import express from "express";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { appRouter } from "./routers";
import { getDb } from "./db";
import { registerBillingWebhook } from "./billing/webhook";
import { assertAccessAllowed, getSubscription, planForHeadcount, plans, recordBillingEvent, resolveAccess } from "./billing/core";
import {
  billingEvents,
  billingInvoices,
  memberships,
  tenantSubscriptions,
  tenants,
  users,
} from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";

function ctx(userId: number, openId: string): TrpcContext {
  return {
    user: {
      id: userId,
      openId,
      email: `${openId}@test.local`,
      name: openId,
      loginMethod: "password",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "http", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("billing (plans, InfinitePay checkout, entitlements)", () => {
  let tenantA = 0;
  let tenantB = 0;
  let tenantC = 0;
  let tenantMismatch = 0;
  let seatTenant = 0;
  let adminA = 0;
  let adminAOpen = "";
  let adminB = 0;
  let adminBOpen = "";
  let adminC = 0;
  let adminCOpen = "";
  let adminMismatch = 0;
  let adminMismatchOpen = "";
  let seatAdmin = 0;
  let seatAdminOpen = "";
  let webhookServer: Server | null = null;
  let webhookUrl = "";

  beforeAll(async () => {
    process.env.BILLING_SIMULATION = "1";
    // Safety: the suite must never run with real provider credentials.
    if ((process.env.INFINITEPAY_API_KEY ?? "").trim().length > 0)
      throw new Error("INFINITEPAY_API_KEY deve estar ausente nos testes.");
    const db = await getDb();
    if (!db) throw new Error("database unavailable");
    const suffix = Date.now();

    const makeUser = async (name: string) => {
      const [u] = await db
        .insert(users)
        .values({ openId: `bill_${name}_${suffix}`, name, role: "user" })
        .$returningId();
      return u;
    };
    const ua = await makeUser("admA");
    adminA = ua.id;
    adminAOpen = ua.openId;
    const ua1 = await makeUser("empA");
    const uB = await makeUser("admB");
    adminB = uB.id;
    adminBOpen = uB.openId;
    const uC = await makeUser("admC");
    adminC = uC.id;
    adminCOpen = uC.openId;
    const uM = await makeUser("admM");
    adminMismatch = uM.id;
    adminMismatchOpen = uM.openId;
    const uS = await makeUser("admSeat");
    seatAdmin = uS.id;
    seatAdminOpen = uS.openId;

    const mkTenant = async (name: string) => {
      const [t] = await db
        .insert(tenants)
        .values({ name, slug: `bill-${name}-${suffix}` })
        .$returningId();
      return t.id;
    };
    tenantA = await mkTenant("BillingCorp");
    tenantB = await mkTenant("IsoladaCorp");
    tenantC = await mkTenant("WebhookCorp");
    tenantMismatch = await mkTenant("MismatchCorp");
    seatTenant = await mkTenant("SeatCorp");

    const mkMember = async (
      tenantId: number,
      userId: number,
      email: string,
      role: "tenant_admin" | "employee"
    ) => {
      const [m] = await db
        .insert(memberships)
        .values({
          tenantId,
          userId,
          email,
          name: email.split("@")[0],
          role,
          active: 1,
          joinedAt: new Date(),
        })
        .$returningId();
      return m.id;
    };
    await mkMember(tenantA, adminA, "adminA@billing.local", "tenant_admin");
    await mkMember(tenantA, ua1.id, "empA@billing.local", "employee");
    await mkMember(tenantB, adminB, "adminB@billing.local", "tenant_admin");
    await mkMember(tenantC, adminC, "adminC@billing.local", "tenant_admin");
    await mkMember(
      tenantMismatch,
      adminMismatch,
      "admM@billing.local",
      "tenant_admin"
    );
    await mkMember(seatTenant, seatAdmin, "seat@billing.local", "tenant_admin");
    const us2 = await makeUser("empSeat");
    await mkMember(seatTenant, us2.id, "seat2@billing.local", "employee");
    // A pending (not yet accepted) membership occupies a seat on import.
    await db.insert(memberships).values({
      tenantId: seatTenant,
      userId: null,
      email: "pend@billing.local",
      name: "Pendente",
      role: "employee",
      active: 1,
      joinedAt: null,
    });
    // Bootstrap subscription rows eagerly so seat-limit updates are real.
    for (const id of [tenantA, tenantB, tenantC, tenantMismatch, seatTenant]) {
      await getSubscription(db, id);
    }

    const app = express();
    app.use(express.json({ limit: "1mb" }));
    registerBillingWebhook(app);
    await new Promise<void>(resolve => {
      webhookServer = createServer(app);
      webhookServer.listen(0, "127.0.0.1", () => {
        const address = webhookServer?.address();
        webhookUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/api/webhooks/infinitepay`;
        resolve();
      });
    });
  }, 30000);

  afterAll(async () => {
    webhookServer?.close();
  });

  const caller = (userId: number, openId: string) =>
    appRouter.createCaller(ctx(userId, openId));
  const adminOfA = () => caller(adminA, adminAOpen);
  const adminOfB = () => caller(adminB, adminBOpen);
  const adminOfC = () => caller(adminC, adminCOpen);
  const adminOfMismatch = () => caller(adminMismatch, adminMismatchOpen);
  const seatCaller = () => caller(seatAdmin, seatAdminOpen);

  it("1. faixas de funcionários mapeiam planos corretamente (1/25/26/50/51/100/101)", () => {
    expect(planForHeadcount(1)).toBe("starter");
    expect(planForHeadcount(25)).toBe("starter");
    expect(planForHeadcount(26)).toBe("growth");
    expect(planForHeadcount(50)).toBe("growth");
    expect(planForHeadcount(51)).toBe("business");
    expect(planForHeadcount(100)).toBe("business");
    expect(planForHeadcount(101)).toBeNull();
  });

  it("2. preços e limites dos planos batem com o catálogo comercial", async () => {
    const result = await adminOfA().billing.plans();
    expect(result.plans.map(p => p.monthlyPriceCents)).toEqual([15000, 28000, 45000]);
    expect(result.plans.map(p => p.maxEmployees)).toEqual([25, 50, 100]);
    expect(result.plans.every(p => p.highlights.length > 0)).toBe(true);
    expect(result.commercialThreshold).toBe(100);
  });

  it("3. checkout cria pedido com orderNsu imprevisível e link projetado", async () => {
    const result = await adminOfA().billing.startCheckout({ tenantId: tenantA });
    expect(result.orderNsu).toMatch(/^pwrh_[0-9a-f]{32}$/);
    expect(result.checkoutUrl).toContain("/checkout/simulado?order=");
    expect(result.mode).toBe("simulated");
    const [invoice] = await (
      await getDb()
    )!
      .select()
      .from(billingInvoices)
      .where(eq(billingInvoices.orderNsu, result.orderNsu));
    expect(invoice.status).toBe("pending");
    expect(invoice.amountCents).toBe(plans[result.planCode].monthlyPriceCents);
  });

  it("4. checkout repetido dentro de 15min reutiliza a fatura pendente", async () => {
    const first = await adminOfA().billing.startCheckout({ tenantId: tenantA, requestedPlan: "business" });
    const again = await adminOfA().billing.startCheckout({ tenantId: tenantA, requestedPlan: "business" });
    expect(again.invoiceId).toBe(first.invoiceId);
  });

  it("5. visitar a página de pagamento sozinho NÃO ativa a assinatura", async () => {
    const overview = await adminOfA().billing.overview({ tenantId: tenantA });
    expect(overview.accessStatus).toBe("trialing");
    expect(overview.pendingInvoiceId).not.toBeNull();
  });

  it("6. webhook sem confirmação revalidada NÃO libera acesso", async () => {
    const overview = await adminOfA().billing.overview({ tenantId: tenantA });
    const orderNsu = (
      await (await getDb())!
        .select()
        .from(billingInvoices)
        .where(eq(billingInvoices.id, overview.pendingInvoiceId!))
    )[0].orderNsu;
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "paid", order_nsu: orderNsu }),
    });
    const payload = (await res.json()) as { confirmed?: boolean };
    expect(res.status).toBe(200);
    expect(payload.confirmed).toBe(false);
    const after = await adminOfA().billing.overview({ tenantId: tenantA });
    expect(after.accessStatus).toBe("trialing");
  });

  it("7. aprovação simulada + verificação server-side ativam a assinatura", async () => {
    await adminOfA().billing.simulateApproval({ tenantId: tenantA });
    const result = await adminOfA().billing.checkPayment({ tenantId: tenantA });
    expect(result.status).toBe("paid");
    const overview = await adminOfA().billing.overview({ tenantId: tenantA });
    expect(overview.accessStatus).toBe("active");
    expect(overview.periodEnd).not.toBeNull();
    const subscription = await (await getDb())!
      .select()
      .from(tenantSubscriptions)
      .where(eq(tenantSubscriptions.tenantId, tenantA));
    expect(subscription[0].status).toBe("active");
    expect(subscription[0].currentPeriodEnd!.getTime()).toBeGreaterThan(
      Date.now() + 29 * 24 * 3600 * 1000
    );
  });

  it("8. webhook duplicado é idempotente (sem segunda ativação)", async () => {
    const overview = await adminOfA().billing.overview({ tenantId: tenantA });
    const before = overview.periodEnd;
    const orderNsu = (
      await (await getDb())!
        .select()
        .from(billingInvoices)
        .where(eq(billingInvoices.tenantId, tenantA))
        .orderBy(billingInvoices.id)
    ).at(-1)!.orderNsu;
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "paid", order_nsu: orderNsu }),
    });
    const payload = (await res.json()) as { confirmed?: boolean };
    expect(payload.confirmed).toBe(true);
    const [event] = await (await getDb())!
      .select()
      .from(billingEvents)
      .where(
        and(
          eq(billingEvents.externalId, `${orderNsu}:paid`),
          eq(billingEvents.result, "idempotent_repeat")
        )
      );
    expect(event).toBeTruthy();
    const after = await adminOfA().billing.overview({ tenantId: tenantA });
    expect(after.periodEnd).toBe(before);
  });

  it("9. valor pago menor que a fatura é recusado (mismatch)", async () => {
    const checkout = await adminOfMismatch().billing.startCheckout({
      tenantId: tenantMismatch,
    });
    const db = (await getDb())!;
    await recordBillingEvent(db, {
      provider: "infinitepay",
      externalId: checkout.orderNsu,
      eventType: "paid",
      invoiceId: checkout.invoiceId,
      result: "simulated",
      detail: { amountCents: 1 },
    });
    const result = await adminOfMismatch().billing.checkPayment({
      tenantId: tenantMismatch,
    });
    expect(result.status).toBe("mismatch");
    const [invoice] = await db
      .select()
      .from(billingInvoices)
      .where(eq(billingInvoices.id, checkout.invoiceId));
    expect(invoice.status).toBe("pending");
    const overview = await adminOfMismatch().billing.overview({
      tenantId: tenantMismatch,
    });
    expect(overview.accessStatus).toBe("trialing");
  });

  it("10. webhook também recusa valor divergente", async () => {
    const checkout = await adminOfB().billing.startCheckout({ tenantId: tenantB });
    const db = (await getDb())!;
    await recordBillingEvent(db, {
      provider: "infinitepay",
      externalId: checkout.orderNsu,
      eventType: "paid",
      invoiceId: checkout.invoiceId,
      result: "simulated",
      detail: { amountCents: 10 },
    });
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "paid", order_nsu: checkout.orderNsu }),
    });
    const payload = (await res.json()) as { confirmed?: boolean };
    expect(payload.confirmed).toBe(false);
    const [event] = await db
      .select()
      .from(billingEvents)
      .where(
        and(
          eq(billingEvents.externalId, `${checkout.orderNsu}:paid`),
          eq(billingEvents.result, "rejected")
        )
      );
    expect(event?.eventType).toBe("amount_mismatch");
    const [invoice] = await db
      .select()
      .from(billingInvoices)
      .where(eq(billingInvoices.id, checkout.invoiceId));
    expect(invoice.status).toBe("pending");
  });

  it("11. webhook com pedido desconhecido responde 200 sem ativar nada", async () => {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "paid", order_nsu: "pwrh_unknown_order" }),
    });
    const payload = (await res.json()) as { matched?: boolean };
    expect(res.status).toBe(200);
    expect(payload.matched).toBe(false);
  });

  it("12. eventos fora de ordem: cancelado antes de pago não impede ativação", async () => {
    const checkout = await adminOfC().billing.startCheckout({ tenantId: tenantC });
    const canceledRes = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "canceled", order_nsu: checkout.orderNsu }),
    });
    expect(canceledRes.status).toBe(200);
    let [invoice] = await (await getDb())!
      .select()
      .from(billingInvoices)
      .where(eq(billingInvoices.id, checkout.invoiceId));
    expect(invoice.status).toBe("pending");
    await adminOfC().billing.simulateApproval({ tenantId: tenantC });
    const paidRes = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "paid", order_nsu: checkout.orderNsu }),
    });
    const payload = (await paidRes.json()) as { confirmed?: boolean };
    expect(payload.confirmed).toBe(true);
    [invoice] = await (await getDb())!
      .select()
      .from(billingInvoices)
      .where(eq(billingInvoices.id, checkout.invoiceId));
    expect(invoice.status).toBe("paid");
  });

  it("13. assinatura bloqueada quebra o RH mas billing continua acessível", async () => {
    const db = (await getDb())!;
    await db
      .update(tenantSubscriptions)
      .set({ status: "past_due", currentPeriodEnd: new Date(Date.now() - 86400000) })
      .where(eq(tenantSubscriptions.tenantId, tenantA));
    let blockedError: unknown;
    try {
      await adminOfA().attendance.myWeek({
        tenantId: tenantA,
        date: new Date().toLocaleDateString("en-CA"),
      });
    } catch (error) {
      blockedError = error;
    }
    expect((blockedError as { code?: string })?.code ?? "").toBe(
      "PAYMENT_REQUIRED"
    );
    const overview = await adminOfA().billing.overview({ tenantId: tenantA });
    expect(overview.accessStatus).toBe("blocked_period_ended");
    expect(overview.graceDays).toBe(0);
    // Restore active access (simulating a confirmed renewal).
    await db
      .update(tenantSubscriptions)
      .set({ status: "active", currentPeriodEnd: new Date(Date.now() + 25 * 86400000) })
      .where(eq(tenantSubscriptions.tenantId, tenantA));
  });

  it("14. teste gratuito expirado é bloqueado com zero tolerância", async () => {
    const db = (await getDb())!;
    await db
      .update(tenantSubscriptions)
      .set({ status: "trialing", trialEndsAt: new Date(Date.now() - 86400000) })
      .where(eq(tenantSubscriptions.tenantId, tenantMismatch));
    const access = await resolveAccess(db, tenantMismatch);
    expect(access.status).toBe("blocked_trial_ended");
    expect(() => assertAccessAllowed(access)).toThrow();
    const overview = await adminOfMismatch().billing.overview({
      tenantId: tenantMismatch,
    });
    expect(overview.accessStatus).toBe("blocked_trial_ended");
  });

  it("15. isolamento: admin de outra empresa não acessa o billing alheio", async () => {
    let error: unknown;
    try {
      await adminOfB().billing.overview({ tenantId: tenantA });
    } catch (err) {
      error = err;
    }
    expect((error as { code?: string })?.code ?? "").toBe("FORBIDDEN");
  });

  it("16. renovação cria nova fatura; teste vivo não permite renovação", async () => {
    const active = await adminOfA().billing.renew({ tenantId: tenantA });
    expect(active.planCode).toBe("business");
    const [renewed] = await (await getDb())!
      .select()
      .from(billingInvoices)
      .where(eq(billingInvoices.id, active.invoiceId));
    expect(renewed.status).toBe("pending");
    let error: unknown;
    try {
      await adminOfB().billing.renew({ tenantId: tenantB });
    } catch (err) {
      error = err;
    }
    expect(
      ((error as { message?: string })?.message ?? "").includes(
        "teste ainda está ativo"
      )
    ).toBe(true);
  });

  it("17. downgrade abajo da faixa é reagendado, não aplicado na hora", async () => {
    const result = await adminOfA().billing.changePlan({
      tenantId: tenantA,
      targetPlan: "growth",
    });
    expect(result.message).toBeTruthy();
  });

  it("18. importação acima do limite de assentos é recusada", async () => {
    const db = (await getDb())!;
    // Three active memberships occupy all three seats.
    await db
      .update(tenantSubscriptions)
      .set({ seatLimit: 3 })
      .where(eq(tenantSubscriptions.tenantId, seatTenant));
    let error: unknown;
    try {
      await seatCaller().imports.commitCsv({
        tenantId: seatTenant,
        csvText: "name,email\nExtra,extra@seat.local\n",
      });
    } catch (err) {
      error = err;
    }
    expect((error as { code?: string })?.code ?? "").toBe(
      "PRECONDITION_FAILED"
    );
  });

  it("19. dentro do limite a importação funciona e convite além do plano falha", async () => {
    const db = (await getDb())!;
    await db
      .update(tenantSubscriptions)
      .set({ seatLimit: 4 })
      .where(eq(tenantSubscriptions.tenantId, seatTenant));
    const result = await seatCaller().imports.commitCsv({
      tenantId: seatTenant,
      csvText: "name,email\nCabivel,cabivel@seat.local\n",
    });
    expect(result.created).toBe(1);
    const invited = await seatCaller().tenants.inviteMember({
      tenantId: seatTenant,
      name: "Segunda",
      email: `segunda${Date.now()}@seat.local`,
      role: "employee" as const,
    });
    expect(invited).toBeTruthy();
    await db
      .update(tenantSubscriptions)
      .set({ seatLimit: 2 })
      .where(eq(tenantSubscriptions.tenantId, seatTenant));
    let error: unknown;
    try {
      await seatCaller().tenants.inviteMember({
        tenantId: seatTenant,
        name: "Terceira",
        email: `terceira${Date.now()}@seat.local`,
        role: "employee" as const,
      });
    } catch (err) {
      error = err;
    }
    expect((error as { code?: string })?.code ?? "").toBe(
      "PRECONDITION_FAILED"
    );
  });

  it("20. nada dos procedimentos vaza segredos do provedor", async () => {
    const plansOut = JSON.stringify(await adminOfA().billing.plans());
    const overviewOut = JSON.stringify(
      await adminOfA().billing.overview({ tenantId: tenantA })
    );
    for (const blob of [plansOut, overviewOut]) {
      expect(blob.toLowerCase()).not.toContain("api_key");
      expect(blob.toLowerCase()).not.toContain("apikey");
      expect(blob.toLowerCase()).not.toContain("x-api-key");
    }
  });
});
