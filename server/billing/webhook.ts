import type { Express } from "express";
import { desc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { billingInvoices } from "../../drizzle/schema";
import {
  activateInvoice,
  recordBillingEvent,
} from "./core";
import { checkPayment, isLiveMode } from "./infinitepay";

// Public webhook endpoint. InfinitePay's integrated checkout does NOT
// document a webhook signature, so every event is treated as untrusted and
// revalidated server-side via payment_check before anything happens.
// Responses: 200 once durably processed (or durably ignored); 5xx only on
// internal failures so the provider retries.
export function registerBillingWebhook(app: Express) {
  app.post("/api/webhooks/infinitepay", async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const orderNsu =
      typeof body.order_nsu === "string"
        ? body.order_nsu
        : typeof body.orderNsu === "string"
          ? body.orderNsu
          : null;
    const transactionNsu =
      typeof body.transaction_nsu === "string" ? body.transaction_nsu : null;
    const slug = typeof body.slug === "string" ? body.slug : null;
    const claimedType = String(body.type ?? body.event ?? "unknown");
    const correlationId = `whk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const db = await getDb();
    if (!db) return res.status(500).end();

    try {
      if (!orderNsu) {
        await recordBillingEvent(db, {
          provider: "infinitepay",
          externalId: `unknown:${correlationId}`,
          eventType: claimedType,
          invoiceId: null,
          result: "ignored_no_order",
          detail: body,
        });
        return res.status(200).json({ received: true });
      }
      const [invoice] = await db
        .select()
        .from(billingInvoices)
        .where(eq(billingInvoices.orderNsu, orderNsu))
        .orderBy(desc(billingInvoices.createdAt))
        .limit(1);
      if (!invoice) {
        await recordBillingEvent(db, {
          provider: "infinitepay",
          externalId: `${orderNsu}:${claimedType}:${correlationId}`,
          eventType: claimedType,
          invoiceId: null,
          result: "unknown_order",
          detail: { orderNsu, claimedType },
        });
        return res.status(200).json({ received: true, matched: false });
      }

      const existingKey = `${orderNsu}:${claimedType}`;
      if (
        claimedType === "refunded" ||
        claimedType === "canceled" ||
        claimedType === "payment_failed"
      ) {
        await recordBillingEvent(db, {
          provider: "infinitepay",
          externalId: existingKey,
          eventType: claimedType,
          invoiceId: invoice.id,
          result: "no_access_change",
          detail: { correlationId },
        });
        return res.status(200).json({ received: true });
      }

      // Server-side confirmation (works in both live and simulated mode).
      const provider = await checkPayment(
        {
          orderNsu,
          slug: slug ?? invoice.slug ?? undefined,
          transactionNsu:
            transactionNsu ?? invoice.externalTransactionId ?? undefined,
        },
        correlationId
      );
      if (!provider.approved) {
        await recordBillingEvent(db, {
          provider: "infinitepay",
          externalId: existingKey,
          eventType: claimedType,
          invoiceId: invoice.id,
          result: "not_confirmed",
          detail: { correlationId, providerStatus: provider.status },
        });
        return res.status(200).json({ received: true, confirmed: false });
      }
      const paidCents = provider.paidAmountCents ?? invoice.amountCents;
      if (
        (provider.amountCents !== null &&
          provider.amountCents < invoice.amountCents) ||
        paidCents < invoice.amountCents
      ) {
        await recordBillingEvent(db, {
          provider: "infinitepay",
          externalId: existingKey,
          eventType: "amount_mismatch",
          invoiceId: invoice.id,
          result: "rejected",
          detail: { invoiced: invoice.amountCents, paid: paidCents, correlationId },
        });
        return res.status(200).json({ received: true, confirmed: false });
      }
      const result = await activateInvoice(
        db,
        invoice.id,
        provider.transactionNsu ?? transactionNsu ?? null
      );
      await recordBillingEvent(db, {
        provider: "infinitepay",
        externalId: existingKey,
        eventType: "paid",
        invoiceId: invoice.id,
        result: result.alreadyPaid ? "idempotent_repeat" : "activated",
        detail: { correlationId, mode: isLiveMode() ? "live" : "simulated" },
      });
      return res.status(200).json({ received: true, confirmed: true });
    } catch (error) {
      console.error(
        `[billing-webhook] falha ${correlationId}:`,
        error instanceof Error ? error.message : error
      );
      return res.status(500).end();
    }
  });
}
