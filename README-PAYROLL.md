# Pers Web RH — Jornadas múltiplas + Folha de pagamento

## Jornadas de trabalho (vários horários)

- Tabela `work_schedules`: nome único por empresa, dias da semana (0=Dom…6=Sáb) e
  **vários blocos por dia** (`[{start,end}, ...]`) — turno quebrado, turnos
  escalonados e overnight (bloco terminando depois da meia-noite). Blocos não
  podem se sobrepor; validado no servidor.
- Colunas novas em `memberships`: `scheduleId` (jornada da pessoa) e
  `salaryCents` (salário mensal em centavos, opcional).
- Pessoa sem jornada definida herda o padrão do RH (jornada base das
  configurações de ponto). Feriados do tenant são respeitados no cálculo de
  dias úteis.
- UI: **Configurações → Jornada de trabalho** (criar/editar/ativar/eliminar
  jornadas, atribuir por pessoa e cadastrar salário mensal).

## Folha de pagamento completa

Fluxo (admin gera/fecha; finance lê):

1. **Gerar rascunho**: mês + tipo (normal, complementar, 13º, férias).
   Existe apenas um rascunho por mês+tipo (regeneração bloqueada até fechar
   ou cancelar).
2. O motor calcula por pessoa (só quem tem salário):
   - **Dias úteis** do mês pela jornada × feriados; jornada esperada em minutos.
   - **Horas trabalhadas** de `work_entries` (ponto real (`source=punch`),
     solicitações retroativas aprovadas e faixas manuais).
   - **Horas extras por dia**: minutos além do bloco do dia × 1,5.
   - **Adicional noturno**: interseção do trabalho com 22h–5h (fuso da
     empresa, DST-aware) × 20% sobre o valor da hora.
   - **Faltas**: dias úteis sem nenhuma marcação → desconto da jornada diária.
   - **INSS empregado progressivo** sobre a base remunerada (salário − faltas +
     extras), com as faixas 7,5%/9%/12%/14% (2025/2026).
   - **IRRF mensal progressivo** sobre a base − INSS (tabela vigente desde
     mai/2025: isento até R$2.428,80 … 27,5% com dedução).
   - **FGTS 8%** e **INSS patronal 20%** (informação de custo da empresa).
   - Bruto, total de descontos, **neto** e **custo total da empresa**.
3. **Ajustes manuais** por item (acréscimos/descontos + observação) enquanto
   rascunho — recalcula tributos e sincroniza totais do lote transacionalmente
   em rascunho.
4. **Fechar** congela a folha (ajustes passam a ser recusados). Cancelar só vale
   em rascunho. Exportação CSV de cada folha na UI.

Tabelas: `payroll_runs` (totais do lote + status) e `payroll_items` (por
pessoa, com `breakdown` detalhado). A fórmula exata vive em
`server/routers/payroll.ts` com constantes isoladas em `server/payroll/br.ts`
(quando o governo publicar novas tabelas, atualize só esse arquivo).

## Endpoints (`/api/trpc/payroll.*`)

- Jornadas: `listSchedules`, `saveSchedule`, `toggleSchedule`,
  `deleteSchedule`, `assignSchedule`.
- Salários: `listSalaries`, `setSalary` (admin).
- Folha: `generate`, `summarize`, `runDetail`, `adjustItem`, `closeRun`,
  `cancelRun`. Mútações transitam por `canAdmin` (tenant_admin).

## Testes (`server/payroll.test.ts`, 12 casos)

INSS/IRRF por faixa · CRUD de jornada com blocos + rejeição de sobreposição ·
extras por dia e noturno com fuso · faltas · espelhamento das fórmulas ·
dupla geração bloqueada · ajuste recalcula tributos e totais · fechar congela ·
acesso (funcionário bloqueado) · isolamento multiempresa · feriado sai de
dias úteis · reuso do mês após cancelamento.

## Migração

`drizzle/0007_chief_maggott.sql` — cria `work_schedules`, `payroll_runs`,
`payroll_items` e adiciona `scheduleId`/`salaryCents` a `memberships`.

Backup pré-fase: `/opt/backups/pre-ponto-jornada-folha-20261102-205721/`
(código + dump MySQL com 34 tabelas + storage).
