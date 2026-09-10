-- supabase/migrations/20260910190000_dayuse_on_site_payment.sql
-- Day use pago NA ARENA.
--
-- Faltava o caso mais comum de todos: a arena define R$ 20, o aluno reserva
-- pelo app e paga na hora, na porta. Sem este método o app tratava esse day use
-- como GRATUITO — a tela do aluno anunciava "Gratuito" um horário de R$ 20, e a
-- arena não tinha onde marcar quem já havia pago.
--
-- Com `on_site` a reserva nasce confirmada (não há pagamento online a esperar) e
-- um `payments` pendente com `gateway = 'on_site'` guarda a dívida, para o admin
-- dar baixa na tela do day use. É o mesmo desenho da aula avulsa cobrada na
-- recepção, que já usa `payments.settled_method`.
alter table dayuse_bookings drop constraint if exists dayuse_bookings_payment_method_check;
alter table dayuse_bookings add constraint dayuse_bookings_payment_method_check
  check (payment_method in ('free', 'wallet', 'mercadopago', 'pix_manual', 'on_site'));

comment on column dayuse_bookings.payment_method is
  'free | wallet | mercadopago | pix_manual | on_site. Define a janela de hold_until (lib/dayuse/paymentMethod.ts); on_site confirma na hora e deixa payments pendente para o admin dar baixa.';

-- A RPC de reserva valida o método; sem recriá-la, `on_site` seria recusado com
-- INVALID_PAYMENT_METHOD. Só a lista de valores muda em relação a
-- 20260910150000 — o resto vai idêntico para o `create or replace` não perder
-- comportamento (advisory lock, ALREADY_BOOKED, SLOT_FULL, hold por método).
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
  if p_payment_method not in ('free', 'wallet', 'mercadopago', 'pix_manual', 'on_site') then
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
