-- Integração de check-in por parceiro (Wellhub/TotalPass), por academia.
-- org_integrations: config (gym_id + webhook_secret) que roteia o webhook → academia.
-- pending_checkins: fila de check-ins órfãos (ID não casou) para o admin resolver.

-- 1. Config da integração por academia.
create table if not exists org_integrations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  partner         checkin_partner not null,
  gym_id          text not null,
  webhook_secret  text not null,
  status          text not null default 'connected',
  connected_at    timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

-- Um gym_id mapeia exatamente uma academia (roteamento do webhook).
create unique index if not exists org_integrations_partner_gym_idx
  on org_integrations (partner, gym_id);
-- Uma config por parceiro por academia.
create unique index if not exists org_integrations_org_partner_idx
  on org_integrations (organization_id, partner);

-- 2. Fila de check-ins órfãos.
create table if not exists pending_checkins (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  partner           checkin_partner not null,
  partner_member_id text not null,
  checkin_date      date not null,
  external_ref      text,
  payload           jsonb not null,
  resolved          boolean not null default false,
  created_at        timestamptz not null default now()
);

create index if not exists pending_checkins_org_resolved_idx
  on pending_checkins (organization_id, resolved);
-- Dedupe de eventos reenviados pela Wellhub.
create unique index if not exists pending_checkins_partner_ref_idx
  on pending_checkins (partner, external_ref) where external_ref is not null;

-- 3. RLS — escrita só via service role (webhook/admin actions). Leitura: admin da academia.
alter table org_integrations enable row level security;
alter table pending_checkins enable row level security;

create policy "org_integrations_admin_org" on org_integrations
  for select using (is_org_admin(organization_id));
create policy "pending_checkins_admin_org" on pending_checkins
  for select using (is_org_admin(organization_id));
