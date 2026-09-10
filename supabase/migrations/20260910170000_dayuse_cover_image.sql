-- supabase/migrations/20260910170000_dayuse_cover_image.sql
-- Imagem de capa do day use, para o link compartilhado no WhatsApp ter cara.
--
-- Link nu no grupo não é clicado: quem recebe não sabe o que é. O preview de OG
-- de /d/[id] já existia, mas caía no logo da academia — a foto da areia daquele
-- domingo vende o day use, o logo não.
--
-- Bucket próprio e PÚBLICO, no molde de `tournament-images` (20260628000200):
-- a imagem tem de ser buscável pelo servidor do WhatsApp, que não manda header
-- de autenticação nenhum. Não confundir com `payment-receipts`, que é privado e
-- servido por URL assinada — ali o conteúdo é comprovante bancário.
alter table dayuse_slots
  add column if not exists cover_image_url text;

comment on column dayuse_slots.cover_image_url is
  'URL pública da capa (bucket dayuse-images). Usada no preview de OG de /d/[id] e no compartilhamento.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'dayuse-images',
  'dayuse-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- Upload só por admin de alguma academia. Mesma policy de tournament-images:
-- o caminho não carrega o id da academia (o nome do arquivo é um uuid), então a
-- checagem é de papel, não de dono.
drop policy if exists "dayuse-images upload" on storage.objects;
create policy "dayuse-images upload"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'dayuse-images'
    and (select auth.uid()) in (select user_id from memberships where role = 'admin')
  );

drop policy if exists "dayuse-images public read" on storage.objects;
create policy "dayuse-images public read"
  on storage.objects for select
  using (bucket_id = 'dayuse-images');
