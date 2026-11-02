# Pers Web RH — Billing (InfinitePay Checkout Integrado)

Monetização SaaS com faturamento por banda de funcionários ativos, checkout
mensal único via InfinitePay e bloqueio automático de acesso em caso de
inadimplência (zero dias de tolerância).

## Regras comerciais

| Faixa (funcionários faturáveis) | Plano Técnico | Nome comercial | Preço/mês | Limite de assentos |
|---------------------------------|--------------|----------------|-----------|--------------------|
| 1–25                            | `starter`    | Essencial      | R$ 150,00 | 25                 |
| 26–50                           | `growth`     | Equipe         | R$ 280,00 | 50                 |
| 51–100                          | `business`   | Business       | R$ 450,00 | 100                |
| > 100                           | —            | Contactar vendas (sem preço automático) | sob consulta | customizada |

- **Funcionário faturável**: membership ativa (`active=1`) **com conta aceita**
  (`userId NOT NULL`) — convites pendentes, desativados e contas só-plataforma
  não contam.
- **Dedupe de faturas**: um novo checkout reutiliza uma fatura pendente do
  mesmo plano criada há menos de 15 minutos (evita links duplicados).
- **Renovação recuperada**: o `renew` honra um downgrade agendado
  (`pendingDowngrade` nas notas da assinatura) somente se o headcount caber na
  faixa.

## Trial e bloqueio

- Trial padrão de **14 dias** contados em `tenants.create` (configurável 0–90
  via `platform_settings.trial_days`, Super Admin).
- Extralimite: **zero dias de carência** (`GRACE_DAYS = 0`). No instante em que
  o período pago (ou trial) termina sem confirmação, o acesso é bloqueado
  (`PAYMENT_REQUIRED`). Reconciliação é preguiçosa, no ponto de chamada
  (`tenantAccess` — ver `server/billing/core.ts:resolveAccess`).
- **Blocos**: `blocked_trial_ended`, `blocked_payment_failed`,
  `blocked_period_ended`, `canceled`. Nestes estados, só o console de cobrança
  responde (`billing.overview`, etc.).
- **Período**: 30 dias UTC por pagamento confirmado; prorrogação/ativação é
  transacional e idempotente (`FOR UPDATE` na fatura).

## InfinitePay — como funciona

1. **Checkout**: `POST https://api.checkout.infinitepay.io/links` com header
   `X-Api-Key` (variável `INFINITEPAY_API_KEY`, somente servidor), pagamento
   único mensal (`single_payment`), métodos `credit_card` + `pix`.
2. **Verificação**: cada webhook é tratado como **não confiável** (a
   InfinitePay não documenta assinatura) e **sempre revalidado** com
   `POST /payment_check` antes de qualquer mudança de acesso.
3. **Webhook**: `POST /api/webhooks/infinitepay` — eventos
   `paid/settled`, `canceled`, `refunded`, `payment_failed`. Ele:
   - valida **valor pago ≥ faturado** (divergências geram evento
     `amount_mismatch` rejeitado e NÃO ativam);
   - registra **idempotência** em `billing_events` (chave
     `provider + externalId`) — replays não reativam nem estendem período;
   - eventos fora de ordem (ex. `canceled` antes de `paid`) não corrompem o
     estado: pagamentos confirmados ativam; cancelamentos de umal fatura paga
     não estornam acesso (só registrar `no_access_change`).
4. **Nenhuma ativação pela browser**: voltar da página de checkout ou clicar
   em "Verificar pagamento" apenas consulta o provedor no servidor.

### Modo simulado (sem credenciais)

Sem `INFINITEPAY_API_KEY`, o sistema opera em modo simulado: o checkout aponta
para `https://servidor/checkout/simulado?order=...`. Esse console **nunca
confirma pagamento sozinho**; só grava um evento de provedor simulado se
`BILLING_SIMULATION=1` (admin clica "Simular aprovação do provedor") e a
ativação continua seguindo o fluxo normal de verificação/revalidação.

```env
# .env
INFINITEPAY_API_KEY=cv-key-xxxxxxxx   # ausente => modo simulado
APP_PUBLIC_URL=                       # opcional; base do redirect_url/webhook
BILLING_SIMULATION=1                  #liga console de simulação (dev/testes)
```

## Endpoints tRPC (`/api/trpc/billing.*`)

- `plans` (público) — catálogo + `commercialThreshold: 100`.
- `overview` (membro) — status de acesso, plano, headcount, dias restantes,
  faturas, nota de recorrência.
- `startCheckout` (admin) — plano decidido no servidor pelo headcount real;
  >100 → `PRECONDITION_FAILED` (vendas).
- `checkPayment` (membro) — revalida fatura pendente no provedor e ativa.
- `simulateApproval` (admin, `BILLING_SIMULATION=1` e sem API key real).
- `renew` / `cancelSubscription` / `resumeSubscription` / `changePlan` (admin).
- `addons` / `toggleAddon` / `acceptTerms` (admin) — catálogo honesto de
  integrações (ERP ADP é candidato prioritário; preços "A definir").
- `platformBilling` / `adminOverride` / `setTrialDays` (Super Admin;
  `adminOverride` exige motivo e grava em `platform_audit_logs`).

## Proteções implementadas

- Chaves do InfinitePay **nunca** saem do servidor (varredura dos bundles do
  frontend passo e teste automatizado).
- Headcount/limite preventivo: convites
  (`inviteMember`) e importações CSV (`imports.commitCsv`) rejeitam acima do
  limite do plano.
- Isolamento por tenant: procedures de billing seguem `billingMember`
  (membro ativo) e mutações exigem `tenant_admin`.
- `terms_acceptances` registra aceite da `TERMS_VERSION`.
- Page `Home` troca o workspace por tela de assinatura quando o acesso está
  bloqueado; os dados do RH permanecem preservados.

## Testes (`server/billing.test.ts`, 20 casos)

Faixas 1/25/26/50/51/100/101 · preços do catálogo · checkout cria pedido
imprevisível (`pwrh_...`) e link · dedupe 15min · só-redirect não ativa ·
webhook sem confirmação não ativa · simulação+verificação ativa · webhook
duplicado idempotente · mismatch de valor recusado (caller e webhook) · pedido
desconhecido → 200/inerte · eventos fora de ordem · bloqueio quebra o RH mas
billing fica acessível · trial expirado com zero tolerância · isolamento ·
renovação (e negação no teste vivo) · downgrade reagendado · limite de assentos
(import e convite) · sem vazamento de segredos.

Rodar: `pnpm test` (requer MySQL, ver `.env`).

## Backup executado no início da fase

`/opt/backups/pre-billing-20261101-232000/` — código, banco, storage e hash
(`sha256sum -c SHA256SUMS`). Restore: `tar -xzf code.tar.gz -C /` e
`mysql orbitrh < database.sql`.
