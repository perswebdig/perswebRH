import { useState } from "react";
import {
  CalendarClock,
  Pencil,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

const DAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
type Block = { start: string; end: string };

const mapping = (b: { start: string; end: string }): Block => ({
  start: b.start,
  end: b.end,
});

function blocksToText(blocks: Block[]) {
  return blocks.map(b => `${b.start}–${b.end}`).join(" + ");
}

function daysToText(days: number[]) {
  return days
    .slice()
    .sort()
    .map(day => DAY_LABELS[day])
    .join(", ");
}

export function JornadasPanel({ tenantId }: { tenantId: number }) {
  const utils = trpc.useUtils();
  const schedules = trpc.payroll.listSchedules.useQuery({ tenantId });
  const salaries = trpc.payroll.listSalaries.useQuery({ tenantId });
  const save = trpc.payroll.saveSchedule.useMutation();
  const toggle = trpc.payroll.toggleSchedule.useMutation();
  const remove = trpc.payroll.deleteSchedule.useMutation();
  const assign = trpc.payroll.assignSchedule.useMutation();
  const setSalary = trpc.payroll.setSalary.useMutation();
  const [form, setForm] = useState<{
    scheduleId?: number;
    name: string;
    days: number[];
    blocks: Block[];
  } | null>(null);
  const [salaryDraft, setSalaryDraft] = useState<Record<number, string>>({});

  const refresh = async () => {
    await utils.payroll.listSchedules.invalidate();
    await utils.payroll.listSalaries.invalidate();
  };

  const newSchedule = () =>
    setForm({
      name: "",
      days: [1, 2, 3, 4, 5],
      blocks: [{ start: "09:00", end: "18:00" }],
    });

  const startEdit = (row: {
    id?: number;
    scheduleId?: number;
    name: string;
    daysOfWeek: number[];
    blocks: { start: string; end: string }[];
    active?: number;
  }) =>
    setForm({
      scheduleId: row.scheduleId ?? row.id,
      name: row.name,
      days: [...row.daysOfWeek],
      blocks: row.blocks.map(mapping),
    });

  const submit = async () => {
    if (!form) return;
    try {
      await save.mutateAsync({
        tenantId,
        name: form.name,
        daysOfWeek: form.days,
        blocks: form.blocks,
        ...(form.scheduleId ? { scheduleId: form.scheduleId } : {}),
      });
      toast.success(form.scheduleId ? "Jornada atualizada." : "Jornada criada.");
      setForm(null);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao salvar jornada.");
    }
  };

  const toggleDay = (day: number) => {
    if (!form) return;
    setForm({
      ...form,
      days: form.days.includes(day)
        ? form.days.filter(d => d !== day)
        : [...form.days, day].sort(),
    });
  };

  return (
    <section className="panel settings-panel" id="schedules">
      <div className="settings-panel-head">
        <span className="settings-icon indigo">
          <CalendarClock size={18} />
        </span>
        <div>
          <h2>Jornada de trabalho</h2>
          <p>
            Vários horários por empresa e por pessoa: turnos, escravos
            personalizados e salários mensais usados pela folha.
          </p>
        </div>
        <button className="button button-outline" onClick={newSchedule}>
          <Plus size={15} /> Nova jornada
        </button>
      </div>

      {form && (
        <div className="settings-form schedule-editor">
          <div className="form-three">
            <label>
              Nome da jornada
              <input
                value={form.name}
                placeholder="Ex.: Escala 8x, Turno noturno"
                onChange={e => setForm({ ...form, name: e.target.value })}
              />
            </label>
          </div>
          <div className="schedule-days">
            <small>Dias da semana</small>
            <div className="day-toggle-row">
              {DAY_LABELS.map((label, day) => (
                <button
                  type="button"
                  key={day}
                  className={`day-toggle ${form.days.includes(day) ? "on" : ""}`}
                  onClick={() => toggleDay(day)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="schedule-blocks">
            <small>Blocos de horas do dia</small>
            {form.blocks.map((block, index) => (
              <div className="schedule-block-row" key={index}>
                <input
                  type="time"
                  value={block.start}
                  onChange={e => {
                    const blocks = [...form.blocks];
                    blocks[index] = { ...blocks[index], start: e.target.value };
                    setForm({ ...form, blocks });
                  }}
                />
                <span>—</span>
                <input
                  type="time"
                  value={block.end}
                  onChange={e => {
                    const blocks = [...form.blocks];
                    blocks[index] = { ...blocks[index], end: e.target.value };
                    setForm({ ...form, blocks });
                  }}
                  disabled={block.end < block.start}
                />
                {form.blocks.length > 1 && (
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() =>
                      setForm({
                        ...form,
                        blocks: form.blocks.filter((_, i) => i !== index),
                      })
                    }
                    title="Remover bloco"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              className="button button-outline"
              onClick={() =>
                setForm({
                  ...form,
                  blocks: [...form.blocks, { start: "13:00", end: "17:00" }],
                })
              }
            >
              <Plus size={13} /> Adicionar bloco
            </button>
            <small>
              Blocos como 08:00–12:00 e 13:00–17:00 — folga entre eles conta
              como intervalo. Um bloco indo até depois da meia-noite é permitido
              (turno noturno).
            </small>
          </div>
          <div className="schedule-editor-actions">
            <button
              className="button button-primary"
              onClick={() => void submit()}
              disabled={save.isPending}
            >
              <Save size={15} /> Salvar jornada
            </button>
            <button
              className="button button-outline"
              onClick={() => setForm(null)}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      <div className="table-scroll schedule-table">
        <table>
          <thead>
            <tr>
              <th>Jornada</th>
              <th>Dias</th>
              <th>Horários</th>
              <th>Status</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {(schedules.data ?? []).map(row => (
              <tr key={row.id} className={row.active ? "" : "muted-row"}>
                <td>
                  <b>{row.name}</b>
                </td>
                <td>{daysToText(row.daysOfWeek as number[])}</td>
                <td>{blocksToText(row.blocks as Block[])}</td>
                <td>
                  <span
                    className={`status-chip ${row.active ? "status-approved" : "status-draft"}`}
                  >
                    {row.active ? "Ativa" : "Inativa"}
                  </span>
                </td>
                <td>
                  <button
                    className="text-link"
                    onClick={() =>
                      startEdit({
                        id: row.id,
                        name: row.name,
                        daysOfWeek: row.daysOfWeek as number[],
                        blocks: row.blocks as Block[],
                        active: row.active as number,
                      })
                    }
                  >
                    <Pencil size={13} /> Editar
                  </button>
                  <button
                    className="text-link"
                    onClick={() =>
                      void toggle
                        .mutateAsync({
                          tenantId,
                          scheduleId: row.id,
                          active: !row.active,
                        })
                        .then(refresh)
                        .catch(error =>
                          toast.error(error instanceof Error ? error.message : "Falha")
                        )
                    }
                  >
                    {row.active ? "Desativar" : "Ativar"}
                  </button>
                  <button
                    className="text-link text-danger"
                    onClick={() =>
                      void remove
                        .mutateAsync({ tenantId, scheduleId: row.id })
                        .then(refresh)
                        .catch(error =>
                          toast.error(error instanceof Error ? error.message : "Falha")
                        )
                    }
                  >
                    <Trash2 size={13} /> Excluir
                  </button>
                </td>
              </tr>
            ))}
            {!schedules.data?.length && (
              <tr>
                <td colSpan={5}>
                  Nenhuma jornada criada — todas as pessoas seguem o padrão
                  geral do RH (jornada 9h, limite de horas diárias das
                  configurações).
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div>
        <small className="panel-hint">
          Jornada por pessoa e salário mensal (para a folha). Deixe sem jornada
          para herdar o padrão; salário vazio é excluído da folha.
        </small>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Pessoa</th>
              <th>Perfil</th>
              <th>Jornada</th>
              <th>Salário mensal</th>
            </tr>
          </thead>
          <tbody>
            {(salaries.data ?? []).map(member => (
              <tr key={member.membershipId} className={member.active ? "" : "muted-row"}>
                <td>
                  <b>{member.name}</b>
                  <small> {member.email}</small>
                </td>
                <td>
                  {member.active
                    ? ""
                    : "Desativado"}
                </td>
                <td>
                  <select
                    value={member.scheduleId ?? ""}
                    onChange={e =>
                      void assign
                        .mutateAsync({
                          tenantId,
                          membershipId: member.membershipId,
                          scheduleId: e.target.value ? Number(e.target.value) : null,
                        })
                        .then(refresh)
                        .catch(error =>
                          toast.error(error instanceof Error ? error.message : "Falha")
                        )
                    }
                  >
                    <option value="">Padrão do RH</option>
                    {(schedules.data ?? []).map(row => (
                      <option key={row.id} value={row.id}>
                        {row.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <div className="salary-cell">
                    <span>R$</span>
                    <input
                      inputMode="decimal"
                      placeholder="—"
                      defaultValue={
                        member.salaryCents
                          ? (member.salaryCents / 100).toFixed(2)
                          : ""
                      }
                      onChange={e =>
                        setSalaryDraft({
                          ...salaryDraft,
                          [member.membershipId]: e.target.value,
                        })
                      }
                    />
                    <button
                      className="text-link"
                      onClick={() =>
                        void setSalary
                          .mutateAsync({
                            tenantId,
                            membershipId: member.membershipId,
                            salaryCents:
                              (salaryDraft[member.membershipId] ?? "") === ""
                                ? null
                                : Math.round(
                                    Number(
                                      (salaryDraft[member.membershipId] ?? "0")
                                        .replace(/\./g, "")
                                        .replace(",", ".")
                                    ) * 100
                                  ),
                          })
                          .then(refresh)
                          .then(() => toast.success("Salário salvo."))
                          .catch(error =>
                            toast.error(error instanceof Error ? error.message : "Falha")
                          )
                      }
                    >
                      Salvar
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!salaries.data?.length && (
              <tr>
                <td colSpan={4}>Sem pessoas cadastradas.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
