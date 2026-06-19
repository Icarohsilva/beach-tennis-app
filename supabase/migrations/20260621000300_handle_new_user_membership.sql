-- Multi-vínculo (Plano 1) — parte 4/4
-- handle_new_user passa a criar TAMBÉM a membership inicial (role student) na academia
-- resolvida pelo invite_code. Continua gravando profiles.organization_id e os campos de
-- parceiro em profiles (fonte dupla — o drop dessas colunas é o Plano 3). Sem isso, um
-- cadastro novo no Plano 1 ficaria sem membership e a RLS (auth_org_ids) o bloquearia.

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_partner    text := new.raw_user_meta_data->>'pending_partner';
  v_partner_id text := new.raw_user_meta_data->>'partner_id';
  v_invite     text := new.raw_user_meta_data->>'org_invite_code';
  v_org        uuid;
  v_pp         checkin_partner := case when v_partner in ('wellhub','totalpass') then v_partner::checkin_partner else null end;
  v_wellhub    text := case when v_partner = 'wellhub' then nullif(v_partner_id, '') else null end;
  v_totalpass  text := case when v_partner = 'totalpass' then nullif(v_partner_id, '') else null end;
begin
  select id into v_org
    from organizations
    where invite_code = v_invite and status = 'active';

  if v_org is null then
    select id into v_org from organizations where is_default limit 1;
  end if;

  insert into public.profiles (
    id, organization_id, full_name, avatar_url, phone,
    pending_partner, wellhub_id, totalpass_id
  )
  values (
    new.id,
    v_org,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    new.raw_user_meta_data->>'avatar_url',
    new.raw_user_meta_data->>'phone',
    v_pp, v_wellhub, v_totalpass
  );

  -- Membership inicial (aluno) na academia resolvida. Idempotente por segurança.
  if v_org is not null then
    insert into public.memberships (
      user_id, organization_id, role, pending_partner, wellhub_id, totalpass_id
    )
    values (new.id, v_org, 'student', v_pp, v_wellhub, v_totalpass)
    on conflict (user_id, organization_id) do nothing;
  end if;

  return new;
end;
$$;
