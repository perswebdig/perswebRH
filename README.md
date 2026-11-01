# Pers Web RH

SaaS multi-tenant de recursos humanos com módulos de frequência/ponto e reembolso de despesas. Frontend React/TypeScript e backend Express/tRPC; persistência relacional MySQL/Drizzle. A aplicação usa autenticação local por e-mail e senha e armazenamento local de arquivos.

## Funcionalidades

- Empresas (tenants), vínculos com papéis, departamentos e configuração individual por empresa.
- Ponto em faixas independentes, vários períodos por dia, tipo de marcação configurável, atividade, projeto, centro de custo, campos personalizados e local pré-cadastrado ou GPS.
- Folha pessoal semanal e consulta mensal; gestor pode revisar folhas da equipe.
- Relatórios com filtro de período/equipe, agregação por pessoa e projeto/atividade, exportação CSV e impressão em PDF.
- Reembolso com rascunhos, itens, categorias e limites, recibos JPG/PNG/WebP/PDF de até 5 MB, documento consolidado imprimível, regras de aprovação e registro de pagamento.
- Papéis de tenant: Admin, Gestor, Funcionário, Financeiro e Administrativo; visão de Super Admin depende do papel de proprietário fornecido pelo starter.
- Histórico de ações operacionais e checagem de tenant e papel no servidor.

## Requisitos

Node.js compatível com o projeto, `pnpm` 10.18.0 e um MySQL para desenvolvimento local. Em Cloud/Preview, o projeto já está ligado ao banco, servidor e object storage gerenciados. Não use o banco compartilhado de Preview para testes destrutivos: desenvolvimento, testes e publicação compartilham a mesma base.

## Instalação e execução local

```bash
pnpm install --frozen-lockfile
cp .env.example .env
# Preencha as variáveis necessárias para a infraestrutura que você configurou.
pnpm db:migrate
pnpm dev
```

Para compilar e servir a versão de produção local:

```bash
pnpm check
pnpm test
pnpm build
pnpm start
```

O servidor usa `PORT` quando fornecida (padrão 3000). `pnpm db:migrate` aplica migrations já versionadas. `pnpm db:push` gera migration a partir do schema Drizzle e aplica as migrations pendentes; revise o SQL gerado antes de executar em uma base que contenha dados importantes.

## Variáveis de ambiente

Use `.env.example` como referência; nunca inclua credenciais reais no Git ou no bundle do navegador.

- `DATABASE_URL`: DSN MySQL de desenvolvimento local; no ambiente gerenciado, é fornecida pela plataforma.
- `APP_SECRET`: segredo usado para assinar a sessão JWT local.
- `STORAGE_DIR`: diretório local para recibos e arquivos (padrão `data/storage`).
- `OWNER_OPEN_ID`: compatibilidade opcional do starter para identificar o proprietário. Não é um substituto para autorização de tenant.
- `PORT`: porta local/produção do processo.

O primeiro usuário cadastrado se torna administrador da plataforma. A sessão usa JWT no cookie `webdev_app_session`; em HTTP local o cookie é `SameSite=Lax`.

## Banco de dados e modelo

`drizzle/schema.ts` define as entidades e `drizzle/` guarda as migrations. Cada tabela operacional possui `tenantId`; usuários de OAuth são identidades globais, vinculadas a uma empresa por `memberships`. Procedimentos tRPC validam o vínculo ativo e escopam consultas pelo tenant autorizado, além de validar identificadores de registros dentro do mesmo tenant.

O schema inclui tenants, memberships, departamentos, configuração de ponto, períodos e faixas, categorias, regras de aprovação, solicitações, itens, anexos, etapas de aprovação e auditoria. Índices de consulta começam por tenant nas áreas operacionais.

## Organização do código

- `client/src/features/attendance.tsx`: ponto, folha semanal/mensal e fluxo de aprovação.
- `client/src/features/reimbursements.tsx`: rascunhos, itens, anexos, nota consolidada e pagamento.
- `client/src/features/settings.tsx`: tenant, jornada, equipe, departamentos, categorias e regras.
- `server/routers.ts`: composição do router tRPC raiz; `server/routers/tenants.ts`, `attendance.ts` e `reimbursements.ts`: APIs por domínio; `shared.ts`: autorização, membership, períodos, auditoria e helpers.
- `drizzle/schema.ts` e `drizzle/*.sql`: estrutura relacional e migrations versionadas.
- `client/public/`: marca e manifesto de rotas; `README.md` e `.env.example`: operação e ambiente.

## Papéis e guia de uso

1. Cadastre a primeira conta administradora.
2. Se ainda não tiver vínculo, crie uma empresa e torne-se Admin do Tenant.
3. No painel de Configurações, defina fuso/moeda, jornada, tolerância, tipos de marcação e quais tipos não contam como trabalho (por exemplo, “Pausa”), locais e campos; gerencie departamentos, convites, categorias, limites agregados por categoria no pedido e regras de aprovação.
4. A pessoa convidada entra com o mesmo endereço de e-mail do convite e define sua senha.
5. Funcionários registram uma ou mais faixas, selecionam local ou capturam GPS e enviam a folha semanal para revisão. A visualização mensal é informativa; a aprovação continua agrupada por semana.
6. O funcionário cria um rascunho de reembolso, adiciona itens e recibos e envia. O responsável vê a fila no próprio painel, aprova ou rejeita com justificativa; o último aprovador designado pela regra (ou Admin do Tenant) registra o pagamento após aprovação.
7. CSV é baixado no navegador; “Salvar PDF” abre a impressão do navegador, que permite salvar como PDF.

## Segurança e proteção de dados

- Validação Zod nos inputs tRPC, consultas parametrizadas do Drizzle, autorização server-side por sessão, papel e associação ao tenant. React escapa texto por padrão; HTML arbitrário não é renderizado.
- Os recibos são validados por tipo e assinatura do arquivo, limitados a 5 MB e criptografados no servidor com AES-256-GCM antes do object storage. A chave é derivada server-side do segredo de sessão do projeto. A interface não recebe URLs públicas dos objetos; o download exige autorização e descriptografa apenas após essa checagem.
- Nomes, e-mails, coordenadas e demais campos relacionais não recebem criptografia campo-a-campo nesta versão. Não armazene dados bancários, documentos de identidade ou dados sensíveis desnecessários. Use os controles de acesso, TLS e proteção em repouso oferecidos pelos serviços gerenciados da plataforma.
- A chave derivada não vai ao navegador. Se a chave de sessão do projeto for rotacionada, os recibos existentes precisarão ser recriptografados antes da troca para manter sua leitura.
- O armazenamento runtime não oferece exclusão física via helper; excluir um registro de aplicação não garante apagar bytes de object storage. Planeje retenção e remoção de objetos pelo processo administrativo de storage.
- O fluxo de responsável é uma fila interna da aplicação; não há envio de e-mail transacional configurado nesta versão.

## Domínios, publicação e limites operacionais

O identificador de tenant é único. A resolução pelo host usa o domínio próprio salvo no tenant ou um subdomínio cujo prefixo corresponda ao identificador, quando DNS e hospedagem apontarem para este app. Registrar o domínio, configurar DNS/TLS, autorizar o callback OAuth e publicar o app são passos externos; informar o domínio no painel não os executa. A configuração de domínio não deve ser considerada ativa até esses passos estarem concluídos.

Os indicadores de ausência são uma estimativa de dias úteis (segunda a sexta) sem faixa registrada. A métrica de atraso considera a primeira faixa de trabalho no fuso do tenant e desconta o horário de início e a tolerância configurados. Não há nesta versão cadastro de feriados, férias, licenças ou justificativas; o indicador de ausência não substitui um módulo de afastamentos. Horas extras são estimadas acima das horas diárias configuradas, sem banco de horas, adicional legal ou apuração trabalhista.

## Estrutura principal

- `client/src/pages/Home.tsx`: login, primeiro tenant e seleção de empresa.
- `client/src/features/`: shell do workspace, ponto, reembolsos, configurações e telas administrativas.
- `client/src/index.css`: tokens visuais, responsividade e impressão.
- `client/public/`: recursos estáticos do app.
- `server/routers.ts`: validação, autenticação, regras de negócio, escopo tenant, auditoria e recibos.
- `server/storage.ts`: armazenamento local de arquivos.
- `drizzle/schema.ts`, `drizzle/relations.ts`, `drizzle/`: schema e migrations.
- `plan.md` e `TODO.md`: decisões de arquitetura/design e critérios originais de aceite.

## Comandos

```bash
pnpm check       # TypeScript
pnpm test        # testes automatizados
pnpm build       # build web + servidor
pnpm dev         # desenvolvimento completo
pnpm db:migrate  # migrations versionadas
pnpm db:push     # gerar e aplicar mudanças intencionais de schema
```
