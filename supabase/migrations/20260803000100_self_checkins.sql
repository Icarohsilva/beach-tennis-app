-- Confirmação de presença pelo próprio aluno, com conferência de geolocalização.
--
-- organizations ganha o ponto da quadra (lat/lng + raio); self_checkins guarda a
-- confirmação do aluno com a evidência do dispositivo.
--
-- Tabela própria, e não colunas em attendance, pela mesma razão que motivou a
-- separação de `checkins` (ver 20260615000000_checkins.sql): o ciclo de vida é
-- outro. `attendance` é o veredito (professor / parceiro / app); `self_checkins`
-- é a evidência do aluno, com estado de revisão, e nunca é sobrescrita quando o
-- professor ajusta a chamada.

-- ---------------------------------------------------------------------------
-- 1. Ponto da academia
-- ---------------------------------------------------------------------------

alter table organizations
  add column if not exists latitude             numeric(9,6),
  add column if not exists longitude            numeric(9,6),
  add column if not exists checkin_radius_m     int not null default 150,
  -- Nasce desligado: sem coordenadas, toda confirmação cairia como pendente e
  -- inundaria a chamada. A academia liga depois de marcar o ponto.
  add column if not exists self_checkin_enabled boolean not null default false;

alter table organizations
  drop constraint if exists organizations_checkin_radius_chk;
alter table organizations
  add constraint organizations_checkin_radius_chk
  check (checkin_radius_m between 20 and 5000);

-- ---------------------------------------------------------------------------
-- 2. Confirmações
-- ---------------------------------------------------------------------------

create table if not exists self_checkins (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  student_id       uuid not null references profiles(id) on delete cascade,
  session_id       uuid not null references class_sessions(id) on delete cascade,
  -- validated = dentro do raio, vale presença na hora.
  -- pending    = sem GPS / fora do raio / academia sem ponto — professor decide.
  -- rejected   = professor recusou.
  status           text not null default 'pending'
                     check (status in ('validated','pending','rejected')),
  -- Evidência do dispositivo. Tudo nullable: sem GPS a confirmação ainda é gravada.
  latitude         numeric(9,6),
  longitude        numeric(9,6),
  accuracy_m       numeric(8,2),
  distance_m       numeric(9,2),
  -- 'denied' | 'unavailable' | 'timeout' | 'unsupported' | 'org_unset' | 'inaccurate'
  geo_error        text,
  reviewed_by      uuid references profiles(id) on delete set null,
  reviewed_at      timestamptz,
  created_at       timestamptz not null default now()
);

-- Uma confirmação por aluno por sessão (o upsert da action depende deste índice).
create unique index if not exists self_checkins_student_session_idx
  on self_checkins (student_id, session_id);

-- Chamada: todas as confirmações de uma sessão.
create index if not exists self_checkins_session_idx
  on self_checkins (session_id);

-- Fila de pendências da academia.
create index if not exists self_checkins_org_status_idx
  on self_checkins (organization_id, status) where status = 'pending';

-- ---------------------------------------------------------------------------
-- 3. RLS — só leitura. Escrita passa por createAdminClient() nas server actions,
--    como missed_checkins / pending_checkins / partner_checkin_rates.
-- ---------------------------------------------------------------------------

alter table self_checkins enable row level security;

drop policy if exists "self_checkins_select_own" on self_checkins;
create policy "self_checkins_select_own" on self_checkins
  for select to authenticated using (student_id = auth.uid());

drop policy if exists "self_checkins_admin_org" on self_checkins;
create policy "self_checkins_admin_org" on self_checkins
  for select to authenticated using (is_org_admin(organization_id));
