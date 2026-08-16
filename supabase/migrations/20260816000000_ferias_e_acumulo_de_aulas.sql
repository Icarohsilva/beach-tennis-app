-- Férias do aluno e acúmulo de aulas do plano.
--
-- Duas coisas que o modelo atual não sabia dizer:
--
-- 1) FÉRIAS. Ou o aluno estava ativo, ou o admin inativava o cadastro
--    (memberships.archived_at) — que cancela plano e matrículas, grosso demais
--    para quem vai viajar três semanas. Sem um meio-termo, a geração semanal
--    seguia reservando o aluno em todas as fixas e ele ocupava vaga que não ia
--    usar.
--
-- 2) ACÚMULO. A cota é derivada: resolveQuota conta as reservas dentro da janela
--    do ciclo. Como a janela do ciclo seguinte não enxerga a anterior, o que
--    sobra some na virada. Acumular sem limite é o que obriga a gravar saldo —
--    derivar recursivamente até o começo da história não tem base de parada.
--
-- Tudo aditivo e desligado por padrão: nenhum plano existente muda de
-- comportamento com o deploy.

-- ───────────────────────────────────────────────────────────────────────────
-- 1. vacations — o período de férias, com aprovação
-- ───────────────────────────────────────────────────────────────────────────
--
-- Tabela e não flag na membership por três motivos: férias se repetem, o
-- período importa, e o pedido do aluno precisa de estado de aprovação com
-- histórico. Mesma forma de plan_recommendations (20260704000100).
--
-- "Estar de férias" NÃO é coluna: é derivado de existir linha `approved`
-- cobrindo a data. Um par flag+período dessincroniza no dia em que o período
-- vence e ninguém roda nada.

create table if not exists vacations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  student_id uuid not null references profiles(id) on delete cascade,
  -- Inclusivos, em BRT. Data pura: férias é dia cheio, não instante.
  starts_on date not null,
  ends_on date not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  -- Quem pediu: o próprio aluno, ou o admin que marcou direto.
  requested_by uuid references profiles(id) on delete set null,
  reviewed_by uuid references profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  constraint vacations_period_valid check (ends_on >= starts_on)
);

-- Caminho quente: "este aluno está de férias nesta data?", perguntado a cada
-- reserva e uma vez por aluno na geração da grade.
create index if not exists vacations_approved_idx
  on vacations (organization_id, student_id, starts_on, ends_on)
  where status = 'approved';

-- Fila do admin: os pedidos esperando resposta.
create index if not exists vacations_pending_idx
  on vacations (organization_id, created_at desc)
  where status = 'pending';

alter table vacations enable row level security;

-- (select auth.uid()) e not auth.uid(): InitPlan, uma avaliação por statement
-- em vez de uma por linha (ver 20260809000000_escala_rls_e_indices.sql).
drop policy if exists vacations_select_own on vacations;
create policy vacations_select_own on vacations
  for select using (student_id = (select auth.uid()));

drop policy if exists vacations_admin_org on vacations;
create policy vacations_admin_org on vacations
  for all using (organization_id in (select auth_admin_org_ids()));

comment on table vacations is
  'Período de férias do aluno. Aprovado = ele sai da geração da grade e não reserva sozinho. Não mexe em cobrança.';

-- ───────────────────────────────────────────────────────────────────────────
-- 2. subscription_plans.rollover_unused — a sobra vira saldo?
-- ───────────────────────────────────────────────────────────────────────────
--
-- Por plano, e não por academia: a arena pode vender um plano em que a aula não
-- usada acumula e outro em que ela zera todo mês. Nasce false, como
-- quota_enforcement_enabled — o comportamento de hoje é o default.

alter table subscription_plans
  add column if not exists rollover_unused boolean not null default false;

comment on column subscription_plans.rollover_unused is
  'Aula do plano não usada no ciclo vira saldo para o ciclo seguinte. Não afeta crédito avulso.';

-- ───────────────────────────────────────────────────────────────────────────
-- 3. plan_cycle_balances — o extrato do saldo, um ciclo por linha
-- ───────────────────────────────────────────────────────────────────────────
--
-- Extrato, não cache: cada linha guarda as PARCELAS que produziram o número
-- (o que o plano deu, o que entrou de antes, o que foi usado), então dá para
-- responder "por que este aluno tem 5 aulas a mais em março" sem recalcular a
-- história inteira. Mesma ideia de credit_transactions e liga_points.
--
-- O unique é o que torna o fechamento idempotente: o cron roda todo dia e usa
-- `on conflict do nothing`, então rodar duas vezes não dobra saldo de ninguém.

create table if not exists plan_cycle_balances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  student_id uuid not null references profiles(id) on delete cascade,
  -- Janela do ciclo fechado (cycleWindow de lib/utils/classQuota.ts).
  cycle_start date not null,
  cycle_end date not null,
  -- classes_per_week × semanas do ciclo: o que o plano deu naquele ciclo.
  granted int not null default 0,
  -- Reservas que consumiram cota (mesma contagem de resolveQuota).
  used int not null default 0,
  -- Saldo que entrou do ciclo anterior. 0 quando é o primeiro.
  carried_in int not null default 0,
  -- max(0, carried_in + granted - used). É o que o ciclo seguinte lê.
  carried_out int not null default 0,
  closed_at timestamptz not null default now(),
  constraint plan_cycle_balances_unique unique (student_id, organization_id, cycle_start)
);

-- Leitura do ciclo anterior, feita a cada consulta de cota de aluno com
-- rollover ligado: pega a linha mais recente antes de uma data.
create index if not exists plan_cycle_balances_lookup_idx
  on plan_cycle_balances (student_id, organization_id, cycle_start desc);

alter table plan_cycle_balances enable row level security;

drop policy if exists plan_cycle_balances_select_own on plan_cycle_balances;
create policy plan_cycle_balances_select_own on plan_cycle_balances
  for select using (student_id = (select auth.uid()));

drop policy if exists plan_cycle_balances_admin_org on plan_cycle_balances;
create policy plan_cycle_balances_admin_org on plan_cycle_balances
  for all using (organization_id in (select auth_admin_org_ids()));

comment on table plan_cycle_balances is
  'Extrato do saldo de aulas do plano, uma linha por ciclo fechado. Escrito pelo cron plan-cycle-close.';
