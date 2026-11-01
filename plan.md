# Plano de implementação — Pers Web RH

## Abordagem e decisões

Aplicação SaaS web de RH no starter Manus gerenciado **React + TypeScript + Vite, Express + tRPC e Drizzle/MySQL**, com servidor, banco e object storage habilitados. A identidade global vem do OAuth Manus e da sessão JWT do starter; cada empresa é um tenant, e cada vínculo de funcionário/gestor/admin pertence a um tenant. Cada operação de domínio resolve e valida membership ativo no servidor; o tenantId enviado pelo browser nunca é prova de acesso. Consultas e mutações combinam tenant autorizado, registro e papel; atribuições entre entidades também são verificadas no mesmo tenant. O primeiro criador autenticado se torna Admin do Tenant; o papel de Super Admin utiliza o papel de proprietário do starter.

Modelo relacional: tenants e domínios; memberships, departamentos e configurações por tenant; períodos semanais e faixas de ponto com tipo, indicação explícita de contar ou não como trabalho (preservada por registro), início/fim, atividade, projeto, centro de custo, local e campos personalizados; solicitações, itens, recibos, regras/etapas de aprovação e auditoria. As faixas são múltiplas por dia. O funcionário tem folha semanal e consulta mensal, enquanto o fluxo de aprovação continua por semana. Os dashboards usam os dados autorizados do tenant para horas por pessoa/projeto/atividade, estimativa de ausência, horas acima da jornada diária e atrasos excedentes à tolerância configurada na primeira faixa de trabalho do dia. CSV será criado no browser sobre resultado autorizado; impressão do navegador oferecerá PDF.

As regras de reembolso são filtradas por categoria e valor total e resolvem Gestor Direto, Financeiro, Administrativo ou pessoa designada. A pessoa que conclui a última etapa fica explicitamente registrada como responsável pelo pagamento; o servidor limita a ela (ou Admin do Tenant) a ação de registrar pagamento. O fluxo inclui rascunho, envio, aprovação, aprovação/rejeição com justificativa obrigatória e pagamento. A tela de detalhes gera a visualização consolidada do pedido, itens, recibos e total.

Recibos são limitados a 5 MB, validados por assinatura de arquivo e criptografados no servidor com AES-256-GCM antes do object storage. O browser não recebe caminho ou URL pública do objeto: o download passa por procedure autenticada, que confere tenant, vínculo à solicitação e autorização antes de descriptografar. A chave server-only é derivada do segredo de sessão do projeto; rotação requer recriptografia de objetos existentes. Campos relacionais comuns (por exemplo, e-mail e geolocalização) não recebem criptografia campo-a-campo.

Convites associam endereço de e-mail a membership, e o vínculo é reivindicado na entrada OAuth com o mesmo e-mail. Papéis no tenant incluem Admin, Gestor, Funcionário, Financeiro e Administrativo. A UI permite criar tenants, escolher uma empresa, gerir equipe/departamentos, editar papéis/ativação, parametrizar jornada, locais, campos, categorias e regras. Domínio customizado fica associado a um tenant e é resolvido pelo host; DNS, TLS, OAuth callback e domínio da hospedagem precisam de configuração externa e não são ativados pelo cadastro.

## Estrutura do projeto

- `client/src/pages/Home.tsx`: login, criação/seleção do tenant e resolução de host configurado.
- `client/src/features/OrbitWorkspace.tsx`: shell, navegação e visão geral.
- `client/src/features/attendance.tsx`: registro/faixas, folha semanal/mensal e aprovação.
- `client/src/features/reimbursements.tsx`: rascunhos, itens, upload e documento de recibo.
- `client/src/features/settings.tsx`: empresa, políticas, departamentos, equipe, categorias e regras.
- `client/src/index.css`: tokens, layout responsivo, ajustes de mobile e impressão.
- `client/public/perswebrh-mark.svg`: marca vetorial/fav icon; `client/public/manus-routes.json`: manifesto fiel das rotas atuais.
- `server/routers.ts`: composição do router raiz e autenticação; `server/routers/shared.ts`: helpers compartilhados de membership, autorização, auditoria, período e recibos; `tenants.ts`, `attendance.ts` e `reimbursements.ts`: procedures e regras organizadas por domínio.
- `server/storage.ts`: transfers e URLs assinadas runtime para object storage gerenciado; sem URLs de recibo no cliente.
- `server/db.ts`: conexão e helpers SQL/Drizzle.
- `drizzle/schema.ts` e `drizzle/`: schema relacional, índices, constraints e migrations aditivas.
- `README.md` e `.env.example`: instalação, dados, papéis, variáveis, operação e limites.
- `plan.md` e `TODO.md`: decisões de implementação e critérios de aceite originais, com status baseado em evidência.

## Design

Estilos alternativos considerados (probabilidades amostradas na cauda, abaixo de 0,10): **Swiss Industrial (0,043)**, **Editorial de operações humanas (0,071)** e **Utilitário cibernético (0,018)**. Escolha: **Editorial de operações humanas**, com disciplina editorial para uma operação de RH serena e precisa.

- **Movimento:** editorial suíço contemporâneo aplicado a software operacional.
- **Princípios:** hierarquia tipográfica nítida; informação antes de decoração; estados compreensíveis; densidade confortável que se adapta ao celular.
- **Filosofia de cor:** marfim e superfícies claras reduzem fadiga; azul-petróleo comunica confiança; verde-lima contido destaca presença/ação; âmbar e vermelho são reservados a alertas/estados.
- **Layout:** navegação lateral recolhível, cabeçalho contextual e área de trabalho modular; telas estreitas usam navegação recolhível e cartões verticais.
- **Elementos-signatura:** marca circular orbital com ponto ativo; régua temporal para faixas; etiquetas de status discretas.
- **Interação:** ações claras, validação junto ao campo, feedback breve e reversibilidade antes do envio.
- **Animação:** transições breves para menus e estados; sem animação contínua; respeitar `prefers-reduced-motion`.
- **Tipografia:** Manrope em títulos/números e sans-serif de sistema na interface; escala estável entre título, corpo e metadados.
- **Essência da marca:** conecta tempo, equipe e despesas sem fragmentar a rotina. Personalidade: confiável, clara, humana.
- **Voz:** direta e acolhedora, sem jargão. Exemplos: “Seu dia, organizado faixa a faixa.” “Despesas conferidas. Próximo passo à vista.”
- **Wordmark e símbolo:** nome Pers Web RH combinado a arcos orbitais assimétricos envolvendo o ponto de marcação; versão vetorial própria para favicon/ícone.
- **Cor de assinatura:** azul-petróleo `#164B4B`.

## Persistência, sessão e serving

A autenticação mantém OAuth e sessão JWT do starter, inclusive cookie `SameSite=None; Secure` para Preview HTTPS incorporado. Zod valida dados de entrada; Drizzle usa queries parametrizadas; React escapa conteúdo textual. PII de cadastro e coordenadas dependem de controles e proteções dos serviços gerenciados, sem criptografia de campo adicional nesta versão. Anexos são criptografados pela aplicação como descrito acima. Chaves privadas não entram no bundle web.

O backend Express/tRPC atende a porta Preview configurada (3000), possui endpoint de saúde `/api/health` e entrega o SPA e suas APIs no mesmo processo. O manifesto de rotas declara somente as páginas funcionais (não APIs, assets nem fallback 404). Migrações são aditivas; schema e scripts são incluídos no pacote do projeto. O README documenta configuração de ambiente e operação sem declarar domínio/DNS ou publicação antes de confirmação real.
