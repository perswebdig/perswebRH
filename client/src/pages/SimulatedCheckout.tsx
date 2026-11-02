import { useEffect, useState } from "react";
import { Check, Clock3, ExternalLink, LoaderCircle, X } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

// Console of the SIMULATED checkout (used when no InfinitePay credentials
// are configured). Never auto-approves: only records a durable simulated
// provider event; the normal server-side verification flow then activates.
export default function SimulatedCheckout() {
  const order = new URLSearchParams(window.location.search).get("order") ?? "";
  const simulate = trpc.billing.simulateApproval.useMutation();
  const check = trpc.billing.checkPayment.useMutation();
  const [state, setState] = useState<"idle" | "simulated" | "paid" | "error">(
    "idle"
  );
  const [message, setMessage] = useState("");
  const utils = trpc.useUtils();

  useEffect(() => {
    if (!order) setState("error");
  }, [order]);

  const run = async () => {
    try {
      await simulate.mutateAsync({ tenantId: tenantIdFromStorage() });
      setState("simulated");
      const result = await check.mutateAsync({
        tenantId: tenantIdFromStorage(),
      });
      if (result.status === "paid") {
        setState("paid");
        setMessage(result.message);
        await utils.billing.overview.invalidate();
      } else {
        setMessage(result.message);
      }
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Falha.");
      toast.error(error instanceof Error ? error.message : "Falha.");
    }
  };

  return (
    <main className="auth-screen">
      <div className="auth-card">
        <div className="brand-lockup">
          <span className="brand-mark">
            <i />
          </span>
          <span>
            persweb<span className="brand-rh">rh</span>
          </span>
        </div>
        <div className="auth-eyebrow">
          <Clock3 size={14} /> Checkout simulado — ambiente de testes
        </div>
        <h1>
          {state === "paid" ? "Pagamento confirmado." : "Pedido pendente."}
        </h1>
        <p>
          Pedido: <b>{order || "—"}</b>.{" "}
          {state === "paid"
            ? "Acesso liberado automaticamente após confirmação server-side."
            : "Este console existe apenas quando não há credenciais reais da InfinitePay. Ele nunca confirma pagamento sozinho."}
        </p>
        {message && <p className="billing-sim-message">{message}</p>}
        {state === "paid" ? (
          <button
            className="button button-primary button-wide"
            onClick={() => (window.location.href = "/")}
          >
            <Check size={15} /> Ir para o sistema
          </button>
        ) : state === "error" ? (
          <button
            className="button button-outline button-wide"
            onClick={() => (window.location.href = "/")}
          >
            <X size={15} /> Voltar
          </button>
        ) : state === "simulated" ? (
          <button className="button button-primary button-wide" disabled>
            <LoaderCircle className="spin" size={15} /> Verificando no servidor…
          </button>
        ) : (
          <button
            className="button button-primary button-wide"
            onClick={() => void run()}
            disabled={simulate.isPending || !order}
          >
            <ExternalLink size={15} /> Simular aprovação do provedor
          </button>
        )}
      </div>
    </main>
  );
}

function tenantIdFromStorage(): number {
  return Number(localStorage.getItem("persweb-active-tenant") ?? 0);
}
