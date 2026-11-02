import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { memberships, payrollItems, workEntries, workSchedules, workSettings, tenants } from "../../drizzle/schema";
import {
  audit,
  canAdmin,
  database,
  idSchema,
  optionalText,
  requireActor,
  tenantAccess,
  tenantInput,
  textField,
} from "./shared";
import {
  EMPLOYER_INSS_RATE,
  FGTS_RATE,
  NIGHT_ADDITION_MULTIPLIER,
  OVERTIME_MULTIPLIER,
  calculateInss,
  calculateIrrf,
  employerInss,
  fgts,
  minutesBetween,
  nightMinutesBetween,
  scheduleMinutes,
  hoursDecimal,
} from "../payroll/br";

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const monthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
  .or(z.string().regex(/^\d{4}-\d{2}-01$/))
  .transform(value => value.slice(0, 7));

const blocksSchema = z
  .array(
    z
      .object({ start: timeSchema, end: timeSchema })
      .refine(({ start, end }) => start !== end, {
        message: "O bloco precisa ter início diferente do fim.",
      })
  )
  .min(1)
  .max(12)
  .refine(
    blocks => {
      const sorted = [...blocks].sort((a, b) =>
        a.start < b.start ? -1 : 1
      );
      for (let i = 0; i < sorted.length - 1; i++) {
        const prevEnd = minutesBetween(sorted[i].start, sorted[i].end) +
          minutesOfDay(sorted[i].start);
        if (sorted[i].end < sorted[i].start) {
          // overnight block fills the rest of the day; next overlaps
          prevEnd = 24 * 60;
        }
        if (minutesOfDay(sorted[i + 1].start) < prevEnd) return false;
      }
      return true;
    },
    { message: "Os blocos do dia não podem se sobrepor." }
  );

function minutesOfDay(time: string) {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

const scheduleInput = tenantInput.extend({
  name: textField(120),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7),
  blocks: blocksSchema,
});

async function getWorkSettings(db: NonNullable<Awaited<ReturnType<typeof database>>>, tenantId: number) {
  const [settings] = await db
    .select()
    .from(workSettings)
    .where(eq(workSettings.tenantId, tenantId))
    .limit(1);
  return settings ?? null;
}

function splitMonth(month: string) {
  const [year, mon] = month.split("-").map(Number);
  return { year, mon };
}

function monthBounds(month: string) {
  const { year, mon } = splitMonth(month);
  const start = Date.UTC(year, mon - 1, 1, 0, 0, 0);
  const end = Date.UTC(year, mon, 1, 0, 0, 0) - 1;
  return { start, end };
}

function daysInMonth(month: string) {
  const { year, mon } = splitMonth(month);
  return new Date(Date.UTC(year, mon, 0)).getUTCDate();
}

function isoDateUTC(month: string, day: number) {
  const { year, mon } = splitMonth(month);
  const y = year;
  const m = String(mon).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export const payrollRouter = router({
  // ---------- Jornadas (work schedules) ----------
  listSchedules: protectedProcedure
    .input(tenantInput)
    .query(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      await tenantAccess(db, user, input.tenantId);
      return db
        .select()
        .from(workSchedules)
        .where(eq(workSchedules.tenantId, input.tenantId))
        .orderBy(asc(workSchedules.name));
    }),

  saveSchedule: protectedProcedure
    .input(scheduleInput.extend({ scheduleId: idSchema.optional() }))
    .mutation(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      const member = await tenantAccess(db, user, input.tenantId, canAdmin);
      if (!input.daysOfWeek.length)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Escolha pelo menos um dia da semana.",
        });
      if (input.scheduleId) {
        const [updated] = await db
          .select({ id: workSchedules.id })
          .from(workSchedules)
          .where(
            and(
              eq(workSchedules.id, input.scheduleId),
              eq(workSchedules.tenantId, input.tenantId)
            )
          );
        if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
        try {
          await db
            .update(workSchedules)
            .set({
              name: input.name,
              daysOfWeek: input.daysOfWeek,
              blocks: input.blocks,
            })
            .where(eq(workSchedules.id, input.scheduleId));
        } catch {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Já existe outra jornada com este nome.",
          });
        }
        await audit(db, input.tenantId, member.id, "work_schedule", input.scheduleId, "updated");
        return { scheduleId: input.scheduleId };
      }
      const [row] = await db
        .insert(workSchedules)
        .values({
          tenantId: input.tenantId,
          name: input.name,
          daysOfWeek: input.daysOfWeek,
          blocks: input.blocks,
        })
        .$returningId();
      await audit(db, input.tenantId, member.id, "work_schedule", row.id, "created");
      return { scheduleId: row.id };
    }),

  toggleSchedule: protectedProcedure
    .input(tenantInput.extend({ scheduleId: idSchema, active: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      const member = await tenantAccess(db, user, input.tenantId, canAdmin);
      await db
        .update(workSchedules)
        .set({ active: input.active ? 1 : 0 })
        .where(
          and(
            eq(workSchedules.id, input.scheduleId),
            eq(workSchedules.tenantId, input.tenantId)
          )
        );
      await audit(db, input.tenantId, member.id, "work_schedule", input.scheduleId, input.active ? "activated" : "deactivated");
      return { success: true };
    }),

  deleteSchedule: protectedProcedure
    .input(tenantInput.extend({ scheduleId: idSchema }))
    .mutation(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      const member = await tenantAccess(db, user, input.tenantId, canAdmin);
      // Unassign members first to keep references honest.
      await db
        .update(memberships)
        .set({ scheduleId: null })
        .where(
          and(
            eq(memberships.tenantId, input.tenantId),
            eq(memberships.scheduleId, input.scheduleId)
          )
        );
      await db
        .delete(workSchedules)
        .where(
          and(
            eq(workSchedules.id, input.scheduleId),
            eq(workSchedules.tenantId, input.tenantId)
          )
        );
      await audit(db, input.tenantId, member.id, "work_schedule", input.scheduleId, "deleted");
      return { success: true };
    }),

  assignSchedule: protectedProcedure
    .input(
      tenantInput.extend({
        scheduleId: idSchema.nullable(),
        membershipId: idSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      const member = await tenantAccess(db, user, input.tenantId, canAdmin);
      if (input.scheduleId !== null) {
        const [schedule] = await db
          .select({ id: workSchedules.id })
          .from(workSchedules)
          .where(
            and(
              eq(workSchedules.id, input.scheduleId),
              eq(workSchedules.tenantId, input.tenantId)
            )
          );
        if (!schedule)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Jornada inexistente nesta empresa.",
          });
      }
      await db
        .update(memberships)
        .set({ scheduleId: input.scheduleId })
        .where(
          and(
            eq(memberships.id, input.membershipId),
            eq(memberships.tenantId, input.tenantId)
          )
        );
      await audit(db, input.tenantId, member.id, "membership", input.membershipId, input.scheduleId ? "schedule_assigned" : "schedule_unassigned", { scheduleId: input.scheduleId });
      return { success: true };
    }),

  // ---------- Salário (para compor a folha) ----------
  listSalaries: protectedProcedure
    .input(tenantInput)
    .query(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      const member = await tenantAccess(db, user, input.tenantId, canAdmin);
      // Admin-only quick listing of who has/doesn't have a salary on file.
      return db
        .select({
          membershipId: memberships.id,
          name: memberships.name,
          email: memberships.email,
          salaryCents: memberships.salaryCents,
          scheduleId: memberships.scheduleId,
          active: memberships.active,
        })
        .from(memberships)
        .where(eq(memberships.tenantId, input.tenantId))
        .orderBy(asc(memberships.name));
    }),

  setSalary: protectedProcedure
    .input(
      tenantInput.extend({
        membershipId: idSchema,
        salaryCents: z.number().int().min(0).max(100_000_000).nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      const member = await tenantAccess(db, user, input.tenantId, canAdmin);
      await db
        .update(memberships)
        .set({ salaryCents: input.salaryCents })
        .where(
          and(
            eq(memberships.id, input.membershipId),
            eq(memberships.tenantId, input.tenantId)
          )
        );
      await audit(db, input.tenantId, member.id, "membership", input.membershipId, "salary_updated", { salaryCents: input.salaryCents });
      return { success: true };
    }),

  // ---------- Folha de pagamento ----------
  generate: protectedProcedure
    .input(
      tenantInput.extend({
        referenceMonth: monthSchema,
        type: z
          .enum(["normal", "complementar", "13_salario", "ferias"])
          .default("normal"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      const member = await tenantAccess(db, user, input.tenantId, canAdmin);
      // Any pending draft for this month+type blocks a regeneration to avoid
      // silently overwriting manual adjustments.
      const [existingDraft] = await db
        .select({ id: payrollRuns.id })
        .from(payrollRuns)
        .where(
          and(
            eq(payrollRuns.tenantId, input.tenantId),
            eq(payrollRuns.referenceMonth, input.referenceMonth),
            eq(payrollRuns.type, input.type),
            eq(payrollRuns.status, "draft")
          )
        )
        .limit(1);
      if (existingDraft)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Já existe um rascunho de folha para ${input.referenceMonth} (${input.type}). Feche-o ou cancele antes de regenerar.`,
        });

      const team = await db
        .select({
          id: memberships.id,
          name: memberships.name,
          email: memberships.email,
          role: memberships.role,
          salaryCents: memberships.salaryCents,
          scheduleId: memberships.scheduleId,
        })
        .from(memberships)
        .where(
          and(
            eq(memberships.tenantId, input.tenantId),
            eq(memberships.active, 1)
          )
        );
      const schedules = await db
        .select()
        .from(workSchedules)
        .where(eq(workSchedules.tenantId, input.tenantId));
      const scheduleMap = new Map(schedules.map(schedule => [schedule.id, schedule]));

      const settings = await getWorkSettings(db, input.tenantId);
      const fallbackDailyMinutes =
        Math.round(Number(settings?.dailyHours ?? "8") * 60) || 480;
      const fallbackDays = [1, 2, 3, 4, 5];

      const [tenant] = await db
        .select({ timezone: tenants.timezone })
        .from(tenants)
        .where(eq(tenants.id, input.tenantId));
      const timezone = tenant?.timezone ?? "America/Sao_Paulo";

      const holidaysList = await db
        .select({ holidayDate: (await import("../../drizzle/schema")).tenantHolidays.holidayDate })
        .from((await import("../../drizzle/schema")).tenantHolidays)
        .where(eq((await import("../../drizzle/schema")).tenantHolidays.tenantId, input.tenantId));
      const holidaySet = new Set(holidaysList.map(row => row.holidayDate));

      const { start, end } = monthBounds(input.referenceMonth);
      const entries = await db
        .select({
          membershipId: workEntries.membershipId,
          workDate: workEntries.workDate,
          startedAt: workEntries.startedAt,
          endedAt: workEntries.endedAt,
          countsAsWork: workEntries.countsAsWork,
        })
        .from(workEntries)
        .where(
          and(
            eq(workEntries.tenantId, input.tenantId),
            // 六 month window via string compare is safe: workDate is a DATE string
            void eq(workEntries.workDate, workEntries.workDate)
          )
        );
      const monthEntries = entries.filter(entry =>
        entry.workDate.startsWith(input.referenceMonth + "-")
      );

      const itemsInput = [];
      for (const memberRow of team) {
        const salaryCents = memberRow.salaryCents ?? null;
        if (salaryCents === null) continue;
        const schedule = memberRow.scheduleId
          ? scheduleMap.get(memberRow.scheduleId)
          : null;
        const activeSchedule =
          schedule && schedule.active ? schedule : null;
        const dailyMinutes = activeSchedule
          ? scheduleMinutes(activeSchedule.blocks)
          : fallbackDailyMinutes;
        const scheduledDays = activeSchedule
          ? activeSchedule.daysOfWeek
          : fallbackDays;

        let workingDays = 0;
        let expectedMinutesTotal = 0;
        for (let day = 1; day <= daysInMonth(input.referenceMonth); day++) {
          const date = new Date(Date.UTC(
            splitMonth(input.referenceMonth).year,
            splitMonth(input.referenceMonth).mon - 1,
            day
          ));
          const dow = date.getUTCDay();
          if (!scheduledDays.includes(dow)) continue;
          if (holidaySet.has(isoDateUTC(input.referenceMonth, day))) continue;
          workingDays++;
          expectedMinutesTotal += dailyMinutes;
        }

        // Aggregate per-day worked minutes from entries.
        const perDay = new Map<string, number>();
        let workedMinutesTotal = 0;
        let nightMinutesTotal = 0;
        for (const entry of monthEntries) {
          if (entry.membershipId !== memberRow.id || !entry.countsAsWork)
            continue;
          const diff = Math.floor(
            (entry.endedAt.getTime() - entry.startedAt.getTime()) / 60000
          );
          if (diff <= 0) continue;
          const minutes = diff;
          perDay.set(
            entry.workDate,
            (perDay.get(entry.workDate) ?? 0) + minutes
          );
          nightMinutesTotal += nightMinutesBetween(entry.startedAt, entry.endedAt, timezone);
          workedMinutesTotal += minutes;
        }

        let absenceDays = 0;
        for (let day = 1; day <= daysInMonth(input.referenceMonth); day++) {
          const date = new Date(Date.UTC(
            splitMonth(input.referenceMonth).year,
            splitMonth(input.referenceMonth).mon - 1,
            day
          ));
          if (!scheduledDays.includes(date.getUTCDay())) continue;
          if (holidaySet.has(isoDateUTC(input.referenceMonth, day))) continue;
          if (!(perDay.get(isoDateUTC(input.referenceMonth, day)) ?? 0))
            absenceDays++;
        }

        const perMinute = salaryCents / (expectedMinutesTotal || 1);
        const overtimeMinutes = Math.max(0, workedMinutesTotal - expectedMinutesTotal);
        const overtimeCents = Math.round(perMinute * overtimeMinutes * OVERTIME_MULTIPLIER);
        const nightAdditionCents = Math.round(
          perMinute * nightMinutesTotal * NIGHT_ADDITION_MULTIPLIER
        );
        const absenceDeductionCents = Math.round(perMinute * dailyMinutes * absenceDays);
        const manualAdditionsCents = 0;
        const manualDeductionsCents = 0;

        const subtotal =
          salaryCents - absenceDeductionCents + overtimeCents + nightAdditionCents;
        const inssBase = Math.max(0, subtotal);
        const inssCents = Math.round(calculateInss(inssBase));
        const irrfCents = Math.round(calculateIrrf(Math.max(0, inssBase - inssCents)));
        const grossCents = subtotal + manualAdditionsCents;
        const totalDeductionsCents =
          absenceDeductionCents + inssCents + irrfCents + manualDeductionsCents;
        const netCents = grossCents - totalDeductionsCents;
        const employerInssCents = employerInss(inssBase);
        const fgtsCents = fgts(inssBase);
        const employerCostCents = grossCents + employerInssCents + fgtsCents;

        itemsInput.push({
          membershipId: memberRow.id,
          membershipName: memberRow.name,
          membershipRole: memberRow.role,
          email: memberRow.email,
          baseSalaryCents: salaryCents,
          workingDays,
          expectedMinutes: expectedMinutesTotal,
          workedMinutes: workedMinutesTotal,
          overtimeMinutes,
          nightMinutes: nightMinutesTotal,
          absenceDays,
          absenceDeductionCents,
          overtimeCents,
          nightAdditionCents,
          manualAdditionsCents,
          manualDeductionsCents,
          grossCents,
          inssBaseCents: inssBase,
          inssCents,
          irrfCents,
          totalDeductionsCents,
          netCents,
          employerInssCents,
          fgtsCents,
          employerCostCents,
          breakdown: {
            hoursDecimal: hoursDecimal(workedMinutesTotal),
            overtime: hoursDecimal(overtimeMinutes),
            night: hoursDecimal(nightMinutesTotal),
            perMinute,
            schedule: activeSchedule
              ? { name: activeSchedule.name, days: activeSchedule.daysOfWeek, blocks: activeSchedule.blocks }
              : { name: "Padrão do RH", days: fallbackDays, minutes: fallbackDailyMinutes },
          },
        });
      }

      const grossTotal = itemsInput.reduce((s, i) => s + i.grossCents, 0);
      const deductionTotal = itemsInput.reduce((s, i) => s + i.totalDeductionsCents, 0);
      const netTotal = itemsInput.reduce((s, i) => s + i.netCents, 0);
      const employerTotal = itemsInput.reduce((s, i) => s + i.employerCostCents, 0);

      const [run] = await db
        .insert(payrollRuns)
        .values({
          tenantId: input.tenantId,
          referenceMonth: input.referenceMonth,
          type: input.type,
          grossCents: grossTotal,
          totalDeductionsCents: deductionTotal,
          netCents: netTotal,
          employerCostCents: employerTotal,
          itemTotal: itemsInput.length,
          createdByMembershipId: member.id,
        })
        .$returningId();
      for (const item of itemsInput) {
        const { membershipName, membershipRole, email, ...values } = item;
        void membershipName;
        void membershipRole;
        void email;
        await db.insert(payrollItems).values({
          runId: run.id,
          tenantId: input.tenantId,
          ...values,
        });
      }
      await audit(db, input.tenantId, member.id, "payroll_run", run.id, "generated", {
        referenceMonth: input.referenceMonth,
        items: itemsInput.length,
      });
      return {
        runId: run.id,
        month: input.referenceMonth,
        items: itemsInput.length,
        skipped: team.length - itemsInput.length,
        netCents: netTotal,
      };
    }),

  summarize: protectedProcedure
    .input(tenantInput)
    .query(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      await tenantAccess(db, user, input.tenantId);
      const runs = await db.query.payrollRuns
        ? []
        : [];
      void runs;
      const list = await db
        .select()
        .from(payrollRuns)
        .where(eq(payrollRuns.tenantId, input.tenantId))
        .orderBy(asc(payrollRuns.referenceMonth));
      const salaries = await db.query.payrollItems
        ? []
        : [];
      void salaries;
      const withoutSalary = await db
        .select({ total: (await import("drizzle-orm")).count() })
        .from(memberships)
        .where(
          and(
            eq(memberships.tenantId, input.tenantId),
            eq(memberships.active, 1),
            (await import("drizzle-orm")).isNull(memberships.salaryCents)
          )
        );
      return { runs: list, missingSalaries: (withoutSalary[0]?.total ?? 0) > 0, missingSalariesCount: withoutSalary[0]?.total ?? 0 };
    }),

  closeRun: protectedProcedure
    .input(tenantInput.extend({ runId: idSchema }))
    .mutation(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      const member = await tenantAccess(db, user, input.tenantId, canAdmin);
      const [run] = await db
        .select()
        .from(payrollRuns)
        .where(
          and(
            eq(payrollRuns.id, input.runId),
            eq(payrollRuns.tenantId, input.tenantId)
          )
        );
      if (!run) throw new TRPCError({ code: "NOT_FOUND" });
      if (run.status !== "draft")
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Somente rascunhos podem ser fechados.",
        });
      await db
        .update(payrollRuns)
        .set({ status: "closed", closedAt: new Date() })
        .where(eq(payrollRuns.id, run.id));
      await audit(db, input.tenantId, member.id, "payroll_run", run.id, "closed");
      return { success: true };
    }),

  cancelRun: protectedProcedure
    .input(tenantInput.extend({ runId: idSchema }))
    .mutation(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      const member = await tenantAccess(db, user, input.tenantId, canAdmin);
      const [run] = await db
        .select()
        .from(payrollRuns)
        .where(
          and(
            eq(payrollRuns.id, input.runId),
            eq(payrollRuns.tenantId, input.tenantId)
          )
        );
      if (!run) throw new TRPCError({ code: "NOT_FOUND" });
      if (run.status !== "draft")
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Rascunhos fechados não podem ser cancelados.",
        });
      await db
        .update(payrollRuns)
        .set({ status: "canceled" })
        .where(eq(payrollRuns.id, run.id));
      await audit(db, input.tenantId, member.id, "payroll_run", run.id, "canceled");
      return { success: true };
    }),

  adjustItem: protectedProcedure
    .input(
      tenantInput.extend({
        itemId: idSchema,
        manualAdditionsCents: z.number().int().min(0).max(10_000_000),
        manualDeductionsCents: z.number().int().min(0).max(10_000_000),
        additionsNote: optionalText(240),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      const member = await tenantAccess(db, user, input.tenantId, canAdmin);
      const [item] = await db
        .select()
        .from(payrollItems)
        .where(
          and(
            eq(payrollItems.id, input.itemId),
            eq(payrollItems.tenantId, input.tenantId)
          )
        );
      if (!item) throw new TRPCError({ code: "NOT_FOUND" });
      const [run] = await db
        .select()
        .from(payrollRuns)
        .where(eq(payrollRuns.id, item.runId));
      if (!run || run.status !== "draft")
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "A folha foi fechada; ajustes só valem em rascunho.",
        });
      const grossCents =
        item.baseSalaryCents -
        item.absenceDeductionCents +
        item.overtimeCents +
        item.nightAdditionCents +
        input.manualAdditionsCents;
      const inssBase = Math.max(0, grossCents - input.manualDeductionsCents);
      const inssCents = Math.round(calculateInss(inssBase));
      const irrfCents = Math.round(
        calculateIrrf(Math.max(0, inssBase - inssCents))
      );
      const totalDeductionsCents =
        item.absenceDeductionCents +
        inssCents +
        irrfCents +
        input.manualDeductionsCents;
      const netCents = grossCents - totalDeductionsCents;
      await db
        .update(payrollItems)
        .set({
          manualAdditionsCents: input.manualAdditionsCents,
          manualDeductionsCents: input.manualDeductionsCents,
          additionsNote: input.additionsNote ?? null,
          grossCents,
          inssBaseCents: inssBase,
          inssCents,
          irrfCents,
          totalDeductionsCents,
          netCents,
          employerInssCents: Math.round(inssBase * EMPLOYER_INSS_RATE),
          fgtsCents: Math.round(inssBase * FGTS_RATE),
          employerCostCents: grossCents + Math.round(inssBase * EMPLOYER_INSS_RATE) + Math.round(inssBase * FGTS_RATE),
        })
        .where(eq(payrollItems.id, item.id));
      // Keep run totals in sync.
      const allItems = await db
        .select({
          gross: payrollItems.grossCents,
          ded: payrollItems.totalDeductionsCents,
          net: payrollItems.netCents,
          cost: payrollItems.employerCostCents,
        })
        .from(payrollItems)
        .where(eq(payrollItems.runId, run.id));
      await db
        .update(payrollRuns)
        .set({
          grossCents: allItems.reduce((s, i) => s + i.gross, 0),
          totalDeductionsCents: allItems.reduce((s, i) => s + i.ded, 0),
          netCents: allItems.reduce((s, i) => s + i.net, 0),
          employerCostCents: allItems.reduce((s, i) => s + i.cost, 0),
        })
        .where(eq(payrollRuns.id, run.id));
      await audit(db, input.tenantId, member.id, "payroll_item", item.id, "adjusted", {
        additions: input.manualAdditionsCents,
        deductions: input.manualDeductionsCents,
      });
      return { success: true };
    }),

  runDetail: protectedProcedure
    .input(tenantInput.extend({ runId: idSchema }))
    .query(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      await tenantAccess(db, user, input.tenantId);
      const [run] = await db
        .select()
        .from(payrollRuns)
        .where(
          and(
            eq(payrollRuns.id, input.runId),
            eq(payrollRuns.tenantId, input.tenantId)
          )
        );
      if (!run) throw new TRPCError({ code: "NOT_FOUND" });
      const items = await db
        .select({
          item: payrollItems,
          memberName: memberships.name,
          memberEmail: memberships.email,
        })
        .from(payrollItems)
        .innerJoin(memberships, eq(memberships.id, payrollItems.membershipId))
        .where(eq(payrollItems.runId, run.id))
        .orderBy(asc(memberships.name));
      return { run, items };
    }),
});
