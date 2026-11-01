# Entregas e critérios de aceite — Pers Web RH

## 1. SaaS multi-tenant, acesso e administração

- [x] “Todas as entidades (funcionários, registros de ponto, reembolsos, configurações) devem pertencer a um tenantId (ID da empresa). Nenhum dado pode vazar entre tenants.” — Todas as tabelas operacionais têm `tenantId`; procedures verificam o vínculo ativo e escopam leituras e gravações ao tenant autorizado.
- [ ] “Cada empresa deve ter seu próprio domínio ou subdomínio e um painel administrativo para gerenciar seus funcionários, departamentos, regras de ponto e fluxos de reembolso.” — O painel e a resolução de domínio cadastrado no host estão implementados; DNS, TLS, callback OAuth e publicação do domínio ainda exigem configuração externa.
- [x] “Autenticação segura (JWT) com diferentes níveis de acesso: Super Admin (você, dono do SaaS), Admin do Tenant, Gestor e Funcionário.” — A identidade e sessão JWT usam OAuth e o starter; Super Admin usa o papel de proprietário da plataforma. A aplicação também distingue Financeiro e Administrativo para o fluxo de pagamento.
- [x] “Cada empresa deve poder customizar as regras de ambos os módulos de acordo com sua realidade.” — As políticas e categorias são tenant-scoped e administráveis.

## 2. Regras configuráveis por empresa

- [x] Ponto: “Definição de jornadas de trabalho, tolerâncias de atraso, tipos de marcação (entrada, saída, intervalo), campos personalizados no registro (ex.: ‘Projeto’, ‘Centro de Custo’).” — Inclui configuração de tipos que não contam como trabalho; a natureza é gravada em cada faixa.
- [x] Reembolso: “Criação de categorias de despesa (ex.: Alimentação, Transporte, Hospedagem), definição de políticas de limite de valor por categoria, e customização do fluxo de aprovação.” — O limite por categoria é cumulativo para cada solicitação e é informado explicitamente na interface.

## 3. Registro de ponto do funcionário

- [x] “O funcionário deve poder registrar múltiplos períodos de trabalho no mesmo dia. Exemplo: 08:00 - 12:00 (Atividade: Reunião com cliente / Local: Escritório) e 13:30 - 18:00 (Atividade: Desenvolvimento / Local: Home Office).” — O servidor também impede sobreposição e mantém cada faixa ligada à folha semanal.
- [x] Cada faixa requer “Data e Hora de início e fim de cada faixa” e “Descrição da Atividade realizada naquela faixa (campo de texto).”
- [x] “O sistema deve capturar a geolocalização (latitude/longitude) no momento da marcação, ou permitir que o funcionário selecione um local pré-cadastrado (ex.: ‘Escritório Central’, ‘Cliente X’, ‘Home Office’).” — GPS é solicitado explicitamente no navegador; coordenadas antigas são apagadas quando a captura é refeita ou o modo de local muda, e o servidor só persiste coordenadas no modo geolocalizado.
- [x] “Dashboard do Funcionário: Visualização da sua folha de ponto semanal/mensal, com o total de horas trabalhadas por dia e por projeto/atividade.” — A aprovação permanece semanal; a consulta mensal é informativa.

## 4. Gestão e aprovação de ponto

- [x] “Dashboard do Gestor: Aprovação de folhas de ponto, visualização da equipe, relatórios de absenteísmo e horas extras.” — Ausência é uma estimativa de dias úteis sem faixa; horas extras e atrasos consideram as configurações do tenant. Não substitui calendário de feriados, licenças ou apuração trabalhista.
- [x] “Exportação em CSV/PDF de relatórios de frequência, horas trabalhadas por funcionário, por projeto e por período.” — CSV é gerado no navegador e PDF pode ser salvo pela impressão do navegador.

## 5. Solicitação de reembolso

- [x] O pedido inclui “Upload de recibos e notas fiscais (imagens e PDFs)”, “Descrição da despesa”, “Valor de cada item”, “Data da despesa” e “Categoria da despesa (pré-definida pelo tenant).” — Upload limitado a 5 MB por arquivo; anexos são criptografados no servidor.
- [x] “O sistema deve gerar um documento (PDF ou visualização na tela) que consolide todas as despesas de uma solicitação, apresentando o valor total a ser reembolsado.” — A tela da nota consolidada pode ser impressa/salva em PDF.
- [x] “O tenant deve poder configurar diferentes responsáveis pelo pagamento (ex.: Gestor Direto, Financeiro, Administrativo) com base na categoria da despesa ou no valor total. O sistema deve enviar a solicitação (ou a nota consolidada) para o responsável correto aprovar e/ou efetuar o pagamento.” — As regras alimentam filas internas por papel/membro; a etapa final designa quem pode registrar o pagamento. Não há e-mail transacional configurado.
- [x] “Status da solicitação: Rascunho → Enviado → Em Aprovação → Aprovado → Pago (ou Rejeitado, com justificativa).”

## 6. Qualidade técnica, responsividade e documentação

- [x] “Utilize uma stack moderna de sua escolha (sugestão: Next.js/React no frontend, Node.js/NestJS ou Python no backend, PostgreSQL para banco de dados relacional). O importante é que seja um código limpo, modular e bem documentado.” — React/TypeScript, Express/tRPC, Drizzle/MySQL; rotas organizadas por domínio, README e migrations incluídos.
- [ ] “Sanitização de inputs, proteção contra vulnerabilidades comuns (SQL Injection, XSS) e criptografia de dados sensíveis.” — Zod, queries parametrizadas, escape React e criptografia AES-256-GCM para recibos foram implementados; nomes, e-mails e campos de localização ainda não têm criptografia de campo da aplicação. Revise essa política antes de armazenar PII ou dados de localização em produção.
- [x] “A interface deve ser totalmente funcional em dispositivos móveis (essencial para marcação de ponto e envio de reembolsos).” — Layout e controles responsivos implementados; build e inspeção de código concluídos, sem teste manual autenticado em navegador.
- [x] “Inclua um arquivo README.md completo com instruções de instalação, configuração do banco de dados, variáveis de ambiente e guia de uso.”

## 7. Entrega do código e banco

- [x] “Código-Fonte Completo: Todos os arquivos de frontend e backend, organizados em pastas.” — Inclui cliente, APIs por domínio, helpers e assets.
- [x] “Scripts de Banco de Dados: Arquivo .sql ou migrations para criar a estrutura do banco.” — Migrations SQL `0000`, `0001` e `0002` versionadas; a última adiciona somente campos para semântica configurável de ponto.
- [x] “Documentação: O README.md mencionado acima.”
- [x] “Disponibilize o download de todo o código-base (frontend e backend) em um arquivo .zip ou forneça os links para os repositórios. Preciso ter a posse total dos arquivos.” — Pacote ZIP completo foi gerado e validado, sem segredos, `node_modules` ou artefatos de build.

## Evidências de implementação

- `pnpm check`: concluído sem erros.
- `pnpm test`: 3 arquivos e 8 testes aprovados.
- `pnpm build`: build Vite + bundle Express concluído; o bundler avisa sobre o script público `config.js` do starter e o tamanho do chunk principal (545 KB minificado, 154 KB gzip), sem falha.
- Preview: `/api/health` respondeu HTTP 200; `/manus-routes.json` respondeu HTTP 200 com JSON válido; favicon Pers Web RH respondeu HTTP 200.
- Banco gerenciado: migrations aplicadas; `countsAsWork` e `nonWorkingMarkTypes` confirmados; consulta prévia encontrou zero faixas de ponto antes da migration aditiva.
- Publicação: não realizada; `publishing.auto_publish=false`. A aplicação permanece disponível no Preview do projeto. Domínio/DNS/TLS e callback OAuth de produção não foram configurados.
