-- Uma linha por unidade inscrita (cobre individual e dupla). Substitui a
-- tournament_registrations referenciada pelo código mas nunca criada em prod.
create table if not exists tournament_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  tournament_id uuid not null references tournaments(id) on delete cascade,
  player_id uuid not null references profiles(id),
  partner_id uuid references profiles(id),
  seed int,
  created_at timestamptz not null default now(),
  unique (tournament_id, player_id)
);

create index if not exists tournament_entries_tournament_idx
  on tournament_entries(tournament_id);

alter table tournament_entries enable row level security;

-- Mesmo padrão das demais tabelas (memberships): leitura por org do usuário,
-- inscrição da própria pessoa, cancelamento da própria, admin faz tudo na org.
create policy "tentries_select_org" on tournament_entries
  for select using (organization_id in (select auth_org_ids()));
create policy "tentries_insert_own" on tournament_entries
  for insert with check (player_id = auth.uid() and organization_id in (select auth_org_ids()));
create policy "tentries_delete_own" on tournament_entries
  for delete using (player_id = auth.uid() and organization_id in (select auth_org_ids()));
create policy "tentries_admin_org" on tournament_entries
  for all using (is_org_admin(organization_id));
