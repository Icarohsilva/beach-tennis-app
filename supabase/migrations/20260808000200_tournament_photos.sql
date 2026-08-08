-- Liga Fase 4: mural de fotos dos torneios (spec §Fase 4).
--
-- Só a academia sobe foto. Não é preguiça de moderação: é a decisão de não ter fila de
-- moderação nenhuma. Com upload aberto ao aluno, alguém precisa revisar o que sobe, e
-- ninguém vai revisar.

create table if not exists tournament_photos (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  tournament_id    uuid not null references tournaments(id) on delete cascade,
  storage_path     text not null,
  caption          text,
  -- set null (não cascade): apagar o professor que subiu não pode apagar a foto do
  -- torneio, que é memória da academia inteira.
  uploaded_by      uuid references profiles(id) on delete set null,
  created_at       timestamptz not null default now()
);

create index if not exists tournament_photos_tournament_idx
  on tournament_photos (tournament_id, created_at desc);

create index if not exists tournament_photos_org_idx
  on tournament_photos (organization_id, created_at desc);

alter table tournament_photos enable row level security;

-- Leitura para quem é da academia. O torneio é público (/t/[id]) mas a galeria não:
-- foto de aluno não vai para uma URL compartilhável sem login.
drop policy if exists tournament_photos_read_own_org on tournament_photos;
create policy tournament_photos_read_own_org on tournament_photos for select to authenticated
  using (organization_id in (
    select organization_id from memberships where user_id = auth.uid()
  ));

-- ---------------------------------------------------------------------------
-- Bucket
-- ---------------------------------------------------------------------------
-- Privado, ao contrário de tournament-images (capa do torneio, que é divulgação).
-- Aqui são rostos de alunos: o app serve por URL assinada.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'tournament-photos',
  'tournament-photos',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- Sem policy de insert para `authenticated`: o upload passa por server action com
-- service role, guardada por requireAdmin. Mesma escolha de updateBranding.
drop policy if exists "tournament-photos read own org" on storage.objects;
create policy "tournament-photos read own org"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'tournament-photos'
    -- O path começa com o organization_id: `${orgId}/${tournamentId}/${uuid}.ext`.
    and (storage.foldername(name))[1] in (
      select organization_id::text from memberships where user_id = auth.uid()
    )
  );

comment on table tournament_photos is
  'Mural de fotos do torneio. Só a academia sobe (sem fila de moderação); bucket privado.';
