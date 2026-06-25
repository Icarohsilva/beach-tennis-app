-- Bucket de Storage para logos das academias (white-label co-branded).
-- Leitura pública (logos aparecem no app do aluno, admin e página pública).
-- Escrita restrita ao DONO da academia; organization_id é o 1º segmento do path
-- (ex.: org-logos/{organization_id}/logo.png). Idempotente.

-- Cria o bucket público (id = name = 'org-logos').
insert into storage.buckets (id, name, public)
values ('org-logos', 'org-logos', true)
on conflict (id) do update set public = true;

-- Leitura pública (qualquer um lê os objetos do bucket).
drop policy if exists "org-logos public read" on storage.objects;
create policy "org-logos public read"
  on storage.objects for select
  using (bucket_id = 'org-logos');

-- INSERT restrito ao dono da org cujo id é o 1º segmento do path.
drop policy if exists "org-logos owner insert" on storage.objects;
create policy "org-logos owner insert"
  on storage.objects for insert
  with check (
    bucket_id = 'org-logos'
    and exists (
      select 1 from organizations o
      where o.id::text = (storage.foldername(name))[1]
        and o.owner_id = auth.uid()
    )
  );

-- UPDATE restrito ao dono. with check espelha using para impedir mover o objeto
-- para um path de outra org durante o update (defesa em profundidade).
drop policy if exists "org-logos owner update" on storage.objects;
create policy "org-logos owner update"
  on storage.objects for update
  using (
    bucket_id = 'org-logos'
    and exists (
      select 1 from organizations o
      where o.id::text = (storage.foldername(name))[1]
        and o.owner_id = auth.uid()
    )
  )
  with check (
    bucket_id = 'org-logos'
    and exists (
      select 1 from organizations o
      where o.id::text = (storage.foldername(name))[1]
        and o.owner_id = auth.uid()
    )
  );

-- DELETE restrito ao dono.
drop policy if exists "org-logos owner delete" on storage.objects;
create policy "org-logos owner delete"
  on storage.objects for delete
  using (
    bucket_id = 'org-logos'
    and exists (
      select 1 from organizations o
      where o.id::text = (storage.foldername(name))[1]
        and o.owner_id = auth.uid()
    )
  );
