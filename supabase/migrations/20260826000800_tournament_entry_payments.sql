-- supabase/migrations/20260826000800_tournament_entry_payments.sql
-- Link pessoal de pagamento por LADO da inscrição (/p/[token]): titular e
-- parceiro de uma dupla fixa pagam separadamente (Fase 2a), então cada um
-- precisa do próprio link — "Sua parte é R$ 60, pague por aqui".
--
-- Token em tabela própria, nunca em coluna de tournament_entries: a policy
-- tournament_entries_public_read dá select de TODAS as colunas de qualquer
-- inscrição de torneio não-draft para `anon` (é o que alimenta a lista
-- pública de inscritos) — um token ali seria um token que qualquer
-- visitante lista e usa. Mesmo motivo de tournament_partner_invites
-- (20260826000700): tabela com RLS ligada e SEM policy pública não vaza por
-- omissão.
create table if not exists tournament_entry_payments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  tournament_id    uuid not null references tournaments(id) on delete cascade,
  entry_id         uuid not null references tournament_entries(id) on delete cascade,
  side             text not null check (side in ('player', 'partner')),
  token            text not null unique,
  created_at       timestamptz not null default now(),
  -- No máximo um link por lado da inscrição — ensureEntryPaymentToken faz
  -- upsert lógico (lê antes de inserir) usando este índice para detectar a
  -- corrida de duas chamadas concorrentes gerando o link ao mesmo tempo.
  unique (entry_id, side)
);

create index if not exists idx_tournament_entry_payments_tournament
  on tournament_entry_payments (tournament_id);

alter table tournament_entry_payments enable row level security;

-- Só a academia dona lê (painel do admin, para montar a mensagem de
-- cobrança). A rota pública /p/[token] é resolvida pelo service role
-- (createAdminClient, ignora RLS) — mesmo desenho de tournament_partner_invites.
create policy tournament_entry_payments_admin_org on tournament_entry_payments
  for select using (organization_id in (select auth_admin_org_ids()));
