import { and, asc, eq, isNull } from "drizzle-orm";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { ENV } from "../_core/env";
import { getDb } from "../db";
import {
  approvalRules,
  approvalSteps,
  expenseItems,
  memberships,
  tenantAuditLogs,
  tenants,
  workPeriods,
  type User,
} from "../../drizzle/schema";

export const idSchema = z.number().int().positive();
export const textField = (max: number) => z.string().trim().min(1).max(max);
export const optionalText = (max: number) =>
  z.string().trim().max(max).optional().nullable();
export const roles = [
  "tenant_admin",
  "manager",
  "employee",
  "finance",
  "administrative",
] as const;
export type TenantRole = (typeof roles)[number];

export async function database() {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Banco de dados indisponível.",
    });
  return db;
}

export function isPlatformAdmin(user: User) {
  return (
    user.role === "admin" &&
    (ENV.platformAdminMode === "role" || user.openId === ENV.ownerOpenId)
  );
}

export function requireActor(user: User | null): User {
  if (!user)
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Entre na sua conta para continuar.",
    });
  return user;
}

async function memberFor(
  db: Awaited<ReturnType<typeof database>>,
  user: User,
  tenantId: number
) {
  let [member] = await db
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.tenantId, tenantId),
        eq(memberships.userId, user.id),
        eq(memberships.active, 1)
      )
    )
    .limit(1);
  if (member) return member;
  if (user.email) {
    const [invite] = await db
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.tenantId, tenantId),
          eq(memberships.email, user.email),
          isNull(memberships.userId),
          eq(memberships.active, 1)
        )
      )
      .limit(1);
    if (invite) {
      await db
        .update(memberships)
        .set({
          userId: user.id,
          joinedAt: new Date(),
          name: user.name || invite.name,
        })
        .where(
          and(
            eq(memberships.id, invite.id),
            eq(memberships.tenantId, tenantId),
            isNull(memberships.userId)
          )
        );
      [member] = await db
        .select()
        .from(memberships)
        .where(
          and(
            eq(memberships.id, invite.id),
            eq(memberships.tenantId, tenantId),
            eq(memberships.userId, user.id)
          )
        )
        .limit(1);
      return member;
    }
  }
  throw new TRPCError({
    code: "FORBIDDEN",
    message: "Você não tem vínculo ativo com esta empresa.",
  });
}

export async function tenantAccess(
  db: Awaited<ReturnType<typeof database>>,
  user: User,
  tenantId: number,
  allowed?: readonly TenantRole[]
) {
  const member = await memberFor(db, user, tenantId);
  if (allowed && !allowed.includes(member.role))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Seu perfil não pode realizar esta ação.",
    });
  return member;
}

export function audit(
  db: Awaited<ReturnType<typeof database>>,
  tenantId: number,
  actorId: number | null,
  entityType: string,
  entityId: number | null,
  action: string,
  metadata?: Record<string, unknown>
) {
  return db.insert(tenantAuditLogs).values({
    tenantId,
    actorMembershipId: actorId,
    entityType,
    entityId,
    action,
    metadata: metadata ?? null,
  });
}

export function weekBounds(dateText: string) {
  const d = new Date(`${dateText}T12:00:00.000Z`);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  const start = d.toISOString().slice(0, 10);
  d.setUTCDate(d.getUTCDate() + 6);
  return { start, end: d.toISOString().slice(0, 10) };
}

export function monthBounds(dateText: string) {
  const [year, month] = dateText.split("-").map(Number);
  return {
    start: `${year}-${String(month).padStart(2, "0")}-01`,
    end: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10),
  };
}

export function dateInTimezone(value: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: string) =>
    parts.find(item => item.type === type)?.value ?? "00";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function workEntryHours(entry: {
  startedAt: Date | string;
  endedAt: Date | string;
  countsAsWork: boolean;
}) {
  if (!entry.countsAsWork) return 0;
  return Math.max(
    0,
    (new Date(entry.endedAt).getTime() - new Date(entry.startedAt).getTime()) /
      3600000
  );
}

export function weekdaysBetween(
  start: string,
  end: string,
  holidays: ReadonlySet<string> = new Set()
) {
  let count = 0;
  const date = new Date(`${start}T12:00:00.000Z`);
  const last = new Date(`${end}T12:00:00.000Z`);
  while (date <= last) {
    const day = date.getUTCDay();
    const key = date.toISOString().slice(0, 10);
    if (day !== 0 && day !== 6 && !holidays.has(key)) count++;
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return count;
}

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function money(value: string | number) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Informe um valor válido.",
    });
  return n.toFixed(2);
}

function receiptKey() {
  if (!ENV.cookieSecret)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "A chave de sessão do projeto não está disponível.",
    });
  return createHash("sha256")
    .update(`${ENV.appId}\0perswebrh-receipts:v1\0${ENV.cookieSecret}`)
    .digest();
}

export function encryptReceipt(data: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", receiptKey(), iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([
    Buffer.from("ORH1"),
    iv,
    cipher.getAuthTag(),
    encrypted,
  ]);
}

export function decryptReceipt(data: Buffer) {
  if (data.length < 32 || data.subarray(0, 4).toString("ascii") !== "ORH1")
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "O comprovante está em formato inválido.",
    });
  try {
    const iv = data.subarray(4, 16);
    const tag = data.subarray(16, 32);
    const decipher = createDecipheriv("aes-256-gcm", receiptKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(data.subarray(32)),
      decipher.final(),
    ]);
  } catch {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Não foi possível descriptografar o comprovante.",
    });
  }
}

export async function periodFor(
  db: Awaited<ReturnType<typeof database>>,
  tenantId: number,
  membershipId: number,
  workDate: string
) {
  const bounds = weekBounds(workDate);
  let [period] = await db
    .select()
    .from(workPeriods)
    .where(
      and(
        eq(workPeriods.tenantId, tenantId),
        eq(workPeriods.membershipId, membershipId),
        eq(workPeriods.periodStart, bounds.start)
      )
    )
    .limit(1);
  if (!period) {
    try {
      const result = await db.insert(workPeriods).values({
        tenantId,
        membershipId,
        periodStart: bounds.start,
        periodEnd: bounds.end,
      });
      const insertedId = Number((result as any)[0]?.insertId);
      [period] = await db
        .select()
        .from(workPeriods)
        .where(
          and(
            eq(workPeriods.tenantId, tenantId),
            eq(workPeriods.membershipId, membershipId),
            eq(workPeriods.periodStart, bounds.start)
          )
        )
        .limit(1);
      if (!period && insertedId)
        [period] = await db
          .select()
          .from(workPeriods)
          .where(
            and(
              eq(workPeriods.id, insertedId),
              eq(workPeriods.tenantId, tenantId)
            )
          )
          .limit(1);
    } catch {
      [period] = await db
        .select()
        .from(workPeriods)
        .where(
          and(
            eq(workPeriods.tenantId, tenantId),
            eq(workPeriods.membershipId, membershipId),
            eq(workPeriods.periodStart, bounds.start)
          )
        )
        .limit(1);
    }
  }
  if (!period)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Não foi possível abrir a folha de ponto.",
    });
  return period;
}

export async function totalsFor(
  db: Awaited<ReturnType<typeof database>>,
  tenantId: number,
  reimbursementId: number
) {
  const items = await db
    .select({ amount: expenseItems.amount })
    .from(expenseItems)
    .where(
      and(
        eq(expenseItems.tenantId, tenantId),
        eq(expenseItems.reimbursementId, reimbursementId)
      )
    );
  return items.reduce((sum, item) => sum + Number(item.amount), 0).toFixed(2);
}

export async function chooseApprovers(
  db: Awaited<ReturnType<typeof database>>,
  tenantId: number,
  requestId: number,
  owner: typeof memberships.$inferSelect,
  total: number,
  categoryIds: number[]
) {
  const rulesList = await db
    .select()
    .from(approvalRules)
    .where(
      and(eq(approvalRules.tenantId, tenantId), eq(approvalRules.active, 1))
    )
    .orderBy(asc(approvalRules.priority));
  const matched = rulesList.filter(rule => {
    const categoryMatches =
      rule.categoryId === null || categoryIds.includes(rule.categoryId);
    const amountMatches =
      (rule.minAmount === null || total >= Number(rule.minAmount)) &&
      (rule.maxAmount === null || total <= Number(rule.maxAmount));
    return categoryMatches && amountMatches;
  });
  const uniqueRules = matched.filter(
    (rule, i, arr) =>
      arr.findIndex(
        r =>
          r.assignedMembershipId === rule.assignedMembershipId &&
          r.approverLabel === rule.approverLabel
      ) === i
  );
  const candidates: { id: number | null; label: string }[] = [];
  for (const rule of uniqueRules) {
    let approverId = rule.assignedMembershipId;
    const label = rule.approverLabel;
    if (!approverId) {
      const lower = label.toLowerCase();
      if (lower.includes("gestor") || lower.includes("manager"))
        approverId = owner.managerMembershipId;
      if (
        !approverId &&
        (lower.includes("finance") || lower.includes("financeiro"))
      ) {
        const [finance] = await db
          .select({ id: memberships.id })
          .from(memberships)
          .where(
            and(
              eq(memberships.tenantId, tenantId),
              eq(memberships.role, "finance"),
              eq(memberships.active, 1)
            )
          )
          .limit(1);
        approverId = finance?.id ?? null;
      }
      if (
        !approverId &&
        (lower.includes("administr") || lower.includes("admin"))
      ) {
        const [admin] = await db
          .select({ id: memberships.id })
          .from(memberships)
          .where(
            and(
              eq(memberships.tenantId, tenantId),
              eq(memberships.role, "administrative"),
              eq(memberships.active, 1)
            )
          )
          .limit(1);
        approverId = admin?.id ?? null;
      }
      if (!approverId) {
        const [admin] = await db
          .select({ id: memberships.id })
          .from(memberships)
          .where(
            and(
              eq(memberships.tenantId, tenantId),
              eq(memberships.role, "tenant_admin"),
              eq(memberships.active, 1)
            )
          )
          .limit(1);
        approverId = admin?.id ?? null;
      }
    }
    if (approverId === owner.id) continue;
    candidates.push({ id: approverId, label });
  }
  const selected = candidates.filter(
    (candidate, i, arr) => arr.findIndex(c => c.id === candidate.id) === i
  );
  if (!selected.length) {
    const [admin] = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          eq(memberships.tenantId, tenantId),
          eq(memberships.role, "tenant_admin"),
          eq(memberships.active, 1)
        )
      )
      .limit(1);
    selected.push({ id: admin?.id ?? null, label: "Administração da empresa" });
  }
  for (let i = 0; i < selected.length; i++) {
    await db.insert(approvalSteps).values({
      tenantId,
      reimbursementId: requestId,
      sequence: i + 1,
      approverMembershipId: selected[i].id,
      approverLabel: selected[i].label,
    });
  }
  return selected[0]?.id ?? null;
}

export const tenantInput = z.object({ tenantId: idSchema });
export const canManage = ["tenant_admin", "manager"] as const;
export const canAdmin = ["tenant_admin"] as const;
