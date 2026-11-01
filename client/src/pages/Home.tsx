import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ArrowRight,
  Building2,
  CircleDot,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  Mail,
  Sparkles,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import OrbitWorkspace from "@/features/OrbitWorkspace";

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

function LoadingScreen() {
  return (
    <main className="auth-screen">
      <div className="auth-loader">
        <CircleDot className="brand-persweb" />
        <LoaderCircle className="spin" size={18} />
      </div>
      <p>Preparando seu espaço de trabalho…</p>
    </main>
  );
}

export default function Home() {
  const utils = trpc.useUtils();
  const auth = trpc.auth.me.useQuery(undefined, { retry: false });
  const authMode = trpc.auth.mode.useQuery(undefined, { retry: false });
  const signedIn = Boolean(auth.data);
  const tenantQuery = trpc.tenants.list.useQuery(undefined, {
    enabled: signedIn,
    retry: false,
  });
  const platform = trpc.tenants.platformOverview.useQuery(undefined, {
    enabled: signedIn && auth.data?.role === "admin",
    retry: false,
  });
  const createTenant = trpc.tenants.create.useMutation();
  const loginMutation = trpc.auth.login.useMutation();
  const registerMutation = trpc.auth.register.useMutation();
  const [authView, setAuthView] = useState<"login" | "register">("login");
  const [authName, setAuthName] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [companySlug, setCompanySlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [selectedTenantId, setSelectedTenantId] = useState<number | null>(null);
  const [consent, setConsent] = useState(() => localStorage.getItem("persweb-consent") === "1");

  useEffect(() => {
    const stored = Number(localStorage.getItem("persweb-active-tenant"));
    if (stored > 0) setSelectedTenantId(stored);
  }, []);

  const tenants = tenantQuery.data ?? [];
  useEffect(() => {
    if (!tenants.length) return;
    const host = window.location.hostname.toLowerCase();
    const hostMatch = tenants.find(
      t =>
        t.customDomain?.toLowerCase() === host ||
        host.startsWith(`${t.slug.toLowerCase()}.`)
    );
    const current = tenants.find(t => t.tenantId === selectedTenantId);
    const chosen = hostMatch ?? current ?? tenants[0];
    setSelectedTenantId(chosen.tenantId);
    localStorage.setItem("persweb-active-tenant", String(chosen.tenantId));
  }, [tenants, selectedTenantId]);

  const activeTenant = useMemo(
    () => tenants.find(t => t.tenantId === selectedTenantId),
    [tenants, selectedTenantId]
  );

  if (auth.isLoading || (signedIn && tenantQuery.isLoading))
    return <LoadingScreen />;
  if (!auth.data) {
    const localAuth = authMode.data?.localAuth ?? false;
    const registration = authMode.data?.registration ?? false;
    const submitAuth = async (event: FormEvent) => {
      event.preventDefault();
      try {
        const user =
          authView === "register"
            ? await registerMutation.mutateAsync({
                name: authName.trim(),
                email: authEmail.trim(),
                password: authPassword,
              })
            : await loginMutation.mutateAsync({
                email: authEmail.trim(),
                password: authPassword,
              });
        utils.auth.me.setData(undefined, user);
        setAuthPassword("");
        await tenantQuery.refetch();
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Não foi possível entrar agora."
        );
      }
    };
    const pending =
      loginMutation.isPending || registerMutation.isPending;
    return (
      <main className="auth-screen">
        <div className="auth-card">
          <div className="brand-lockup">
            <span className="brand-mark">
              <CircleDot size={25} />
              <i />
            </span>
            <span>
              persweb<span className="brand-rh">rh</span>
            </span>
          </div>
          <div className="auth-eyebrow">
            <Sparkles size={14} /> Pessoas, tempo e despesas em um só fluxo
          </div>
          <h1>
            O trabalho acontece.
            <br />
            <em>A gestão acompanha.</em>
          </h1>
          <p>
            Uma rotina mais clara para quem registra o dia e para quem cuida da
            equipe.
          </p>
          {localAuth ? (
            <>
              <div className="auth-tabs">
                <button
                  type="button"
                  className={authView === "login" ? "active" : ""}
                  onClick={() => setAuthView("login")}
                >
                  Entrar
                </button>
                {registration && (
                  <button
                    type="button"
                    className={authView === "register" ? "active" : ""}
                    onClick={() => setAuthView("register")}
                  >
                    Criar conta
                  </button>
                )}
              </div>
              <form className="form-stack auth-form" onSubmit={submitAuth}>
                {authView === "register" && (
                  <label>
                    Seu nome
                    <input
                      required
                      autoComplete="name"
                      maxLength={160}
                      value={authName}
                      onChange={event => setAuthName(event.target.value)}
                      placeholder="Como quer ser chamado?"
                    />
                  </label>
                )}
                <label>
                  E-mail
                  <div className="auth-field">
                    <Mail size={16} />
                    <input
                      required
                      type="email"
                      autoComplete="email"
                      maxLength={320}
                      value={authEmail}
                      onChange={event => setAuthEmail(event.target.value)}
                      placeholder="voce@empresa.com"
                    />
                  </div>
                </label>
                <label>
                  Senha
                  <div className="auth-field">
                    <KeyRound size={16} />
                    <input
                      required
                      type="password"
                      autoComplete={
                        authView === "register"
                          ? "new-password"
                          : "current-password"
                      }
                      minLength={8}
                      maxLength={200}
                      value={authPassword}
                      onChange={event => setAuthPassword(event.target.value)}
                      placeholder="Ao menos 8 caracteres"
                    />
                  </div>
                </label>
                <button
                  className="button button-primary button-wide"
                  disabled={pending}
                >
                  {pending ? (
                    <LoaderCircle className="spin" size={16} />
                  ) : authView === "register" ? (
                    <>
                      Criar minha conta <UserPlus size={16} />
                    </>
                  ) : (
                    <>
                      Entrar <ArrowRight size={16} />
                    </>
                  )}
                </button>
                {authView === "login" && registration && (
                  <button
                    type="button"
                    className="auth-link"
                    onClick={() => setAuthView("register")}
                  >
                    Ainda não tem conta? Cadastre sua empresa
                  </button>
                )}
              </form>
            </>
          ) : (
            <p className="auth-disabled">
              A autenticação local está desativada neste ambiente.
            </p>
          )}
          <div className="auth-secure">
            <LockKeyhole size={14} />{" "}
            {localAuth
              ? "Sessão protegida e dados separados por empresa"
              : "Acesso seguro com autenticação da plataforma"}
          </div>
        </div>
        <div className="auth-foot">
          Pers Web RH <span>•</span> Gestão humana, sem ruído
        </div>
      </main>
    );
  }

  if (tenantQuery.error)
    return (
      <main className="auth-screen">
        <div className="auth-card">
          <h1>Não foi possível carregar suas empresas.</h1>
          <p>{tenantQuery.error.message}</p>
          <button
            className="button button-primary"
            onClick={() => tenantQuery.refetch()}
          >
            Tentar novamente
          </button>
        </div>
      </main>
    );

  if (!activeTenant) {
    return (
      <main className="auth-screen setup-screen">
        <section className="setup-card">
          <div className="brand-lockup">
            <span className="brand-mark">
              <CircleDot size={25} />
              <i />
            </span>
            <span>
              persweb<span className="brand-rh">rh</span>
            </span>
          </div>
          <div className="auth-eyebrow">
            <Building2 size={14} /> Seu espaço começa aqui
          </div>
          <h1>
            Crie o espaço da
            <br />
            <em>sua empresa.</em>
          </h1>
          <p>
            Você será o administrador inicial. Convide a equipe quando estiver
            pronto.
          </p>
          <form
            onSubmit={async event => {
              event.preventDefault();
              try {
                const result = await createTenant.mutateAsync({
                  name: companyName.trim(),
                  slug: companySlug,
                });
                localStorage.setItem(
                  "persweb-active-tenant",
                  String(result.tenantId)
                );
                setSelectedTenantId(result.tenantId);
                await tenantQuery.refetch();
                toast.success("Empresa criada. Seu painel está pronto.");
              } catch (error) {
                toast.error(
                  error instanceof Error
                    ? error.message
                    : "Não foi possível criar a empresa."
                );
              }
            }}
            className="form-stack"
          >
            <label>
              Nome da empresa
              <input
                required
                maxLength={160}
                value={companyName}
                onChange={event => {
                  setCompanyName(event.target.value);
                  if (!slugTouched) setCompanySlug(slugify(event.target.value));
                }}
                placeholder="Ex.: Estúdio Aurora"
              />
            </label>
            <label>
              Identificador do espaço
              <div className="slug-input">
                <span>ID&nbsp;·</span>
                <input
                  required
                  minLength={3}
                  maxLength={80}
                  pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                  value={companySlug}
                  onChange={event => {
                    setSlugTouched(true);
                    setCompanySlug(slugify(event.target.value));
                  }}
                />
              </div>
              <small>Use letras minúsculas, números e hífen.</small>
            </label>
            <button
              className="button button-primary button-wide"
              disabled={createTenant.isPending}
            >
              {" "}
              {createTenant.isPending ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <>
                  Criar empresa <ArrowRight size={16} />
                </>
              )}
            </button>
          </form>
          {auth.data.role === "admin" && platform.data && (
            <div className="platform-summary">
              <b>Super Admin</b>
              <span>{platform.data.total} empresas na plataforma</span>
            </div>
          )}
          <div className="auth-secure">
            <LockKeyhole size={14} /> Dados separados por empresa
          </div>
        </section>
      </main>
    );
  }

  if (!consent && auth.data) {
    return (
      <main className="auth-screen">
        <div className="auth-card">
          <h1>Termos e privacidade</h1>
          <p>
            Ao usar o Pers Web RH, você concorda com o tratamento dos dados de
            ponto, equipe e despesas para fins de gestão de RH, conforme a LGPD.
          </p>
          <button
            className="button button-primary button-wide"
            onClick={() => {
              localStorage.setItem("persweb-consent", "1");
              setConsent(true);
            }}
          >
            Aceitar e continuar
          </button>
        </div>
      </main>
    );
  }

  return (
    <OrbitWorkspace
      user={auth.data}
      tenants={tenants}
      tenant={activeTenant}
      onSelectTenant={id => {
        setSelectedTenantId(id);
        localStorage.setItem("persweb-active-tenant", String(id));
      }}
    />
  );
}
