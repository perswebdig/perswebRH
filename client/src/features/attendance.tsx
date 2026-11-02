import { useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  Check,
  ClipboardList,
  Clock3,
  Fingerprint,
  History,
  LocateFixed,
  LogIn,
  LogOut,
  Pause,
  Play,
  MapPin,
  Plus,
  Send,
  TimerReset,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

type Role =
  | "tenant_admin"
  | "manager"
  | "employee"
  | "finance"
  | "administrative";
type PunchEventType = "ENTRY" | "EXIT" | "BREAK_START" | "BREAK_END";
const today = () => new Date().toLocaleDateString("en-CA");
const monday = (value: string) => {
  const d = new Date(`${value}T12:00:00`);
  const weekday = d.getDay();
  d.setDate(d.getDate() + (weekday === 0 ? -6 : 1 - weekday));
  return d.toLocaleDateString("en-CA");
};
const monthBounds = (value: string) => {
  const [year, month] = value.split("-").map(Number);
  return {
    start: `${year}-${String(month).padStart(2, "0")}-01`,
    end: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10),
  };
};
const localDateTime = (date: string, time: string, timezone: string) => {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
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
  return new Date(instant).toISOString();
};
const clockLabel = (value: string | Date, timezone: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
const duration = (start: string | Date, end: string | Date) => {
  const min = Math.max(
    0,
    (new Date(end).getTime() - new Date(start).getTime()) / 60000
  );
  return `${Math.floor(min / 60)}h ${String(Math.round(min % 60)).padStart(2, "0")}m`;
};
const minutesLabel = (minutes: number) =>
  `${Math.floor(minutes / 60)}h ${String(Math.round(minutes % 60)).padStart(2, "0")}m`;
const dayLabel = (date: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  }).format(new Date(`${date}T12:00:00`));
const eventTypeLabel: Record<PunchEventType, string> = {
  ENTRY: "Entrada",
  EXIT: "Saída",
  BREAK_START: "Início do intervalo",
  BREAK_END: "Fim do intervalo",
};
const stateLabel: Record<string, string> = {
  off: "Fora de jornada",
  working: "Em trabalho",
  on_break: "Em intervalo",
};

function PunchCard({
  tenantId,
  timezone,
  onChanged,
}: {
  tenantId: number;
  timezone: string;
  onChanged: () => void;
}) {
  const state = trpc.punch.punchState.useQuery({ tenantId });
  const punch = trpc.punch.punch.useMutation();
  const tokenRef = useRef<string>("");
  const busy = punch.isPending;
  const doPunch = async (eventType: PunchEventType) => {
    if (busy) return;
    if (!tokenRef.current)
      tokenRef.current =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `tok-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      const result = await punch.mutateAsync({
        tenantId,
        eventType,
        clientToken: tokenRef.current,
      });
      toast.success(
        `${eventTypeLabel[eventType]} registrada às ${clockLabel(result.occurredAt, timezone)} (horário oficial do servidor).`
      );
      tokenRef.current = "";
      onChanged();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Não foi possível bater o ponto."
      );
    }
  };
  if (state.isLoading)
    return (
      <div className="panel punch-card">
        <div className="empty-inline">Consultando seu ponto…</div>
      </div>
    );
  if (state.isError)
    return (
      <div className="panel punch-card">
        <div className="empty-inline">
          Não foi possível carregar o estado do ponto.
        </div>
      </div>
    );
  const data = state.data;
  const openClock = data?.openEvent
    ? clockLabel(data.openEvent.occurredAt, timezone)
    : null;
  const actionButtons: {
    type: PunchEventType;
    label: string;
    icon: typeof LogIn;
    primary: boolean;
  }[] = [
    { type: "ENTRY", label: "Bater ponto — Entrada", icon: LogIn, primary: true },
    { type: "EXIT", label: "Bater ponto — Saída", icon: LogOut, primary: true },
    { type: "BREAK_START", label: "Iniciar intervalo", icon: Pause, primary: false },
    { type: "BREAK_END", label: "Voltar do intervalo", icon: Play, primary: false },
  ];
  return (
    <div className="panel punch-card">
      <div className="punch-head">
        <div>
          <div className="eyebrow">PONTO EM TEMPO REAL</div>
          <h2>
            {data?.state === "off"
              ? "Você ainda não iniciou a jornada."
              : data?.state === "working"
                ? `Em trabalho desde ${openClock}.`
                : `Em intervalo desde ${openClock}.`}
          </h2>
          <p>
            {data?.state === "working" || data?.state === "on_break"
              ? `Período aberto ontem/hoje — não esqueça de registrar a saída.`
              : "Toque em Bater ponto no momento em que o evento acontecer. O horário oficial é gerado pelo servidor."}
          </p>
        </div>
        <span className={`punch-state punch-state-${data?.state}`}>
          {stateLabel[data?.state ?? "off"]}
        </span>
      </div>
      {data && data.workedMinutes + data.provisionalMinutes > 0 && (
        <div className="punch-totals">
          <span>
            <b>{minutesLabel(data.workedMinutes)}</b> trabalhados hoje
          </span>
          <span>
            <b>{minutesLabel(data.breakMinutes)}</b> em intervalos
          </span>
          {data.provisionalMinutes > 0 && (
            <span className="punch-open-hint">
              <Clock3 size={13} /> +{minutesLabel(data.provisionalMinutes)} em
              andamento (provisório)
            </span>
          )}
        </div>
      )}
      <div className="punch-actions">
        {actionButtons
          .filter(button => data?.actions.includes(button.type))
          .map(button => (
            <button
              key={button.type}
              className={`button ${button.primary ? "button-primary" : "button-outline"} punch-button`}
              disabled={busy}
              onClick={() => void doPunch(button.type)}
            >
              <Fingerprint size={17} />
              {busy ? "Registrando…" : button.label}
            </button>
          ))}
      </div>
      {data?.todayEvents.length ? (
        <div className="punch-timeline">
          <div className="panel-head">
            <div>
              <div className="eyebrow">HOJE</div>
              <h3>Marcações do dia</h3>
            </div>
            <span className="count-pill">{data.todayEvents.length}</span>
          </div>
          <div className="punch-events">
            {data.todayEvents.map(event => (
              <div className={`punch-event punch-event-${event.eventType.toLowerCase()}`} key={event.id}>
                <b>{event.clock}</b>
                <span>{eventTypeLabel[event.eventType as PunchEventType]}</span>
                <small>
                  {event.source === "retroactive_approval"
                    ? "aprovado pelo gestor"
                    : "tempo real"}
                </small>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PunchRequests({
  tenantId,
  role,
  timezone,
}: {
  tenantId: number;
  role: Role;
  timezone: string;
}) {
  const mine = trpc.punch.listPunchRequests.useQuery({
    tenantId,
    scope: "mine",
  });
  const approver = role === "tenant_admin" || role === "manager";
  const queue = trpc.punch.listPunchRequests.useQuery(
    { tenantId, scope: "approval" },
    { enabled: approver }
  );
  const create = trpc.punch.createPunchRequest.useMutation();
  const decide = trpc.punch.decidePunchRequest.useMutation();
  const cancel = trpc.punch.cancelPunchRequest.useMutation();
  const [open, setOpen] = useState(false);
  const [reqDate, setReqDate] = useState(today());
  const [reqReason, setReqReason] = useState("");
  const [reqEvents, setReqEvents] = useState<
    { eventType: PunchEventType; time: string }[]
  >([
    { eventType: "ENTRY", time: "09:00" },
    { eventType: "EXIT", time: "17:00" },
  ]);
  const [rejectId, setRejectId] = useState<number | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const yesterday = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toLocaleDateString("en-CA");
  }, []);
  const submitRequest = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!reqReason.trim())
      return toast.error("Descreva obrigatoriamente o motivo do ajuste.");
    try {
      await create.mutateAsync({
        tenantId,
        workDate: reqDate,
        events: reqEvents,
        reason: reqReason.trim(),
      });
      toast.success("Solicitação enviada. Aguarde a análise do gestor.");
      setReqReason("");
      setOpen(false);
      await mine.refetch();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Não foi possível enviar."
      );
    }
  };
  const decideRequest = async (
    requestId: number,
    decision: "approved" | "rejected"
  ) => {
    try {
      await decide.mutateAsync({
        tenantId,
        requestId,
        decision,
        note: decision === "rejected" ? rejectNote : undefined,
      });
      toast.success(
        decision === "approved"
          ? "Aprovada — marcações oficiais criadas."
          : "Solicitação rejeitada."
      );
      setRejectId(null);
      setRejectNote("");
      await queue.refetch();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Falha na decisão."
      );
    }
  };
  const statusChip: Record<string, string> = {
    pending: "Em análise",
    approved: "Aprovada",
    rejected: "Rejeitada",
    cancelled: "Cancelada",
  };
  return (
    <div className="panel punch-requests-panel">
      <div className="panel-head">
        <div>
          <div className="eyebrow">AJUSTES E RETROATIVOS</div>
          <h2>Solicitações de marcação</h2>
        </div>
        <button
          className="button button-outline"
          onClick={() => setOpen(!open)}
        >
          {open ? <X size={15} /> : <Plus size={15} />}
          {open ? "Fechar" : "Solicitar ajuste"}
        </button>
      </div>
      {open && (
        <form className="form-stack punch-request-form" onSubmit={submitRequest}>
          <label>
            Dia anterior ao qual se refere
            <input
              type="date"
              required
              max={yesterday}
              min="2000-01-01"
              value={reqDate}
              onChange={e => setReqDate(e.target.value)}
            />
            <small>
              Dias anteriores exigem aprovação. O dia de hoje usa o botão de
              bater ponto.
            </small>
          </label>
          <div className="punch-req-events">
            {reqEvents.map((event, index) => (
              <div className="form-two punch-req-event" key={index}>
                <label>
                  Marcação
                  <select
                    value={event.eventType}
                    onChange={e =>
                      setReqEvents(
                        reqEvents.map((item, i) =>
                          i === index
                            ? {
                                ...item,
                                eventType: e.target.value as PunchEventType,
                              }
                            : item
                        )
                      )
                    }
                  >
                    {(Object.keys(eventTypeLabel) as PunchEventType[]).map(
                      type => (
                        <option key={type} value={type}>
                          {eventTypeLabel[type]}
                        </option>
                      )
                    )}
                  </select>
                </label>
                <label>
                  Hora
                  <input
                    type="time"
                    required
                    value={event.time}
                    onChange={e =>
                      setReqEvents(
                        reqEvents.map((item, i) =>
                          i === index ? { ...item, time: e.target.value } : item
                        )
                      )
                    }
                  />
                </label>
                {reqEvents.length > 1 && (
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Remover marcação"
                    onClick={() =>
                      setReqEvents(reqEvents.filter((_, i) => i !== index))
                    }
                  >
                    <X size={15} />
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              className="button button-outline"
              onClick={() =>
                setReqEvents([
                  ...reqEvents,
                  { eventType: "ENTRY", time: "12:00" },
                ])
              }
            >
              <Plus size={14} /> Adicionar marcação
            </button>
          </div>
          <label>
            Motivo (obrigatório)
            <textarea
              required
              rows={2}
              maxLength={2000}
              value={reqReason}
              onChange={e => setReqReason(e.target.value)}
              placeholder="Explique por que este registro ficou faltando ou errado…"
            />
          </label>
          <button
            className="button button-primary button-wide"
            disabled={create.isPending}
          >
            <Send size={15} />
            {create.isPending ? "Enviando…" : "Enviar para aprovação"}
          </button>
        </form>
      )}
      <div className="punch-request-list">
        {(mine.data ?? []).map(request => (
          <article className="punch-request" key={request.id}>
            <div className="punch-request-main">
              <b>
                {dayLabel(request.workDate)}{" "}
                <small>({request.workDate})</small>
              </b>
              <small>
                {request.events
                  .map(
                    event =>
                      `${eventTypeLabel[event.eventType as PunchEventType]} ${event.time}`
                  )
                  .join(" · ")}
              </small>
              <small className="punch-request-reason">
                Motivo: {request.reason}
              </small>
              {request.reviewNote && (
                <small className="punch-request-reason">
                  Análise: {request.reviewNote}
                </small>
              )}
            </div>
            <span
              className={`status-chip status-${request.status === "approved" ? "approved" : request.status === "pending" ? "submitted" : "rejected"}`}
            >
              {statusChip[request.status] ?? request.status}
            </span>
            {request.status === "pending" && (
              <button
                className="button button-outline"
                disabled={cancel.isPending}
                onClick={() =>
                  void cancel
                    .mutateAsync({ tenantId, requestId: request.id })
                    .then(() => mine.refetch())
                    .catch(error =>
                      toast.error(
                        error instanceof Error ? error.message : "Falha."
                      )
                    )
                }
              >
                Cancelar
              </button>
            )}
          </article>
        ))}
        {!mine.isLoading && !mine.data?.length && (
          <div className="empty-inline">
            Nenhuma solicitação sua. Ponto retroativo só por aqui.
          </div>
        )}
      </div>
      {approver && (
        <div className="punch-approval-queue">
          <div className="panel-head">
            <div>
              <div className="eyebrow">ANÁLISE DO GESTOR</div>
              <h3>Solicitações pendentes</h3>
            </div>
            <span className="count-pill">{queue.data?.length ?? 0}</span>
          </div>
          {(queue.data ?? []).map(request => (
            <article className="punch-request" key={request.id}>
              <div className="punch-request-main">
                <b>{request.requesterName}</b>
                <small>
                  {dayLabel(request.workDate)} ·{" "}
                  {request.events
                    .map(
                      event =>
                        `${eventTypeLabel[event.eventType as PunchEventType]} ${event.time}`
                    )
                    .join(" · ")}
                </small>
                <small className="punch-request-reason">
                  Motivo: {request.reason}
                </small>
              </div>
              {rejectId === request.id ? (
                <div className="reject-reason punch-reject">
                  <label>
                    Motivo da rejeição
                    <textarea
                      rows={2}
                      value={rejectNote}
                      onChange={e => setRejectNote(e.target.value)}
                      placeholder="Explique o motivo para o colaborador…"
                    />
                  </label>
                  <button
                    className="button button-primary"
                    disabled={decide.isPending}
                    onClick={() => void decideRequest(request.id, "rejected")}
                  >
                    Confirmar rejeição
                  </button>
                </div>
              ) : (
                <div className="punch-request-actions">
                  <button
                    className="button button-outline"
                    onClick={() => {
                      setRejectId(request.id);
                      setRejectNote("");
                    }}
                  >
                    Rejeitar
                  </button>
                  <button
                    className="button button-primary"
                    disabled={decide.isPending}
                    onClick={() => void decideRequest(request.id, "approved")}
                  >
                    <Check size={15} /> Aprovar
                  </button>
                </div>
              )}
            </article>
          ))}
          {queue.data && !queue.data.length && (
            <div className="empty-inline">
              Nenhuma solicitação aguarda sua análise.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function Attendance({
  tenantId,
  role,
}: {
  tenantId: number;
  role: Role;
  currency: string;
}) {
  const [date, setDate] = useState(today());
  const [periodView, setPeriodView] = useState<"week" | "month">("week");
  const [activity, setActivity] = useState("");
  const [markType, setMarkType] = useState("Entrada");
  const [project, setProject] = useState("");
  const [costCenter, setCostCenter] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");
  const [locationMode, setLocationMode] = useState<
    "preset" | "geolocation" | "manual"
  >("preset");
  const [locationName, setLocationName] = useState("Home Office");
  const [coords, setCoords] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [custom, setCustom] = useState<Record<string, string>>({});
  const start = monday(date);
  const settings = trpc.tenants.settings.useQuery({ tenantId });
  const week = trpc.attendance.myWeek.useQuery({ tenantId, date: start });
  const month = trpc.attendance.myMonth.useQuery(
    { tenantId, date },
    { enabled: periodView === "month" }
  );
  const addEntry = trpc.attendance.addEntry.useMutation();
  const submitWeek = trpc.attendance.submitWeek.useMutation();
  const entries =
    periodView === "month"
      ? (month.data?.entries ?? [])
      : (week.data?.entries ?? []);
  const activeWorkSettings =
    periodView === "month" ? month.data?.workSettings : week.data?.workSettings;
  const entryHours = (entry: (typeof entries)[number]) =>
    entry.countsAsWork
      ? (new Date(entry.endedAt).getTime() -
          new Date(entry.startedAt).getTime()) /
        3600000
      : 0;
  const totalHours = entries.reduce((sum, entry) => sum + entryHours(entry), 0);
  const byDay = useMemo(() => {
    const map = new Map<string, typeof entries>();
    entries.forEach(entry =>
      map.set(entry.workDate, [...(map.get(entry.workDate) ?? []), entry])
    );
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [entries]);
  const locs = settings.data?.workSettings?.locations ?? ["Home Office"];
  const markTypes = settings.data?.workSettings?.markTypes ?? [
    "Entrada",
    "Saída",
    "Intervalo",
  ];
  const activeMarkType = markTypes.includes(markType)
    ? markType
    : (markTypes[0] ?? "Entrada");
  const fields = settings.data?.workSettings?.customFields ?? [
    "Projeto",
    "Centro de Custo",
  ];
  const timezone = settings.data?.tenant?.timezone ?? "America/Sao_Paulo";
  const canCorrect = role === "tenant_admin" || role === "manager";

  const capture = () => {
    setCoords(null);
    if (!navigator.geolocation) {
      toast.error("Este navegador não oferece geolocalização.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      position => {
        setCoords({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
        setLocationMode("geolocation");
        setLocationName("Localização GPS");
        toast.success("Localização capturada.");
      },
      () =>
        toast.error(
          "Não foi possível obter a localização. Verifique a permissão do navegador."
        ),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };
  const submitEntry = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!activity.trim()) return toast.error("Descreva a atividade realizada.");
    if (locationMode === "geolocation" && !coords)
      return toast.error("Capture sua localização antes de salvar.");
    const customFields: Record<string, string> = {};
    fields.forEach(field => {
      const val = custom[field]?.trim();
      if (val) customFields[field] = val;
    });
    try {
      await addEntry.mutateAsync({
        tenantId,
        workDate: date,
        startedAt: localDateTime(date, startTime, timezone),
        endedAt: localDateTime(date, endTime, timezone),
        activity: activity.trim(),
        markType: activeMarkType,
        project: project.trim() || null,
        costCenter: costCenter.trim() || null,
        locationMode,
        locationName,
        latitude:
          locationMode === "geolocation" ? (coords?.latitude ?? null) : null,
        longitude:
          locationMode === "geolocation" ? (coords?.longitude ?? null) : null,
        customFields,
      });
      toast.success("Faixa registrada como correção administrativa.");
      setActivity("");
      setProject("");
      setCostCenter("");
      setCustom({});
      setCoords(null);
      await week.refetch();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Não foi possível registrar o ponto."
      );
    }
  };
  const sendWeek = async () => {
    try {
      await submitWeek.mutateAsync({ tenantId, date: start });
      toast.success("Sua folha de ponto foi enviada para aprovação.");
      await week.refetch();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Não foi possível enviar a folha."
      );
    }
  };
  const periodStatus = week.data?.period.status;
  const locked = periodStatus === "submitted" || periodStatus === "approved";
  return (
    <section className="page-content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">REGISTRO DE JORNADA</div>
          <h1>
            Meu ponto<span className="heading-period">.</span>
          </h1>
          <p>Bata o ponto no momento do evento. O servidor registra a hora oficial.</p>
        </div>
        <div className="heading-actions attendance-heading-actions">
          <div
            className="period-toggle"
            role="group"
            aria-label="Período da folha"
          >
            <button
              type="button"
              className={periodView === "week" ? "active" : ""}
              onClick={() => setPeriodView("week")}
            >
              Semana
            </button>
            <button
              type="button"
              className={periodView === "month" ? "active" : ""}
              onClick={() => setPeriodView("month")}
            >
              Mês
            </button>
          </div>
          <label className="date-picker-label">
            <CalendarDays size={16} />
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
            />
          </label>
        </div>
      </div>
      <PunchCard
        tenantId={tenantId}
        timezone={timezone}
        onChanged={() => {
          void week.refetch();
        }}
      />
      <PunchRequests
        tenantId={tenantId}
        role={role}
        timezone={timezone}
      />
      <div className="attendance-summary">
        <div className="panel attendance-total">
          <span className="stat-icon">
            <Clock3 size={18} />
          </span>
          <div>
            <small>
              Total {periodView === "month" ? "do mês" : "da semana"}
            </small>
            <b>
              {Math.floor(totalHours)}h{" "}
              <i>
                {String(Math.round((totalHours % 1) * 60)).padStart(2, "0")}m
              </i>
            </b>
          </div>
          <span
            className={`status-chip status-${periodStatus === "approved" ? "approved" : periodStatus === "submitted" ? "submitted" : periodStatus === "rejected" ? "rejected" : "draft"}`}
          >
            {
              (
                {
                  draft: "Rascunho",
                  submitted: "Enviada",
                  approved: "Aprovada",
                  rejected: "Precisa de ajuste",
                } as Record<string, string>
              )[periodStatus ?? "draft"]
            }
          </span>
        </div>
        <div className="panel attendance-note">
          <span className="action-symbol blue">
            <TimerReset size={17} />
          </span>
          <span>
            <b>Jornada configurada</b>
            <small>
              {activeWorkSettings?.dailyHours ?? 8}h por dia · tolerância de{" "}
              {activeWorkSettings?.toleranceMinutes ?? 10} min
            </small>
          </span>
        </div>
      </div>
      <div className="attendance-layout">
        <div className="panel timeline-panel">
          <div className="panel-head">
            <div>
              <div className="eyebrow">
                {periodView === "month" ? "MÊS DE " : "SEMANA DE "}
                {new Date(
                  `${periodView === "month" ? monthBounds(date).start : start}T12:00:00`
                ).toLocaleDateString("pt-BR", {
                  day: "2-digit",
                  month: "long",
                })}
              </div>
              <h2>Faixas registradas</h2>
            </div>
            <span className="count-pill">{entries.length}</span>
          </div>
          {(periodView === "month" ? month.isLoading : week.isLoading) ? (
            <div className="empty-inline">Carregando seus registros…</div>
          ) : !byDay.length ? (
            <div className="empty-state">
              <span className="empty-illustration">
                <Clock3 size={24} />
              </span>
              <h3>Seu tempo, do seu jeito.</h3>
              <p>Bata o ponto acima para começar a registrar a jornada.</p>
            </div>
          ) : (
            <div className="day-groups">
              {byDay.map(([day, dayEntries]) => (
                <div className="day-group" key={day}>
                  <div className="day-date">
                    <span>{dayLabel(day)}</span>
                    <small>
                      {dayEntries
                        .reduce((sum, entry) => sum + entryHours(entry), 0)
                        .toFixed(1)}
                      h
                    </small>
                  </div>
                  <div className="day-entries">
                    {dayEntries.map(entry => (
                      <article className="time-entry" key={entry.id}>
                        <div className="timeline-dot" />
                        <div className="time-entry-main">
                          <div className="time-entry-time">
                            {clockLabel(entry.startedAt, timezone)}
                            <span>—</span>
                            {clockLabel(entry.endedAt, timezone)}
                            <small>
                              {duration(entry.startedAt, entry.endedAt)}
                            </small>
                          </div>
                          <b>{entry.activity}</b>
                          <div className="entry-tags">
                            <span>{entry.markType}</span>
                            {entry.source && entry.source !== "manual" && (
                              <span className="verified-badge">
                                <History size={12} />
                                {entry.source === "punch"
                                  ? "ponto eletrônico"
                                  : "retroativo aprovado"}
                              </span>
                            )}
                            {entry.project && <span>{entry.project}</span>}
                            {entry.costCenter && (
                              <span>CC · {entry.costCenter}</span>
                            )}
                            <span className="entry-location">
                              <MapPin size={12} />
                              {entry.locationName}
                            </span>
                            {entry.latitude != null && (
                              <>
                                <span>
                                  {entry.latitude.toFixed(4)},{" "}
                                  {entry.longitude?.toFixed(4)}
                                </span>
                                <span className="verified-badge">
                                  <Check size={12} /> GPS verificado
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="panel-footer">
            <span>
              {periodView === "month"
                ? "Na visualização mensal, a aprovação continua organizada por semana."
                : periodStatus === "submitted"
                  ? "Aguardando revisão do gestor"
                  : periodStatus === "approved"
                    ? "Folha revisada e aprovada"
                    : periodStatus === "rejected"
                      ? week.data?.period.managerNote ||
                        "Ajuste a folha e envie novamente"
                      : "Confira os registros antes de enviar"}
            </span>
            <button
              className="button button-primary"
              onClick={() => void sendWeek()}
              disabled={
                periodView === "month" ||
                locked ||
                submitWeek.isPending ||
                entries.length === 0
              }
            >
              <Send size={15} />
              {periodView === "month"
                ? "Envio no modo semanal"
                : submitWeek.isPending
                  ? "Enviando…"
                  : periodStatus === "rejected"
                    ? "Reenviar folha"
                    : "Enviar para aprovação"}
            </button>
          </div>
        </div>
        {canCorrect && (
          <div className="panel add-entry-panel">
            <div className="panel-head">
              <div>
                <div className="eyebrow">CORREÇÃO ADMINISTRATIVA</div>
                <h2>Faixa manual (gestores)</h2>
              </div>
              <span className="action-symbol blue">
                <ClipboardList size={17} />
              </span>
            </div>
            <p className="panel-hint">
              Para colaboradores, o ponto é batido em tempo real ou solicitado
              como ajuste. Este formulário é apenas para correções oficiais do
              gestor, sem horários futuros.
            </p>
            {locked ? (
              <div className="empty-inline">
                <p>
                  Esta folha está em revisão ou aprovada. Não é possível alterar
                  os registros.
                </p>
              </div>
            ) : (
              <form className="form-stack" onSubmit={submitEntry}>
                <label>
                  Data (hoje ou anterior)
                  <input
                    required
                    type="date"
                    max={today()}
                    value={date}
                    onChange={e => setDate(e.target.value)}
                  />
                </label>
                <div className="form-two">
                  <label>
                    Início
                    <input
                      required
                      type="time"
                      value={startTime}
                      onChange={e => setStartTime(e.target.value)}
                    />
                  </label>
                  <label>
                    Fim
                    <input
                      required
                      type="time"
                      value={endTime}
                      onChange={e => setEndTime(e.target.value)}
                    />
                  </label>
                </div>
                <label>
                  Tipo de marcação
                  <select
                    value={activeMarkType}
                    onChange={e => setMarkType(e.target.value)}
                  >
                    {markTypes.map(type => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                  <small>
                    Faixas do tipo Intervalo não entram no total de horas
                    trabalhadas.
                  </small>
                </label>
                <label>
                  Atividade realizada
                  <textarea
                    required
                    rows={3}
                    maxLength={2000}
                    value={activity}
                    onChange={e => setActivity(e.target.value)}
                    placeholder="O que você fez nesta faixa?"
                  />
                </label>
                <div className="form-two">
                  <label>
                    Projeto
                    <input
                      maxLength={160}
                      value={project}
                      onChange={e => setProject(e.target.value)}
                      placeholder="Ex.: Projeto Atlas"
                    />
                  </label>
                  <label>
                    Centro de custo
                    <input
                      maxLength={120}
                      value={costCenter}
                      onChange={e => setCostCenter(e.target.value)}
                      placeholder="Ex.: CC-041"
                    />
                  </label>
                </div>
                {fields
                  .filter(
                    field =>
                      !["projeto", "centro de custo"].includes(
                        field.toLowerCase()
                      )
                  )
                  .map(field => (
                    <label key={field}>
                      {field}
                      <input
                        value={custom[field] ?? ""}
                        onChange={e =>
                          setCustom({ ...custom, [field]: e.target.value })
                        }
                      />
                    </label>
                  ))}
                <label>
                  Local da atividade
                  <select
                    value={
                      locationMode === "preset"
                        ? `preset:${locationName}`
                        : locationMode
                    }
                    onChange={e => {
                      if (e.target.value.startsWith("preset:")) {
                        setCoords(null);
                        setLocationMode("preset");
                        setLocationName(e.target.value.slice(7));
                      } else if (e.target.value === "geolocation") {
                        setCoords(null);
                        setLocationMode("geolocation");
                        setLocationName("Localização GPS");
                      } else {
                        setCoords(null);
                        setLocationMode("manual");
                        setLocationName("");
                      }
                    }}
                  >
                    <optgroup label="Locais cadastrados">
                      {locs.map(loc => (
                        <option key={loc} value={`preset:${loc}`}>
                          {loc}
                        </option>
                      ))}
                    </optgroup>
                    <option value="geolocation">Usar geolocalização</option>
                    <option value="manual">Informar outro local</option>
                  </select>
                </label>
                {locationMode === "manual" && (
                  <label>
                    Descreva o local
                    <input
                      required
                      maxLength={180}
                      value={locationName}
                      onChange={e => setLocationName(e.target.value)}
                      placeholder="Ex.: Visita ao cliente"
                    />
                  </label>
                )}
                {locationMode === "geolocation" && (
                  <button
                    type="button"
                    className="button button-outline location-button"
                    onClick={capture}
                  >
                    <LocateFixed size={16} />
                    {coords
                      ? "Localização capturada"
                      : "Capturar localização atual"}
                    {coords && <Check size={15} />}
                    {coords && (
                      <span className="verified-badge">
                        <Check size={12} /> Local verificado
                      </span>
                    )}
                  </button>
                )}
                <button
                  className="button button-primary button-wide"
                  disabled={addEntry.isPending}
                >
                  <Plus size={16} />
                  {addEntry.isPending ? "Salvando faixa…" : "Adicionar à folha"}
                </button>
              </form>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
