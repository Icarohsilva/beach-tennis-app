-- Fundação multi-tenant (Plano 1) — parte 4/6
-- handle_new_user passa a gravar organization_id: resolve pela academia do código de
-- convite (metadata org_invite_code) e cai na org default quando ausente/inválido.
-- Assim o cadastro de produção (sem código) continua entrando na academia Hudson.
-- Mantém a lógica de parceiro (pending_partner / wellhub_id / totalpass_id) do fix anterior.

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
    case when v_partner in ('wellhub','totalpass') then v_partner::public.checkin_partner else null end,
    case when v_partner = 'wellhub' then nullif(v_partner_id, '') else null end,
    case when v_partner = 'totalpass' then nullif(v_partner_id, '') else null end
  );
  return new;
end;
$$;
