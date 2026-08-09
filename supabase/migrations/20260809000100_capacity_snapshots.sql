-- 20260809000100_capacity_snapshots.sql
--
-- Retrato diário do tamanho da operação, para responder "quando vou precisar
-- subir de plano?" com data em vez de palpite.
--
-- Um retrato isolado diz pouco. O que decide upgrade é a CURVA: 30 retratos dão
-- crescimento por dia, e crescimento por dia dá a data em que cada teto é
-- cruzado. Por isso a tabela guarda histórico em vez de um registro único.

create table if not exists capacity_snapshots (
  id uuid primary key default gen_random_uuid(),
  captured_at timestamptz not null default now(),
  -- jsonb, e não colunas: a lista de métricas vai mudar mais rápido que o
  -- schema, e retrato velho continua legível com o formato que tinha no dia.
  metrics jsonb not null
);

create index if not exists capacity_snapshots_captured_idx
  on capacity_snapshots (captured_at desc);

-- Só a plataforma lê. RLS ligada sem policy de leitura = ninguém pelo cliente;
-- o cron e o painel entram por service role, que ignora RLS.
alter table capacity_snapshots enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- Coleta. Uma chamada devolve tudo: contagem de tenants/alunos, linhas e bytes
-- das tabelas que crescem, tamanho do banco e MAU.
--
-- Usa reltuples (estimativa do planejador) em vez de count(*): com 30 milhões de
-- linhas um count exato por tabela custaria mais que o próprio cron. Para
-- projeção de crescimento a estimativa basta — o erro é de fração de por cento
-- depois do autovacuum e não muda a data do upgrade.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function capacity_metrics()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  resultado jsonb;
  tabelas jsonb;
begin
  select jsonb_object_agg(
           rel.relname,
           jsonb_build_object(
             'rows', greatest(rel.reltuples, 0)::bigint,
             'bytes', pg_total_relation_size(rel.oid)
           )
         )
  into tabelas
  from pg_class rel
  join pg_namespace ns on ns.oid = rel.relnamespace
  where ns.nspname = 'public'
    and rel.relkind = 'r'
    and rel.relname in (
      'attendance', 'session_bookings', 'class_sessions', 'classes', 'enrollments',
      'liga_points', 'liga_standings', 'liga_medals', 'liga_kudos',
      'credit_transactions', 'notifications', 'payments', 'memberships',
      'profiles', 'organizations', 'posts', 'waitlists', 'self_checkins', 'checkins'
    );

  select jsonb_build_object(
    'orgs', (select count(*) from organizations),
    'orgs_ativas', (select count(*) from organizations where coalesce(status, 'active') <> 'suspended'),
    'alunos', (select count(*) from memberships where role = 'student'),
    'alunos_ativos', (select count(*) from memberships where role = 'student' and contract_active is true),
    -- MAU no mesmo sentido que o Supabase cobra: quem autenticou nos últimos 30 dias.
    'mau', (select count(*) from auth.users where last_sign_in_at > now() - interval '30 days'),
    'db_bytes', pg_database_size(current_database()),
    'tabelas', coalesce(tabelas, '{}'::jsonb)
  ) into resultado;

  return resultado;
end $$;

revoke all on function capacity_metrics() from public, anon, authenticated;
