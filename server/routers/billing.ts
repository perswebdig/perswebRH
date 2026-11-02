import { and, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import {
  billingInvoices,
  memberships,
  platformAuditLogs,
  platformSettings,
  tenantAddons,
  tenantSubscriptions,
  termsAcceptances,
} from "../../drizzle/schema";
import {
  planList,
  plans,
  planForHeadcount,
  normalizePlan,
  formatBRL,
} from "../../shared/plans";
import { ENV } from "../_core/env";
import {
  audit,
  canManage,
  database,
  idSchema,
  optionalText,
  requireActor,
  textField,
} from "./shared";
import {
  activateInvoice,
  assertAccessAllowed,
  billableHeadcount,
  getSubscription,
  GRACE_DAYS,
  recordBillingEvent,
  resolveAccess,
  TERMS_VERSION,
  trialDays,
} from "../billing/core";
import type { Db } from "../billing/db-types";
import {
  checkPayment,
  createCheckout,
  isLiveMode,
  newOrderNsu,
} from "../billing/infinitepay";

function publicBaseUrl(headers: Record<string, unknown>) {
  const configured = (process.env.APP_PUBLIC_URL ?? "").trim();
  if (configured) return configured.replace(/\/$/, "");
  const host = String(headers["x-forwarded-host"] ?? headers.host ?? "");
  const proto = String(headers["x-forwarded-proto"] ?? "http");
  return host ? `${proto}://${host}` : "";
}

async function billingMember(
  db: Db,
  user: { id: number },
  tenantId: number
) {
  const [member] = await db
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
  if (!member)
    throw new TRPCError({ code: "FORBIDDEN", message: "Acesso negado." });
  return member;
}

// Add-on catalog: no prices are invented — priceCents stays null ("a
// definir") until a Super Admin configures it. Connectors that depend on
// vendor access/credentials are listed with their real, honest status.
export const ADDON_CATALOG = [
  {
    code: "directory_entra_id",
    name: "Microsoft Entra ID (Azure AD)",
    kind: "directory",
    description:
      "Importação e sincronização de usuários e grupos via API oficial, com consentimento do administrador.",
    status: "needs_vendor_access" as const,
    statusLabel:
      "Aguardando credenciais de teste e validação da API do fornecedor",
  },
  {
    code: "directory_google_workspace",
    name: "Google Workspace",
    kind: "directory",
    description:
      "Importação e sincronização de usuários e grupos com autorização de administrador do domínio.",
    status: "needs_vendor_access" as const,
    statusLabel: "Aguardando credenciais de teste e validação da API",
  },
  {
    code: "directory_active_directory",
    name: "Active Directory local",
    kind: "directory",
    description:
      "Requer conector instalado na rede do cliente (arquitetura pendente de infraestrutura).",
    status: "needs_infrastructure" as const,
    statusLabel: "Arquitetura definida; conector aguardando infraestrutura",
  },
  {
    code: "erp_adp",
    name: "ADP / ADPWeb",
    kind: "erp",
    description:
      "Candidato prioritário de integração com folha/ponto. Aguardando documentação e sandbox do fornecedor.",
    status: "needs_vendor_access" as const,
    statusLabel: "Aguardando acesso do fornecedor (documentação + sandbox)",
  },
  {
    code: "erp_totvs",
    name: "TOTVS RM / Protheus",
    kind: "erp",
    description: "Candidato de roadmap, sujeito à validação de API e licença.",
    status: "roadmap" as const,
    statusLabel: "Roadmap — não validado",
  },
  {
    code: "erp_senior",
    name: "Senior Sistemas",
    kind: "erp",
    description: "Candidato de roadmap, sujeito à validação de API e licença.",
    status: "roadmap" as const,
    statusLabel: "Roadmap — não validado",
  },
  {
    code: "erp_sap",
    name: "SAP",
    kind: "erp",
    description: "Candidato de roadmap, sujeito à validação de API e licença.",
    status: "roadmap" as const,
    statusLabel: "Roadmap — não validado",
  },
] as const;

export const billingRouter = router({
  plans: publicProcedure.query(() => ({
      plans: Object.values(plans).map(plan => ({
      id: plan.id,
      name: plan.name,
      description: plan.description,
      monthlyPriceCents: plan.monthlyPriceCents,
      priceLabel: formatBRL(plan.monthlyPriceCents),
      maxEmployees: plan.maxEmployees,
      minEmployees: plan.minEmployees,
      highlights: plan.highlights,
    })),
    commercialThreshold: 100,
  })),

  overview: protectedProcedure
    .input(z.object({ tenantId: idSchema }))
    .query(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      await billingMember(db, user, input.tenantId);
      const access = await resolveAccess(db, input.tenantId);
      const invoices = await db
        .select()
        .from(billingInvoices)
        .where(eq(billingInvoices.tenantId, input.tenantId))
        .orderBy(desc(billingInvoices.createdAt))
        .limit(24);
      return {
        accessStatus: access.status,
        pendingInvoiceId: access.pendingInvoiceId ?? null,
        plan: {
          id: access.plan,
          name: plans[access.plan].name,
          priceCents: access.priceCents,
          priceLabel: formatBRL(access.priceCents),
          seatLimit: access.seatLimit,
        },
        headcount: access.headcount,
        daysLeft: access.daysLeft,
        periodEnd: access.periodEnd?.toISOString() ?? null,
        cancelAtPeriodEnd: access.cancelAtPeriodEnd,
        graceDays: GRACE_DAYS,
        billingMode: isLiveMode() ? "live" : "simulated",
        recurringSupported: false,
        recurringNote:
          "A InfinitePay (checkout integrado) não oferece recorrência programática validada. Cada ciclo mensal gera uma nova fatura com link de pagamento único.",
        invoices: invoices.map(invoice => ({
          id: invoice.id,
          orderNsu: invoice.orderNsu,
          planCode: invoice.planCode,
          amountCents: invoice.amountCents,
          amountLabel: formatBRL(invoice.amountCents),
          status: invoice.status,
          periodStart: invoice.periodStart,
          periodEnd: invoice.periodEnd,
          checkoutUrl: invoice.checkoutUrl,
          createdAt: invoice.createdAt.toISOString(),
          paidAt: invoice.paidAt?.toISOString() ?? null,
        })),
      };
    }),

  startCheckout: protectedProcedure
    .input(
      z.object({
        tenantId: idSchema,
        requestedPlan: z.enum(["starter", "growth", "business"]).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      const member = await billingMember(db, user, input.tenantId);
      if (member.role !== "tenant_admin")
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Apenas o administrador da empresa contrata planos.",
        });
      const headcount = await billableHeadcount(db, input.tenantId);
      const recommended = planForHeadcount(headcount);
      if (!recommended)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Sua empresa tem mais de 100 funcionários ativos. Fale com vendas para um plano empresarial sob medida.",
        });
      const planCode =
        input.requestedPlan && plans[input.requestedPlan].maxEmployees >= headcount
          ? input.requestedPlan
          : recommended;
      if (!input.requestedPlan && headcount > plans[planCode].maxEmployees)
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // Reuse a fresh pending invoice instead of creating duplicate links.
      const [recentPending] = await db
        .select()
        .from(billingInvoices)
        .where(
          and(
            eq(billingInvoices.tenantId, input.tenantId),
            eq(billingInvoices.status, "pending"),
            eq(billingInvoices.planCode, planCode)
          )
        )
        .orderBy(desc(billingInvoices.createdAt), desc(billingInvoices.id))
        .limit(1);
      if (
        recentPending &&
        Date.now() - recentPending.createdAt.getTime() < 15 * 60 * 1000
      )
        return {
          invoiceId: recentPending.id,
          orderNsu: recentPending.orderNsu,
          checkoutUrl: recentPending.checkoutUrl ?? "",
          planCode,
        };

      const amountCents = plans[planCode].monthlyPriceCents;
      const orderNsu = newOrderNsu();
      const periodStart = new Date();
      const periodEnd = new Date();
      periodEnd.setUTCDate(periodEnd.getUTCDate() + 30);
      const baseUrl = publicBaseUrl(ctx.req.headers as Record<string, unknown>);
      const correlationId = `chk_${orderNsu.slice(-12)}`;
      const checkout = await createCheckout(
        {
          orderNsu,
          amountCents,
          description: `Pers Web RH — Plano ${plans[planCode].name} (mensal)`,
          redirectUrl: baseUrl ? `${baseUrl}/?billing_return=1` : "",
          webhookUrl: baseUrl ? `${baseUrl}/api/webhooks/infinitepay` : undefined,
        },
        correlationId
      );
      const [invoice] = await db
        .insert(billingInvoices)
        .values({
          tenantId: input.tenantId,
          orderNsu,
          periodStart: periodStart.toISOString().slice(0, 10),
          periodEnd: periodEnd.toISOString().slice(0, 10),
          planCode,
          amountCents,
          checkoutUrl: checkout.checkoutUrl,
          slug: checkout.slug ?? null,
        })
        .$returningId();
      await audit(db, input.tenantId, member.id, "billing_invoice", invoice.id, "checkout_created", {
        planCode,
        amountCents,
        mode: checkout.mode,
        correlationId,
      });
      return {
        invoiceId: invoice.id,
        orderNsu,
        checkoutUrl: checkout.checkoutUrl,
        planCode,
        mode: checkout.mode,
      };
    }),

  checkPayment: protectedProcedure
    .input(z.object({ tenantId: idSchema, invoiceId: idSchema.optional() }))
    .mutation(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      const member = await billingMember(db, user, input.tenantId);
      const [invoice] = input.invoiceId
        ? await db
            .select()
            .from(billingInvoices)
            .where(
              and(
                eq(billingInvoices.id, input.invoiceId),
                eq(billingInvoices.tenantId, input.tenantId)
              )
            )
            .limit(1)
        : await db
            .select()
            .from(billingInvoices)
            .where(
              and(
                eq(billingInvoices.tenantId, input.tenantId),
                eq(billingInvoices.status, "pending")
              )
            )
            .orderBy(desc(billingInvoices.createdAt), desc(billingInvoices.id))
            .limit(1);
      if (!invoice)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Nenhuma cobrança pendente para verificar.",
        });
      const correlationId = `chk_${invoice.orderNsu.slice(-12)}`;
      const provider = await checkPayment(
        {
          orderNsu: invoice.orderNsu,
          slug: invoice.slug ?? undefined,
          transactionNsu: invoice.externalTransactionId ?? undefined,
        },
        correlationId
      );
      if (!provider.approved)
        return {
          status: "pending" as const,
          message: "Pagamento ainda não confirmado pelo provedor.",
        };
      // Value check: paid amount must cover the invoiced amount exactly.
      const paidCents =
        provider.paidAmountCents ?? invoice.amountCents;
      if (
        provider.amountCents !== null &&
        provider.amountCents < invoice.amountCents
      ) {
        await recordBillingEvent(db, {
          provider: "infinitepay",
          externalId: `${invoice.orderNsu}:${provider.status}`,
          eventType: "amount_mismatch",
          invoiceId: invoice.id,
          result: "rejected",
          detail: {
            invoiced: invoice.amountCents,
            providerAmount: provider.amountCents,
            correlationId,
          },
        });
        return {
          status: "mismatch" as const,
          message:
            "O valor confirmado pelo provedor difere da fatura. Contate o suporte.",
        };
      }
      if (paidCents < invoice.amountCents) {
        await recordBillingEvent(db, {
          provider: "infinitepay",
          externalId: `${invoice.orderNsu}:${provider.status}`,
          eventType: "amount_mismatch",
          invoiceId: invoice.id,
          result: "rejected",
          detail: { invoiced: invoice.amountCents, paid: paidCents, correlationId },
        });
        return {
          status: "mismatch" as const,
          message:
            "O valor pago difere da fatura. Contate o suporte para regularizar.",
        };
      }
      const result = await activateInvoice(
        db,
        invoice.id,
        provider.transactionNsu ?? null
      );
      await audit(
        db,
        input.tenantId,
        member.id,
        "billing_invoice",
        invoice.id,
        result.alreadyPaid ? "already_active" : "payment_confirmed",
        { correlationId, mode: provider.mode }
      );
      return {
        status: "paid" as const,
        message: "Pagamento confirmado — acesso liberado automaticamente.",
      };
    }),

  simulateApproval: protectedProcedure
    .input(z.object({ tenantId: idSchema }))
    .mutation(async ({ ctx, input }) => {
      if (isLiveMode())
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Simulação indisponível: credenciais reais da InfinitePay estão configuradas.",
        });
      if (process.env.BILLING_SIMULATION !== "1")
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Simulação de pagamento desativada neste ambiente.",
        });
      const user = requireActor(ctx.user);
      const db = await database();
      const member = await billingMember(db, user, input.tenantId);
      if (member.role !== "tenant_admin") throw new TRPCError({ code: "FORBIDDEN" });
      const [invoice] = await db
        .select()
        .from(billingInvoices)
        .where(
          and(
            eq(billingInvoices.tenantId, input.tenantId),
            eq(billingInvoices.status, "pending")
          )
        )
        .orderBy(desc(billingInvoices.createdAt), desc(billingInvoices.id))
        .limit(1);
      if (!invoice)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Nenhuma cobrança pendente para simular.",
        });
      // Dev-only: records a durable simulated provider event. The normal
      // verification path (checkPayment) is what actually activates.
      await recordBillingEvent(db, {
        provider: "infinitepay",
        externalId: invoice.orderNsu,
        eventType: "paid",
        invoiceId: invoice.id,
        result: "simulated",
        detail: { amountCents: invoice.amountCents, simulated: true },
      });
      await audit(
        db,
        input.tenantId,
        member.id,
        "billing_invoice",
        invoice.id,
        "simulated_approval",
        { orderNsu: invoice.orderNsu }
      );
      return { simulated: true, orderNsu: invoice.orderNsu };
    }),

  renew: protectedProcedure
    .input(z.object({ tenantId: idSchema }))
    .mutation(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      const member = await billingMember(db, user, input.tenantId);
      if (member.role !== "tenant_admin") throw new TRPCError({ code: "FORBIDDEN" });
      const access = await resolveAccess(db, input.tenantId);
      if (access.status === "trialing")
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "O teste ainda está ativo. Assine quando quiser.",
        });
      // Honor a scheduled downgrade only if the headcount fits the band.
      let planCode = access.plan;
      const notes = access.subscription.notes ?? "";
      try {
        const parsed = JSON.parse(notes || "{}") as { pendingDowngrade?: string };
        if (
          parsed.pendingDowngrade &&
          plans[normalizePlan(parsed.pendingDowngrade)].maxEmployees >=
            access.headcount
        )
          planCode = normalizePlan(parsed.pendingDowngrade);
      } catch {
        // notes are informational only
      }
      if (plans[planCode].maxEmployees < access.headcount)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Você tem ${access.headcount} funcionários faturáveis — acima da faixa solicitada. Reduza ou mantenha o plano atual.`,
        });
      const amountCents = plans[planCode].monthlyPriceCents;
      const orderNsu = newOrderNsu();
      const periodStart = new Date();
      const periodEnd = new Date();
      periodEnd.setUTCDate(periodEnd.getUTCDate() + 30);
      const baseUrl = publicBaseUrl(ctx.req.headers as Record<string, unknown>);
      const checkout = await createCheckout(
        {
          orderNsu,
          amountCents,
          description: `Pers Web RH — Renovação ${plans[planCode].name} (mensal)`,
          redirectUrl: baseUrl ? `${baseUrl}/?billing_return=1` : "",
          webhookUrl: baseUrl ? `${baseUrl}/api/webhooks/infinitepay` : undefined,
        },
        `ren_${orderNsu.slice(-12)}`
      );
      const [invoice] = await db
        .insert(billingInvoices)
        .values({
          tenantId: input.tenantId,
          orderNsu,
          periodStart: periodStart.toISOString().slice(0, 10),
          periodEnd: periodEnd.toISOString().slice(0, 10),
          planCode,
          amountCents,
          checkoutUrl: checkout.checkoutUrl,
          slug: checkout.slug ?? null,
        })
        .$returningId();
      await audit(db, input.tenantId, member.id, "billing_invoice", invoice.id, "renewal_created", {
        planCode,
        amountCents,
      });
      return { invoiceId: invoice.id, checkoutUrl: checkout.checkoutUrl, planCode };
    }),

  cancelSubscription: protectedProcedure
    .input(z.object({ tenantId: idSchema }))
    .mutation(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      const member = await billingMember(db, user, input.tenantId);
      if (member.role !== "tenant_admin") throw new TRPCError({ code: "FORBIDDEN" });
      const access = await resolveAccess(db, input.tenantId);
      if (access.status === "trialing") {
        await db
          .update(tenantSubscriptions)
          .set({ status: "canceled", canceledAt: new Date() })
          .where(eq(tenantSubscriptions.tenantId, input.tenantId));
      } else {
        await db
          .update(tenantSubscriptions)
          .set({ cancelAtPeriodEnd: "1", canceledAt: new Date() })
          .where(eq(tenantSubscriptions.tenantId, input.tenantId));
      }
      await audit(db, input.tenantId, member.id, "subscription", access.subscription.id, "cancel_requested");
      return {
        message:
          access.status === "trialing"
            ? "Teste cancelado."
            : "Cancelamento agendado para o fim do período já pago.",
      };
    }),

  resumeSubscription: protectedProcedure
    .input(z.object({ tenantId: idSchema }))
    .mutation(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      const member = await billingMember(db, user, input.tenantId);
      if (member.role !== "tenant_admin") throw new TRPCError({ code: "FORBIDDEN" });
      await db
        .update(tenantSubscriptions)
        .set({ cancelAtPeriodEnd: "0", canceledAt: null })
        .where(eq(tenantSubscriptions.tenantId, input.tenantId));
      await audit(db, input.tenantId, member.id, "subscription", 0, "cancel_reverted");
      return { message: "Cancelamento revertido." };
    }),

  changePlan: protectedProcedure
    .input(
      z.object({
        tenantId: idSchema,
        targetPlan: z.enum(["starter", "growth", "business"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      const member = await billingMember(db, user, input.tenantId);
      if (member.role !== "tenant_admin") throw new TRPCError({ code: "FORBIDDEN" });
      const access = await resolveAccess(db, input.tenantId);
      const target = plans[input.targetPlan];
      if (access.status === "trialing") {
        await db
          .update(tenantSubscriptions)
          .set({
            plan: input.targetPlan,
            seatLimit: target.seatLimit,
            priceCents: target.monthlyPriceCents,
          })
          .where(eq(tenantSubscriptions.tenantId, input.tenantId));
        await audit(db, input.tenantId, member.id, "subscription", 0, "plan_changed_trial", {
          targetPlan: input.targetPlan,
        });
        return {
          message: `Plano ${target.name} aplicado ao teste (limite de ${target.seatLimit} funcionários).`,
        };
      }
      if (target.maxEmployees >= plans[access.plan].maxEmployees) {
        // Upgrade: new invoice now; entitlement widens after confirmation.
        const orderNsu = newOrderNsu();
        const baseUrl = publicBaseUrl(ctx.req.headers as Record<string, unknown>);
        const checkout = await createCheckout(
          {
            orderNsu,
            amountCents: target.monthlyPriceCents,
            description: `Pers Web RH — Upgrade para ${target.name} (mensal)`,
            redirectUrl: baseUrl ? `${baseUrl}/?billing_return=1` : "",
          },
          `upg_${orderNsu.slice(-12)}`
        );
        const periodStart = new Date();
        const periodEnd = new Date();
        periodEnd.setUTCDate(periodEnd.getUTCDate() + 30);
        const [invoice] = await db
          .insert(billingInvoices)
          .values({
            tenantId: input.tenantId,
            orderNsu,
            periodStart: periodStart.toISOString().slice(0, 10),
            periodEnd: periodEnd.toISOString().slice(0, 10),
            planCode: input.targetPlan,
            amountCents: target.monthlyPriceCents,
            checkoutUrl: checkout.checkoutUrl,
          })
          .$returningId();
        await audit(db, input.tenantId, member.id, "billing_invoice", invoice.id, "upgrade_created", {
          targetPlan: input.targetPlan,
        });
        return {
          message: `Upgrade para ${target.name}: pague a fatura para ampliar o limite para ${target.seatLimit} funcionários.`,
          checkoutUrl: checkout.checkoutUrl,
        };
      }
      // Downgrade: scheduled for next cycle, only if headcount fits.
      if (target.maxEmployees < access.headcount)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Você tem ${access.headcount} funcionários faturáveis; a faixa ${target.name} permite ${target.seatLimit}. Reduza a equipe ou escolha outra faixa — ninguém é desativado automaticamente.`,
        });
      await db
        .update(tenantSubscriptions)
        .set({ notes: JSON.stringify({ pendingDowngrade: input.targetPlan }) })
        .where(eq(tenantSubscriptions.tenantId, input.tenantId));
      await audit(db, input.tenantId, member.id, "subscription", 0, "downgrade_scheduled", {
        targetPlan: input.targetPlan,
      });
      return {
        message: `Downgrade para ${target.name} agendado para o próximo ciclo (se a contagem continuar compatível).`,
      };
    }),

  addons: protectedProcedure
    .input(z.object({ tenantId: idSchema }))
    .query(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      await billingMember(db, user, input.tenantId);
      const enabled = await db
        .select()
        .from(tenantAddons)
        .where(eq(tenantAddons.tenantId, input.tenantId));
      return ADDON_CATALOG.map(addon => {
        const state = enabled.find(row => row.addonCode === addon.code);
        return {
          ...addon,
          priceCents: state?.priceCents ?? null,
          priceLabel: state?.priceCents ? formatBRL(state.priceCents) : "A definir",
          entitlementStatus: state?.status ?? "available",
          enabled: state?.status === "active",
        };
      });
    }),

  toggleAddon: protectedProcedure
    .input(
      z.object({
        tenantId: idSchema,
        addonCode: textField(60),
        enable: z.boolean(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      const member = await billingMember(db, user, input.tenantId);
      if (member.role !== "tenant_admin") throw new TRPCError({ code: "FORBIDDEN" });
      const addon = ADDON_CATALOG.find(item => item.code === input.addonCode);
      if (!addon) throw new TRPCError({ code: "NOT_FOUND" });
      const nextStatus = input.enable
        ? addon.status === "needs_vendor_access" ||
            addon.status === "needs_infrastructure" ||
            addon.status === "roadmap"
          ? "needs_configuration"
          : "active"
        : "disconnected";
      await db
        .insert(tenantAddons)
        .values({
          tenantId: input.tenantId,
          addonCode: input.addonCode,
          status: nextStatus,
          priceCents: null,
          enabledByMembershipId: member.id,
        })
        .onDuplicateKeyUpdate({
          set: { status: nextStatus, enabledByMembershipId: member.id },
        });
      await audit(db, input.tenantId, member.id, "addon", null, input.enable ? "addon_enabled" : "addon_disabled", {
        addonCode: input.addonCode,
      });
      return {
        status: nextStatus,
        message:
          nextStatus === "needs_configuration"
            ? "Add-on registrado como 'configuração necessária' — a integração ainda não está disponível até validação do fornecedor."
            : "Estado atualizado.",
      };
    }),

  acceptTerms: protectedProcedure
    .input(z.object({ tenantId: idSchema.nullable().optional() }))
    .mutation(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      await db
        .insert(termsAcceptances)
        .values({
          tenantId: input.tenantId ?? null,
          userId: user.id,
          version: TERMS_VERSION,
        })
        .onDuplicateKeyUpdate({ set: { acceptedAt: new Date() } });
      return { version: TERMS_VERSION };
    }),

  platformBilling: protectedProcedure.query(async ({ ctx }) => {
    const user = requireActor(ctx.user);
    if (user.role !== "admin")
      throw new TRPCError({ code: "FORBIDDEN", message: "Super Admin apenas." });
    const db = await database();
    const rows = await db
      .select({
        tenantId: tenantSubscriptions.tenantId,
        plan: tenantSubscriptions.plan,
        status: tenantSubscriptions.status,
        seatLimit: tenantSubscriptions.seatLimit,
        priceCents: tenantSubscriptions.priceCents,
        trialEndsAt: tenantSubscriptions.trialEndsAt,
        currentPeriodEnd: tenantSubscriptions.currentPeriodEnd,
        cancelAtPeriodEnd: tenantSubscriptions.cancelAtPeriodEnd,
      })
      .from(tenantSubscriptions);
    const accessList = await Promise.all(
      rows.map(async row => {
        const access = await resolveAccess(db, row.tenantId);
        return {
          tenantId: row.tenantId,
          plan: plans[access.plan].name,
          accessStatus: access.status,
          headcount: access.headcount,
          seatLimit: access.seatLimit,
          priceCents: access.priceCents,
          periodEnd: access.periodEnd?.toISOString() ?? null,
          daysLeft: access.daysLeft,
        };
      })
    );
    return accessList;
  }),

  adminOverride: protectedProcedure
    .input(
      z.object({
        tenantId: idSchema,
        invoiceId: idSchema,
        reason: optionalText(500),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      if (user.role !== "admin")
        throw new TRPCError({ code: "FORBIDDEN", message: "Super Admin apenas." });
      if (!input.reason?.trim())
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Informe o motivo da ação manual (obrigatório para auditoria).",
        });
      const db = await database();
      const [invoice] = await db
        .select()
        .from(billingInvoices)
        .where(
          and(
            eq(billingInvoices.id, input.invoiceId),
            eq(billingInvoices.tenantId, input.tenantId)
          )
        )
        .limit(1);
      if (!invoice) throw new TRPCError({ code: "NOT_FOUND" });
      const result = await activateInvoice(db, invoice.id, "manual_override");
      await db.insert(platformAuditLogs).values({
        actorUserId: user.id,
        tenantId: input.tenantId,
        action: "admin_manual_override",
        resource: "billing_invoice",
        resourceId: invoice.id,
        metadata: {
          reason: input.reason,
          alreadyPaid: result.alreadyPaid,
        },
      });
      return {
        message:
          "Fatura marcada como paga manualmente (auditada). Lembre-se de conferir o comprovante no provedor.",
      };
    }),

  setTrialDays: protectedProcedure
    .input(z.object({ days: z.number().int().min(0).max(90) }))
    .mutation(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      if (user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await database();
      await db
        .insert(platformSettings)
        .values({
          key: "trial_days",
          value: String(input.days),
          updatedByUserId: user.id,
        })
        .onDuplicateKeyUpdate({
          set: { value: String(input.days), updatedByUserId: user.id },
        });
      return { trialDays: input.days };
    }),
});
