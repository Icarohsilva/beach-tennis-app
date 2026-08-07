-- Co-propriedade de academia: além do owner_id original (fundador), um admin
-- pode ser marcado is_co_owner=true na membership e passa a ter as mesmas
-- permissões de dono (financeiro/configurações/equipe/refund/logo), sem
-- substituir owner_id. isOwner em getStaffContext() passa a considerar
-- owner_id OU is_co_owner.

alter table memberships add column if not exists is_co_owner boolean not null default false;

-- org-logos: escrita liberada também pra co-donos.
drop policy if exists "org-logos owner insert" on storage.objects;
create policy "org-logos owner insert"
  on storage.objects for insert
  with check (
    bucket_id = 'org-logos'
    and exists (
      select 1 from organizations o
      where o.id::text = (storage.foldername(name))[1]
        and (
          o.owner_id = auth.uid()
          or exists (
            select 1 from memberships m
            where m.organization_id = o.id and m.user_id = auth.uid() and m.is_co_owner = true
          )
        )
    )
  );

drop policy if exists "org-logos owner update" on storage.objects;
create policy "org-logos owner update"
  on storage.objects for update
  using (
    bucket_id = 'org-logos'
    and exists (
      select 1 from organizations o
      where o.id::text = (storage.foldername(name))[1]
        and (
          o.owner_id = auth.uid()
          or exists (
            select 1 from memberships m
            where m.organization_id = o.id and m.user_id = auth.uid() and m.is_co_owner = true
          )
        )
    )
  )
  with check (
    bucket_id = 'org-logos'
    and exists (
      select 1 from organizations o
      where o.id::text = (storage.foldername(name))[1]
        and (
          o.owner_id = auth.uid()
          or exists (
            select 1 from memberships m
            where m.organization_id = o.id and m.user_id = auth.uid() and m.is_co_owner = true
          )
        )
    )
  );

drop policy if exists "org-logos owner delete" on storage.objects;
create policy "org-logos owner delete"
  on storage.objects for delete
  using (
    bucket_id = 'org-logos'
    and exists (
      select 1 from organizations o
      where o.id::text = (storage.foldername(name))[1]
        and (
          o.owner_id = auth.uid()
          or exists (
            select 1 from memberships m
            where m.organization_id = o.id and m.user_id = auth.uid() and m.is_co_owner = true
          )
        )
    )
  );

-- platform_refund_requests: solicitar/ver reembolso também liberado pra co-donos.
drop policy if exists "platform_refund_insert_owner" on platform_refund_requests;
create policy "platform_refund_insert_owner" on platform_refund_requests
  for insert to authenticated with check (
    exists (
      select 1 from organizations o
      where o.id = organization_id
        and (
          o.owner_id = auth.uid()
          or exists (
            select 1 from memberships m
            where m.organization_id = o.id and m.user_id = auth.uid() and m.is_co_owner = true
          )
        )
    )
  );

drop policy if exists "platform_refund_select_owner" on platform_refund_requests;
create policy "platform_refund_select_owner" on platform_refund_requests
  for select to authenticated using (
    exists (
      select 1 from organizations o
      where o.id = organization_id
        and (
          o.owner_id = auth.uid()
          or exists (
            select 1 from memberships m
            where m.organization_id = o.id and m.user_id = auth.uid() and m.is_co_owner = true
          )
        )
    )
  );
