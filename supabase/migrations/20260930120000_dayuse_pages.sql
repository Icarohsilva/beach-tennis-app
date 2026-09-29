-- supabase/migrations/20260930120000_dayuse_pages.sql
-- Página de day use: a capa que agrupa as datas de um mesmo day use.
--
-- Mesmo desenho do evento de torneio (20260811000100_tournament_events.sql). A
-- arena não divulga "day use de 04/10 às 9h" isolado: divulga o "Day Use de
-- Verão" com o flyer, e dentro dele estão os sábados e domingos. Hoje cada data
-- tem a sua página /d/[id], e mandar oito links no grupo não funciona.
--
-- A página é só a CAPA e o agrupamento. Reserva, pagamento, parceiro e lista do
-- quiosque continuam na data (dayuse_slots) — uma página sem data vinculada é
-- vazia, não um novo tipo de day use. Cada day use novo que a arena lança ganha
-- a sua página.
create table if not exists dayuse_pages (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  name             text not null,
  -- Global, como tournament_events.slug: o link divulgado é /dayuse/verao, sem o
  -- nome da arena no meio. A action resolve colisão com sufixo.
  slug             text not null unique,
  description      text,
  cover_image_url  text,
  -- Rascunho não aparece na página pública: a arena vincula as datas com calma
  -- e só depois divulga o link.
  is_published     boolean not null default false,
  created_by       uuid references profiles(id) on delete set null,
  created_at       timestamptz not null default now()
);

create index if not exists dayuse_pages_org_idx
  on dayuse_pages (organization_id, created_at desc);

-- A data aponta para a página, e não o contrário: uma data pertence a no máximo
-- uma página, e a maioria pode não pertencer a nenhuma (o /d/[id] continua
-- funcionando igual). `set null` porque apagar a capa não pode apagar data com
-- reserva paga dentro.
alter table dayuse_slots
  add column if not exists page_id uuid references dayuse_pages(id) on delete set null;

create index if not exists dayuse_slots_page_idx on dayuse_slots (page_id)
  where page_id is not null;

-- A recorrência também: as datas que ela gera nascem já dentro da página
-- (features/dayuse/generation.ts copia o page_id), senão a arena teria de
-- vincular data por data toda semana.
alter table dayuse_recurrences
  add column if not exists page_id uuid references dayuse_pages(id) on delete set null;

-- RLS: leitura pública do que está publicado (a página abre sem login). Escrita
-- só por service role, como o resto do day use. Policies já no formato
-- InitPlan (ver 20260809000000_escala_rls_e_indices.sql).
alter table dayuse_pages enable row level security;

drop policy if exists "dayuse_pages_public_read" on dayuse_pages;
create policy "dayuse_pages_public_read" on dayuse_pages
  for select to anon, authenticated
  using (is_published = true);

drop policy if exists "dayuse_pages_admin" on dayuse_pages;
create policy "dayuse_pages_admin" on dayuse_pages
  for all to authenticated
  using (organization_id in (select auth_admin_org_ids()));
