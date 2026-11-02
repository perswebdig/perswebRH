import { useMemo, useState } from "react";
import {
  BadgeCheck,
  Building2,
  Check,
  Clock3,
  CreditCard,
  ExternalLink,
  LoaderCircle,
  Plug,
  RefreshCw,
  ShieldAlert,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

const statusText: Record<string, { label: string; tone: string }> = {
  trialing: { label: "Em teste", tone: "submitted" },
  active: { label: "Ativo", tone: "approved" },
  blocked_trial_ended: { label: "Teste encerrado", tone: "rejected" },
  blocked_payment_failed: { label: "Pagamento não confirmado", tone: "rejected" },
  blocked_period_ended: { label: "Período encerrado", tone: "rejected" },
  canceled: { label: "Cancelado", tone: "rejected" },
};

export function BillingScreen({
  tenantId,
  onActivated,
}: {
  tenantId: number;
  onActivated?: () => void;
}) {
  const overview = trpc.billing.overview.useQuery({ tenantId });
  const plansQuery = trpc.billing.plans.useQuery();
  const start = trpc.billing.startCheckout.useMutation();
  const check = trpc.billing.checkPayment.useMutation();
  const acceptTerms = trpc.billing.acceptTerms.useMutation();
  const [busy, setBusy] = useState(false);
  const data = overview.data;
  const isBlocked = data
    ? ["blocked_trial_ended", "blocked_payment_failed", "blocked_period_ended", "canceled"].includes(
        data.accessStatus
      )
    : false;

  const choose = async (requestedPlan?: "starter" | "growth" | "business") => {
    setBusy(true);
    try {
      await acceptTerms.mutateAsync({ tenantId });
      const result = await start.mutateAsync({ tenantId, requestedPlan });
      if (!result.checkoutUrl)
        throw new Error("Checkout indisponível. Tente novamente.");
      if (result.mode === "live")
        window.location.href = result.checkoutUrl;
      else
        window.location.href = `/checkout/simulado?order=${encodeURIComponent(result.orderNsu)}`;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha no checkout.");
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    try {
      const result = await check.mutateAsync({ tenantId });
      if (result.status === "paid") {
        toast.success(result.message);
        await overview.refetch();
        onActivated?.();
      } else {
        toast.info(result.message);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao verificar.");
    } finally {
      setBusy(false);
    }
  };

  if (overview.isLoading)
    return (
      <main className="auth-screen">
        <LoaderCircle className="spin" size={22} />
      </main>
    );

  return (
    <main className="auth-screen billing-screen">
      <div className="billing-card">
        <div className="billing-head">
          <span className="brand-mark"><i /></span>
          <div>
            <div className="eyebrow">
              {isBlocked ? "ACESSO SUSPENSO" : "ASSINATURA DA EMPRESA"}
            </div>
            <h1>
              {isBlocked
                ? "Sua assinatura precisa ser regularizada."
                : data?.accessStatus === "trialing"
                  ? `Teste ativo — ${data?.daysLeft ?? 0} dia(s) restante(s).`
                  : "Assinatura ativa."}
            </h1>
            <p>
              {isBlocked
                ? "Os módulos de RH ficam bloqueados até a confirmação do pagamento pelo servidor. Seus dados estão preservados."
                : "O acesso completo é liberado automaticamente após a confirmação do pagamento (webhook verificado server-side)."}
            </p>
          </div>
        </div>

        {data && (
          <div className="billing-status-row">
            <span className={`status-chip status-${statusText[data.accessStatus]?.tone ?? "draft"}`}>
              {statusText[data.accessStatus]?.label ?? data.accessStatus}
            </span>
            <span>
              Plano <b>{data.plan.name}</b> · {data.headcount} de{" "}
              {data.plan.seatLimit} funcionários faturáveis ·{" "}
              {data.plan.priceLabel}/mês
            </span>
            {data.pendingInvoiceId && (
              <button className="button button-outline" onClick={() => void verify()} disabled={busy}>
                <RefreshCw size={14} /> Verificar pagamento
              </button>
            )}
          </div>
        )}

        {data?.pendingInvoiceId && (
          <div className="billing-pending">
            <Clock3 size={16} />
            Estamos confirmando seu pagamento. Esta página não libera acesso por
            conta própria — aguarde o webhook ou use “Verificar pagamento”.
          </div>
        )}

        <div className="billing-plans">
          {(plansQuery.data?.plans ?? []).map(plan => {
            const recommended =
              data && plan.maxEmployees >= data.headcount && plan.minEmployees <= Math.max(1, data.headcount);
            return (
              <article className={`plan-card ${recommended ? "plan-recommended" : ""}`} key={plan.id}>
                {recommended && <span className="plan-badge">Recomendado</span>}
                <b>{plan.name}</b>
                <strong>
                  {plan.priceLabel}
                  <small>/mês</small>
                </strong>
                <small className="plan-limit">
                  Até {plan.maxEmployees} funcionários ativos
                </small>
                <ul>
                  {plan.highlights.map(item => (
                    <li key={item}>
                      <Check size={13} /> {item}
                    </li>
                  ))}
                </ul>
                <button
                  className="button button-primary button-wide"
                  disabled={busy}
                  onClick={() => void choose(plan.id as "starter")}
                >
                  <CreditCard size={15} /> Assinar e pagar
                </button>
              </article>
            );
          })}
          <article className="plan-card plan-commercial">
            <b>Mais de 100 funcionários</b>
            <strong>Plano empresarial</strong>
            <small className="plan-limit">Valor sob consulta — sem preço automático</small>
            <p>
              Fale com vendas para capacidade customizada, integrações e SLA
              dedicado.
            </p>
            <button className="button button-outline button-wide" onClick={() => toast("Nosso time comercial entrará em contato: vendas@perswebrh.com.br")}>
              Fale com vendas
            </button>
          </article>
        </div>

        <div className="billing-footnote">
          <ShieldAlert size={13} />
          Tolerância de inadimplência: {data?.graceDays ?? 0} dia(s). Renovação
          mensal por link de pagamento único (a InfinitePay não oferece
          recorrência programática validada para este checkout). Modo atual:{" "}
          {data?.billingMode === "live" ? "produção (InfinitePay)" : "simulado"}.
        </div>
      </div>
    </main>
  );
}

export function BillingSettings({ tenantId }: { tenantId: number }) {
  const overview = trpc.billing.overview.useQuery({ tenantId });
  const renew = trpc.billing.renew.useMutation();
  const cancel = trpc.billing.cancelSubscription.useMutation();
  const resume = trpc.billing.resumeSubscription.useMutation();
  const changePlan = trpc.billing.changePlan.useMutation();
  const check = trpc.billing.checkPayment.useMutation();
  const addons = trpc.billing.addons.useQuery({ tenantId });
  const toggleAddon = trpc.billing.toggleAddon.useMutation();
  const utils = trpc.useUtils();

  const act = async (action: () => Promise<{ message: string }>) => {
    try {
      const result = await action();
      toast.success(result.message);
      await utils.billing.overview.invalidate();
      await utils.billing.addons.invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha na operação.");
    }
  };

  const data = overview.data;
  const invoiceStatus: Record<string, string> = {
    pending: "Pendente",
    paid: "Paga",
    failed: "Falhou",
    canceled: "Cancelada",
    refunded: "Estornada",
    partially_refunded: "Estorno parcial",
  };

  return (
    <div className="billing-settings">
      <div className="page-heading">
        <div>
          <div className="eyebrow">ASSINATURA E FATURAS</div>
          <h1>
            Cobrança<span className="heading-period">.</span>
          </h1>
          <p>Plano, limite de funcionários, faturas e renovações.</p>
        </div>
      </div>
      {overview.isLoading || !data ? (
        <div className="panel empty-inline">Carregando…</div>
      ) : (
        <>
          <div className="stat-grid">
            <article className="stat-card">
              <div className="stat-label">
                <span className="stat-icon">
                  <BadgeCheck size={17} />
                </span>
                Plano atual
              </div>
              <strong>{data.plan.name}</strong>
              <small>
                {data.plan.priceLabel}/mês ·{" "}
                {statusText[data.accessStatus]?.label ?? data.accessStatus}
                {data.daysLeft !== null && data.accessStatus !== "active"
                  ? ` · ${data.daysLeft} dia(s) restante(s)`
                  : ""}
                {data.cancelAtPeriodEnd ? " · cancela no fim do período" : ""}
              </small>
            </article>
            <article className="stat-card">
              <div className="stat-label">
                <span className="stat-icon indigo">
                  <Building2 size={17} />
                </span>
                Funcionários faturáveis
              </div>
              <strong>
                {data.headcount} de {data.plan.seatLimit}
              </strong>
              <small>
                Contas ativas aceitas; convites pendentes e desativados não
                contam.
              </small>
            </article>
            <article className="stat-card">
              <div className="stat-label">
                <span className="stat-icon amber">
                  <Clock3 size={17} />
                </span>
                Próxima renovação
              </div>
              <strong>
                {data.periodEnd
                  ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(
                      new Date(data.periodEnd)
                    )
                  : "—"}
              </strong>
              <small>Renovação por novo link de pagamento mensal.</small>
            </article>
          </div>

          <div className="panel billing-actions-panel">
            <div className="panel-head">
              <div>
                <div className="eyebrow">AÇÕES</div>
                <h2>Gerenciar assinatura</h2>
              </div>
            </div>
            <div className="billing-actions">
              <button
                className="button button-outline"
                disabled={!data.pendingInvoiceId}
                onClick={() => void act(() => check.mutateAsync({ tenantId }))}
              >
                <RefreshCw size={15} /> Verificar pagamento pendente
              </button>
              <button
                className="button button-primary"
                onClick={() =>
                  void act(async () => {
                    const result = await renew.mutateAsync({ tenantId });
                    if (result.checkoutUrl)
                      window.open(result.checkoutUrl, "_blank");
                    return { message: "Fatura de renovação criada." };
                  })
                }
              >
                <ExternalLink size={15} /> Renovar agora
              </button>
              {(["growth", "business"] as const).map(planId => (
                <button
                  key={planId}
                  className="button button-outline"
                  onClick={() =>
                    void act(() =>
                      changePlan.mutateAsync({ tenantId, targetPlan: planId })
                    )
                  }
                >
                  Mudar para {planId === "growth" ? "Equipe" : "Business"}
                </button>
              ))}
              {data.cancelAtPeriodEnd ? (
                <button
                  className="button button-outline"
                  onClick={() => void act(() => resume.mutateAsync({ tenantId }))}
                >
                  Reverter cancelamento
                </button>
              ) : (
                <button
                  className="button button-outline button-danger"
                  onClick={() => void act(() => cancel.mutateAsync({ tenantId }))}
                >
                  <X size={15} /> Cancelar assinatura
                </button>
              )}
            </div>
            <small className="billing-recurring-note">
              {data.recurringNote}
            </small>
          </div>

          <div className="panel table-panel">
            <div className="panel-head">
              <div>
                <div className="eyebrow">HISTÓRICO</div>
                <h2>Faturas</h2>
              </div>
              <span className="count-pill">{data.invoices.length}</span>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Criada em</th>
                    <th>Plano</th>
                    <th>Período</th>
                    <th>Valor</th>
                    <th>Status</th>
                    <th>Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {data.invoices.map(invoice => (
                    <tr key={invoice.id}>
                      <td>
                        {new Intl.DateTimeFormat("pt-BR", {
                          dateStyle: "short",
                        }).format(new Date(invoice.createdAt))}
                      </td>
                      <td>{invoice.planCode === "starter" ? "Essencial" : invoice.planCode === "growth" ? "Equipe" : "Business"}</td>
                      <td>
                        {invoice.periodStart} → {invoice.periodEnd}
                      </td>
                      <td>{invoice.amountLabel}</td>
                      <td>
                        <span
                          className={`status-chip status-${invoice.status === "paid" ? "approved" : invoice.status === "pending" ? "submitted" : "rejected"}`}
                        >
                          {invoiceStatus[invoice.status] ?? invoice.status}
                        </span>
                      </td>
                      <td>
                        {invoice.status === "pending" && invoice.checkoutUrl ? (
                          <button
                            className="text-link"
                            onClick={() =>
                              window.location.assign(invoice.checkoutUrl!)
                            }
                          >
                            Pagar agora <ExternalLink size={13} />
                          </button>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                  {!data.invoices.length && (
                    <tr>
                      <td colSpan={6}>Nenhuma fatura ainda.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <div>
                <div className="eyebrow">INTEGRAÇÕES E ADD-ONS</div>
                <h2>Catálogo de integrações</h2>
              </div>
              <Plug size={17} className="muted-icon" />
            </div>
            <div className="addon-list">
              {(addons.data ?? []).map(addon => (
                <article className="addon-card" key={addon.code}>
                  <div>
                    <b>{addon.name}</b>
                    <small>{addon.description}</small>
                    <small className="addon-status">
                      {addon.statusLabel} · preço: {addon.priceLabel}
                    </small>
                  </div>
                  <div className="addon-actions">
                    <span className={`status-chip ${addon.enabled ? "status-approved" : "status-draft"}`}>
                      {addon.enabled
                        ? "Ativo"
                        : addon.entitlementStatus === "needs_configuration"
                          ? "Config. necessária"
                          : "Disponível"}
                    </span>
                    <button
                      className="button button-outline"
                      onClick={() =>
                        void act(() =>
                          toggleAddon.mutateAsync({
                            tenantId,
                            addonCode: addon.code,
                            enable: !addon.enabled,
                          })
                        )
                      }
                    >
                      {addon.enabled ? "Desconectar" : "Ativar"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
