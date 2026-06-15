-- Autodeclaração de parceiro (Gympass/TotalPass) no cadastro, pendente de confirmação.

alter table profiles
  add column if not exists pending_partner checkin_partner;

-- Trigger passa a gravar phone, pending_partner e o ID do parceiro declarado.
-- payment_type permanece o default da tabela até o admin confirmar.
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
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
    case when v_partner in ('wellhub','totalpass') then v_partner::checkin_partner else null end,
    case when v_partner = 'wellhub' then v_partner_id else null end,
    case when v_partner = 'totalpass' then v_partner_id else null end
  );
  return new;
end;
$$;
