import { and, asc, desc, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  memberships,
  punchEvents,
  punchRequests,
  tenants,
  workEntries,
  workPeriods,
  workSettings,
} from "../../drizzle/schema";
import {
  audit,
  canManage,
  dateInTimezone,
  database,
  idSchema,
  optionalText,
  periodFor,
  requireActor,
  tenantAccess,
  tenantInput,
  textField,
} from "./shared";

type Db = Awaited<ReturnType<typeof database>>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type PunchEventType = "ENTRY" | "EXIT" | "BREAK_START" | "BREAK_END";
type PunchEvent = typeof punchEvents.$inferSelect;

// Helpers in shared.ts are typed for the pooled database; inside transactions
// we reuse them via this cast — MySQL transactions expose the same query API.
const asDb = (executor: Db | Tx) => executor as unknown as Db;

const eventTypeSchema = z.enum(["ENTRY", "EXIT", "BREAK_START", "BREAK_END"]);

function tenantTimezone(row: { timezone?: string | null } | undefined) {
  return row?.timezone ?? "America/Sao_Paulo";
}

function zonedInstant(dateStr: string, timeStr: string, timezone: string) {
  const [year, month, day] = dateStr.split("-").map(Number);
  const [hour, minute] = timeStr.split(":").map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let instant = target;
  for (let attempt = 0; attempt < 3; attempt++) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(instant));
    const part = (type: string) =>
      Number(parts.find(item => item.type === type)?.value ?? 0);
    const represented = Date.UTC(
      part("year"),
      part("month") - 1,
      part("day"),
      part("hour"),
      part("minute"),
      part("second")
    );
    instant += target - represented;
  }
  return new Date(instant);
}

function localClock(timezone: string, value: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

async function recentEvents(
  db: Db | Tx,
  tenantId: number,
  membershipId: number
) {
  const [lastExit] = await db
    .select({ occurredAt: punchEvents.occurredAt })
    .from(punchEvents)
    .where(
      and(
        eq(punchEvents.tenantId, tenantId),
        eq(punchEvents.membershipId, membershipId),
        eq(punchEvents.eventType, "EXIT"),
        eq(punchEvents.status, "valid")
      )
    )
    .orderBy(desc(punchEvents.occurredAt))
    .limit(1);
  const condition = [
    eq(punchEvents.tenantId, tenantId),
    eq(punchEvents.membershipId, membershipId),
    eq(punchEvents.status, "valid"),
  ];
  if (lastExit) condition.push(gte(punchEvents.occurredAt, lastExit.occurredAt));
  return db
    .select()
    .from(punchEvents)
    .where(and(...condition))
    .orderBy(asc(punchEvents.occurredAt), asc(punchEvents.id));
}

// State machine: derives current state and the next allowed event types.
function deriveState(events: PunchEvent[]) {
  let openEntry: PunchEvent | null = null;
  let openBreak: PunchEvent | null = null;
  for (const event of events) {
    if (event.eventType === "ENTRY") {
      if (openEntry) continue;
      openEntry = event;
      openBreak = null;
    } else if (event.eventType === "EXIT") {
      openEntry = null;
      openBreak = null;
    } else if (event.eventType === "BREAK_START") {
      if (openEntry) openBreak = event;
    } else if (event.eventType === "BREAK_END") {
      openBreak = null;
    }
  }
  const actions: PunchEventType[] = [];
  if (!openEntry) actions.push("ENTRY");
  else {
    if (openBreak) actions.push("BREAK_END");
    else actions.push("BREAK_START", "EXIT");
  }
  return {
    state: !openEntry ? "off" : openBreak ? "on_break" : "working",
    openEntry,
    openBreak,
    actions,
  } as const;
}

// Materializes closed event pairs into official work_entries so that sheets,
// reports and metrics keep working from a single source of hours.
async function materializePairs(
  tx: Db | Tx,
  tenantId: number,
  membershipId: number,
  events: PunchEvent[],
  source: "punch" | "retroactive"
) {
  const pairs: {
    workDate: string;
    startedAt: Date;
    endedAt: Date;
    countsAsWork: boolean;
    activity: string;
    project: string | null;
    costCenter: string | null;
    locationName: string;
  }[] = [];
  let openEntry: PunchEvent | null = null;
  let openBreak: PunchEvent | null = null;
  for (const event of events) {
    if (event.eventType === "ENTRY") {
      if (!openEntry) {
        openEntry = event;
        openBreak = null;
      }
    } else if (event.eventType === "EXIT") {
      if (openEntry) {
        pairs.push({
          workDate: openEntry.workDate,
          startedAt: openEntry.occurredAt,
          endedAt: event.occurredAt,
          countsAsWork: true,
          activity:
            (openEntry.meta?.activity as string | undefined)?.trim() ||
            "Jornada de trabalho",
          project: openEntry.meta?.project ?? null,
          costCenter: openEntry.meta?.costCenter ?? null,
          locationName: openEntry.meta?.locationName ?? "Registro de ponto",
        });
        openEntry = null;
        openBreak = null;
      }
    } else if (event.eventType === "BREAK_START") {
      if (openEntry && !openBreak) openBreak = event;
    } else if (event.eventType === "BREAK_END") {
      if (openBreak) {
        pairs.push({
          workDate: openBreak.workDate,
          startedAt: openBreak.occurredAt,
          endedAt: event.occurredAt,
          countsAsWork: false,
          activity: "Intervalo",
          project: null,
          costCenter: null,
          locationName: openBreak.meta?.locationName ?? "Registro de ponto",
        });
        openBreak = null;
      }
    }
  }
  for (const pair of pairs) {
    if (pair.endedAt <= pair.startedAt) continue;
    const period = await periodFor(asDb(tx), tenantId, membershipId, pair.workDate);
    if (period.status !== "draft" && period.status !== "rejected")
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "A folha semanal deste período já foi enviada ou aprovada. Solicite o ajuste ao administrador.",
      });
    const [row] = await tx
      .insert(workEntries)
      .values({
        tenantId,
        periodId: period.id,
        membershipId,
        workDate: pair.workDate,
        startedAt: pair.startedAt,
        endedAt: pair.endedAt,
        activity: pair.activity,
        markType: "Ponto eletrônico",
        countsAsWork: pair.countsAsWork,
        project: pair.project,
        costCenter: pair.costCenter,
        locationMode: "manual",
        locationName: pair.locationName,
        source,
      })
      .$returningId();
    await audit(asDb(tx), tenantId, membershipId, "work_entry", row.id, `created_${source}`);
  }
  return pairs.length;
}

const requestedEventSchema = z.object({
  eventType: eventTypeSchema,
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
});

export const punchRouter = router({
  punchState: protectedProcedure.input(tenantInput).query(async ({ ctx, input }) => {
    const user = requireActor(ctx.user);
    const db = await database();
    const member = await tenantAccess(db, user, input.tenantId);
    const [tenant] = await db
      .select({ timezone: tenants.timezone })
      .from(tenants)
      .where(eq(tenants.id, input.tenantId))
      .limit(1);
    const timezone = tenantTimezone(tenant);
    const now = new Date();
    const today = dateInTimezone(now, timezone);
    const [dayEvents, allRecent, [settings], pendingCount] = await Promise.all([
      db
        .select()
        .from(punchEvents)
        .where(
          and(
            eq(punchEvents.tenantId, input.tenantId),
            eq(punchEvents.membershipId, member.id),
            eq(punchEvents.workDate, today),
            eq(punchEvents.status, "valid")
          )
        )
        .orderBy(asc(punchEvents.occurredAt), asc(punchEvents.id)),
      recentEvents(db, input.tenantId, member.id),
      db
        .select()
        .from(workSettings)
        .where(eq(workSettings.tenantId, input.tenantId))
        .limit(1),
      db
        .select({ id: punchRequests.id })
        .from(punchRequests)
        .where(
          and(
            eq(punchRequests.tenantId, input.tenantId),
            eq(punchRequests.membershipId, member.id),
            eq(punchRequests.status, "pending")
          )
        ),
    ]);
    const { state, actions } = deriveState(allRecent);
    let workedMinutes = 0;
    let breakMinutes = 0;
    let openEntry: PunchEvent | null = null;
    let openBreak: PunchEvent | null = null;
    for (const event of allRecent) {
      if (event.eventType === "ENTRY") {
        if (!openEntry) {
          openEntry = event;
          openBreak = null;
        }
      } else if (event.eventType === "EXIT") {
        if (openEntry) {
          workedMinutes +=
            (event.occurredAt.getTime() - openEntry.occurredAt.getTime()) / 60000;
          openEntry = null;
          openBreak = null;
        }
      } else if (event.eventType === "BREAK_START") {
        if (openEntry && !openBreak) openBreak = event;
      } else if (event.eventType === "BREAK_END") {
        if (openBreak) {
          breakMinutes +=
            (event.occurredAt.getTime() - openBreak.occurredAt.getTime()) / 60000;
          openBreak = null;
        }
      }
    }
    const openSince = openBreak ?? openEntry;
    const provisionalMinutes = openSince
      ? (now.getTime() - openSince.occurredAt.getTime()) / 60000
      : 0;
    return {
      timezone,
      serverNow: now.toISOString(),
      localToday: today,
      state,
      openEvent: openSince
        ? {
            id: openSince.id,
            eventType: openSince.eventType,
            occurredAt: openSince.occurredAt.toISOString(),
            workDate: openSince.workDate,
          }
        : null,
      actions,
      breaksEnabled: true,
      todayEvents: dayEvents.map(event => ({
        id: event.id,
        eventType: event.eventType,
        occurredAt: event.occurredAt.toISOString(),
        workDate: event.workDate,
        source: event.source,
        note: event.note,
        clock: localClock(timezone, event.occurredAt),
      })),
      workedMinutes: Math.max(0, Math.floor(workedMinutes)),
      breakMinutes: Math.max(0, Math.floor(breakMinutes)),
      provisionalMinutes: Math.max(0, Math.floor(provisionalMinutes)),
      pendingRequests: pendingCount.length,
      dailyHours: Number(settings?.dailyHours ?? 8),
    };
  }),

  punchDay: protectedProcedure
    .input(tenantInput.extend({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
    .query(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      const member = await tenantAccess(db, user, input.tenantId);
      const [tenant] = await db
        .select({ timezone: tenants.timezone })
        .from(tenants)
        .where(eq(tenants.id, input.tenantId))
        .limit(1);
      const timezone = tenantTimezone(tenant);
      const events = await db
        .select()
        .from(punchEvents)
        .where(
          and(
            eq(punchEvents.tenantId, input.tenantId),
            eq(punchEvents.membershipId, member.id),
            eq(punchEvents.workDate, input.date),
            eq(punchEvents.status, "valid")
          )
        )
        .orderBy(asc(punchEvents.occurredAt), asc(punchEvents.id));
      let workedMinutes = 0;
      let breakMinutes = 0;
      let openEntry: PunchEvent | null = null;
      let openBreak: PunchEvent | null = null;
      for (const event of events) {
        if (event.eventType === "ENTRY") {
          if (!openEntry) {
            openEntry = event;
            openBreak = null;
          }
        } else if (event.eventType === "EXIT") {
          if (openEntry) {
            workedMinutes +=
              (event.occurredAt.getTime() - openEntry.occurredAt.getTime()) / 60000;
            openEntry = null;
            openBreak = null;
          }
        } else if (event.eventType === "BREAK_START") {
          if (openEntry && !openBreak) openBreak = event;
        } else if (event.eventType === "BREAK_END") {
          if (openBreak) {
            breakMinutes +=
              (event.occurredAt.getTime() - openBreak.occurredAt.getTime()) / 60000;
            openBreak = null;
          }
        }
      }
      return {
        timezone,
        events: events.map(event => ({
          id: event.id,
          eventType: event.eventType,
          occurredAt: event.occurredAt.toISOString(),
          source: event.source,
          note: event.note,
          clock: localClock(timezone, event.occurredAt),
        })),
        workedMinutes: Math.max(0, Math.floor(workedMinutes)),
        breakMinutes: Math.max(0, Math.floor(breakMinutes)),
        hasOpenPeriod: Boolean(openEntry),
      };
    }),

  punch: protectedProcedure
    .input(
      tenantInput.extend({
        eventType: eventTypeSchema,
        clientToken: z.string().min(8).max(64),
        note: optionalText(500),
        activity: optionalText(2000),
        project: optionalText(160),
        costCenter: optionalText(120),
        locationName: optionalText(180),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      const member = await tenantAccess(db, user, input.tenantId);
      const [tenant] = await db
        .select({ timezone: tenants.timezone })
        .from(tenants)
        .where(eq(tenants.id, input.tenantId))
        .limit(1);
      const timezone = tenantTimezone(tenant);
      const clientToken = input.clientToken.trim().slice(0, 64);

      const [existing] = await db
        .select()
        .from(punchEvents)
        .where(
          and(
            eq(punchEvents.tenantId, input.tenantId),
            eq(punchEvents.membershipId, member.id),
            eq(punchEvents.clientToken, clientToken)
          )
        )
        .limit(1);
      if (existing)
        return { duplicate: true, id: existing.id, occurredAt: existing.occurredAt.toISOString(), workDate: existing.workDate };

      return db.transaction(async tx => {
        // Serializes concurrent punches from the same membership (two devices).
        await tx
          .select({ id: memberships.id })
          .from(memberships)
          .where(eq(memberships.id, member.id))
          .for("update");
        const history = await recentEvents(tx, input.tenantId, member.id);
        const { state, actions } = deriveState(history);
        if (!actions.includes(input.eventType))
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              state === "off"
                ? "Nenhum período aberto: bata a entrada antes desta marcação."
                : "Marcação não permitida no estado atual.",
          });
        // Official instant: server clock only. Client-provided time is ignored.
        const now = new Date();
        const workDate = dateInTimezone(now, timezone);
        const meta: Record<string, string> = {};
        if (input.activity?.trim()) meta.activity = input.activity.trim();
        if (input.project?.trim()) meta.project = input.project.trim();
        if (input.costCenter?.trim()) meta.costCenter = input.costCenter.trim();
        if (input.locationName?.trim())
          meta.locationName = input.locationName.trim();
        const [row] = await tx
          .insert(punchEvents)
          .values({
            tenantId: input.tenantId,
            membershipId: member.id,
            workDate,
            eventType: input.eventType,
            occurredAt: now,
            source: "web",
            status: "valid",
            note: input.note ?? null,
            meta,
            timezone,
            clientToken,
            createdByMembershipId: member.id,
          })
          .$returningId();
        if (input.eventType === "EXIT" || input.eventType === "BREAK_END") {
          const since = history.length
            ? new Date(
                Math.min(
                  ...history.map(event => event.occurredAt.getTime())
                )
              )
            : now;
          const scope = await tx
            .select()
            .from(punchEvents)
            .where(
              and(
                eq(punchEvents.tenantId, input.tenantId),
                eq(punchEvents.membershipId, member.id),
                gte(punchEvents.occurredAt, since)
              )
            )
            .orderBy(asc(punchEvents.occurredAt), asc(punchEvents.id));
                      await materializePairs(
            asDb(tx),
            input.tenantId,
            member.id,
            scope,
            "punch"
          );
        }
        await audit(
          asDb(tx),
          input.tenantId,
          member.id,
          "punch_event",
          row.id,
          `punched_${input.eventType.toLowerCase()}`
        );
        return {
          duplicate: false,
          id: row.id,
          occurredAt: now.toISOString(),
          workDate,
        };
      });
    }),

  createPunchRequest: protectedProcedure
    .input(
      tenantInput.extend({
        workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        events: z.array(requestedEventSchema).min(1).max(20),
        reason: textField(2000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      const member = await tenantAccess(db, user, input.tenantId);
      const [tenant] = await db
        .select({ timezone: tenants.timezone })
        .from(tenants)
        .where(eq(tenants.id, input.tenantId))
        .limit(1);
      const timezone = tenantTimezone(tenant);
      const now = new Date();
      const today = dateInTimezone(now, timezone);
      if (input.workDate > today)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Não é possível solicitar marcação para data futura. Hoje o ponto é batido em tempo real.",
        });
      const localClockNow = localClock(timezone, now);
      const [nowHour, nowMinute] = localClockNow.split(":").map(Number);
      const nowMinutes = nowHour * 60 + nowMinute;
      let previousMinutes = -1;
      for (const event of input.events) {
        const [hour, minute] = event.time.split(":").map(Number);
        const minutes = hour * 60 + minute;
        if (input.workDate === today && minutes >= nowMinutes)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Horário ${event.time} ainda não aconteceu hoje. Use o botão de bater ponto para marcações em tempo real.`,
          });
        if (minutes <= previousMinutes)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Os horários precisam estar em ordem crescente.",
          });
        previousMinutes = minutes;
      }
      const [period] = await db
        .select({ status: workPeriods.status })
        .from(workPeriods)
        .where(
          and(
            eq(workPeriods.tenantId, input.tenantId),
            eq(workPeriods.membershipId, member.id),
            lte(workPeriods.periodStart, input.workDate),
            gte(workPeriods.periodEnd, input.workDate)
          )
        )
        .limit(1);
      if (period && period.status !== "draft" && period.status !== "rejected")
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "A folha semanal deste período já foi enviada ou aprovada. Fale com o administrador.",
        });
      const [duplicate] = await db
        .select({ id: punchRequests.id })
        .from(punchRequests)
        .where(
          and(
            eq(punchRequests.tenantId, input.tenantId),
            eq(punchRequests.membershipId, member.id),
            eq(punchRequests.workDate, input.workDate),
            eq(punchRequests.status, "pending")
          )
        )
        .limit(1);
      if (duplicate)
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "Já existe uma solicitação pendente para este dia. Aguarde a análise.",
        });
      const [row] = await db
        .insert(punchRequests)
        .values({
          tenantId: input.tenantId,
          membershipId: member.id,
          workDate: input.workDate,
          events: input.events,
          reason: input.reason.trim(),
        })
        .$returningId();
      await audit(
        db,
        input.tenantId,
        member.id,
        "punch_request",
        row.id,
        "requested",
        { workDate: input.workDate, events: input.events.length }
      );
      return { id: row.id };
    }),

  listPunchRequests: protectedProcedure
    .input(tenantInput.extend({ scope: z.enum(["mine", "approval"]).default("mine") }))
    .query(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      const member = await tenantAccess(db, user, input.tenantId);
      const approval = input.scope === "approval";
      if (approval && !canManage.includes(member.role as "tenant_admin"))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Somente gestores e administradores analisam solicitações.",
        });
      const condition = [
        eq(punchRequests.tenantId, input.tenantId),
        approval
          ? eq(punchRequests.status, "pending")
          : eq(punchRequests.membershipId, member.id),
      ];
      const rows = await db
        .select({
          request: punchRequests,
          requesterName: memberships.name,
          requesterEmail: memberships.email,
        })
        .from(punchRequests)
        .innerJoin(
          memberships,
          eq(memberships.id, punchRequests.membershipId)
        )
        .where(and(...condition))
        .orderBy(desc(punchRequests.createdAt))
        .limit(100);
      return rows.map(({ request, requesterName, requesterEmail }) => ({
        id: request.id,
        workDate: request.workDate,
        events: request.events,
        reason: request.reason,
        status: request.status,
        reviewNote: request.reviewNote,
        createdAt: request.createdAt.toISOString(),
        requesterName,
        requesterEmail,
        membershipId: request.membershipId,
        isMine: request.membershipId === member.id,
      }));
    }),

  decidePunchRequest: protectedProcedure
    .input(
      tenantInput.extend({
        requestId: idSchema,
        decision: z.enum(["approved", "rejected"]),
        note: optionalText(1000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      const approver = await tenantAccess(db, user, input.tenantId, canManage);
      if (input.decision === "rejected" && !input.note?.trim())
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Informe o motivo da rejeição.",
        });
      return db.transaction(async tx => {
        await tx
          .select({ id: punchRequests.id })
          .from(punchRequests)
          .where(eq(punchRequests.id, input.requestId))
          .for("update");
        const [request] = await tx
          .select()
          .from(punchRequests)
          .where(
            and(
              eq(punchRequests.id, input.requestId),
              eq(punchRequests.tenantId, input.tenantId)
            )
          )
          .limit(1);
        if (!request) throw new TRPCError({ code: "NOT_FOUND" });
        if (request.status !== "pending")
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Esta solicitação já foi analisada.",
          });
        if (request.membershipId === approver.id)
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Você não pode analisar a sua própria solicitação.",
          });
        if (approver.role === "manager") {
          const [employee] = await tx
            .select({ managerMembershipId: memberships.managerMembershipId })
            .from(memberships)
            .where(eq(memberships.id, request.membershipId))
            .limit(1);
          if (employee?.managerMembershipId !== approver.id)
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "Este funcionário não faz parte da sua equipe.",
            });
        }
        const [tenant] = await tx
          .select({ timezone: tenants.timezone })
          .from(tenants)
          .where(eq(tenants.id, input.tenantId))
          .limit(1);
        const timezone = tenantTimezone(tenant);
        let createdEventIds: number[] = [];
        if (input.decision === "approved") {
          const [period] = await tx
            .select({ status: workPeriods.status })
            .from(workPeriods)
            .where(
              and(
                eq(workPeriods.tenantId, input.tenantId),
                eq(workPeriods.membershipId, request.membershipId),
                lte(workPeriods.periodStart, request.workDate),
                gte(workPeriods.periodEnd, request.workDate)
              )
            )
            .limit(1);
          if (
            period &&
            period.status !== "draft" &&
            period.status !== "rejected"
          )
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message:
                "A folha semanal já foi enviada ou aprovada. Não é possível criar os eventos.",
            });
          const created: PunchEvent[] = [];
          for (const proposed of request.events) {
            const occurredAt = zonedInstant(
              request.workDate,
              proposed.time,
              timezone
            );
            const [row] = await tx
              .insert(punchEvents)
              .values({
                tenantId: input.tenantId,
                membershipId: request.membershipId,
                workDate: request.workDate,
                eventType: proposed.eventType,
                occurredAt,
                source: "retroactive_approval",
                status: "valid",
                note: `Solicitação #${request.id}: ${request.reason}`,
                requestId: request.id,
                timezone,
                createdByMembershipId: approver.id,
              })
              .$returningId();
            const [event] = await tx
              .select()
              .from(punchEvents)
              .where(eq(punchEvents.id, row.id))
              .limit(1);
            created.push(event);
          }
          createdEventIds = created.map(event => event.id);
          await materializePairs(
            asDb(tx),
            input.tenantId,
            request.membershipId,
            created,
            "retroactive"
          );
        }
        await tx
          .update(punchRequests)
          .set({
            status: input.decision,
            reviewedByMembershipId: approver.id,
            reviewedAt: new Date(),
            reviewNote: input.note ?? null,
          })
          .where(eq(punchRequests.id, request.id));
        await audit(
          asDb(tx),
          input.tenantId,
          approver.id,
          "punch_request",
          request.id,
          input.decision,
          { note: input.note ?? null }
        );
        return { success: true, createdEventIds };
      });
    }),

  cancelPunchRequest: protectedProcedure
    .input(tenantInput.extend({ requestId: idSchema }))
    .mutation(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      const member = await tenantAccess(db, user, input.tenantId);
      const [request] = await db
        .select()
        .from(punchRequests)
        .where(
          and(
            eq(punchRequests.id, input.requestId),
            eq(punchRequests.tenantId, input.tenantId),
            eq(punchRequests.membershipId, member.id)
          )
        )
        .limit(1);
      if (!request) throw new TRPCError({ code: "NOT_FOUND" });
      if (request.status !== "pending")
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Somente solicitações pendentes podem ser canceladas.",
        });
      await db
        .update(punchRequests)
        .set({ status: "cancelled" })
        .where(eq(punchRequests.id, request.id));
      await audit(
        db,
        input.tenantId,
        member.id,
        "punch_request",
        request.id,
        "cancelled_by_requester"
      );
      return { success: true };
    }),
});
