-- supabase/migrations/20260826000700_tournament_partner_invites.sql
-- Convite de parceiro por link — quem inscreve pode não ter conta ainda para
-- o colega de dupla. A dupla fixa registra a inscrição (segurando a vaga e o
-- pagamento do titular) com `partner_id` nulo; este convite é o que resolve
-- quem é o parceiro depois, sem bloquear a vaga esperando alguém abrir o
-- WhatsApp.
--
-- Tabela PRÓPRIA, e não colunas em tournament_entries: a policy
-- tournament_entries_public_read (20260628000300) dá select de TODAS as
-- colunas de toda inscrição de torneio aberto para `anon`. Um token de
-- convite numa coluna dali seria um token que qualquer visitante lista e usa
-- para sequestrar a dupla de outra pessoa. Tabela com RLS ligada e SEM
-- policy pública não vaza por omissão.
--
-- Padrão do token copiado de memberships.calendar_feed_token
-- (20260820000000_calendar_sync.sql): crypto.randomBytes gerado na action,
-- nunca no banco.
create table if not exists tournament_partner_invites (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  tournament_id    uuid not null references tournaments(id) on delete cascade,
  -- Uma inscrição tem no máximo um convite de parceiro em aberto por vez.
  entry_id         uuid not null unique references tournament_entries(id) on delete cascade,
  token            text not null unique,
  invited_name     text not null,
  invited_phone    text,
  -- Quando quem convida já sabe o gênero do parceiro, a checagem de dupla
  -- roda na hora do convite em vez de só no aceite.
  invited_gender   text check (invited_gender in ('M', 'F')),
  created_by       uuid references profiles(id) on delete set null,
  expires_at       timestamptz not null,
  accepted_at      timestamptz,
  accepted_by      uuid references profiles(id) on delete set null,
  declined_at      timestamptz,
  created_at       timestamptz not null default now()
);

create index if not exists tournament_partner_invites_tournament_idx
  on tournament_partner_invites (tournament_id);

alter table tournament_partner_invites enable row level security;

-- Sem policy pública de propósito: a rota /t/[id]/dupla/[token] autentica
-- pelo próprio token (createAdminClient, como app/api/calendar/[token]) —
-- não por RLS. O admin da academia enxerga pela org, para dar suporte.
drop policy if exists tournament_partner_invites_admin_org on tournament_partner_invites;
create policy tournament_partner_invites_admin_org on tournament_partner_invites
  for select to authenticated
  using (organization_id in (select auth_admin_org_ids()));

comment on table tournament_partner_invites is
  'Convite de parceiro por link/WhatsApp para dupla fixa. entry_id aponta para a inscrição que fica com partner_id nulo até o convite ser aceito.';
