import { useMemo, useState } from "react";
import {
  Banknote,
  ChevronDown,
  Download,
  LoaderCircle,
  Lock,
  Play,
  ReceiptText,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

function brl(cents: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format((cents ?? 0) / 100);
}

function hoursFmt(minutes: number) {
  return (Math.round((minutes / 60) * 100) / 100).toFixed(2).replace(".", ",");
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

const TYPE_LABEL: Record<string, string> = {
  normal: "Mensal",
  complementar: "Complementar",
  "13_salario": "13º salário",
  ferias: "Férias",
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Rascunho",
  closed: "Fechada",
  canceled: "Cancelada",
};

type RunRow = {
  id: number;
  referenceMonth: string;
  type: string;
  status: string;
  grossCents: number;
  totalDeductionsCents: number;
  netCents: number;
  employerCostCents: number;
  itemTotal: number;
  closedAt: string | null;
  generatedAt: string;
};

type DetailItem = {
  item: {
    id: number;
    membershipId: number;
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
    additionsNote: string | null;
    grossCents: number;
    inssBaseCents: number;
    inssCents: number;
    irrfCents: number;
    totalDeductionsCents: number;
    netCents: number;
    employerInssCents: number;
    fgtsCents: number;
    employerCostCents: number;
    breakdown: Record<string, unknown> | null;
  };
  memberName: string;
  memberEmail: string;
};

export function PayrollView({
  tenantId,
  isAdmin,
}: {
  tenantId: number;
  isAdmin: boolean;
}) {
  const utils = trpc.useUtils();
  const summarize = trpc.payroll.summarize.useQuery({ tenantId });
  const generate = trpc.payroll.generate.useMutation();
  const closeRun = trpc.payroll.closeRun.useMutation();
  const cancelRun = trpc.payroll.cancelRun.useMutation();
  const adjust = trpc.payroll.adjustItem.useMutation();
  const [month, setMonth] = useState(currentMonth());
  const [type, setType] = useState<"normal" | "complementar" | "13_salario" | "ferias">("normal");
  const [openRunId, setOpenRunId] = useState<number | null>(null);

  const runs = useMemo(
    () => (summarize.data?.runs ?? []) as unknown as RunRow[],
    [summarize.data]
  );

  const refresh = async () => {
    await utils.payroll.summarize.invalidate();
    if (openRunId) await utils.payroll.runDetail.invalidate({ tenantId, runId: openRunId });
  };

  const doGenerate = async () => {
    try {
      const result = await generate.mutateAsync({
        tenantId,
        referenceMonth: month,
        type,
      });
      toast.success(
        `Folha ${result.month} gerada: ${result.items} pessoa(s)${result.skippedNoSalary ? ` · ${result.skippedNoSalary} sem salário cadastrado (excluídas)` : ""}.`
      );
      await refresh();
      setOpenRunId(result.runId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao gerar folha.");
    }
  };

  const closeOrCancel = async (runId: number, action: "close" | "cancel") => {
    try {
      if (action === "close") {
        await closeRun.mutateAsync({ tenantId, runId });
        toast.success("Folha fechada. Valores congelados como histórico.");
      } else {
        await cancelRun.mutateAsync({ tenantId, runId });
        toast.success("Rascunho cancelado.");
      }
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha na operação.");
    }
  };

  const exportCsv = async (run: RunRow) => {
    try {
      const detail = await utils.payroll.runDetail.fetch({ tenantId, runId: run.id });
      const runItems = (detail as { items: DetailItem[] }).items ?? [];
      const lines: string[] = [
        ["Pessoa", "Email", "Salário base", "Dias úteis", "Horas trabalhadas", "Horas extras", "Horas noturnas", "Faltas", "Horas extras R$", "Adicional noturno R$", "Acrescimos manuais R$", "Descontos manuais R$", "Falta R$", "Bruto R$", "Base INSS", "INSS", "IRRF", "Total descontos", "Netto R$", "INSS empresa", "FGTS", "Custo empresa"].join(";"),
      ];
      for (const row of runItems) {
        const t = row.item;
        lines.push(
          [
            row.memberName,
            row.memberEmail,
            t.baseSalaryCents / 100,
            t.workingDays,
            hoursFmt(t.workedMinutes),
            hoursFmt(t.overtimeMinutes),
            hoursFmt(t.nightMinutes),
            t.absenceDays,
            t.overtimeCents / 100,
            t.nightAdditionCents / 100,
            t.manualAdditionsCents / 100,
            t.manualDeductionsCents / 100,
            t.absenceDeductionCents / 100,
            t.grossCents / 100,
            t.inssBaseCents / 100,
            t.inssCents / 100,
            t.irrfCents / 100,
            t.totalDeductionsCents / 100,
            t.netCents / 100,
            t.employerInssCents / 100,
            t.fgtsCents / 100,
            t.employerCostCents / 100,
          ]
            .map(value =>
              String(value).replace(".", ",")
            )
            .join(";")
        );
      }
      const content =
        "Folha " + run.referenceMonth + " (" + (TYPE_LABEL[run.type] ?? run.type) + ", " + (STATUS_LABEL[run.status] ?? run.status) + ")\n" +
        lines.join("\n");
      const link = document.createElement("a");
      link.href = "data:text/csv;charset=utf-8," + encodeURIComponent(content);
      link.download = `folha-${run.referenceMonth}${run.type !== "normal" ? `-${run.type}` : ""}.csv`;
      link.click();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao exportar.");
    }
  };

  return (
    <div className="payroll-view">
      <div className="page-heading">
        <div>
          <div className="eyebrow">REMUNERAÇÃO</div>
          <h1>
            Folha de pagamento<span className="heading-period">.</span>
          </h1>
          <p>
            Geração mensal por jornada e horas registradas: horas extras, adicional
            noturno, faltas, INSS, IRRF, FGTS e custo total da empresa.
          </p>
        </div>
      </div>

      {summarize.data && summarize.data.missingSalaries > 0 && (
        <div className="panel payroll-warning">
          <ReceiptText size={16} />
          {summarize.data.missingSalaries} pessoa(s) ativa(s) sem salário
          cadastrado — elas ficam fora da folha. Configure em Configurações →
          Jornada de trabalho.
        </div>
      )}

      <div className="panel">
        <div className="panel-head">
          <div>
            <div className="eyebrow">GERAR</div>
            <h2>Nova folha</h2>
          </div>
        </div>
        <div className="payroll-generate">
          <label>
            Mês de referência
            <input
              type="month"
              value={month}
              max={currentMonth()}
              onChange={e => setMonth(e.target.value)}
            />
          </label>
          <label>
            Tipo
            <select
              value={type}
              onChange={e =>
                setType(e.target.value as typeof type)
              }
            >
              <option value="normal">Mensal</option>
              <option value="complementar">Complementar</option>
              <option value="13_salario">13º salário</option>
              <option value="ferias">Férias</option>
            </select>
          </label>
          {isAdmin ? (
            <button
              className="button button-primary"
              onClick={() => void doGenerate()}
              disabled={generate.isPending || !month}
            >
              {generate.isPending ? (
                <LoaderCircle className="spin" size={15} />
              ) : (
                <Play size={15} />
              )}
              Gerar rascunho
            </button>
          ) : (
            <span className="payroll-readonly">
              <Lock size={13} /> Somente administradores geram ou fecham folhas.
            </span>
          )}
        </div>
      </div>

      <div className="panel table-panel">
        <div className="panel-head">
          <div>
            <div className="eyebrow">HISTÓRICO</div>
            <h2>Folhas da empresa</h2>
          </div>
          <span className="count-pill">{runs.length}</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Mês</th>
                <th>Tipo</th>
                <th>Pessoas</th>
                <th>Bruto</th>
                <th>Descontos</th>
                <th>Neto</th>
                <th>Custo empresa</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {runs.map(run => (
                <RunAccordion
                  key={run.id}
                  run={run}
                  tenantId={tenantId}
                  isAdmin={isAdmin}
                  open={openRunId === run.id}
                  onToggle={() =>
                    setOpenRunId(openRunId === run.id ? null : run.id)
                  }
                  onClose={closeOrCancel}
                  onExport={exportCsv}
                  adjust={async (items, manualAdd, manualDed, note) => {
                    try {
                      await adjust.mutateAsync({
                        tenantId,
                        itemId: items,
                        manualAdditionsCents: manualAdd,
                        manualDeductionsCents: manualDed,
                        additionsNote: note || undefined,
                      });
                      await refresh();
                      toast.success("Item ajustado.");
                    } catch (error) {
                      toast.error(
                        error instanceof Error ? error.message : "Falha ao ajustar."
                      );
                    }
                  }}
                />
              ))}
              {!runs.length && (
                <tr>
                  <td colSpan={9}>
                    Nenhuma folha gerada ainda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <small className="panel-hint">
        Cálculos seguem o CLT simplificado: horas extras a 50%, adicionais
        noturnos 20% (22h–5h no fuso da empresa), faltas em dias úteis
        descontados na base, INSS progressivo do empregado, IRRF mensal
        progressivo sobre base após INSS, FGTS 8% e INSS patronal 20%. Tabelas
        vigentes do ano em uso: 2025/2026.
      </small>
    </div>
  );
}

function RunAccordion({
  run,
  tenantId,
  isAdmin,
  open,
  onToggle,
  onClose,
  onExport,
  adjust,
}: {
  run: RunRow;
  tenantId: number;
  isAdmin: boolean;
  open: boolean;
  onToggle: () => void;
  onClose: (runId: number, action: "close" | "cancel") => void;
  onExport: (run: RunRow) => void;
  adjust: (
    itemId: number,
    manualAdd: number,
    manualDed: number,
    note: string
  ) => Promise<void>;
}) {
  const detail = trpc.payroll.runDetail.useQuery(
    { tenantId, runId: run.id },
    { enabled: open }
  );
  return (
    <>
      <tr className={`payroll-run-row ${run.status}`}>
        <td>
          <b>{run.referenceMonth}</b>
        </td>
        <td>{TYPE_LABEL[run.type] ?? run.type}</td>
        <td>{run.itemTotal}</td>
        <td>{brl(run.grossCents)}</td>
        <td>{brl(run.totalDeductionsCents)}</td>
        <td>
          <b>{brl(run.netCents)}</b>
        </td>
        <td>{brl(run.employerCostCents)}</td>
        <td>
          <span
            className={`status-chip ${run.status === "closed" ? "status-approved" : run.status === "draft" ? "status-submitted" : "status-rejected"}`}
          >
            {STATUS_LABEL[run.status] ?? run.status}
          </span>
        </td>
        <td onClick={e => e.stopPropagation()}>
          {run.status === "draft" && isAdmin && (
            <>
              <button
                className="text-link"
                onClick={() => void onClose(run.id, "close")}
              >
                Fechar
              </button>
              <button
                className="text-link text-danger"
                onClick={() => void onClose(run.id, "cancel")}
              >
                Cancelar
              </button>
            </>
          )}
          <button className="text-link" onClick={() => onExport(run)}>
            <Download size={13} /> CSV
          </button>
          <button className="text-link" onClick={onToggle}>
            {open ? (
              <X size={14} />
            ) : (
              <ChevronDown size={14} />
            )}
          </button>
        </td>
      </tr>
      {open && (
        <tr className="payroll-detail-row">
          <td colSpan={9}>
            {detail.isLoading ? (
              <LoaderCircle className="spin" size={15} />
            ) : (
              <div className="payroll-items">
                {(detail.data?.items ?? []).map(row => (
                  <PayrollItemRowInline
                    key={row.item.id}
                    row={row}
                    editable={isAdmin && run.status === "draft"}
                    adjust={adjust}
                  />
                ))}
                {!detail.data?.items.length && (
                  <div className="empty-inline">Sem itens nesta folha.</div>
                )}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function PayrollItemRowInline({
  row,
  editable,
  adjust,
}: {
  row: DetailItem;
  editable: boolean;
  adjust: (
    itemId: number,
    manualAdd: number,
    manualDed: number,
    note: string
  ) => Promise<void>;
}) {
  const t = row.item;
  const [additions, setAdditions] = useState(
    t.manualAdditionsCents ? (t.manualAdditionsCents / 100).toFixed(2) : ""
  );
  const [deductions, setDeductions] = useState(
    t.manualDeductionsCents ? (t.manualDeductionsCents / 100).toFixed(2) : ""
  );
  const [note, setNote] = useState(t.additionsNote ?? "");
  const toCents = (value: string) =>
    value.trim() === ""
      ? 0
      : Math.round(
          Number(value.replace(/\./g, "").replace(",", ".") || 0) * 100
        );

  return (
    <details className="payroll-item">
      <summary>
        <span>
          <b>{row.memberName}</b>
          <small> {row.memberEmail}</small>
        </span>
        <span>
          <b>{brl(t.netCents)}</b> neto ·{" "}
          {brl(t.grossCents)} bruto
        </span>
      </summary>
      <div className="payroll-item-grid">
        <div>
          <small>Salário</small>
          <b>{brl(t.baseSalaryCents)}</b>
        </div>
        <div>
          <small>Dias úteis</small>
          <b>{t.workingDays}</b>
        </div>
        <div>
          <small>Jornada esperada</small>
          <b>{hoursFmt(t.expectedMinutes)}h</b>
        </div>
        <div>
          <small>Trabalhadas</small>
          <b>{hoursFmt(t.workedMinutes)}h</b>
        </div>
        <div>
          <small>Extras</small>
          <b>
            {hoursFmt(t.overtimeMinutes)}h · {brl(t.overtimeCents)}
          </b>
        </div>
        <div>
          <small>Noturnas</small>
          <b>
            {hoursFmt(t.nightMinutes)}h · {brl(t.nightAdditionCents)}
          </b>
        </div>
        <div>
          <small>Faltas</small>
          <b>
            {t.absenceDays} dia(s) · −{brl(t.absenceDeductionCents)}
          </b>
        </div>
        <div>
          <small>Bruto</small>
          <b>{brl(t.grossCents)}</b>
        </div>
        <div>
          <small>Base INSS</small>
          <b>{brl(t.inssBaseCents)}</b>
        </div>
        <div>
          <small>INSS</small>
          <b>−{brl(t.inssCents)}</b>
        </div>
        <div>
          <small>IRRF</small>
          <b>−{brl(t.irrfCents)}</b>
        </div>
        <div>
          <small>Neto</small>
          <b>{brl(t.netCents)}</b>
        </div>
        <div>
          <small>INSS empresa</small>
          <b>{brl(t.employerInssCents)}</b>
        </div>
        <div>
          <small>FGTS</small>
          <b>{brl(t.fgtsCents)}</b>
        </div>
        <div>
          <small>Custo empresa</small>
          <b>{brl(t.employerCostCents)}</b>
        </div>
      </div>
      {editable && (
        <div className="payroll-adjust">
          <label>
            Acúscimos (R$)
            <input
              inputMode="decimal"
              value={additions}
              onChange={e => setAdditions(e.target.value)}
              placeholder="0,00"
            />
          </label>
          <label>
            Descontos manuais (R$)
            <input
              inputMode="decimal"
              value={deductions}
              onChange={e => setDeductions(e.target.value)}
              placeholder="0,00"
            />
          </label>
          <label>
            Observação
            <input
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Ex.: ajuda de custo, desconto de uniforme"
            />
          </label>
          <button
            className="button button-outline"
            onClick={() =>
              void adjust(t.id, toCents(additions), toCents(deductions), note)
            }
          >
            <Banknote size={14} /> Aplicar ajustes
          </button>
        </div>
      )}
      {!editable && t.additionsNote && (
        <small className="panel-hint">
          Ajuste manual: {t.additionsNote} (+{brl(t.manualAdditionsCents)} / −
          {brl(t.manualDeductionsCents)})
        </small>
      )}
    </details>
  );
}
