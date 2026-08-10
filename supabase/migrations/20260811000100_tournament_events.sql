-- Evento: a página que agrupa vários torneios do mesmo dia (ou fim de semana).
--
-- A academia não anuncia "Super 8 Masculino B" isolado — anuncia "Copa de Agosto"
-- e dentro dela existem misto, masculino B, feminino C. Hoje cada torneio tem sua
-- própria página `/t/[id]`, e divulgar seis links no Instagram não funciona: a
-- pessoa entra num, não vê os outros e desiste de procurar o dela.
--
-- O evento é só a CAPA e o agrupamento. Toda a mecânica (inscrição, chave,
-- placar, pódio) continua no torneio — um evento sem torneio vinculado é uma
-- página vazia, não um novo tipo de competição.
create table if not exists tournament_events (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  name             text not null,
  -- Global, como organizations.slug: o link divulgado é /e/copa-de-agosto, sem o
  -- nome da arena no meio. A action resolve colisão com sufixo.
  slug             text not null unique,
  description      text,
  cover_image_url  text,
  starts_on        date not null,
  -- Nulo = evento de um dia só.
  ends_on          date,
  -- Rascunho não aparece na página pública: a academia monta os torneios com
  -- calma e só depois divulga o link.
  is_published     boolean not null default false,
  created_by       uuid references profiles(id) on delete set null,
  created_at       timestamptz not null default now()
);

create index if not exists tournament_events_org_idx
  on tournament_events (organization_id, starts_on desc);

-- O torneio aponta para o evento, e não o contrário: um torneio pertence a no
-- máximo um evento, e a maioria não pertence a nenhum (torneio avulso continua
-- funcionando igual). `set null` porque apagar a capa não pode apagar torneio
-- com inscrição, chave e resultado dentro.
alter table tournaments
  add column if not exists event_id uuid references tournament_events(id) on delete set null;

create index if not exists tournaments_event_idx on tournaments (event_id)
  where event_id is not null;

-- RLS: leitura pública do que está publicado (a página /e/[slug] abre sem login,
-- é o que permite divulgar no Instagram). Escrita só por service role, como o
-- resto do módulo de torneios.
alter table tournament_events enable row level security;

drop policy if exists "tournament_events_public_read" on tournament_events;
create policy "tournament_events_public_read" on tournament_events
  for select to anon, authenticated
  using (is_published = true);

drop policy if exists "tournament_events_admin" on tournament_events;
create policy "tournament_events_admin" on tournament_events
  for all to authenticated
  using (organization_id in (select auth_admin_org_ids()));
