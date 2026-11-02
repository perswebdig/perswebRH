import { randomUUID } from "node:crypto";
import { ENV } from "../_core/env";

// InfinitePay Checkout Integrado adapter (server-side only).
// Docs: https://ajuda.infinitepay.io/pt-BR/articles/10766888
// - POST https://api.checkout.infinitepay.io/links   (X-Api-Key header)
// - POST https://api.checkout.infinitepay.io/payment_check
// - Webhooks carry NO documented signature: every event is revalidated
//   server-side through payment_check before any entitlement change.

const API_BASE = "https://api.checkout.infinitepay.io";

export type CheckoutInput = {
  orderNsu: string;
  amountCents: number;
  description: string;
  redirectUrl: string;
  webhookUrl?: string;
};

export type CheckoutResult = {
  checkoutUrl: string;
  slug?: string;
  mode: "live" | "simulated";
};

export type PaymentCheckResult = {
  approved: boolean;
  paidAmountCents: number | null;
  amountCents: number | null;
  status: string;
  transactionNsu?: string;
  mode: "live" | "simulated";
};

function apiKey() {
  return (process.env.INFINITEPAY_API_KEY ?? "").trim();
}

export function isLiveMode() {
  return apiKey().length > 0;
}

export function assertSafeForTests() {
  // Guards against accidental real charges from test environments.
  if (isLiveMode() && process.env.NODE_ENV === "test")
    throw new Error(
      "INFINITEPAY_API_KEY deve estar ausente ao rodar a suíte de testes."
    );
}

async function callInfinitePay(
  path: string,
  body: unknown,
  correlationId: string
) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": apiKey(),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  if (!response.ok)
    throw new Error(
      `InfinitePay ${path} falhou (${response.status}) [${correlationId}]`
    );
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(
      `InfinitePay ${path}: resposta inválida [${correlationId}]`
    );
  }
}

export async function createCheckout(
  input: CheckoutInput,
  correlationId: string
): Promise<CheckoutResult> {
  if (!isLiveMode()) {
    // Simulated mode (no credentials configured): returns the internal
    // confirmation console instead of a real gateway. Never auto-confirms.
    return {
      checkoutUrl: `/checkout/simulado?order=${encodeURIComponent(input.orderNsu)}`,
      mode: "simulated",
    };
  }
  const payload = {
    order_nsu: input.orderNsu,
    redirect_url: input.redirectUrl,
    items: [
      {
        quantity: 1,
        price: input.amountCents,
        description: input.description,
      },
    ],
    options: {
      single_payment: true,
      payment_methods_enabled: ["credit_card", "pix"],
    },
    ...(input.webhookUrl
      ? {
          webhook: {
            url: input.webhookUrl,
            events: ["paid", "canceled", "refunded", "payment_failed"],
          },
        }
      : {}),
  };
  const data = await callInfinitePay("/links", payload, correlationId);
  const url = (data.url ?? data.checkout_url ?? data.link) as string | undefined;
  if (!url)
    throw new Error(`InfinitePay não retornou URL de checkout [${correlationId}]`);
  return {
    checkoutUrl: url,
    slug: typeof data.slug === "string" ? data.slug : undefined,
    mode: "live",
  };
}

export async function checkPayment(
  input: { orderNsu: string; slug?: string; transactionNsu?: string },
  correlationId: string
): Promise<PaymentCheckResult> {
  if (!isLiveMode()) {
    // Simulated mode: the only way an order becomes approved is the
    // dev-only simulation endpoint which records a billing event.
    const { getDb } = await import("../db");
    const { billingEvents } = await import("../../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) throw new Error("database unavailable");
    const [event] = await db
      .select()
      .from(billingEvents)
      .where(eq(billingEvents.externalId, input.orderNsu))
      .limit(1);
    const approved = event?.eventType === "paid";
    return {
      approved,
      status: approved ? "paid" : "pending",
      paidAmountCents: approved ? (event?.detail ? JSON.parse(event.detail).amountCents ?? null : null) : null,
      amountCents: null,
      transactionNsu: approved ? event?.externalId : undefined,
      mode: "simulated",
    };
  }
  const data = await callInfinitePay(
    "/payment_check",
    {
      order_nsu: input.orderNsu,
      ...(input.slug ? { slug: input.slug } : {}),
      ...(input.transactionNsu ? { transaction_nsu: input.transactionNsu } : {}),
    },
    correlationId
  );
  const paid = data.paid === true || data.status === "paid";
  const toCents = (value: unknown) =>
    typeof value === "number" ? value : null;
  return {
    approved: paid,
    status: String(data.status ?? (paid ? "paid" : "unknown")),
    amountCents: toCents(data.amount),
    paidAmountCents: toCents(data.paid_amount),
    transactionNsu:
      typeof data.transaction_nsu === "string"
        ? data.transaction_nsu
        : undefined,
    mode: "live",
  };
}

export function newOrderNsu() {
  return `pwrh_${randomUUID().replace(/-/g, "")}`;
}
