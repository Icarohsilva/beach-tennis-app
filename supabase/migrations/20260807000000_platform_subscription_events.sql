-- Histórico de assinatura da plataforma — a peça que faltava para as métricas
-- de receita saírem do "estado atual" e virarem série temporal de verdade.
--
-- Sem esta tabela, o painel só sabe como a base está HOJE: dá para somar MRR,
-- mas não para dizer quanto entrou, quanto saiu e por quê no mês passado. A
-- data de cancelamento tinha de ser aproximada por platform_subscriptions
-- .updated_at, que qualquer update posterior sobrescreve.
--
-- Modelo: log de TRANSIÇÃO DE ESTADO, não um catálogo de verbos. Cada linha diz
-- de qual status para qual status a conta foi e quanto ela passa a valer de MRR.
-- Movimento (novo, reativação, churn, expansão, contração) é DERIVADO da
-- diferença entre eventos consecutivos da mesma org — ver lib/superAdmin/
-- mrrMovement.ts. Assim o dia que a plataforma tiver mais de um plano, expansão
-- e contração passam a funcionar sem migration nova.
--
-- Só via service role, como as demais tabelas de billing: RLS ligada e SEM
-- políticas nega anon/authenticated por completo.

create table if not exists platform_subscription_events (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  -- null no primeiro evento da org (não havia estado anterior).
  from_status     text check (from_status in ('trialing','active','past_due','canceled')),
  to_status       text not null check (to_status in ('trialing','active','past_due','canceled')),
  -- MRR da conta DEPOIS do evento, em centavos (int evita erro de ponto
  -- flutuante ao somar). Trial, atraso, cancelada e cortesia valem 0.
  mrr_cents       integer not null default 0 check (mrr_cents >= 0),
  -- Quem provocou: cadastro, webhook do MP, dono da academia ou super-admin.
  source          text not null check (source in ('signup','webhook','owner','platform_admin','seed')),
  actor_id        uuid references profiles(id),
  details         jsonb not null default '{}'::jsonb,
  occurred_at     timestamptz not null default now()
);

-- A leitura quente é "todos os eventos de uma org em ordem" (para derivar o
-- delta) e "tudo desde a data X" (para a série mensal).
create index if not exists idx_platform_sub_events_org
  on platform_subscription_events (organization_id, occurred_at);

create index if not exists idx_platform_sub_events_occurred
  on platform_subscription_events (occurred_at desc);

alter table platform_subscription_events enable row level security;

-- ---------------------------------------------------------------------------
-- Marco zero
-- ---------------------------------------------------------------------------
-- Uma linha por assinatura existente com o estado de HOJE, para a série ter um
-- ponto de partida conhecido.
--
-- occurred_at = now() de propósito, NÃO a data em que a mudança realmente
-- aconteceu: essa data não existe em lugar nenhum. Datar o seed no passado
-- inventaria um histórico que ninguém registrou. source='seed' deixa esses
-- registros distinguíveis dos eventos reais, e o painel informa desde quando
-- está medindo em vez de fingir que sempre mediu.

insert into platform_subscription_events (organization_id, from_status, to_status, mrr_cents, source, details)
select
  ps.organization_id,
  null,
  ps.status,
  case when ps.status = 'active' and not coalesce(ps.is_comped, false) then 4990 else 0 end,
  'seed',
  jsonb_build_object('nota', 'estado no momento da adocao do historico')
from platform_subscriptions ps
where not exists (
  select 1 from platform_subscription_events e
  where e.organization_id = ps.organization_id
);
