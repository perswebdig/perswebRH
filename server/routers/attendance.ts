import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
} from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { ENV } from "../_core/env";
import { protectedProcedure, router } from "../_core/trpc";
import {
  approvalRules,
  approvalSteps,
  departments,
  expenseAttachments,
  expenseCategories,
  expenseItems,
  memberships,
  reimbursements,
  tenantAuditLogs,
  tenantHolidays,
  tenants,
  users,
  workEntries,
  workPeriods,
  workSettings,
  type User,
} from "../../drizzle/schema";
import {
  audit,
  canAdmin,
  canManage,
  chooseApprovers,
  dateInTimezone,
  database,
  decryptReceipt,
  encryptReceipt,
  idSchema,
  monthBounds,
  money,
  optionalText,
  periodFor,
  requireActor,
  roles,
  tenantAccess,
  tenantInput,
  textField,
  totalsFor,
  weekBounds,
  weekdaysBetween,
  workEntryHours,
} from "./shared";

const entryFields = {
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime(),
  activity: textField(2000),
  markType: textField(80),
  project: optionalText(160),
  costCenter: optionalText(120),
  locationMode: z.enum(["preset", "geolocation", "manual"]),
  locationName: textField(180),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  customFields: z
    .record(z.string().max(80), z.string().max(1000))
    .refine(fields => Object.keys(fields).length <= 20)
    .optional(),
};

const entryInput = tenantInput.extend(entryFields);

type EntryInput = z.infer<typeof entryInput>;

async function validateEntry(
  db: Awaited<ReturnType<typeof database>>,
  tenantId: number,
  membershipId: number,
  input: EntryInput,
  excludeEntryId?: number
) {
  const start = new Date(input.startedAt);
  const end = new Date(input.endedAt);
  const [tenant] = await db
    .select({ timezone: tenants.timezone })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  const timezone = tenant?.timezone ?? "America/Sao_Paulo";
  if (
    end <= start ||
    dateInTimezone(start, timezone) !== input.workDate ||
    dateInTimezone(end, timezone) !== input.workDate
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "A faixa precisa ter fim depois do início e permanecer no mesmo dia da empresa.",
    });
  if (
    input.locationMode === "geolocation" &&
    (input.latitude == null || input.longitude == null)
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "A localização precisa de latitude e longitude.",
    });
  const period = await periodFor(db, tenantId, membershipId, input.workDate);
  if (period.status !== "draft" && period.status !== "rejected")
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "A folha enviada ou aprovada não pode ser alterada.",
    });
  const existing = await db
    .select()
    .from(workEntries)
    .where(
      and(
        eq(workEntries.tenantId, tenantId),
        eq(workEntries.membershipId, membershipId),
        eq(workEntries.workDate, input.workDate)
      )
    );
  if (
    existing.some(
      entry =>
        entry.id !== excludeEntryId &&
        start < new Date(entry.endedAt) &&
        end > new Date(entry.startedAt)
    )
  )
    throw new TRPCError({
      code: "CONFLICT",
      message: "Esta faixa coincide com outra marcação do dia.",
    });
  const [settings] = await db
    .select()
    .from(workSettings)
    .where(eq(workSettings.tenantId, tenantId))
    .limit(1);
  if (settings && !settings.markTypes.includes(input.markType))
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Tipo de marcação não configurado pela empresa.",
    });
  if (
    input.locationMode === "preset" &&
    settings &&
    !settings.locations.includes(input.locationName)
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Selecione um local cadastrado pela empresa.",
    });
  const allowedFields = new Set(settings?.customFields ?? []);
  if (
    Object.keys(input.customFields ?? {}).some(
      key => !allowedFields.has(key)
    )
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Campo personalizado não configurado pela empresa.",
    });
  return { start, end, period, settings };
}

export const attendanceRouter = router({
  myWeek: protectedProcedure
    .input(
      tenantInput.extend({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })
    )
    .query(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      const member = await tenantAccess(db, user, input.tenantId);
      const period = await periodFor(db, input.tenantId, member.id, input.date);
      const [entries, settings] = await Promise.all([
        db
          .select()
          .from(workEntries)
          .where(
            and(
              eq(workEntries.tenantId, input.tenantId),
              eq(workEntries.periodId, period.id)
            )
          )
          .orderBy(asc(workEntries.startedAt)),
        db
          .select()
          .from(workSettings)
          .where(eq(workSettings.tenantId, input.tenantId))
          .limit(1),
      ]);
      return { period, entries, workSettings: settings[0] ?? null };
    }),
  myMonth: protectedProcedure
    .input(
      tenantInput.extend({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })
    )
    .query(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      const member = await tenantAccess(db, user, input.tenantId);
      const bounds = monthBounds(input.date);
      const [entries, settings] = await Promise.all([
        db
          .select()
          .from(workEntries)
          .where(
            and(
              eq(workEntries.tenantId, input.tenantId),
              eq(workEntries.membershipId, member.id),
              gte(workEntries.workDate, bounds.start),
              lte(workEntries.workDate, bounds.end)
            )
          )
          .orderBy(asc(workEntries.workDate), asc(workEntries.startedAt)),
        db
          .select()
          .from(workSettings)
          .where(eq(workSettings.tenantId, input.tenantId))
          .limit(1),
      ]);
      return { entries, workSettings: settings[0] ?? null };
    }),
  addEntry: protectedProcedure
    .input(entryInput)
    .mutation(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      const member = await tenantAccess(db, user, input.tenantId);
      const { start, end, period, settings } = await validateEntry(
        db,
        input.tenantId,
        member.id,
        input
      );
      const [id] = await db
        .insert(workEntries)
        .values({
          tenantId: input.tenantId,
          periodId: period.id,
          membershipId: member.id,
          workDate: input.workDate,
          startedAt: start,
          endedAt: end,
          activity: input.activity,
          markType: input.markType,
          countsAsWork: !(
            settings?.nonWorkingMarkTypes ?? ["Intervalo"]
          ).includes(input.markType),
          project: input.project || null,
          costCenter: input.costCenter || null,
          locationMode: input.locationMode,
          locationName: input.locationName,
          latitude:
            input.locationMode === "geolocation"
              ? (input.latitude ?? null)
              : null,
          longitude:
            input.locationMode === "geolocation"
              ? (input.longitude ?? null)
              : null,
          customFields: input.customFields ?? {},
        })
        .$returningId();
      await audit(
        db,
        input.tenantId,
        member.id,
        "work_entry",
        id.id,
        "created"
      );
      return { id: id.id };
    }),
  updateEntry: protectedProcedure
    .input(entryInput.extend({ entryId: idSchema }))
    .mutation(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      const member = await tenantAccess(db, user, input.tenantId);
      const [entry] = await db
        .select()
        .from(workEntries)
        .where(
          and(
            eq(workEntries.id, input.entryId),
            eq(workEntries.tenantId, input.tenantId),
            eq(workEntries.membershipId, member.id)
          )
        )
        .limit(1);
      if (!entry) throw new TRPCError({ code: "NOT_FOUND" });
      const { start, end, period, settings } = await validateEntry(
        db,
        input.tenantId,
        member.id,
        input,
        entry.id
      );
      await db
        .update(workEntries)
        .set({
          periodId: period.id,
          workDate: input.workDate,
          startedAt: start,
          endedAt: end,
          activity: input.activity,
          markType: input.markType,
          countsAsWork: !(
            settings?.nonWorkingMarkTypes ?? ["Intervalo"]
          ).includes(input.markType),
          project: input.project || null,
          costCenter: input.costCenter || null,
          locationMode: input.locationMode,
          locationName: input.locationName,
          latitude:
            input.locationMode === "geolocation"
              ? (input.latitude ?? null)
              : null,
          longitude:
            input.locationMode === "geolocation"
              ? (input.longitude ?? null)
              : null,
          customFields: input.customFields ?? {},
        })
        .where(
          and(
            eq(workEntries.id, entry.id),
            eq(workEntries.tenantId, input.tenantId)
          )
        );
      await audit(
        db,
        input.tenantId,
        member.id,
        "work_entry",
        entry.id,
        "updated"
      );
      return { success: true };
    }),
  deleteEntry: protectedProcedure
    .input(tenantInput.extend({ entryId: idSchema }))
    .mutation(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      const member = await tenantAccess(db, user, input.tenantId);
      const [entry] = await db
        .select()
        .from(workEntries)
        .where(
          and(
            eq(workEntries.id, input.entryId),
            eq(workEntries.tenantId, input.tenantId),
            eq(workEntries.membershipId, member.id)
          )
        )
        .limit(1);
      if (!entry) throw new TRPCError({ code: "NOT_FOUND" });
      const [period] = await db
        .select()
        .from(workPeriods)
        .where(
          and(
            eq(workPeriods.id, entry.periodId),
            eq(workPeriods.tenantId, input.tenantId)
          )
        )
        .limit(1);
      if (!period || (period.status !== "draft" && period.status !== "rejected"))
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "A folha enviada ou aprovada não pode ser alterada.",
        });
      await db
        .delete(workEntries)
        .where(
          and(
            eq(workEntries.id, entry.id),
            eq(workEntries.tenantId, input.tenantId)
          )
        );
      await audit(
        db,
        input.tenantId,
        member.id,
        "work_entry",
        entry.id,
        "deleted"
      );
      return { success: true };
    }),
  submitWeek: protectedProcedure
    .input(
      tenantInput.extend({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })
    )
    .mutation(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      const member = await tenantAccess(db, user, input.tenantId);
      const period = await periodFor(db, input.tenantId, member.id, input.date);
      const [entry] = await db
        .select({ id: workEntries.id })
        .from(workEntries)
        .where(
          and(
            eq(workEntries.tenantId, input.tenantId),
            eq(workEntries.periodId, period.id)
          )
        )
        .limit(1);
      if (!entry)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Adicione ao menos uma faixa antes de enviar.",
        });
      if (period.status !== "draft" && period.status !== "rejected")
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Esta folha já foi enviada.",
        });
      await db
        .update(workPeriods)
        .set({
          status: "submitted",
          submittedAt: new Date(),
          managerNote: null,
        })
        .where(
          and(
            eq(workPeriods.id, period.id),
            eq(workPeriods.tenantId, input.tenantId)
          )
        );
      await audit(
        db,
        input.tenantId,
        member.id,
        "work_period",
        period.id,
        "submitted"
      );
      return { success: true };
    }),
  managerQueue: protectedProcedure
    .input(tenantInput)
    .query(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      const manager = await tenantAccess(db, user, input.tenantId, canManage);
      const periods = await db
        .select()
        .from(workPeriods)
        .where(
          and(
            eq(workPeriods.tenantId, input.tenantId),
            eq(workPeriods.status, "submitted")
          )
        )
        .orderBy(asc(workPeriods.submittedAt));
      const visible =
        manager.role === "tenant_admin"
          ? periods
          : await Promise.all(
              periods.map(async period => {
                const [employee] = await db
                  .select({
                    managerMembershipId: memberships.managerMembershipId,
                  })
                  .from(memberships)
                  .where(
                    and(
                      eq(memberships.id, period.membershipId),
                      eq(memberships.tenantId, input.tenantId)
                    )
                  )
                  .limit(1);
                return employee?.managerMembershipId === manager.id
                  ? period
                  : null;
              })
            ).then(rows => rows.filter(Boolean) as typeof periods);
      return Promise.all(
        visible.map(async period => {
          const [[employee], entries] = await Promise.all([
            db
              .select({
                id: memberships.id,
                name: memberships.name,
                email: memberships.email,
                departmentId: memberships.departmentId,
              })
              .from(memberships)
              .where(
                and(
                  eq(memberships.id, period.membershipId),
                  eq(memberships.tenantId, input.tenantId)
                )
              )
              .limit(1),
            db
              .select()
              .from(workEntries)
              .where(
                and(
                  eq(workEntries.tenantId, input.tenantId),
                  eq(workEntries.periodId, period.id)
                )
              )
              .orderBy(asc(workEntries.startedAt)),
          ]);
          return {
            period,
            employee,
            entries,
            hours: entries.reduce((sum, row) => sum + workEntryHours(row), 0),
          };
        })
      );
    }),
  reviewWeek: protectedProcedure
    .input(
      tenantInput.extend({
        periodId: idSchema,
        decision: z.enum(["approved", "rejected"]),
        note: optionalText(1000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      const manager = await tenantAccess(db, user, input.tenantId, canManage);
      const [period] = await db
        .select()
        .from(workPeriods)
        .where(
          and(
            eq(workPeriods.id, input.periodId),
            eq(workPeriods.tenantId, input.tenantId),
            eq(workPeriods.status, "submitted")
          )
        )
        .limit(1);
      if (!period)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Folha pendente não encontrada.",
        });
      if (manager.role === "manager") {
        const [employee] = await db
          .select({ managerMembershipId: memberships.managerMembershipId })
          .from(memberships)
          .where(
            and(
              eq(memberships.id, period.membershipId),
              eq(memberships.tenantId, input.tenantId)
            )
          )
          .limit(1);
        if (employee?.managerMembershipId !== manager.id)
          throw new TRPCError({ code: "FORBIDDEN" });
      }
      await db
        .update(workPeriods)
        .set({
          status: input.decision,
          managerNote: input.note ?? null,
          reviewedByMembershipId: manager.id,
          reviewedAt: new Date(),
        })
        .where(
          and(
            eq(workPeriods.id, period.id),
            eq(workPeriods.tenantId, input.tenantId)
          )
        );
      await audit(
        db,
        input.tenantId,
        manager.id,
        "work_period",
        period.id,
        input.decision,
        { note: input.note ?? null }
      );
      return { success: true };
    }),
  metrics: protectedProcedure
    .input(
      tenantInput.extend({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
    )
    .query(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      const actor = await tenantAccess(db, user, input.tenantId, canManage);
      const [[tenant], [settings]] = await Promise.all([
        db
          .select({ timezone: tenants.timezone })
          .from(tenants)
          .where(eq(tenants.id, input.tenantId))
          .limit(1),
        db
          .select({
            dailyHours: workSettings.dailyHours,
            shiftStart: workSettings.shiftStart,
            toleranceMinutes: workSettings.toleranceMinutes,
          })
          .from(workSettings)
          .where(eq(workSettings.tenantId, input.tenantId))
          .limit(1),
      ]);
      const teamCondition =
        actor.role === "tenant_admin"
          ? and(
              eq(memberships.tenantId, input.tenantId),
              eq(memberships.active, 1)
            )
          : and(
              eq(memberships.tenantId, input.tenantId),
              eq(memberships.active, 1),
              or(
                eq(memberships.id, actor.id),
                eq(memberships.managerMembershipId, actor.id)
              )
            );
      const members = await db
        .select({ id: memberships.id, joinedAt: memberships.joinedAt })
        .from(memberships)
        .where(teamCondition);
      const timezone = tenant?.timezone ?? "America/Sao_Paulo";
      const through = [
        input.to,
        dateInTimezone(new Date(), timezone),
      ].sort()[0];
      const eligible = members.filter(member => member.joinedAt !== null);
      const ids = eligible.map(member => member.id);
      const holidays =
        through >= input.from
          ? await db
              .select({ holidayDate: tenantHolidays.holidayDate })
              .from(tenantHolidays)
              .where(
                and(
                  eq(tenantHolidays.tenantId, input.tenantId),
                  gte(tenantHolidays.holidayDate, input.from),
                  lte(tenantHolidays.holidayDate, through)
                )
              )
          : [];
      const holidaySet = new Set(holidays.map(row => row.holidayDate));
      const expectedWorkdays =
        through < input.from
          ? 0
          : eligible.reduce((total, member) => {
              const joined = dateInTimezone(member.joinedAt!, timezone);
              const first = joined > input.from ? joined : input.from;
              return (
                total +
                (first > through
                  ? 0
                  : weekdaysBetween(first, through, holidaySet))
              );
            }, 0);
      const entries =
        ids.length && through >= input.from
          ? await db
              .select()
              .from(workEntries)
              .where(
                and(
                  eq(workEntries.tenantId, input.tenantId),
                  gte(workEntries.workDate, input.from),
                  lte(workEntries.workDate, through),
                  inArray(workEntries.membershipId, ids)
                )
              )
          : [];
      const firstWorkEntryByDay = new Map<string, (typeof entries)[number]>();
      for (const entry of entries) {
        if (workEntryHours(entry) <= 0) continue;
        const key = `${entry.membershipId}:${entry.workDate}`;
        const previous = firstWorkEntryByDay.get(key);
        if (!previous || entry.startedAt < previous.startedAt)
          firstWorkEntryByDay.set(key, entry);
      }
      const shiftStart = settings?.shiftStart ?? "09:00";
      const [shiftHour, shiftMinute] = shiftStart.split(":").map(Number);
      const shiftStartMinutes = shiftHour * 60 + shiftMinute;
      const toleranceMinutes = settings?.toleranceMinutes ?? 10;
      const localClock = new Intl.DateTimeFormat("en-GB", {
        timeZone: timezone,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      });
      let lateDays = 0;
      let lateMinutes = 0;
      for (const entry of firstWorkEntryByDay.values()) {
        const parts = localClock.formatToParts(entry.startedAt);
        const hour = Number(parts.find(part => part.type === "hour")?.value);
        const minute = Number(
          parts.find(part => part.type === "minute")?.value
        );
        let difference = hour * 60 + minute - shiftStartMinutes;
        if (difference < -720) difference += 1440;
        else if (difference > 720) difference -= 1440;
        const late = Math.max(0, difference - toleranceMinutes);
        if (late > 0) lateDays += 1;
        lateMinutes += late;
      }
      const hoursByDay = new Map<string, number>();
      for (const entry of entries) {
        const key = `${entry.membershipId}:${entry.workDate}`;
        hoursByDay.set(key, (hoursByDay.get(key) ?? 0) + workEntryHours(entry));
      }
      const workedDays = Array.from(hoursByDay.values()).filter(
        hours => hours > 0
      ).length;
      const dailyTarget = Number(settings?.dailyHours ?? 8);
      const overtimeHours = Array.from(hoursByDay.values()).reduce(
        (sum, hours) => sum + Math.max(0, hours - dailyTarget),
        0
      );
      return {
        headcount: eligible.length,
        expectedWorkdays,
        trackedDays: workedDays,
        daysWithoutRecords: Math.max(0, expectedWorkdays - workedDays),
        overtimeHours,
        dailyTarget,
        lateDays,
        lateMinutes,
        toleranceMinutes,
      };
    }),
  report: protectedProcedure
    .input(
      tenantInput.extend({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        membershipId: idSchema.nullable().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      const member = await tenantAccess(db, user, input.tenantId);
      const canViewTeam =
        member.role === "tenant_admin" || member.role === "manager";
      const targetMember = canViewTeam ? input.membershipId : member.id;
      let visibleMembers: number[] | null = null;
      if (member.role === "manager") {
        const directReports = await db
          .select({ id: memberships.id })
          .from(memberships)
          .where(
            and(
              eq(memberships.tenantId, input.tenantId),
              eq(memberships.managerMembershipId, member.id)
            )
          );
        visibleMembers = [member.id, ...directReports.map(row => row.id)];
        if (targetMember && !visibleMembers.includes(targetMember))
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Este funcionário não faz parte da sua equipe.",
          });
      }
      const condition = [
        eq(workEntries.tenantId, input.tenantId),
        gte(workEntries.workDate, input.from),
        lte(workEntries.workDate, input.to),
      ];
      if (targetMember)
        condition.push(eq(workEntries.membershipId, targetMember));
      else if (visibleMembers)
        condition.push(inArray(workEntries.membershipId, visibleMembers));
      const entries = await db
        .select()
        .from(workEntries)
        .where(and(...condition))
        .orderBy(asc(workEntries.workDate), asc(workEntries.startedAt));
      const employeeIds = Array.from(
        new Set(entries.map(entry => entry.membershipId))
      );
      const employees = employeeIds.length
        ? await db
            .select({
              id: memberships.id,
              name: memberships.name,
              departmentId: memberships.departmentId,
            })
            .from(memberships)
            .where(
              and(
                eq(memberships.tenantId, input.tenantId),
                inArray(memberships.id, employeeIds)
              )
            )
        : [];
      return entries.map(entry => ({
        ...entry,
        employee:
          employees.find(person => person.id === entry.membershipId) ?? null,
        hours: workEntryHours(entry),
      }));
    }),
});
