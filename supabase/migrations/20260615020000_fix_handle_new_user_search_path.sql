-- Fix "Database error saving new user".
-- handle_new_user roda no contexto do role supabase_auth_admin (GoTrue insere em auth.users),
-- cujo search_path NÃO inclui public. O cast para o tipo customizado `checkin_partner` (sem schema)
-- não resolve em tempo de planejamento, derrubando TODO signup — mesmo sem parceiro declarado.
-- Correção: fixa search_path = public na função e qualifica o tipo com public.

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_partner text := new.raw_user_meta_data->>'pending_partner';
  v_partner_id text := new.raw_user_meta_data->>'partner_id';
begin
  insert into public.profiles (id, full_name, avatar_url, phone, pending_partner, wellhub_id, totalpass_id)
  values (
    new.id,
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
