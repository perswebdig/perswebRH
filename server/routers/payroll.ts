import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { and, asc, count, eq, gte, isNull, lt } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import {
  memberships,
  payrollItems,
  payrollRuns,
  tenantHolidays,
  tenants,
  workEntries,
  workSchedules,
  workSettings,
} from "../../drizzle/schema";
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
  hoursDecimal,
  minutesBetween,
  nightMinutesBetween,
  scheduleMinutes,
} from "../payroll/br";

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const monthSchema = z
  .string()
  .regex(/^\d{4}(-(0[1-9]|1[0-2]))?(-01)?$/)
  .transform(value => value.slice(0, 7))
  .refine(value => /^(\d{4}-(0[1-9]|1[0-2]))$/.test(value), {
    message: "Formato do mês: AAAA-MM",
  });

function minutesOfDay(time: string) {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

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
      const spans = blocks.map(block => ({
        start: minutesOfDay(block.start),
        end:
          minutesOfDay(block.end) <= minutesOfDay(block.start)
            ? 24 * 60
            : minutesOfDay(block.end),
      }));
      for (let i = 0; i < spans.length; i++) {
        for (let j = 0; j < spans.length; j++) {
          if (i === j) continue;
          if (spans[j].start > spans[i].start) {
            if (spans[j].start < spans[i].end) return false;
          }
        }
      }
      return true;
    },
    { message: "Os blocos do dia não podem se sobrepor." }
  );

const scheduleInput = tenantInput.extend({
  name: textField(120),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7),
  blocks: blocksSchema,
});

type DbClient = NonNullable<Awaited<ReturnType<typeof database>>>;

async function getWorkSettings(db: DbClient, tenantId: number) {
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

export function monthBounds(month: string) {
  const { year, mon } = splitMonth(month);
  const start = Date.UTC(year, mon - 1, 1, 0, 0, 0);
  const end = Date.UTC(year, mon, 1, 0, 0, 0);
  return { start, end };
}

function daysInMonthCount(month: string) {
  const { year, mon } = splitMonth(month);
  return new Date(Date.UTC(year, mon, 0)).getUTCDate();
}

function isoDateUTC(month: string, day: number) {
  const { year, mon } = splitMonth(month);
  return `${year}-${String(mon).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export const payrollRouter = router({
  // ---------- Jornadas (multiple work schedules) ----------
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
        await db
          .update(workSchedules)
          .set({
            name: input.name,
            daysOfWeek: input.daysOfWeek,
            blocks: input.blocks,
          })
          .where(eq(workSchedules.id, input.scheduleId));
        await audit(db, input.tenantId, member.id, "work_schedule", input.scheduleId, "updated");
        return { scheduleId: input.scheduleId };
      }
      let row: { id: number } | undefined;
      try {
        [row] = await db
          .insert(workSchedules)
          .values({
            tenantId: input.tenantId,
            name: input.name,
            daysOfWeek: input.daysOfWeek,
            blocks: input.blocks,
          })
          .$returningId();
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (message.includes("ER_DUP_ENTRY"))
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Já existe uma jornada com este nome nesta empresa.",
          });
        throw error;
      }
      if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
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

  // ---------- Salários ----------
  listSalaries: protectedProcedure
    .input(tenantInput)
    .query(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      await tenantAccess(db, user, input.tenantId, canAdmin);
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

  // ---------- Folha de pagamento (monthly payroll) ----------
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
          message: `Já existe um rascunho de folha para ${input.referenceMonth} (${input.type}). Feche ou cancele antes de regenerar.`,
        });

      const team = await db
        .select({
          id: memberships.id,
          name: memberships.name,
          role: memberships.role,
          email: memberships.email,
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

      const holidays = await db
        .select({ holidayDate: tenantHolidays.holidayDate })
        .from(tenantHolidays)
        .where(eq(tenantHolidays.tenantId, input.tenantId));
      const holidaySet = new Set(holidays.map(row => row.holidayDate));

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
            gte(workEntries.startedAt, new Date(start)),
            lt(workEntries.startedAt, new Date(end))
          )
        );

      const items: {
        membershipId: number;
        membershipName: string;
        membershipRole: string;
        email: string;
        baseSalaryCents: number;
        workingDays: number;
        expectedMinutes: number;
        workedMinutes: number;
        overtimeMinutes: number;
        nightMinutes: number;
        absenceDays: number;
        absenceDeductionCents: number;
        overtimeCents: number;
        nightAdditionCents: number;
        manualAdditionsCents: number;
        manualDeductionsCents: number;
        grossCents: number;
        inssBaseCents: number;
        inssCents: number;
        irrfCents: number;
        totalDeductionsCents: number;
        netCents: number;
        employerInssCents: number;
        fgtsCents: number;
        employerCostCents: number;
        breakdown: Record<string, unknown>;
      }[] = [];

      for (const memberRow of team) {
        const salaryCents = memberRow.salaryCents;
        if (salaryCents === null || salaryCents === undefined) continue;

        const schedule = memberRow.scheduleId
          ? scheduleMap.get(memberRow.scheduleId)
          : null;
        const activeSchedule = schedule && schedule.active ? schedule : null;
        const dailyMinutes = activeSchedule
          ? scheduleMinutes(activeSchedule.blocks)
          : fallbackDailyMinutes;
        const scheduledDays = activeSchedule
          ? activeSchedule.daysOfWeek
          : fallbackDays;
        if (!scheduledDays.length || dailyMinutes <= 0) {
          // Malformed schedule — build item with zero expectations rather
          // than silently pay full base with no deductions.
        }

        const totalDays = daysInMonthCount(input.referenceMonth);
        let workingDays = 0;
        let expectedMinutesTotal = 0;
        const isWorkDay: boolean[] = new Array(totalDays + 1).fill(false);
        for (let day = 1; day <= totalDays; day++) {
          const dow = new Date(
            Date.UTC(splitMonth(input.referenceMonth).year, splitMonth(input.referenceMonth).mon - 1, day)
          ).getUTCDay();
          if (!scheduledDays.includes(dow)) continue;
          if (holidaySet.has(isoDateUTC(input.referenceMonth, day))) continue;
          isWorkDay[day] = true;
          workingDays++;
          expectedMinutesTotal += dailyMinutes;
        }

        const perDay = new Map<string, number>();
        let workedMinutesTotal = 0;
        let nightMinutesTotal = 0;
        for (const entry of entries) {
          if (entry.membershipId !== memberRow.id || !entry.countsAsWork)
            continue;
          const diff = Math.floor(
            (entry.endedAt.getTime() - entry.startedAt.getTime()) / 60000
          );
          if (diff <= 0) continue;
          perDay.set(entry.workDate, (perDay.get(entry.workDate) ?? 0) + diff);
          nightMinutesTotal += nightMinutesBetween(
            entry.startedAt,
            entry.endedAt,
            timezone
          );
          workedMinutesTotal += diff;
        }

        let absenceDays = 0;
        for (let day = 1; day <= totalDays; day++) {
          if (!isWorkDay[day]) continue;
          if (!(perDay.get(isoDateUTC(input.referenceMonth, day)) ?? 0))
            absenceDays++;
        }

        const perMinute = salaryCents / (expectedMinutesTotal || 1);
        // Overtime is evaluated per day: worked minutes beyond the scheduled
        // block total (scheduled days count their block, non-scheduled days
        // move the whole day into overtime).
        let overtimeMinutes = 0;
        for (let day = 1; day <= totalDays; day++) {
          if (!(perDay.get(isoDateUTC(input.referenceMonth, day)) ?? 0)) continue;
          const expectedDay = isWorkDay[day] ? dailyMinutes : 0;
          overtimeMinutes += Math.max(
            0,
            (perDay.get(isoDateUTC(input.referenceMonth, day)) ?? 0) - expectedDay
          );
        }
        const overtimeCents = Math.round(
          perMinute * overtimeMinutes * OVERTIME_MULTIPLIER
        );
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
        const grossCents = salaryCents + overtimeCents + nightAdditionCents + manualAdditionsCents;
        const totalDeductionsCents =
          absenceDeductionCents + inssCents + irrfCents + manualDeductionsCents;
        const netCents = grossCents - totalDeductionsCents;
        const employerInssCents = employerInss(inssBase);
        const fgtsCents = fgts(inssBase);
        const employerCostCents = grossCents + employerInssCents + fgtsCents;

        items.push({
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
            workedHours: hoursDecimal(workedMinutesTotal),
            overtimeHours: hoursDecimal(overtimeMinutes),
            nightHours: hoursDecimal(nightMinutesTotal),
            perMinuteValue: Math.round(perMinute * 100) / 100,
            schedule: activeSchedule
              ? {
                  kind: "schedule",
                  name: activeSchedule.name,
                  days: activeSchedule.daysOfWeek,
                  blocks: activeSchedule.blocks,
                }
              : {
                  kind: "default",
                  days: fallbackDays,
                  dailyMinutes: fallbackDailyMinutes,
                },
          },
        });
      }

      const grossTotal = items.reduce((s, i) => s + i.grossCents, 0);
      const deductionTotal = items.reduce((s, i) => s + i.totalDeductionsCents, 0);
      const netTotal = items.reduce((s, i) => s + i.netCents, 0);
      const employerTotal = items.reduce((s, i) => s + i.employerCostCents, 0);

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
          itemTotal: items.length,
          createdByMembershipId: member.id,
        })
        .$returningId();
      for (const item of items) {
        await db.insert(payrollItems).values({
          runId: run.id,
          tenantId: input.tenantId,
          membershipId: item.membershipId,
          baseSalaryCents: item.baseSalaryCents,
          workingDays: item.workingDays,
          expectedMinutes: item.expectedMinutes,
          workedMinutes: item.workedMinutes,
          overtimeMinutes: item.overtimeMinutes,
          nightMinutes: item.nightMinutes,
          absenceDays: item.absenceDays,
          absenceDeductionCents: item.absenceDeductionCents,
          overtimeCents: item.overtimeCents,
          nightAdditionCents: item.nightAdditionCents,
          manualAdditionsCents: item.manualAdditionsCents,
          manualDeductionsCents: item.manualDeductionsCents,
          grossCents: item.grossCents,
          inssBaseCents: item.inssBaseCents,
          inssCents: item.inssCents,
          irrfCents: item.irrfCents,
          totalDeductionsCents: item.totalDeductionsCents,
          netCents: item.netCents,
          employerInssCents: item.employerInssCents,
          fgtsCents: item.fgtsCents,
          employerCostCents: item.employerCostCents,
          breakdown: item.breakdown,
        });
      }
      await audit(db, input.tenantId, member.id, "payroll_run", run.id, "generated", {
        referenceMonth: input.referenceMonth,
        items: items.length,
      });
      return {
        runId: run.id,
        month: input.referenceMonth,
        items: items.length,
        skippedNoSalary: team.length - items.length,
        netCents: netTotal,
      };
    }),

  summarize: protectedProcedure
    .input(tenantInput)
    .query(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      await tenantAccess(db, user, input.tenantId);
      const runs = await db
        .select()
        .from(payrollRuns)
        .where(eq(payrollRuns.tenantId, input.tenantId))
        .orderBy(asc(payrollRuns.referenceMonth));
      const [missing] = await db
        .select({ total: count() })
        .from(memberships)
        .where(
          and(
            eq(memberships.tenantId, input.tenantId),
            eq(memberships.active, 1),
            isNull(memberships.salaryCents)
          )
        );
      return { runs, missingSalaries: missing?.total ?? 0 };
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
        item.baseSalaryCents +
        item.overtimeCents +
        item.nightAdditionCents +
        input.manualAdditionsCents;
      const inssBase = Math.max(0, grossCents - input.manualDeductionsCents);
      const inssCents = Math.round(calculateInss(inssBase));
      const irrfCents = Math.round(calculateIrrf(Math.max(0, inssBase - inssCents)));
      const totalDeductionsCents =
        item.absenceDeductionCents +
        inssCents +
        irrfCents +
        input.manualDeductionsCents;
      const netCents = grossCents - totalDeductionsCents;
      const employerInssCents = employerInss(inssBase);
      const fgtsCents = fgts(inssBase);
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
          employerInssCents,
          fgtsCents,
          employerCostCents: grossCents + employerInssCents + fgtsCents,
        })
        .where(eq(payrollItems.id, item.id));
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
