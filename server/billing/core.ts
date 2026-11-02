import { and, count, desc, eq, gte, isNotNull, lte } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  billingEvents,
  billingInvoices,
  memberships,
  platformSettings,
  tenantSubscriptions,
} from "../../drizzle/schema";
import { plans, planForHeadcount, type PlanId } from "../../shared/plans";
import type { Db } from "./db-types";

export const DEFAULT_TRIAL_DAYS = 14;
export const TERMS_VERSION = "2026-11-01";
// Mandatory rule: zero grace days. No silent tolerance.
export const GRACE_DAYS = 0;

export async function setting(
  db: Db,
  key: string,
  fallback: string
): Promise<string> {
  const [row] = await db
    .select()
    .from(platformSettings)
    .where(eq(platformSettings.key, key))
    .limit(1);
  return row?.value ?? fallback;
}

export async function trialDays(db: Db): Promise<number> {
  const value = await setting(db, "trial_days", String(DEFAULT_TRIAL_DAYS));
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 90
    ? Math.floor(parsed)
    : DEFAULT_TRIAL_DAYS;
}

// Billable employees: active memberships with an accepted account.
// Pending invitations (no user bound), deactivated and platform-only
// accounts never count. Admins/managers with an active functional link do.
export async function billableHeadcount(db: Db, tenantId: number) {
  const [row] = await db
    .select({ total: count() })
    .from(memberships)
    .where(
      and(
        eq(memberships.tenantId, tenantId),
        eq(memberships.active, 1),
        isNotNull(memberships.userId)
      )
    );
  return row?.total ?? 0;
}

export async function getSubscription(db: Db, tenantId: number) {
  const [existing] = await db
    .select()
    .from(tenantSubscriptions)
    .where(eq(tenantSubscriptions.tenantId, tenantId))
    .limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(tenantSubscriptions)
    .values({
      tenantId,
      plan: "starter",
      status: "trialing",
      seatLimit: plans.starter.seatLimit,
      priceCents: plans.starter.monthlyPriceCents,
    })
    .$returningId();
  const [row] = await db
    .select()
    .from(tenantSubscriptions)
    .where(eq(tenantSubscriptions.id, created.id))
    .limit(1);
  return row;
}

export type AccessStatus =
  | "trialing"
  | "active"
  | "blocked_trial_ended"
  | "blocked_payment_failed"
  | "blocked_period_ended"
  | "canceled";

export type AccessInfo = {
  status: AccessStatus;
  subscription: typeof tenantSubscriptions.$inferSelect;
  plan: PlanId;
  headcount: number;
  seatLimit: number;
  priceCents: number;
  daysLeft: number | null;
  periodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  pendingInvoiceId: number | null;
};

function startsOfUtcDay(date: Date) {
  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate()
  );
}

export function periodDates(periodEnd: Date) {
  const start = new Date(periodEnd);
  start.setUTCDate(start.getUTCDate() - 30);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { periodStart: iso(start), periodEnd: iso(periodEnd) };
}

// Central, lazy reconciliation — called from the entitlement choke point on
// every business access and by the billing console. Zero grace days: the
// moment the paid period (or trial) ends without a confirmed payment, the
// tenant is blocked.
export async function resolveAccess(
  db: Db,
  tenantId: number
): Promise<AccessInfo> {
  const subscription = await getSubscription(db, tenantId);
  const headcount = await billableHeadcount(db, tenantId);
  const now = Date.now();
  let status = subscription.status as string;
  const trialEnds = subscription.trialEndsAt?.getTime() ?? null;
  const periodEnd = subscription.currentPeriodEnd?.getTime() ?? null;

  const [pending] = await db
    .select({ id: billingInvoices.id })
    .from(billingInvoices)
    .where(
      and(
        eq(billingInvoices.tenantId, tenantId),
        eq(billingInvoices.status, "pending")
      )
    )
    .orderBy(desc(billingInvoices.createdAt))
    .limit(1);

  const isTrialing =
    status === "trialing" && trialEnds !== null && trialEnds > now;
  const isActive =
    status === "active" && periodEnd !== null && periodEnd > now;
  const canceledAtEnd =
    subscription.cancelAtPeriodEnd === "1" && isActive;

  if (status === "canceled") {
    status = "canceled";
  } else if (isActive) {
    status = "active";
  } else if (isTrialing) {
    status = "trialing";
  } else if (status === "trialing" && trialEnds !== null && trialEnds <= now) {
    status = "blocked_trial_ended";
    if (subscription.status === "trialing")
      await db
        .update(tenantSubscriptions)
        .set({ status: "past_due" })
        .where(eq(tenantSubscriptions.id, subscription.id));
  } else if (status === "active" && periodEnd !== null && periodEnd <= now) {
    status = "blocked_period_ended";
    await db
      .update(tenantSubscriptions)
      .set({ status: "past_due" })
      .where(eq(tenantSubscriptions.id, subscription.id));
  } else if (status === "past_due" || status === "suspended") {
    status =
      subscription.status === "suspended"
        ? "blocked_payment_failed"
        : periodEnd !== null && periodEnd <= now
          ? "blocked_period_ended"
          : "blocked_trial_ended";
  }

  const daysLeft =
    status === "trialing" && trialEnds
      ? Math.max(
          0,
          Math.ceil((trialEnds - startsOfUtcDay(new Date())) / 86400000)
        )
      : status === "active" && periodEnd
        ? Math.max(
            0,
            Math.ceil((periodEnd - startsOfUtcDay(new Date())) / 86400000)
          )
        : null;

  return {
    status: status as AccessStatus,
    subscription,
    plan: (subscription.plan as PlanId) ?? "starter",
    headcount,
    seatLimit: subscription.seatLimit,
    priceCents: subscription.priceCents,
    daysLeft,
    periodEnd: subscription.currentPeriodEnd,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd === "1",
    pendingInvoiceId: pending?.id ?? null,
  };
}

export function assertAccessAllowed(access: AccessInfo) {
  const blocked: AccessStatus[] = [
    "blocked_trial_ended",
    "blocked_payment_failed",
    "blocked_period_ended",
    "canceled",
  ];
  if (blocked.includes(access.status))
    throw new TRPCError({
      code: "PAYMENT_REQUIRED",
      message:
        "Assinatura suspensa: os módulos de RH estão bloqueados. Regularize o pagamento na área de cobrança.",
    });
}

export async function recordBillingEvent(
  db: Db,
  input: {
    provider: string;
    externalId: string;
    eventType: string;
    invoiceId: number | null;
    result: string;
    detail?: unknown;
  }
) {
  await db
    .insert(billingEvents)
    .values({
      provider: input.provider,
      externalId: input.externalId,
      eventType: input.eventType,
      invoiceId: input.invoiceId,
      result: input.result,
      detail: input.detail ? JSON.stringify(input.detail) : null,
    })
    .onDuplicateKeyUpdate({
      set: { result: input.result, eventType: input.eventType },
    });
}

// Transactional, idempotent activation: marks the invoice paid and extends
// (or creates) the active subscription for the paid period.
export async function activateInvoice(
  db: Db,
  invoiceId: number,
  externalTransactionId: string | null
) {
  return db.transaction(async tx => {
    await tx
      .select({ id: billingInvoices.id })
      .from(billingInvoices)
      .where(eq(billingInvoices.id, invoiceId))
      .for("update");
    const [invoice] = await tx
      .select()
      .from(billingInvoices)
      .where(eq(billingInvoices.id, invoiceId))
      .limit(1);
    if (!invoice) throw new TRPCError({ code: "NOT_FOUND" });
    if (invoice.status === "paid") return { alreadyPaid: true };
    if (invoice.status !== "pending")
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `Fatura em estado ${invoice.status} não pode ser ativada.`,
      });
    await tx
      .update(billingInvoices)
      .set({
        status: "paid",
        paidAt: new Date(),
        paidAmountCents: invoice.amountCents,
        externalTransactionId,
      })
      .where(eq(billingInvoices.id, invoice.id));

    const [subscription] = await tx
      .select()
      .from(tenantSubscriptions)
      .where(eq(tenantSubscriptions.tenantId, invoice.tenantId))
      .limit(1);
    const target =
      subscription ??
      // A payment can arrive before the tenant ever touched the system
      // (e.g. direct webhook). Bootstrap the subscription in the same tx.
      (await tx
        .insert(tenantSubscriptions)
        .values({
          tenantId: invoice.tenantId,
          plan: "starter",
          status: "trialing",
          seatLimit: plans.starter.seatLimit,
          priceCents: plans.starter.monthlyPriceCents,
        })
        .$returningId()
        .then(([row]) =>
          tx
            .select()
            .from(tenantSubscriptions)
            .where(eq(tenantSubscriptions.id, row.id))
            .limit(1)
            .then(([created]) => created)
        ));
    if (!target) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    const periodEnd = new Date();
    periodEnd.setUTCDate(periodEnd.getUTCDate() + 30);
    await tx
      .update(tenantSubscriptions)
      .set({
        status: "active",
        plan: invoice.planCode as PlanId,
        seatLimit: plans[invoice.planCode as PlanId].seatLimit,
        priceCents: invoice.amountCents,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: "0",
        canceledAt: null,
      })
      .where(eq(tenantSubscriptions.id, subscription.id));
    return { alreadyPaid: false, periodEnd };
  });
}

export async function latestPaidPeriodEnd(db: Db, tenantId: number) {
  const [lastPaid] = await db
    .select({ paidAt: billingInvoices.paidAt })
    .from(billingInvoices)
    .where(
      and(
        eq(billingInvoices.tenantId, tenantId),
        eq(billingInvoices.status, "paid")
      )
    )
    .orderBy(desc(billingInvoices.paidAt))
    .limit(1);
  return lastPaid?.paidAt ?? null;
}

export { planForHeadcount, plans };
