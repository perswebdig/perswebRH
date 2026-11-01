import { useMemo, useState } from "react";
import {
  Activity,
  ArrowRight,
  Bell,
  Building2,
  CalendarClock,
  Check,
  ChevronDown,
  CircleHelp,
  ClipboardCheck,
  Clock3,
  Download,
  FileBarChart2,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  Receipt,
  Settings2,
  ShieldCheck,
  Users,
  WalletCards,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Attendance } from "./attendance";
import { Reimbursements } from "./reimbursements";
import { AdminSettings } from "./settings";

type User = {
  id: number;
  openId: string;
  name: string | null;
  email: string | null;
  role: "user" | "admin";
};
type TenantInfo = {
  id: number;
  tenantId: number;
  name: string;
  slug: string;
  customDomain: string | null;
  role: "tenant_admin" | "manager" | "employee" | "finance" | "administrative";
  departmentId: number | null;
  joinedAt: Date | null;
};
type Section =
  | "overview"
  | "attendance"
  | "approvals"
  | "reimbursements"
  | "reports"
  | "team"
  | "settings"
  | "platform";

const sectionMeta: Record<
  Section,
  { label: string; icon: typeof LayoutDashboard; mobile: string }
> = {
  overview: { label: "Visão geral", icon: LayoutDashboard, mobile: "Início" },
  attendance: { label: "Meu ponto", icon: Clock3, mobile: "Ponto" },
  approvals: { label: "Aprovações", icon: ClipboardCheck, mobile: "Aprovar" },
  reimbursements: { label: "Reembolsos", icon: Receipt, mobile: "Despesas" },
  reports: { label: "Relatórios", icon: FileBarChart2, mobile: "Dados" },
  team: { label: "Equipe", icon: Users, mobile: "Equipe" },
  settings: { label: "Configurações", icon: Settings2, mobile: "Ajustes" },
  platform: { label: "Plataforma", icon: Building2, mobile: "Plataforma" },
};
const roleLabels: Record<string, string> = {
  tenant_admin: "Admin da empresa",
  manager: "Gestor",
  employee: "Funcionário",
  finance: "Financeiro",
  administrative: "Administrativo",
};
const todayIso = () => new Date().toLocaleDateString("en-CA");
const monthStart = () => `${todayIso().slice(0, 7)}-01`;
const weekStart = (value: string) => {
  const d = new Date(`${value}T12:00:00`);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return d.toLocaleDateString("en-CA");
};
const money = (value: number | string, currency = "BRL") =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(
    Number(value || 0)
  );
const hoursLabel = (hours: number) =>
  `${Math.floor(hours)}h ${String(Math.round((hours % 1) * 60)).padStart(2, "0")}m`;
const trackedHours = (entry: {
  startedAt: string | Date;
  endedAt: string | Date;
  countsAsWork: boolean;
}) =>
  entry.countsAsWork
    ? (new Date(entry.endedAt).getTime() -
        new Date(entry.startedAt).getTime()) /
      3600000
    : 0;
const clockLabel = (value: string | Date, timezone: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

function toDateKey(date: string | Date) {
  const value = date instanceof Date ? date.toISOString() : String(date);
  return value.slice(0, 10);
}

function formatDate(
  date: string | Date,
  options: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short" }
) {
  return new Intl.DateTimeFormat("pt-BR", options).format(
    new Date(`${toDateKey(date)}T12:00:00`)
  );
}

export default function OrbitWorkspace({
  user,
  tenants,
  tenant,
  onSelectTenant,
}: {
  user: User;
  tenants: TenantInfo[];
  tenant: TenantInfo;
  onSelectTenant: (id: number) => void;
}) {
  const [section, setSection] = useState<Section>("overview");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [tenantMenu, setTenantMenu] = useState(false);
  const settings = trpc.tenants.settings.useQuery({
    tenantId: tenant.tenantId,
  });
  const requestList = trpc.reimbursements.list.useQuery({
    tenantId: tenant.tenantId,
  });
  const weekDate = weekStart(todayIso());
  const attendance = trpc.attendance.myWeek.useQuery({
    tenantId: tenant.tenantId,
    date: weekDate,
  });
  const signOut = trpc.auth.logout.useMutation();
  const admin = tenant.role === "tenant_admin";
  const manager = tenant.role === "manager";
  const approver =
    admin ||
    manager ||
    tenant.role === "finance" ||
    tenant.role === "administrative";
  const platformAdmin = user.role === "admin";
  const platformOverview = trpc.tenants.platformOverview.useQuery(undefined, {
    enabled: platformAdmin,
  });
  const isLoading =
    settings.isLoading || requestList.isLoading || attendance.isLoading;
  const entries = attendance.data?.entries ?? [];
  const totalWeekHours = entries.reduce(
    (sum, entry) => sum + trackedHours(entry),
    0
  );
  const requests = requestList.data ?? [];
  const waiting = requests.filter(
    request => request.status === "in_approval"
  ).length;
  const pendingPeriods = trpc.attendance.managerQueue.useQuery(
    { tenantId: tenant.tenantId },
    { enabled: admin || manager }
  );
  const pendingApprovals = pendingPeriods.data?.length ?? 0;
  const navSections: Section[] = [
    "overview",
    "attendance",
    ...(approver ? ["approvals" as const] : []),
    "reimbursements",
    "reports",
    ...(admin || manager ? ["team" as const] : []),
    ...(admin ? ["settings" as const] : []),
    ...(platformAdmin ? ["platform" as const] : []),
  ];
  const changeSection = (next: Section) => {
    setSection(next);
    setMobileOpen(false);
  };
  const weekDays = useMemo(() => {
    const map = new Map<string, number>();
    entries.forEach(entry =>
      map.set(
        entry.workDate,
        (map.get(entry.workDate) ?? 0) + trackedHours(entry)
      )
    );
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [entries]);

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
        <div className="sidebar-brand">
          <span className="brand-mark">
            <span className="persweb-dot" />
            <i />
          </span>
          <span>
            persweb<span className="brand-rh">rh</span>
          </span>
          <button
            className="icon-button mobile-close"
            onClick={() => setMobileOpen(false)}
            aria-label="Fechar menu"
          >
            <X size={18} />
          </button>
        </div>
        <button
          className="tenant-switcher"
          onClick={() => setTenantMenu(!tenantMenu)}
        >
          <span className="tenant-avatar">
            {tenant.name.slice(0, 1).toUpperCase()}
          </span>
          <span className="tenant-meta">
            <b>{tenant.name}</b>
            <small>ID · {tenant.slug}</small>
          </span>
          <ChevronDown size={15} />
        </button>
        {tenantMenu && (
          <div className="tenant-popover">
            {tenants.map(item => (
              <button
                key={item.tenantId}
                onClick={() => {
                  onSelectTenant(item.tenantId);
                  setTenantMenu(false);
                }}
                className={item.tenantId === tenant.tenantId ? "selected" : ""}
              >
                <span className="tenant-avatar small">
                  {item.name.slice(0, 1).toUpperCase()}
                </span>
                <span>{item.name}</span>
                {item.tenantId === tenant.tenantId && <Check size={15} />}
              </button>
            ))}
            <div className="tenant-popover-foot">
              Acesso separado por empresa
            </div>
          </div>
        )}
        <div className="nav-caption">ESPAÇO DE TRABALHO</div>
        <nav className="side-nav">
          {navSections.map(key => {
            const Icon = sectionMeta[key].icon;
            const count = key === "approvals" ? pendingApprovals : 0;
            return (
              <button
                key={key}
                onClick={() => changeSection(key)}
                className={section === key ? "active" : ""}
              >
                <Icon size={18} />
                <span>{sectionMeta[key].label}</span>
                {count > 0 && <b className="nav-count">{count}</b>}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-tip">
            <span className="tip-icon">
              <ShieldCheck size={17} />
            </span>
            <div>
              <b>Seu espaço, protegido</b>
              <small>Os dados desta empresa são isolados.</small>
            </div>
          </div>
          <button
            className="user-menu"
            onClick={() => {
              void signOut.mutateAsync().then(() => window.location.reload());
            }}
          >
            <span className="user-avatar">
              {(user.name || user.email || "U").slice(0, 1).toUpperCase()}
            </span>
            <span className="user-meta">
              <b>{user.name || user.email || "Usuário"}</b>
              <small>
                {platformAdmin ? "Super Admin" : roleLabels[tenant.role]}
              </small>
            </span>
            <LogOut size={16} />
          </button>
        </div>
      </aside>
      {mobileOpen && (
        <button
          className="sidebar-scrim"
          onClick={() => setMobileOpen(false)}
          aria-label="Fechar navegação"
        />
      )}
      <main className="main-area">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            onClick={() => setMobileOpen(true)}
            aria-label="Abrir menu"
          >
            <Menu size={20} />
          </button>
          <div className="breadcrumbs">
            {tenant.name}
            <span>/</span>
            <b>{sectionMeta[section].label}</b>
          </div>
          <div className="topbar-actions">
            <span className="top-date">
              <CalendarClock size={15} />
              {new Intl.DateTimeFormat("pt-BR", {
                weekday: "short",
                day: "2-digit",
                month: "short",
              }).format(new Date())}
            </span>
            <button
              className="icon-button notification-button"
              title={
                waiting
                  ? `${waiting} reembolsos em aprovação`
                  : "Sem novas notificações"
              }
            >
              <Bell size={18} />
              {waiting > 0 && <i />}
            </button>
          </div>
        </header>
        <div className="content-area">
          {section === "overview" && (
            <section className="page-content">
              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    {new Intl.DateTimeFormat("pt-BR", {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                    }).format(new Date())}
                  </div>
                  <h1>
                    Olá, {(user.name || "por aí").split(" ")[0]}
                    <span className="heading-period">.</span>
                  </h1>
                  <p>Um panorama da semana na {tenant.name}.</p>
                </div>
                <button
                  className="button button-primary"
                  onClick={() => changeSection("attendance")}
                >
                  <Plus size={16} /> Registrar ponto
                </button>
              </div>
              {isLoading ? (
                <div className="skeleton-row">
                  <div />
                  <div />
                  <div />
                </div>
              ) : (
                <>
                  <div className="stat-grid">
                    <article className="stat-card stat-feature" role="button" tabIndex={0} onClick={() => changeSection("attendance")} style={{ cursor: "pointer" }}>
                      <div className="stat-label">
                        <span className="stat-icon">
                          <Clock3 size={17} />
                        </span>
                        Horas nesta semana
                      </div>
                      <strong>{hoursLabel(totalWeekHours)}</strong>
                      <small>
                        em {weekDays.length}{" "}
                        {weekDays.length === 1
                          ? "dia registrado"
                          : "dias registrados"}
                      </small>
                      <div className="stat-spark">
                        <span style={{ height: "42%" }} />
                        <span style={{ height: "68%" }} />
                        <span style={{ height: "50%" }} />
                        <span style={{ height: "83%" }} />
                        <span style={{ height: "58%" }} />
                        <span
                          className="spark-current"
                          style={{ height: "72%" }}
                        />
                      </div>
                    </article>
                    <article className="stat-card" role="button" tabIndex={0} onClick={() => changeSection("reimbursements")} style={{ cursor: "pointer" }}>
                      <div className="stat-label">
                        <span className="stat-icon indigo">
                          <Receipt size={17} />
                        </span>
                        Reembolsos em aprovação
                      </div>
                      <strong>{waiting.toString().padStart(2, "0")}</strong>
                      <small>
                        {requests.filter(r => r.status === "approved").length}{" "}
                        aprovados ·{" "}
                        {requests.filter(r => r.status === "paid").length} pagos
                      </small>
                      <button
                        className="text-link"
                        onClick={() => changeSection("reimbursements")}
                      >
                        Acessar solicitações <ArrowRight size={14} />
                      </button>
                    </article>
                    <article className="stat-card" role="button" tabIndex={0} onClick={() => changeSection(admin || manager ? "team" : "overview")} style={{ cursor: "pointer" }}>
                      <div className="stat-label">
                        <span className="stat-icon amber">
                          <Users size={17} />
                        </span>
                        Equipe
                      </div>
                      <strong>{settings.data?.teamCount ?? 0}</strong>
                      <small>
                        {settings.data?.departments.length ?? 0} departamentos
                      </small>
                      <button
                        className="text-link"
                        onClick={() =>
                          changeSection(admin || manager ? "team" : "overview")
                        }
                      >
                        Ver estrutura <ArrowRight size={14} />
                      </button>
                    </article>
                  </div>
                  <div className="overview-grid">
                    <section className="panel week-panel">
                      <div className="panel-head">
                        <div>
                          <div className="eyebrow">Ritmo da equipe</div>
                          <h2>Horas registradas</h2>
                        </div>
                        <button
                          className="text-link"
                          onClick={() => changeSection("reports")}
                        >
                          Relatórios <ArrowRight size={14} />
                        </button>
                      </div>
                      {totalWeekHours === 0 ? (
                        <div className="empty-inline">
                          <span><Clock3 size={19} /></span>
                          <p>Sem horas registradas nesta semana.</p>
                        </div>
                      ) : (
                      <div className="week-bars">
                        {Array.from({ length: 5 }, (_, i) => {
                          const d = new Date(`${weekDate}T12:00:00`);
                          d.setDate(d.getDate() + i);
                          const key = d.toLocaleDateString("en-CA");
                          const hour =
                            weekDays.find(([day]) => day === key)?.[1] ?? 0;
                          const height = Math.max(
                            6,
                            Math.min(
                              100,
                              (hour /
                                Math.max(
                                  Number(
                                    attendance.data?.workSettings?.dailyHours ??
                                      8
                                  ),
                                  1
                                )) *
                                100
                            )
                          );
                          return (
                            <div className="week-bar" key={key}>
                              <div className="bar-track">
                                <span
                                  style={{ height: `${height}%` }}
                                  title={hoursLabel(hour)}
                                />
                              </div>
                              <b>
                                {new Intl.DateTimeFormat("pt-BR", {
                                  weekday: "short",
                                })
                                  .format(d)
                                  .replace(".", "")}
                              </b>
                              <small>
                                {hour ? `${Math.round(hour)}h` : "—"}
                              </small>
                            </div>
                          );
                        })}
                      </div>
                      )}
                      <div className="panel-head">
                        <div>
                          <div className="eyebrow">Atalhos</div>
                          <h2>O que vem agora?</h2>
                        </div>
                        <Activity size={18} className="muted-icon" />
                      </div>
                      <button
                        className="action-row"
                        onClick={() => changeSection("attendance")}
                      >
                        <span className="action-symbol blue">
                          <Clock3 size={17} />
                        </span>
                        <span>
                          <b>Fechar sua semana</b>
                          <small>Registre e envie a folha de ponto</small>
                        </span>
                        <ArrowRight size={16} />
                      </button>
                      <button
                        className="action-row"
                        onClick={() => changeSection("reimbursements")}
                      >
                        <span className="action-symbol violet">
                          <WalletCards size={17} />
                        </span>
                        <span>
                          <b>Enviar uma despesa</b>
                          <small>Adicione itens e comprovantes</small>
                        </span>
                        <ArrowRight size={16} />
                      </button>
                      {approver && (
                        <button
                          className="action-row"
                          onClick={() => changeSection("approvals")}
                        >
                          <span className="action-symbol orange">
                            <ClipboardCheck size={17} />
                          </span>
                          <span>
                            <b>Revisar pendências</b>
                            <small>
                              {pendingApprovals} folhas aguardam revisão
                            </small>
                          </span>
                          <ArrowRight size={16} />
                        </button>
                      )}
                    </section>
                  </div>
                  <section className="panel recent-panel">
                    <div className="panel-head">
                      <div>
                        <div className="eyebrow">Histórico recente</div>
                        <h2>Últimas despesas</h2>
                      </div>
                      <button
                        className="text-link"
                        onClick={() => changeSection("reimbursements")}
                      >
                        Ver todas <ArrowRight size={14} />
                      </button>
                    </div>
                    {requests.length === 0 ? (
                      <div className="empty-inline">
                        <span>
                          <Receipt size={19} />
                        </span>
                        <p>
                          Nenhuma solicitação ainda. As despesas da equipe
                          aparecerão aqui.
                        </p>
                      </div>
                    ) : (
                      <div className="recent-list">
                        {requests.slice(0, 4).map(item => (
                          <div className="recent-item" key={item.id}>
                            <span className="recent-icon">
                              <FileText size={17} />
                            </span>
                            <span className="recent-name">
                              <b>{item.title}</b>
                              <small>
                                {item.employee?.name || "Você"} ·{" "}
                                {formatDate(item.createdAt)}
                              </small>
                            </span>
                            <span className="recent-amount">
                              {money(
                                item.totalAmount,
                                settings.data?.tenant?.currency
                              )}
                            </span>
                            <StatusChip status={item.status} />
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                </>
              )}
            </section>
          )}
          {section === "attendance" && (
            <Attendance
              tenantId={tenant.tenantId}
              role={tenant.role}
              currency={settings.data?.tenant?.currency ?? "BRL"}
            />
          )}
          {section === "approvals" && (
            <Approvals
              tenantId={tenant.tenantId}
              role={tenant.role}
              timezone={settings.data?.tenant?.timezone ?? "America/Sao_Paulo"}
              onDone={() => {
                if (admin || manager) void pendingPeriods.refetch();
                void requestList.refetch();
              }}
            />
          )}
          {section === "reimbursements" && (
            <Reimbursements
              tenantId={tenant.tenantId}
              currency={settings.data?.tenant?.currency ?? "BRL"}
            />
          )}
          {section === "reports" && (
            <Reports
              tenantId={tenant.tenantId}
              role={tenant.role}
              team={settings.data?.team ?? []}
              timezone={settings.data?.tenant?.timezone ?? "America/Sao_Paulo"}
            />
          )}
          {section === "team" && (
            <TeamView
              tenantId={tenant.tenantId}
              team={settings.data?.team ?? []}
              departments={settings.data?.departments ?? []}
              onGoSettings={() => changeSection("settings")}
            />
          )}
          {section === "platform" && platformAdmin && (
            <section className="page-content">
              <div className="page-heading">
                <div>
                  <div className="eyebrow">Super Admin</div>
                  <h1>Empresas cadastradas</h1>
                </div>
              </div>
              <div className="panel">
                <div className="panel-head">
                  <h2>{platformOverview.data?.total ?? 0} tenants</h2>
                </div>
                <div className="request-list">
                  {(platformOverview.data?.tenants ?? []).map(item => (
                    <div className="request-list-item" key={item.id}>
                      <span className="request-list-copy">
                        <b>{item.name}</b>
                        <small>
                          {item.slug} · {item.plan} · {item.status} ·{" "}
                          {item.members} membros
                        </small>
                      </span>
                      <b>{item.workEntries} faixas</b>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}
          {section === "settings" && admin && (
            <AdminSettings tenantId={tenant.tenantId} />
          )}
          {section === "settings" && !admin && (
            <div className="panel empty-state">
              <ShieldCheck size={24} />
              <h2>Acesso restrito</h2>
              <p>
                Somente administradores da empresa podem alterar as
                configurações.
              </p>
            </div>
          )}
        </div>
        <footer className="app-footer">
          <span>
            persweb<span className="brand-rh">rh</span>
          </span>
          <span>Um espaço de trabalho. Uma empresa.</span>
          <button
            onClick={() =>
              toast("O suporte da sua empresa pode ajudar com o acesso.")
            }
          >
            <CircleHelp size={14} /> Ajuda
          </button>
        </footer>
      </main>
      <nav className="mobile-nav">
        {navSections.slice(0, 5).map(key => {
          const Icon = sectionMeta[key].icon;
          return (
            <button
              key={key}
              onClick={() => changeSection(key)}
              className={section === key ? "active" : ""}
            >
              <Icon size={19} />
              <span>{sectionMeta[key].mobile}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  const labels: Record<string, string> = {
    draft: "Rascunho",
    submitted: "Enviado",
    in_approval: "Em aprovação",
    approved: "Aprovado",
    paid: "Pago",
    rejected: "Rejeitado",
  };
  return (
    <span className={`status-chip status-${status}`}>
      {labels[status] ?? status}
    </span>
  );
}

function Approvals({
  tenantId,
  role,
  timezone,
  onDone,
}: {
  tenantId: number;
  role: string;
  timezone: string;
  onDone: () => void;
}) {
  const queue = trpc.attendance.managerQueue.useQuery(
    { tenantId },
    { enabled: role === "tenant_admin" || role === "manager" }
  );
  const requests = trpc.reimbursements.list.useQuery({ tenantId });
  const review = trpc.attendance.reviewWeek.useMutation();
  const decide = trpc.reimbursements.decide.useMutation();
  const [rejectionId, setRejectionId] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [selectedPeriodIds, setSelectedPeriodIds] = useState<number[]>([]);
  const [selectedRequestIds, setSelectedRequestIds] = useState<number[]>([]);
  const pendingRequests = (requests.data ?? []).filter(
    item => item.status === "in_approval" && item.canAct
  );
  const doPeriod = async (
    periodId: number,
    decision: "approved" | "rejected"
  ) => {
    try {
      await review.mutateAsync({ tenantId, periodId, decision });
      toast.success(
        decision === "approved" ? "Folha aprovada." : "Folha devolvida."
      );
      await queue.refetch();
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha na decisão.");
    }
  };
  const doExpense = async (
    reimbursementId: number,
    decision: "approved" | "rejected"
  ) => {
    if (decision === "rejected" && !reason.trim())
      return toast.error("Informe a justificativa.");
    try {
      await decide.mutateAsync({
        tenantId,
        reimbursementId,
        decision,
        note: decision === "rejected" ? reason : undefined,
      });
      toast.success(
        decision === "approved" ? "Etapa aprovada." : "Solicitação rejeitada."
      );
      setRejectionId(null);
      setReason("");
      await requests.refetch();
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha na decisão.");
    }
  };
  const bulkPeriods = async (decision: "approved" | "rejected") => {
    for (const id of selectedPeriodIds)
      await doPeriod(id, decision).catch(() => undefined);
    setSelectedPeriodIds([]);
  };
  const bulkRequests = async (decision: "approved" | "rejected") => {
    for (const id of selectedRequestIds)
      await doExpense(id, decision).catch(() => undefined);
    setSelectedRequestIds([]);
  };

  return (
    <section className="page-content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">Fila de revisão</div>
          <h1>
            Aprovações<span className="heading-period">.</span>
          </h1>
          <p>Decisões claras, com registro para cada etapa.</p>
        </div>
        <span className="queue-count">
          {(queue.data?.length ?? 0) + pendingRequests.length} pendências
        </span>
      </div>
      <div className="bulk-actions">
        <button className="button button-outline" onClick={() => void bulkPeriods("approved")} disabled={!selectedPeriodIds.length}>
          Aprovar folhas selecionadas
        </button>
        <button className="button button-outline" onClick={() => void bulkRequests("approved")} disabled={!selectedRequestIds.length}>
          Aprovar reembolsos selecionados
        </button>
      </div>
      <div className="approval-columns">
        <div className="panel approval-section">
          <div className="panel-head">
            <div>
              <div className="eyebrow">FREQUÊNCIA</div>
              <h2>Folhas de ponto</h2>
            </div>
            <span className="count-pill">{queue.data?.length ?? 0}</span>
          </div>
          {queue.isLoading ? (
            <div className="empty-inline">Carregando…</div>
          ) : !queue.data?.length ? (
            <div className="empty-inline">
              <span>
                <Check size={19} />
              </span>
              <p>Nenhuma folha aguarda sua revisão.</p>
            </div>
          ) : (
            queue.data.map(row => (
              <article className="approval-card" key={row.period.id}>
                <input type="checkbox" checked={selectedPeriodIds.includes(row.period.id)} onChange={e => setSelectedPeriodIds(prev => e.target.checked ? [...prev, row.period.id] : prev.filter(id => id !== row.period.id))} />
                <div className="approval-card-head">
                  <span className="user-avatar">
                    {row.employee?.name?.slice(0, 1) ?? "?"}
                  </span>
                  <div>
                    <b>{row.employee?.name ?? "Colaborador"}</b>
                    <small>
                      Semana de {formatDate(row.period.periodStart)} ·{" "}
                      {hoursLabel(row.hours)}
                    </small>
                    <small className="approval-step">
                      Etapa: Aprovação do gestor
                    </small>
                  </div>
                  <StatusChip status="submitted" />
                </div>
                <div className="approval-entries">
                  {row.entries.slice(0, 3).map(entry => (
                    <div key={entry.id}>
                      <span>{formatDate(entry.workDate)}</span>
                      <b>
                        {clockLabel(entry.startedAt, timezone)}–
                        {clockLabel(entry.endedAt, timezone)}
                      </b>
                      <small>{entry.activity}</small>
                    </div>
                  ))}
                </div>
                <div className="approval-actions">
                  <button
                    className="button button-outline"
                    onClick={() => void doPeriod(row.period.id, "rejected")}
                    disabled={review.isPending}
                  >
                    Devolver
                  </button>
                  <button
                    className="button button-primary"
                    onClick={() => void doPeriod(row.period.id, "approved")}
                    disabled={review.isPending}
                  >
                    <Check size={15} /> Aprovar folha
                  </button>
                </div>
              </article>
            ))
          )}
        </div>
        <div className="panel approval-section">
          <div className="panel-head">
            <div>
              <div className="eyebrow">DESPESAS</div>
              <h2>Reembolsos</h2>
            </div>
            <span className="count-pill">{pendingRequests.length}</span>
          </div>
          {requests.isLoading ? (
            <div className="empty-inline">Carregando…</div>
          ) : !pendingRequests.length ? (
            <div className="empty-inline">
              <span>
                <Check size={19} />
              </span>
              <p>Nenhum reembolso aguarda sua decisão.</p>
            </div>
          ) : (
            pendingRequests.map(request => (
              <article className="approval-card" key={request.id}>
                <input type="checkbox" checked={selectedRequestIds.includes(request.id)} onChange={e => setSelectedRequestIds(prev => e.target.checked ? [...prev, request.id] : prev.filter(id => id !== request.id))} />
                <div className="approval-card-head">
                  <span className="action-symbol violet">
                    <Receipt size={17} />
                  </span>
                  <div>
                    <b>{request.title}</b>
                    <small>
                      {request.employee?.name ?? "Colaborador"} ·{" "}
                      {request.items.length} itens
                    </small>
                    <small className="approval-step">
                      Etapa:{" "}
                      {request.status === "in_approval"
                        ? "Aguardando gestor/financeiro"
                        : request.status}
                    </small>
                  </div>
                  <strong>{money(request.totalAmount)}</strong>
                </div>
                <div className="approval-item-lines">
                  {request.items.map(item => (
                    <div key={item.id}>
                      <span>
                        {item.description}
                        <small>{item.categoryName}</small>
                      </span>
                      <b>{money(item.amount)}</b>
                    </div>
                  ))}
                </div>
                {rejectionId === request.id && (
                  <div className="reject-reason">
                    <label>
                      Justificativa da rejeição
                      <textarea
                        rows={2}
                        value={reason}
                        onChange={e => setReason(e.target.value)}
                        placeholder="Explique o motivo para o colaborador…"
                      />
                    </label>
                  </div>
                )}
                <div className="approval-actions">
                  {rejectionId === request.id ? (
                    <button
                      className="button button-outline"
                      onClick={() => setRejectionId(null)}
                    >
                      Cancelar
                    </button>
                  ) : (
                    <>
                      <button
                        className="button button-outline"
                        onClick={() => {
                          setRejectionId(request.id);
                          setReason("");
                        }}
                      >
                        Rejeitar
                      </button>
                    </>
                  )}
                  <button
                    className="button button-primary"
                    onClick={() =>
                      void doExpense(
                        request.id,
                        rejectionId === request.id ? "rejected" : "approved"
                      )
                    }
                    disabled={decide.isPending}
                  >
                    {rejectionId === request.id ? (
                      "Confirmar rejeição"
                    ) : (
                      <>
                        <Check size={15} /> Aprovar
                      </>
                    )}
                  </button>
                </div>
              </article>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

function Reports({
  tenantId,
  role,
  team,
  timezone,
}: {
  tenantId: number;
  role: string;
  team: { id: number; name: string; role: string; active?: number }[];
  timezone: string;
}) {
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayIso());
  const [memberId, setMemberId] = useState("");
  const canViewTeam = role === "tenant_admin" || role === "manager";
  const metrics = trpc.attendance.metrics.useQuery(
    { tenantId, from, to },
    { enabled: canViewTeam }
  );
  const result = trpc.attendance.report.useQuery({
    tenantId,
    from,
    to,
    membershipId: memberId ? Number(memberId) : null,
  });
  const totals = useMemo(
    () =>
      (result.data ?? []).reduce(
        (acc, entry) => {
          const key = entry.employee?.name || "Funcionário";
          acc[key] = (acc[key] ?? 0) + entry.hours;
          return acc;
        },
        {} as Record<string, number>
      ),
    [result.data]
  );
  const projectTotals = useMemo(
    () =>
      (result.data ?? []).reduce(
        (acc, entry) => {
          const key = entry.project || entry.activity || "Sem projeto";
          acc[key] = (acc[key] ?? 0) + entry.hours;
          return acc;
        },
        {} as Record<string, number>
      ),
    [result.data]
  );
  const exportCsv = () => {
    const rows = [
      [
        "Funcionário",
        "Data",
        "Início",
        "Fim",
        "Atividade",
        "Tipo de marcação",
        "Projeto",
        "Centro de custo",
        "Local",
        "Horas",
      ],
      ...(result.data ?? []).map(row => [
        row.employee?.name ?? "",
        row.workDate,
        clockLabel(row.startedAt, timezone),
        clockLabel(row.endedAt, timezone),
        row.activity,
        row.markType,
        row.project ?? "",
        row.costCenter ?? "",
        row.locationName,
        row.hours.toFixed(2),
      ]),
    ];
    const csv = rows
      .map(r =>
        r
          .map(value => {
            const text = String(value ?? "");
            const safe = /^[\t\r ]*[=+\-@]/.test(text) ? `'${text}` : text;
            return `"${safe.replaceAll('"', '""')}"`;
          })
          .join(";")
      )
      .join("\r\n");
    const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `persweb-frequencia-${from}-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <section className="page-content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">Indicadores e extração</div>
          <h1>
            Relatórios<span className="heading-period">.</span>
          </h1>
          <p>Frequência detalhada para acompanhar o período.</p>
        </div>
        <div className="heading-actions">
          <button
            className="button button-outline"
            onClick={() => window.print()}
          >
            <FileText size={16} /> Salvar PDF
          </button>
          <button
            className="button button-primary"
            onClick={exportCsv}
            disabled={!result.data?.length}
          >
            <Download size={16} /> Exportar CSV
          </button>
        </div>
      </div>
      <div className="panel report-filters">
        <label>
          De
          <input
            type="date"
            value={from}
            onChange={e => setFrom(e.target.value)}
          />
        </label>
        <label>
          Até
          <input type="date" value={to} onChange={e => setTo(e.target.value)} />
        </label>
        {canViewTeam && (
          <label>
            Funcionário
            <select
              value={memberId}
              onChange={e => setMemberId(e.target.value)}
            >
              <option value="">Toda a equipe</option>
              {team
                .filter(m => m.active !== 0)
                .map(m => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
            </select>
          </label>
        )}
        <div className="report-totals">
          <span>
            <b>{result.data?.length ?? 0}</b> faixas registradas
          </span>
          <span>
            <b>
              {hoursLabel(
                (result.data ?? []).reduce((n, row) => n + row.hours, 0)
              )}
            </b>{" "}
            trabalhadas
          </span>
        </div>
      </div>
      <div className="report-summary">
        {Object.entries(totals)
          .slice(0, 6)
          .map(([name, value]) => (
            <div key={name} className="report-person">
              <span className="user-avatar">{name.slice(0, 1)}</span>
              <span>
                <b>{name}</b>
                <small>{hoursLabel(value)}</small>
              </span>
              <div className="report-progress">
                <i
                  style={{
                    width: `${Math.min(100, (value / Math.max(...Object.values(totals), 1)) * 100)}%`,
                  }}
                />
              </div>
            </div>
          ))}
      </div>
      {canViewTeam && metrics.data && (
        <div className="manager-metrics">
          <article className="panel manager-metric-card">
            <span className="stat-icon amber">
              <Users size={17} />
            </span>
            <div>
              <small>Dias úteis sem registro</small>
              <b>{metrics.data.daysWithoutRecords}</b>
              <em>de {metrics.data.expectedWorkdays} dias esperados</em>
            </div>
          </article>
          <article className="panel manager-metric-card">
            <span className="stat-icon indigo">
              <Clock3 size={17} />
            </span>
            <div>
              <small>Horas acima da jornada diária</small>
              <b>{hoursLabel(metrics.data.overtimeHours)}</b>
              <em>{metrics.data.headcount} pessoas no escopo</em>
            </div>
          </article>
          <article className="panel manager-metric-card">
            <span className="stat-icon amber">
              <CalendarClock size={17} />
            </span>
            <div>
              <small>Atrasos fora da tolerância</small>
              <b>{metrics.data.lateDays} dias</b>
              <em>
                {metrics.data.lateMinutes} min além dos{" "}
                {metrics.data.toleranceMinutes} min de tolerância
              </em>
            </div>
          </article>
          <p>
            Estimativa em dias úteis de segunda a sexta, sem calendário de
            feriados ou justificativas de ausência cadastrado.
          </p>
        </div>
      )}
      {Object.keys(projectTotals).length > 0 && (
        <div className="panel project-summary-panel">
          <div className="panel-head">
            <div>
              <div className="eyebrow">PROJETOS E ATIVIDADES</div>
              <h2>Horas no período</h2>
            </div>
          </div>
          <div className="project-summary-list">
            {Object.entries(projectTotals)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 12)
              .map(([name, value]) => (
                <div className="project-summary-row" key={name}>
                  <span>{name}</span>
                  <b>{hoursLabel(value)}</b>
                  <i>
                    <em
                      style={{
                        width: `${Math.min(100, (value / Math.max(...Object.values(projectTotals), 1)) * 100)}%`,
                      }}
                    />
                  </i>
                </div>
              ))}
          </div>
        </div>
      )}
      <div className="panel table-panel">
        <div className="panel-head">
          <div>
            <div className="eyebrow">
              {from} — {to}
            </div>
            <h2>Detalhamento da frequência</h2>
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Funcionário</th>
                <th>Data</th>
                <th>Horário</th>
                <th>Tipo</th>
                <th>Atividade / projeto</th>
                <th>Local</th>
                <th>Horas</th>
              </tr>
            </thead>
            <tbody>
              {(result.data ?? []).map(row => (
                <tr key={row.id}>
                  <td>{row.employee?.name ?? "—"}</td>
                  <td>
                    {formatDate(row.workDate, {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })}
                  </td>
                  <td>
                    {clockLabel(row.startedAt, timezone)}–
                    {clockLabel(row.endedAt, timezone)}
                  </td>
                  <td>{row.markType}</td>
                  <td>
                    <b>{row.activity}</b>
                    <small>
                      {row.project || row.costCenter || "Sem projeto"}
                    </small>
                  </td>
                  <td>{row.locationName}</td>
                  <td>
                    <b>{hoursLabel(row.hours)}</b>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!result.data?.length && (
            <div className="empty-inline">
              <span>
                <FileBarChart2 size={19} />
              </span>
              <p>Nenhum registro no período selecionado.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function TeamView({
  tenantId,
  team,
  departments,
  onGoSettings,
}: {
  tenantId: number;
  team: {
    id: number;
    name: string;
    email: string;
    role: string;
    departmentId: number | null;
    active: number;
  }[];
  departments: { id: number; name: string }[];
  onGoSettings: () => void;
}) {
  return (
    <section className="page-content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">Pessoas e estrutura</div>
          <h1>
            Equipe<span className="heading-period">.</span>
          </h1>
          <p>Quem faz parte do espaço de trabalho da empresa.</p>
        </div>
        <button className="button button-primary" onClick={onGoSettings}>
          <Plus size={16} /> Convidar pessoa
        </button>
      </div>
      <div className="team-summary">
        <div className="panel team-summary-card">
          <span className="stat-icon indigo">
            <Users size={18} />
          </span>
          <div>
            <b>{team.filter(m => m.active).length}</b>
            <small>pessoas ativas</small>
          </div>
        </div>
        <div className="panel team-summary-card">
          <span className="stat-icon amber">
            <Building2 size={18} />
          </span>
          <div>
            <b>{departments.length}</b>
            <small>departamentos</small>
          </div>
        </div>
      </div>
      <div className="panel table-panel">
        <div className="panel-head">
          <div>
            <div className="eyebrow">MEMBROS</div>
            <h2>Estrutura da empresa</h2>
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Nome</th>
                <th>E-mail</th>
                <th>Departamento</th>
                <th>Perfil</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {team.map(person => (
                <tr key={person.id}>
                  <td>
                    <span className="table-person">
                      <span className="user-avatar">
                        {person.name.slice(0, 1)}
                      </span>
                      <b>{person.name}</b>
                    </span>
                  </td>
                  <td>{person.email}</td>
                  <td>
                    {departments.find(dept => dept.id === person.departmentId)
                      ?.name ?? "—"}
                  </td>
                  <td>{roleLabels[person.role] ?? person.role}</td>
                  <td>
                    <span
                      className={`status-chip ${person.active ? "status-approved" : "status-rejected"}`}
                    >
                      {person.active ? "Ativo" : "Convite pendente"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {team.length === 0 && (
            <div className="empty-inline">
              <p>Convide a primeira pessoa da equipe nas configurações.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
