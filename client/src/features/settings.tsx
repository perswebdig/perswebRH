import { useEffect, useState } from "react";
import {
  Building2,
  Check,
  CircleHelp,
  Pencil,
  Plus,
  Save,
  Settings2,
  ShieldCheck,
  UserPlus,
  Users,
  WalletCards,
  Clock3,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

export function AdminSettings({ tenantId }: { tenantId: number }) {
  const query = trpc.tenants.settings.useQuery({ tenantId });
  const updateCompany = trpc.tenants.update.useMutation();
  const companyProfile = trpc.tenants.companyProfile.useQuery({ tenantId });
  const updateCompanyProfile = trpc.tenants.updateCompanyProfile.useMutation();
  const ssoConfig = trpc.tenants.ssoConfig.useQuery({ tenantId });
  const saveSso = trpc.tenants.saveSsoConfig.useMutation();
  const testSso = trpc.tenants.testSsoConnection.useMutation();
  const updateWork = trpc.tenants.updateWorkSettings.useMutation();
  const addDepartment = trpc.tenants.addDepartment.useMutation();
  const renameDepartment = trpc.tenants.renameDepartment.useMutation();
  const deleteDepartment = trpc.tenants.deleteDepartment.useMutation();
  const invite = trpc.tenants.inviteMember.useMutation();
  const updateMember = trpc.tenants.updateMember.useMutation();
  const previewCsv = trpc.imports.previewCsv.useMutation();
  const commitCsv = trpc.imports.commitCsv.useMutation();
  const addCategory = trpc.tenants.addCategory.useMutation();
  const setCategoryActive = trpc.tenants.setCategoryActive.useMutation();
  const addRule = trpc.tenants.addApprovalRule.useMutation();
  const setRuleActive = trpc.tenants.setApprovalRuleActive.useMutation();
  const data = query.data;
  const [company, setCompany] = useState({
    name: "",
    customDomain: "",
    timezone: "America/Sao_Paulo",
    currency: "BRL",
  });
  const [work, setWork] = useState({
    dailyHours: 8,
    toleranceMinutes: 10,
    shiftStart: "09:00",
    markTypes: "Entrada, Saída, Intervalo",
    nonWorkingMarkTypes: "Intervalo",
    customFields: "Projeto, Centro de Custo",
    locations: "Escritório Central, Home Office",
  });
  const [departmentName, setDepartmentName] = useState("");
  const [editingDepartmentId, setEditingDepartmentId] = useState<number | null>(
    null
  );
  const [editingDepartmentName, setEditingDepartmentName] = useState("");
  const [member, setMember] = useState({
    name: "",
    email: "",
    role: "employee" as "employee" | "manager" | "finance" | "administrative",
    departmentId: "",
    managerMembershipId: "",
  });
  const [category, setCategory] = useState({ name: "", limitAmount: "" });
  const [rule, setRule] = useState({
    approverLabel: "Gestor direto",
    categoryId: "",
    assignedMembershipId: "",
    minAmount: "",
    maxAmount: "",
    priority: 10,
  });
  const [initialized, setInitialized] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [csvPreview, setCsvPreview] = useState<any>(null);
  const [profile, setProfile] = useState<Record<string, string>>({});
  const [sso, setSso] = useState({
    microsoftTenantId: "",
    clientId: "",
    clientSecret: "",
    redirectUri: "",
    allowedDomains: "",
    loginMode: "optional",
    jitProvisioning: false,
  });

  useEffect(() => {
    if (!data || initialized) return;
    setCompany({
      name: data.tenant?.name ?? "",
      customDomain: data.tenant?.customDomain ?? "",
      timezone: data.tenant?.timezone ?? "America/Sao_Paulo",
      currency: data.tenant?.currency ?? "BRL",
    });
    const p = companyProfile.data;
    if (p) {
      setProfile({
        legalName: p.legalName ?? "",
        cnpj: p.cnpj ?? "",
        corporateEmail: p.corporateEmail ?? "",
        phone: p.phone ?? "",
        website: p.website ?? "",
        addressCity: p.addressCity ?? "",
        addressState: p.addressState ?? "",
        adminContactName: p.adminContactName ?? "",
        adminContactEmail: p.adminContactEmail ?? "",
      });
    }
    const sc = ssoConfig.data;
    if (sc) {
      setSso({
        microsoftTenantId: sc.microsoftTenantId,
        clientId: sc.clientId,
        clientSecret: "",
        redirectUri: sc.redirectUri,
        allowedDomains: (sc.allowedDomains ?? []).join(", "),
        loginMode: "optional",
        jitProvisioning: Boolean(sc.jitProvisioning),
      });
    }
    setWork({
      dailyHours: Number(data.workSettings?.dailyHours ?? 8),
      toleranceMinutes: data.workSettings?.toleranceMinutes ?? 10,
      shiftStart: data.workSettings?.shiftStart ?? "09:00",
      markTypes: (data.workSettings?.markTypes ?? []).join(", "),
      nonWorkingMarkTypes: (
        data.workSettings?.nonWorkingMarkTypes ?? ["Intervalo"]
      ).join(", "),
      customFields: (data.workSettings?.customFields ?? []).join(", "),
      locations: (data.workSettings?.locations ?? []).join(", "),
    });
    setInitialized(true);
  }, [data, initialized]);

  if (query.isLoading || !data)
    return (
      <section className="page-content">
        <div className="panel empty-inline">
          Carregando configurações da empresa…
        </div>
      </section>
    );
  const saveCompany = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await updateCompany.mutateAsync({
        tenantId,
        ...company,
        customDomain: company.customDomain || null,
      });
      toast.success("Dados da empresa atualizados.");
      await query.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
    }
  };
  const saveWork = async (event: React.FormEvent) => {
    event.preventDefault();
    const split = (value: string) =>
      value
        .split(",")
        .map(v => v.trim())
        .filter(Boolean);
    try {
      await updateWork.mutateAsync({
        tenantId,
        dailyHours: Number(work.dailyHours),
        toleranceMinutes: Number(work.toleranceMinutes),
        shiftStart: work.shiftStart,
        markTypes: split(work.markTypes),
        nonWorkingMarkTypes: split(work.nonWorkingMarkTypes),
        customFields: split(work.customFields),
        locations: split(work.locations),
      });
      toast.success("Política de ponto salva.");
      await query.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
    }
  };
  const saveDepartment = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await addDepartment.mutateAsync({
        tenantId,
        name: departmentName.trim(),
      });
      setDepartmentName("");
      await query.refetch();
      toast.success("Departamento adicionado.");
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Falha ao criar departamento."
      );
    }
  };
  const saveDepartmentEdit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingDepartmentId) return;
    try {
      await renameDepartment.mutateAsync({
        tenantId,
        departmentId: editingDepartmentId,
        name: editingDepartmentName.trim(),
      });
      setEditingDepartmentId(null);
      setEditingDepartmentName("");
      await query.refetch();
      toast.success("Departamento atualizado.");
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Falha ao atualizar departamento."
      );
    }
  };
  const removeDepartment = async (departmentId: number) => {
    if (
      !window.confirm(
        "Remover este departamento? Os vínculos atuais serão mantidos sem departamento."
      )
    )
      return;
    try {
      await deleteDepartment.mutateAsync({ tenantId, departmentId });
      await query.refetch();
      toast.success("Departamento removido.");
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Falha ao remover departamento."
      );
    }
  };
  const saveMember = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await invite.mutateAsync({
        tenantId,
        name: member.name.trim(),
        email: member.email.trim(),
        role: member.role,
        departmentId: member.departmentId ? Number(member.departmentId) : null,
        managerMembershipId: member.managerMembershipId
          ? Number(member.managerMembershipId)
          : null,
      });
      setMember({ ...member, name: "", email: "" });
      await query.refetch();
      toast.success(
        "Convite criado. O acesso será vinculado quando a pessoa entrar com este e-mail."
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao criar convite.");
    }
  };
  const saveCategory = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await addCategory.mutateAsync({
        tenantId,
        name: category.name.trim(),
        limitAmount: category.limitAmount ? Number(category.limitAmount) : null,
      });
      setCategory({ name: "", limitAmount: "" });
      await query.refetch();
      toast.success("Categoria adicionada.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao criar categoria.");
    }
  };
  const saveRule = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await addRule.mutateAsync({
        tenantId,
        approverLabel: rule.approverLabel.trim(),
        categoryId: rule.categoryId ? Number(rule.categoryId) : null,
        assignedMembershipId: rule.assignedMembershipId
          ? Number(rule.assignedMembershipId)
          : null,
        minAmount: rule.minAmount ? Number(rule.minAmount) : null,
        maxAmount: rule.maxAmount ? Number(rule.maxAmount) : null,
        priority: Number(rule.priority),
      });
      await query.refetch();
      toast.success("Regra de aprovação criada.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao criar regra.");
    }
  };
  const saveMemberChanges = async (
    person: (typeof data.team)[number],
    patch: { role?: typeof member.role | "tenant_admin"; active?: boolean }
  ) => {
    try {
      await updateMember.mutateAsync({
        tenantId,
        membershipId: person.id,
        role: patch.role ?? person.role,
        departmentId: person.departmentId,
        managerMembershipId: person.managerMembershipId,
        active: patch.active ?? person.active !== 0,
      });
      await query.refetch();
      toast.success("Vínculo atualizado.");
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Não foi possível atualizar o vínculo."
      );
    }
  };
  const toggleCategory = async (id: number, active: boolean) => {
    try {
      await setCategoryActive.mutateAsync({
        tenantId,
        categoryId: id,
        active: !active,
      });
      await query.refetch();
    } catch (e) {
      toast.error(
        e instanceof Error
          ? e.message
          : "Não foi possível atualizar a categoria."
      );
    }
  };
  const toggleRule = async (id: number, active: boolean) => {
    try {
      await setRuleActive.mutateAsync({
        tenantId,
        ruleId: id,
        active: !active,
      });
      await query.refetch();
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Não foi possível atualizar a regra."
      );
    }
  };
  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await updateCompanyProfile.mutateAsync({
        tenantId,
        legalName: profile.legalName || null,
        cnpj: profile.cnpj || null,
        corporateEmail: profile.corporateEmail || null,
        phone: profile.phone || null,
        website: profile.website || null,
        addressCity: profile.addressCity || null,
        addressState: profile.addressState || null,
        adminContactName: profile.adminContactName || null,
        adminContactEmail: profile.adminContactEmail || null,
      });
      toast.success("Perfil empresarial atualizado.");
      await companyProfile.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar perfil.");
    }
  };
  const saveSsoForm = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await saveSso.mutateAsync({
        tenantId,
        microsoftTenantId: sso.microsoftTenantId,
        clientId: sso.clientId,
        clientSecret: sso.clientSecret || undefined,
        redirectUri: sso.redirectUri,
        allowedDomains: sso.allowedDomains
          .split(",")
          .map(v => v.trim())
          .filter(Boolean),
        loginMode: "optional",
        jitProvisioning: sso.jitProvisioning,
      });
      toast.success("Configuração SSO salva.");
      await ssoConfig.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar SSO.");
    }
  };
  const runPreview = async () => {
    try {
      const result = await previewCsv.mutateAsync({ tenantId, csvText });
      setCsvPreview(result);
      toast.success(`Prévia: ${result.valid} válidas, ${result.invalid} inválidas.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha na prévia.");
    }
  };
  const runCommit = async () => {
    try {
      const result = await commitCsv.mutateAsync({ tenantId, csvText });
      toast.success(`Importação concluída: ${result.created} criados, ${result.skipped} ignorados.`);
      await query.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha na importação.");
    }
  };
  const managerOptions = data.team.filter(
    person =>
      person.active &&
      (person.role === "manager" || person.role === "tenant_admin")
  );
  const approverOptions = data.team.filter(
    person => person.active && person.role !== "employee"
  );
  return (
    <section className="page-content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">ADMINISTRAÇÃO DO TENANT</div>
          <h1>
            Configurações<span className="heading-period">.</span>
          </h1>
          <p>As regras deste espaço valem apenas para {data.tenant?.name}.</p>
        </div>
        <span className="settings-shield">
          <ShieldCheck size={17} /> Admin da empresa
        </span>
      </div>
      <div className="settings-layout">
        <aside className="settings-index">
          <a href="#company">
            <Building2 size={15} /> Empresa
          </a>
          <a href="#company-profile">
            <Building2 size={15} /> Perfil empresarial
          </a>
          <a href="#sso">
            <ShieldCheck size={15} /> SSO Microsoft
          </a>
          <a href="#work-policy">
            <Clock3 size={15} /> Ponto e jornada
          </a>
          <a href="#team-settings">
            <Users size={15} /> Equipe
          </a>
          <a href="#import">
            <Users size={15} /> Importação
          </a>
          <a href="#expense-settings">
            <WalletCards size={15} /> Reembolsos
          </a>
        </aside>
        <div className="settings-content">
          <section className="panel settings-panel" id="company">
            <div className="settings-panel-head">
              <span className="settings-icon">
                <Building2 size={18} />
              </span>
              <div>
                <h2>Identidade da empresa</h2>
                <p>Nome e contexto regional do espaço.</p>
              </div>
            </div>
            <form className="settings-form" onSubmit={saveCompany}>
              <label>
                Nome da empresa
                <input
                  required
                  maxLength={160}
                  value={company.name}
                  onChange={e =>
                    setCompany({ ...company, name: e.target.value })
                  }
                />
              </label>
              <div className="form-two">
                <label>
                  Domínio próprio (opcional)
                  <input
                    maxLength={255}
                    value={company.customDomain}
                    onChange={e =>
                      setCompany({ ...company, customDomain: e.target.value })
                    }
                    placeholder="rh.suaempresa.com.br"
                  />
                  <small>
                    Requer configuração de DNS e publicação do domínio.
                  </small>
                </label>
                <label>
                  Fuso horário
                  <select
                    value={company.timezone}
                    onChange={e =>
                      setCompany({ ...company, timezone: e.target.value })
                    }
                  >
                    <option value="America/Sao_Paulo">
                      Brasília (America/Sao_Paulo)
                    </option>
                    <option value="America/Manaus">
                      Manaus (America/Manaus)
                    </option>
                    <option value="America/Rio_Branco">
                      Rio Branco (America/Rio_Branco)
                    </option>
                    <option value="America/Fortaleza">
                      Fortaleza (America/Fortaleza)
                    </option>
                    <option value="UTC">UTC</option>
                  </select>
                </label>
              </div>
              <div className="form-two">
                <label>
                  Moeda
                  <select
                    value={company.currency}
                    onChange={e =>
                      setCompany({ ...company, currency: e.target.value })
                    }
                  >
                    <option value="BRL">BRL · Real brasileiro</option>
                    <option value="USD">USD · Dólar americano</option>
                    <option value="EUR">EUR · Euro</option>
                  </select>
                </label>
                <span className="settings-help">
                  <CircleHelp size={15} /> O identificador do tenant é{" "}
                  <b>{data.tenant?.slug}</b>.
                </span>
              </div>
              <button
                className="button button-primary"
                disabled={updateCompany.isPending}
              >
                <Save size={15} /> Salvar empresa
              </button>
            </form>
          </section>
          <section className="panel settings-panel" id="company-profile">
            <div className="settings-panel-head">
              <span className="settings-icon"><Building2 size={18} /></span>
              <div>
                <h2>Perfil empresarial completo</h2>
                <p>Dados cadastrais, contato e endereço da empresa.</p>
              </div>
            </div>
            <form className="settings-form" onSubmit={saveProfile}>
              <div className="form-two">
                <label>Razão social<input value={profile.legalName ?? ""} onChange={e => setProfile({ ...profile, legalName: e.target.value })} /></label>
                <label>CNPJ<input value={profile.cnpj ?? ""} onChange={e => setProfile({ ...profile, cnpj: e.target.value })} placeholder="00.000.000/0000-00" /></label>
              </div>
              <div className="form-two">
                <label>E-mail corporativo<input value={profile.corporateEmail ?? ""} onChange={e => setProfile({ ...profile, corporateEmail: e.target.value })} /></label>
                <label>Telefone<input value={profile.phone ?? ""} onChange={e => setProfile({ ...profile, phone: e.target.value })} /></label>
              </div>
              <div className="form-two">
                <label>Site<input value={profile.website ?? ""} onChange={e => setProfile({ ...profile, website: e.target.value })} /></label>
                <label>Cidade<input value={profile.addressCity ?? ""} onChange={e => setProfile({ ...profile, addressCity: e.target.value })} /></label>
              </div>
              <div className="form-two">
                <label>UF<input maxLength={2} value={profile.addressState ?? ""} onChange={e => setProfile({ ...profile, addressState: e.target.value })} /></label>
                <label>Contato administrativo<input value={profile.adminContactName ?? ""} onChange={e => setProfile({ ...profile, adminContactName: e.target.value })} /></label>
              </div>
              <label>E-mail do contato administrativo<input value={profile.adminContactEmail ?? ""} onChange={e => setProfile({ ...profile, adminContactEmail: e.target.value })} /></label>
              <button className="button button-primary" disabled={updateCompanyProfile.isPending}><Save size={15} /> Salvar perfil empresarial</button>
            </form>
          </section>
          <section className="panel settings-panel" id="sso">
            <div className="settings-panel-head">
              <span className="settings-icon"><ShieldCheck size={18} /></span>
              <div>
                <h2>SSO Microsoft (Entra ID)</h2>
                <p>Configuração por empresa. Segredos são enviados apenas ao servidor.</p>
              </div>
            </div>
            <form className="settings-form" onSubmit={saveSsoForm}>
              <label>Tenant ID Microsoft<input required value={sso.microsoftTenantId} onChange={e => setSso({ ...sso, microsoftTenantId: e.target.value })} /></label>
              <label>Client ID<input required value={sso.clientId} onChange={e => setSso({ ...sso, clientId: e.target.value })} /></label>
              <label>Client Secret (deixe em branco para manter)<input type="password" value={sso.clientSecret} onChange={e => setSso({ ...sso, clientSecret: e.target.value })} /></label>
              <label>Redirect URI<input required value={sso.redirectUri} onChange={e => setSso({ ...sso, redirectUri: e.target.value })} /></label>
              <label>Domínios corporativos (vírgula)<input value={sso.allowedDomains} onChange={e => setSso({ ...sso, allowedDomains: e.target.value })} /></label>
              <div className="form-two">
                <label>Modo de login<select value="optional" disabled><option value="optional">Opcional — e-mail sempre disponível</option></select></label>
                <label><input type="checkbox" checked={sso.jitProvisioning} onChange={e => setSso({ ...sso, jitProvisioning: e.target.checked })} /> Provisionamento just-in-time</label>
              </div>
              <div className="form-two">
                <button className="button button-primary" disabled={saveSso.isPending}><Save size={15} /> Salvar SSO</button>
                <button type="button" className="button button-outline" disabled={testSso.isPending} onClick={() => void testSso.mutateAsync({ tenantId }).then(r => toast.success(`OIDC OK: ${r.issuer}`)).catch(e => toast.error(e instanceof Error ? e.message : "Falha no teste"))}>Testar conexão</button>
              </div>
            </form>
          </section>
          <section className="panel settings-panel" id="import">
            <div className="settings-panel-head">
              <span className="settings-icon"><Users size={18} /></span>
              <div>
                <h2>Importação de pessoas (CSV)</h2>
                <p>Modelo: name,email,role,department. Prévia antes de gravar.</p>
              </div>
            </div>
            <div className="settings-form">
              <label>
                Arquivo CSV
                <textarea rows={6} value={csvText} onChange={e => setCsvText(e.target.value)} placeholder="name,email,role,department" />
              </label>
              <div className="form-two">
                <button type="button" className="button button-outline" onClick={() => void runPreview()} disabled={previewCsv.isPending}>Pré-visualizar</button>
                <button type="button" className="button button-primary" onClick={() => void runCommit()} disabled={commitCsv.isPending || !csvText}>Importar</button>
              </div>
              {csvPreview && (
                <div className="empty-inline">
                  Colunas: {csvPreview.headers.join(", ")} · Válidas: {csvPreview.valid} · Inválidas: {csvPreview.invalid}
                </div>
              )}
            </div>
          </section>
          <section className="panel settings-panel" id="work-policy">
            <div className="settings-panel-head">
              <span className="settings-icon indigo">
                <Clock3 size={18} />
              </span>
              <div>
                <h2>Jornada e marcações</h2>
                <p>Parâmetros usados pela equipe ao registrar faixas.</p>
              </div>
            </div>
            <form className="settings-form" onSubmit={saveWork}>
              <div className="form-three">
                <label>
                  Horas esperadas por dia
                  <input
                    type="number"
                    step="0.25"
                    min="1"
                    max="24"
                    value={work.dailyHours}
                    onChange={e =>
                      setWork({ ...work, dailyHours: Number(e.target.value) })
                    }
                  />
                </label>
                <label>
                  Tolerância de atraso (min)
                  <input
                    type="number"
                    min="0"
                    max="180"
                    value={work.toleranceMinutes}
                    onChange={e =>
                      setWork({
                        ...work,
                        toleranceMinutes: Number(e.target.value),
                      })
                    }
                  />
                </label>
                <label>
                  Início padrão
                  <input
                    type="time"
                    value={work.shiftStart}
                    onChange={e =>
                      setWork({ ...work, shiftStart: e.target.value })
                    }
                  />
                </label>
              </div>
              <label>
                Tipos de marcação
                <input
                  value={work.markTypes}
                  onChange={e =>
                    setWork({ ...work, markTypes: e.target.value })
                  }
                />
                <small>Separe os tipos por vírgula.</small>
              </label>
              <label>
                Tipos que não contam como trabalho
                <input
                  value={work.nonWorkingMarkTypes}
                  onChange={e =>
                    setWork({ ...work, nonWorkingMarkTypes: e.target.value })
                  }
                  placeholder="Ex.: Intervalo, Pausa"
                />
                <small>
                  Informe somente tipos já cadastrados; cada faixa mantém essa
                  regra histórica mesmo se a política mudar depois.
                </small>
              </label>
              <label>
                Campos personalizados
                <input
                  value={work.customFields}
                  onChange={e =>
                    setWork({ ...work, customFields: e.target.value })
                  }
                />
                <small>Ex.: Projeto, Centro de Custo, Cliente.</small>
              </label>
              <label>
                Locais pré-cadastrados
                <input
                  value={work.locations}
                  onChange={e =>
                    setWork({ ...work, locations: e.target.value })
                  }
                />
                <small>
                  O funcionário poderá escolher um local ou capturar GPS.
                </small>
              </label>
              <button
                className="button button-primary"
                disabled={updateWork.isPending}
              >
                <Save size={15} /> Salvar política de ponto
              </button>
            </form>
          </section>
          <section className="panel settings-panel" id="team-settings">
            <div className="settings-panel-head">
              <span className="settings-icon amber">
                <Users size={18} />
              </span>
              <div>
                <h2>Equipe e departamentos</h2>
                <p>Convites associados ao tenant e à hierarquia da empresa.</p>
              </div>
            </div>
            <form className="settings-inline-form" onSubmit={saveDepartment}>
              <label>
                Novo departamento
                <div className="inline-input">
                  <input
                    required
                    maxLength={120}
                    value={departmentName}
                    onChange={e => setDepartmentName(e.target.value)}
                    placeholder="Ex.: Produto"
                  />
                  <button
                    className="button button-outline"
                    disabled={addDepartment.isPending}
                  >
                    <Plus size={15} />
                  </button>
                </div>
              </label>
            </form>
            <div className="department-list">
              {data.departments.map(dept =>
                editingDepartmentId === dept.id ? (
                  <form
                    className="department-edit-row"
                    key={dept.id}
                    onSubmit={event => void saveDepartmentEdit(event)}
                  >
                    <input
                      aria-label="Nome do departamento"
                      required
                      maxLength={120}
                      value={editingDepartmentName}
                      onChange={event =>
                        setEditingDepartmentName(event.target.value)
                      }
                    />
                    <button
                      className="icon-button"
                      aria-label="Salvar departamento"
                      disabled={renameDepartment.isPending}
                    >
                      <Check size={15} />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="Cancelar edição"
                      onClick={() => setEditingDepartmentId(null)}
                    >
                      <X size={15} />
                    </button>
                  </form>
                ) : (
                  <div className="department-row" key={dept.id}>
                    <span className="category-chip">{dept.name}</span>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Editar ${dept.name}`}
                      onClick={() => {
                        setEditingDepartmentId(dept.id);
                        setEditingDepartmentName(dept.name);
                      }}
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      type="button"
                      className="icon-button danger"
                      aria-label={`Remover ${dept.name}`}
                      disabled={deleteDepartment.isPending}
                      onClick={() => void removeDepartment(dept.id)}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                )
              )}
              {!data.departments.length && (
                <small>Nenhum departamento cadastrado.</small>
              )}
            </div>
            <div className="settings-divider" />
            <form className="settings-form" onSubmit={saveMember}>
              <div className="form-two">
                <label>
                  Nome
                  <input
                    required
                    maxLength={160}
                    value={member.name}
                    onChange={e =>
                      setMember({ ...member, name: e.target.value })
                    }
                    placeholder="Nome completo"
                  />
                </label>
                <label>
                  E-mail de acesso
                  <input
                    required
                    type="email"
                    maxLength={320}
                    value={member.email}
                    onChange={e =>
                      setMember({ ...member, email: e.target.value })
                    }
                    placeholder="pessoa@empresa.com.br"
                  />
                </label>
              </div>
              <div className="form-three">
                <label>
                  Perfil
                  <select
                    value={member.role}
                    onChange={e =>
                      setMember({
                        ...member,
                        role: e.target.value as typeof member.role,
                      })
                    }
                  >
                    <option value="employee">Funcionário</option>
                    <option value="manager">Gestor</option>
                    <option value="finance">Financeiro</option>
                    <option value="administrative">Administrativo</option>
                  </select>
                </label>
                <label>
                  Departamento
                  <select
                    value={member.departmentId}
                    onChange={e =>
                      setMember({ ...member, departmentId: e.target.value })
                    }
                  >
                    <option value="">Sem departamento</option>
                    {data.departments.map(dept => (
                      <option key={dept.id} value={dept.id}>
                        {dept.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Gestor direto
                  <select
                    value={member.managerMembershipId}
                    onChange={e =>
                      setMember({
                        ...member,
                        managerMembershipId: e.target.value,
                      })
                    }
                  >
                    <option value="">Sem gestor atribuído</option>
                    {managerOptions.map(person => (
                      <option key={person.id} value={person.id}>
                        {person.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <button
                className="button button-primary"
                disabled={invite.isPending}
              >
                <UserPlus size={15} /> Criar convite
              </button>
            </form>
            <div className="table-scroll mini-table">
              <table>
                <thead>
                  <tr>
                    <th>Pessoa</th>
                    <th>Perfil</th>
                    <th>Vínculo</th>
                  </tr>
                </thead>
                <tbody>
                  {data.team.map(person => (
                    <tr key={person.id}>
                      <td>
                        <b>{person.name}</b>
                        <small>{person.email}</small>
                      </td>
                      <td>
                        <select
                          className="member-role-select"
                          value={person.role}
                          onChange={event =>
                            void saveMemberChanges(person, {
                              role: event.target.value as
                                | typeof member.role
                                | "tenant_admin",
                            })
                          }
                        >
                          <option value="employee">Funcionário</option>
                          <option value="manager">Gestor</option>
                          <option value="finance">Financeiro</option>
                          <option value="administrative">Administrativo</option>
                          <option value="tenant_admin">Admin do Tenant</option>
                        </select>
                      </td>
                      <td className="member-status-cell">
                        {person.active === 0 ? (
                          <span className="status-chip status-rejected">
                            Desativado
                          </span>
                        ) : person.joinedAt ? (
                          <span className="status-chip status-approved">
                            Ativo
                          </span>
                        ) : (
                          <span className="status-chip status-submitted">
                            Convite pendente
                          </span>
                        )}
                        <button
                          type="button"
                          className="quiet-action"
                          onClick={() =>
                            void saveMemberChanges(person, {
                              active: person.active === 0,
                            })
                          }
                          disabled={updateMember.isPending}
                        >
                          {person.active === 0 ? "Reativar" : "Desativar"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="panel settings-panel" id="expense-settings">
            <div className="settings-panel-head">
              <span className="settings-icon violet">
                <WalletCards size={18} />
              </span>
              <div>
                <h2>Política de reembolso</h2>
                <p>Categorias e responsáveis por valor ou tipo de despesa.</p>
              </div>
            </div>
            <form className="settings-inline-form" onSubmit={saveCategory}>
              <div className="form-two">
                <label>
                  Nova categoria
                  <input
                    required
                    maxLength={120}
                    value={category.name}
                    onChange={e =>
                      setCategory({ ...category, name: e.target.value })
                    }
                    placeholder="Ex.: Alimentação"
                  />
                </label>
                <label>
                  Limite por categoria no pedido (opcional)
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={category.limitAmount}
                    onChange={e =>
                      setCategory({ ...category, limitAmount: e.target.value })
                    }
                    placeholder="R$ 0,00"
                  />
                  <small>
                    O sistema soma os itens desta categoria em cada solicitação.
                  </small>
                </label>
              </div>
              <button
                className="button button-outline"
                disabled={addCategory.isPending}
              >
                <Plus size={15} /> Adicionar categoria
              </button>
            </form>
            <div className="policy-entity-list">
              {data.categories.map(cat => (
                <div className="policy-entity-row" key={cat.id}>
                  <span>
                    <b>{cat.name}</b>
                    <small>
                      {cat.limitAmount
                        ? `Limite por item: ${Number(cat.limitAmount).toLocaleString("pt-BR", { style: "currency", currency: data.tenant?.currency ?? "BRL" })}`
                        : "Sem limite por item"}
                    </small>
                  </span>
                  <span
                    className={`status-chip ${cat.active ? "status-approved" : "status-rejected"}`}
                  >
                    {cat.active ? "Ativa" : "Inativa"}
                  </span>
                  <button
                    type="button"
                    className="quiet-action"
                    onClick={() =>
                      void toggleCategory(cat.id, Boolean(cat.active))
                    }
                    disabled={setCategoryActive.isPending}
                  >
                    {cat.active ? "Desativar" : "Ativar"}
                  </button>
                </div>
              ))}
              {!data.categories.length && (
                <small>Nenhuma categoria cadastrada.</small>
              )}
            </div>
            <div className="settings-divider" />
            <form className="settings-form" onSubmit={saveRule}>
              <h3>Nova regra de aprovação</h3>
              <div className="form-two">
                <label>
                  Responsável / etapa
                  <input
                    required
                    maxLength={100}
                    value={rule.approverLabel}
                    onChange={e =>
                      setRule({ ...rule, approverLabel: e.target.value })
                    }
                    placeholder="Ex.: Gestor direto"
                  />
                </label>
                <label>
                  Categoria (opcional)
                  <select
                    value={rule.categoryId}
                    onChange={e =>
                      setRule({ ...rule, categoryId: e.target.value })
                    }
                  >
                    <option value="">Todas as categorias</option>
                    {data.categories
                      .filter(cat => cat.active)
                      .map(cat => (
                        <option value={cat.id} key={cat.id}>
                          {cat.name}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
              <div className="form-three">
                <label>
                  Valor mínimo
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={rule.minAmount}
                    onChange={e =>
                      setRule({ ...rule, minAmount: e.target.value })
                    }
                    placeholder="Sem mínimo"
                  />
                </label>
                <label>
                  Valor máximo
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={rule.maxAmount}
                    onChange={e =>
                      setRule({ ...rule, maxAmount: e.target.value })
                    }
                    placeholder="Sem máximo"
                  />
                </label>
                <label>
                  Ordem de prioridade
                  <input
                    type="number"
                    min="1"
                    max="1000"
                    value={rule.priority}
                    onChange={e =>
                      setRule({ ...rule, priority: Number(e.target.value) })
                    }
                  />
                </label>
              </div>
              <label>
                Responsável específico (opcional)
                <select
                  value={rule.assignedMembershipId}
                  onChange={e =>
                    setRule({ ...rule, assignedMembershipId: e.target.value })
                  }
                >
                  <option value="">Resolver pelo nome da etapa</option>
                  {approverOptions.map(person => (
                    <option key={person.id} value={person.id}>
                      {person.name} · {person.role}
                    </option>
                  ))}
                </select>
                <small>
                  Sem pessoa específica, “Gestor” usa o gestor direto;
                  Financeiro/Administrativo procura o perfil correspondente e,
                  se não houver, direciona ao Admin do Tenant.
                </small>
              </label>
              <button
                className="button button-primary"
                disabled={addRule.isPending}
              >
                <Plus size={15} /> Adicionar regra
              </button>
            </form>
            <div className="approval-rule-list">
              {data.approvalRules.map(ruleRow => (
                <div className="approval-rule-row" key={ruleRow.id}>
                  <span className="settings-icon">
                    <Settings2 size={16} />
                  </span>
                  <span>
                    <b>{ruleRow.approverLabel}</b>
                    <small>
                      {ruleRow.categoryId
                        ? (data.categories.find(
                            c => c.id === ruleRow.categoryId
                          )?.name ?? "Categoria")
                        : "Todas as categorias"}{" "}
                      ·{" "}
                      {ruleRow.minAmount
                        ? `a partir de ${ruleRow.minAmount}`
                        : "qualquer valor"}
                      {ruleRow.maxAmount ? ` até ${ruleRow.maxAmount}` : ""}
                    </small>
                  </span>
                  <span className="count-pill">#{ruleRow.priority}</span>
                  <button
                    type="button"
                    className="quiet-action"
                    onClick={() =>
                      void toggleRule(ruleRow.id, Boolean(ruleRow.active))
                    }
                    disabled={setRuleActive.isPending}
                  >
                    {ruleRow.active ? "Desativar" : "Ativar"}
                  </button>
                </div>
              ))}
              {!data.approvalRules.length && (
                <p className="settings-help">
                  Sem regra específica: solicitações seguem para a administração
                  da empresa.
                </p>
              )}
            </div>
          </section>
          <div className="notice notice-info">
            <ShieldCheck size={16} />
            <span>
              Todo registro de equipe, ponto, categoria e aprovação é consultado
              dentro do tenant autenticado. Domínios personalizados exigem
              configuração de DNS e não são ativados automaticamente.
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
