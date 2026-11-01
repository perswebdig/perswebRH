import { useMemo, useState } from "react";
import {
  CalendarDays,
  Check,
  Clock3,
  LocateFixed,
  MapPin,
  Plus,
  Send,
  TimerReset,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

type Role =
  | "tenant_admin"
  | "manager"
  | "employee"
  | "finance"
  | "administrative";
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
const dayLabel = (date: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  }).format(new Date(`${date}T12:00:00`));

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
      toast.success("Faixa de trabalho registrada.");
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
          <p>Organize seu dia em faixas claras de trabalho.</p>
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
              <p>Adicione uma faixa de trabalho para este período.</p>
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
        <div className="panel add-entry-panel">
          <div className="panel-head">
            <div>
              <div className="eyebrow">NOVA FAIXA</div>
              <h2>Registrar trabalho</h2>
            </div>
            <span className="action-symbol blue">
              <Plus size={17} />
            </span>
          </div>
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
                Data
                <input
                  required
                  type="date"
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
      </div>
    </section>
  );
}
