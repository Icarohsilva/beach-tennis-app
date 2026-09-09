-- supabase/migrations/20260909193000_dayuse_recurrences.sql
-- Day use recorrente: "todo domingo, 9h-12h, quadra 1" em vez de um slot criado
-- à mão por data. É como as arenas operam de fato (day use é horário fixo
-- semanal), e sem isto a academia esquecia de criar a data e o day use
-- simplesmente não existia naquela semana.
--
-- Mesmo formato de `classes` (day_of_week + start_time + end_time + court), de
-- propósito: é o que faz o day use recorrente entrar na MESMA lista de
-- recorrência da academia que a grade de aulas, gerado pela mesma passada do
-- cron.
--
-- ============================================================================
-- ANTES DE APLICAR: o índice único do fim desta migração falha se a base já
-- tiver dois day use no mesmo espaço, data e horário de início. Confira:
--
--   select organization_id, court, date, start_time, count(*)
--     from dayuse_slots
--    group by 1, 2, 3, 4
--   having count(*) > 1;
--
-- Se voltar linha, a limpeza é decisão da academia (qual dos dois é o certo),
-- não desta migração — day use duplicado pode ter reserva nos dois.
-- ============================================================================

create table if not exists dayuse_recurrences (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  -- 0=domingo..6=sábado, igual a classes.day_of_week (getDay do JS).
  day_of_week      int  not null check (day_of_week between 0 and 6),
  start_time       time not null,
  end_time         time not null,
  court            int  not null default 1,
  sport            text,
  kind             text not null default 'scheduled' check (kind in ('scheduled', 'open')),
  capacity         int  not null default 8 check (capacity >= 1),
  price_cents      int  check (price_cents is null or price_cents >= 0),
  notes            text,
  is_active        boolean not null default true,
  created_by       uuid references profiles(id),
  created_at       timestamptz not null default now(),
  constraint dayuse_recurrences_time_chk check (start_time < end_time)
);

create index if not exists dayuse_recurrences_org_idx
  on dayuse_recurrences (organization_id, is_active, day_of_week);

alter table dayuse_recurrences enable row level security;

-- Formato do 20260809000000_escala_rls_e_indices.sql: `(select ...)` para o
-- planejador avaliar UMA vez por statement (InitPlan) em vez de por linha.
drop policy if exists dayuse_recurrences_admin_org on dayuse_recurrences;
create policy dayuse_recurrences_admin_org on dayuse_recurrences
  for all to authenticated
  using (organization_id in (select auth_admin_org_ids()));

comment on table dayuse_recurrences is
  'Day use fixo semanal. O cron diário materializa isto em dayuse_slots (features/dayuse/generation.ts); a linha aqui é o molde, não o horário reservável.';

-- Procedência do slot: qual recorrência o gerou. Nulo = criado à mão.
-- Necessário para desligar a recorrência e recolher as datas futuras que ELA
-- criou, sem tocar no que o admin montou na mão.
-- `on delete set null` e não cascade: apagar o molde não pode apagar day use
-- que já tem gente reservada.
alter table dayuse_slots
  add column if not exists recurrence_id uuid references dayuse_recurrences(id) on delete set null;

create index if not exists dayuse_slots_recurrence_idx
  on dayuse_slots (recurrence_id) where recurrence_id is not null;

comment on column dayuse_slots.recurrence_id is
  'Recorrência que gerou este slot. Nulo = criado à mão. Desligar a recorrência recolhe as datas futuras SEM reserva geradas por ela.';

-- Unicidade que faltava: sem ela a geração não tinha como ser idempotente (o
-- upsert precisa de uma chave para "esta data já existe"), e a passada seguinte
-- do cron duplicaria o mesmo day use todos os dias.
--
-- Inclui slot INATIVO de propósito: o par (espaço, data, início) é o horário
-- físico, e o inativo é o mesmo horário desligado — recriá-lo é reativar (ver
-- createDayUseSlot), não abrir um segundo. Último statement da migração: se
-- falhar por duplicado preexistente, o resto já está aplicado.
create unique index if not exists dayuse_slots_org_court_date_start_key
  on dayuse_slots (organization_id, court, date, start_time);
