-- supabase/migrations/20260910150000_dayuse_pix_manual_hold.sql
-- Day use aceita PIX manual (chave da arena + comprovante), e a vaga passa a
-- ter prazo POR MÉTODO em vez de 30 minutos para todos.
--
-- Os 30 min estavam cravados dentro de `book_dayuse_atomic` e serviam ao
-- Checkout Pro, que confirma por webhook em segundos. PIX manual tem gargalo
-- humano: a pessoa paga, sobe o comprovante e alguém da arena confere. Com a
-- janela do webhook, a reserva perdia a vaga antes de qualquer um olhar para
-- ela — e o aluno pagava um PIX por uma vaga que já não existia.
--
-- `hold_until` como COLUNA e não como `case` sobre o método dentro da RPC: o
-- prazo passa a ser dado visível (dá para consultar, corrigir na mão e explicar
-- ao aluno) em vez de regra escondida em duas funções. As janelas por método
-- vivem em lib/dayuse/paymentMethod.ts, que é quem preenche a coluna.

alter table dayuse_bookings
  add column if not exists payment_method text not null default 'free',
  add column if not exists hold_until timestamptz;

alter table dayuse_bookings drop constraint if exists dayuse_bookings_payment_method_check;
alter table dayuse_bookings add constraint dayuse_bookings_payment_method_check
  check (payment_method in ('free', 'wallet', 'mercadopago', 'pix_manual'));

-- Comprovante do PIX manual: caminho no bucket privado `payment-receipts`.
alter table dayuse_bookings
  add column if not exists receipt_url text,
  add column if not exists receipt_uploaded_at timestamptz;

comment on column dayuse_bookings.payment_method is
  'free | wallet | mercadopago | pix_manual. Define a janela de hold_until (lib/dayuse/paymentMethod.ts).';
comment on column dayuse_bookings.hold_until is
  'Até quando a reserva pendente ocupa vaga. NULL = confirmada (sem prazo) ou linha anterior a esta migração.';
comment on column dayuse_bookings.receipt_url is
  'Comprovante do PIX manual, no bucket payment-receipts. Conferido por admin.';

-- Backfill: linha antiga pendente mantém exatamente o comportamento que tinha
-- (30 min desde booked_at). Sem isto, `hold_until is null` nas pendentes
-- existentes as trataria como sem prazo e elas segurariam vaga para sempre.
update dayuse_bookings
   set hold_until = booked_at + interval '30 minutes'
 where status = 'pending_payment'
   and hold_until is null;

-- E o método das linhas antigas: pendente/confirmada com pagamento veio do
-- Checkout Pro, que era o único caminho pago que existia.
update dayuse_bookings b
   set payment_method = 'mercadopago'
  where payment_method = 'free'
    and exists (select 1 from payments p where p.dayuse_booking_id = b.id);

create index if not exists dayuse_bookings_pending_hold_idx
  on dayuse_bookings (organization_id, hold_until)
  where status = 'pending_payment';

-- ---------------------------------------------------------------------------
-- book_dayuse_atomic: conta ocupação por `hold_until`, não por "30 min".
--
-- Mesma estrutura de antes (advisory lock por slot, ALREADY_BOOKED, SLOT_FULL);
-- as mudanças são o critério de "pendente ainda vale" e os dois parâmetros
-- novos, que o caller preenche a partir do método escolhido.
--
-- `coalesce(hold_until, booked_at + interval '30 minutes')` cobre linha antiga
-- que a migração não tenha alcançado (inserida entre o backfill e o deploy).
-- ---------------------------------------------------------------------------
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
  if p_payment_method not in ('free', 'wallet', 'mercadopago', 'pix_manual') then
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

revoke all on function public.book_dayuse_atomic(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.book_dayuse_atomic(uuid, uuid, text, text, timestamptz)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- record_dayuse_checkout_payment: mesma troca de critério.
--
-- `p_fresh_minutes` fica na assinatura e passa a valer só como fallback de
-- linha sem `hold_until` — remover o parâmetro quebraria chamada em voo durante
-- o deploy.
-- ---------------------------------------------------------------------------
create or replace function public.record_dayuse_checkout_payment(
  p_payment_id uuid,
  p_gateway_payment_id text,
  p_fresh_minutes int default 30
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking_id uuid;
  v_slot_id uuid;
  v_rows int;
begin
  select b.slot_id into v_slot_id
  from payments p
  join dayuse_bookings b on b.id = p.dayuse_booking_id
  where p.id = p_payment_id;

  if v_slot_id is not null then
    perform pg_advisory_xact_lock(hashtext('dayuse:' || v_slot_id::text));
  end if;

  update payments
  set status = 'paid',
      paid_at = now(),
      gateway_payment_id = p_gateway_payment_id
  where id = p_payment_id
    and status = 'pending'
    and type = 'day_use'
  returning dayuse_booking_id into v_booking_id;

  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    -- Reentrega do MP (já processado) ou payment não é day_use/pending.
    return false;
  end if;

  if v_booking_id is not null then
    -- Dentro do prazo → confirma e zera o hold (confirmada não tem prazo).
    -- Fora do prazo → cancela; o webhook trata isso abrindo estorno
    -- (checkoutHandlers.ts), porque o dinheiro entrou e a vaga não existe mais.
    update dayuse_bookings
    set status = case
          when coalesce(hold_until, booked_at + make_interval(mins => p_fresh_minutes)) > now()
            then 'confirmed'
          else 'cancelled'
        end,
        hold_until = null,
        cancelled_at = case
          when coalesce(hold_until, booked_at + make_interval(mins => p_fresh_minutes)) > now()
            then cancelled_at
          else now()
        end
    where id = v_booking_id
      and status = 'pending_payment';
  end if;

  return true;
end;
$$;

revoke all on function public.record_dayuse_checkout_payment(uuid, text, int)
  from public, anon, authenticated;
