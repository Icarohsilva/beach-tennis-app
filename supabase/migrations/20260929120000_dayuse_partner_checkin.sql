-- supabase/migrations/20260929120000_dayuse_partner_checkin.sql
-- Day use com check-in de Wellhub (ex-Gympass) ou TotalPass.
--
-- A arena controlava isso no grupo do WhatsApp ("quem for de Gympass, avisa os
-- meninos do quiosque"), porque nada no app dizia quem vinha por parceiro.
-- Agora a pessoa escolhe o parceiro ao reservar e a reserva guarda isso no
-- MÉTODO de pagamento: quem é parceiro não paga a arena, paga o app dele.
--
-- A reserva nasce `confirmed` e SEM `payments`: não há dívida com a arena. O
-- que falta é o quiosque validar o check-in no app do parceiro, e é isso que
-- `partner_checkin_at` registra. Se o check-in não passar, o admin converte a
-- reserva em `on_site` e ela vira cobrança na porta (features/dayuse/actions.ts).
--
-- Quais parceiros a arena aceita mora em system_settings (key
-- `day_use_partners`, "wellhub,totalpass"), sem coluna nova: é configuração da
-- academia, igual a `day_use_price`.
-- `partner_checkin_by` SEM foreign key de propósito: dayuse_bookings já tem uma
-- FK para profiles (student_id), e uma segunda deixaria ambíguo o embed
-- `profiles(...)` que as telas fazem — o PostgREST recusa a consulta inteira.
alter table dayuse_bookings
  add column if not exists partner_checkin_at timestamptz,
  add column if not exists partner_checkin_by uuid;

comment on column dayuse_bookings.partner_checkin_at is
  'Quando o quiosque validou o check-in do parceiro (payment_method wellhub/totalpass). Nulo = ainda não validado.';

alter table dayuse_bookings drop constraint if exists dayuse_bookings_payment_method_check;
alter table dayuse_bookings add constraint dayuse_bookings_payment_method_check
  check (payment_method in ('free', 'wallet', 'mercadopago', 'pix_manual', 'on_site', 'wellhub', 'totalpass'));

comment on column dayuse_bookings.payment_method is
  'free | wallet | mercadopago | pix_manual | on_site | wellhub | totalpass. Define a janela de hold_until (lib/dayuse/paymentMethod.ts); on_site confirma na hora e deixa payments pendente para o admin dar baixa; wellhub/totalpass confirmam na hora, sem payments, e esperam o quiosque validar o check-in (partner_checkin_at).';

-- A RPC de reserva valida o método; sem recriá-la, `wellhub`/`totalpass`
-- seriam recusados com INVALID_PAYMENT_METHOD. Só a lista de valores muda em
-- relação a 20260910190000 — o resto vai idêntico para o `create or replace`
-- não perder comportamento (advisory lock, ALREADY_BOOKED, SLOT_FULL, hold).
create or replace function public.book_dayuse_atomic(
  p_student_id uuid,
  p_slot_id uuid,
  p_status text default 'confirmed',
  p_payment_method text default 'free',
  p_hold_until timestamptz default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_capacity int;
  v_org uuid;
  v_count int;
  v_booking_id uuid;
begin
  if p_status not in ('confirmed', 'pending_payment') then
    raise exception 'INVALID_STATUS';
  end if;
  if p_payment_method not in ('free', 'wallet', 'mercadopago', 'pix_manual', 'on_site', 'wellhub', 'totalpass') then
    raise exception 'INVALID_PAYMENT_METHOD';
  end if;

  perform pg_advisory_xact_lock(hashtext('dayuse:' || p_slot_id::text));

  select capacity, organization_id into v_capacity, v_org
  from dayuse_slots
  where id = p_slot_id and is_active = true;

  if v_capacity is null then
    raise exception 'SLOT_NOT_FOUND';
  end if;

  perform 1 from dayuse_bookings
  where slot_id = p_slot_id and student_id = p_student_id
    and (status = 'confirmed'
         or (status = 'pending_payment'
             and coalesce(hold_until, booked_at + interval '30 minutes') > now()));
  if found then
    raise exception 'ALREADY_BOOKED';
  end if;

  select count(*) into v_count
  from dayuse_bookings
  where slot_id = p_slot_id
    and (status = 'confirmed'
         or (status = 'pending_payment'
             and coalesce(hold_until, booked_at + interval '30 minutes') > now()));

  if v_count >= v_capacity then
    raise exception 'SLOT_FULL';
  end if;

  insert into dayuse_bookings (
    slot_id, student_id, organization_id, status, payment_method, hold_until
  )
  values (
    p_slot_id, p_student_id, v_org, p_status, p_payment_method,
    case when p_status = 'pending_payment' then p_hold_until else null end
  )
  returning id into v_booking_id;

  return v_booking_id;
end;
$$;

revoke all on function public.book_dayuse_atomic(uuid, uuid, text, text, timestamptz)
  from public, anon, authenticated;
