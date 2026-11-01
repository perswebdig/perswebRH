import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  departments,
  importJobs,
  memberships,
  tenantAuditLogs,
} from "../../drizzle/schema";
import {
  audit,
  canAdmin,
  database,
  idSchema,
  requireActor,
  tenantAccess,
  tenantInput,
} from "./shared";

type CsvRow = Record<string, string>;

function parseCsv(text: string): { headers: string[]; rows: CsvRow[] } {
  const lines = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = splitCsvLine(lines[0]).map(value => value.trim());
  const rows = lines.slice(1).map(line => {
    const values = splitCsvLine(line);
    const row: CsvRow = {};
    headers.forEach((header, index) => {
      row[header] = (values[index] ?? "").trim();
    });
    return row;
  });
  return { headers, rows };
}

function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

function validateRow(row: CsvRow, index: number) {
  const errors: string[] = [];
  if (!row.name) errors.push("nome obrigatório");
  if (!row.email || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(row.email))
    errors.push("e-mail inválido");
  if (row.role && !["employee", "manager", "finance", "administrative"].includes(row.role))
    errors.push("perfil inválido");
  return { index, row, errors };
}

export const importsRouter = router({
  previewCsv: protectedProcedure
    .input(tenantInput.extend({ csvText: z.string().min(1).max(5_000_000) }))
    .mutation(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      await tenantAccess(db, user, input.tenantId, canAdmin);
      const { headers, rows } = parseCsv(input.csvText);
      const required = ["name", "email"];
      const missing = required.filter(column => !headers.includes(column));
      const validated = rows.map((row, index) => validateRow(row, index + 2));
      return {
        headers,
        missingColumns: missing,
        total: rows.length,
        valid: validated.filter(item => item.errors.length === 0).length,
        invalid: validated.filter(item => item.errors.length > 0).length,
        rows: validated.slice(0, 100),
      };
    }),
  commitCsv: protectedProcedure
    .input(tenantInput.extend({ csvText: z.string().min(1).max(5_000_000) }))
    .mutation(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      const actor = await tenantAccess(db, user, input.tenantId, canAdmin);
      const { rows } = parseCsv(input.csvText);
      const existing = await db
        .select({ email: memberships.email })
        .from(memberships)
        .where(eq(memberships.tenantId, input.tenantId));
      const existingEmails = new Set(existing.map(item => item.email.toLowerCase()));
      const deptCache = new Map<string, number>();
      const departmentsList = await db
        .select()
        .from(departments)
        .where(eq(departments.tenantId, input.tenantId));
      departmentsList.forEach(dept => deptCache.set(dept.name.toLowerCase(), dept.id));

      let created = 0;
      let skipped = 0;
      const errors: string[] = [];
      for (const row of rows) {
        const validation = validateRow(row, 0);
        if (validation.errors.length > 0) {
          skipped++;
          errors.push(`${row.email || "linha"}: ${validation.errors.join(", ")}`);
          continue;
        }
        const email = row.email.toLowerCase();
        if (existingEmails.has(email)) {
          skipped++;
          errors.push(`${email}: já cadastrado`);
          continue;
        }
        let departmentId: number | null = null;
        if (row.department) {
          const key = row.department.toLowerCase();
          if (!deptCache.has(key)) {
            const [id] = await db
              .insert(departments)
              .values({ tenantId: input.tenantId, name: row.department })
              .$returningId();
            deptCache.set(key, id.id);
          }
          departmentId = deptCache.get(key) ?? null;
        }
        await db.insert(memberships).values({
          tenantId: input.tenantId,
          email,
          name: row.name,
          role: (row.role as "employee" | "manager" | "finance" | "administrative") || "employee",
          departmentId,
          active: 1,
          joinedAt: null,
        });
        existingEmails.add(email);
        created++;
      }
      await db.insert(importJobs).values({
        tenantId: input.tenantId,
        type: "csv",
        status: "completed",
        fileName: "importacao.csv",
        createdByMembershipId: actor.id,
        summary: { created, skipped, errors: errors.slice(0, 50) },
      });
      await audit(db, input.tenantId, actor.id, "import", null, "csv_completed", {
        created,
        skipped,
      });
      return { created, skipped, errors: errors.slice(0, 50) };
    }),
});
