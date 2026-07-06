-- Mesma classe de bug já corrigida duas vezes neste plano (Task 14:
-- record_student_subscription_payment; Task 15: record_checkout_credit_purchase):
-- marcar payments.status='paid' e confirmar a reserva de day use eram (no
-- desenho original) duas escritas separadas. Esta RPC faz as duas na mesma
-- transação desde o início — nunca chegou a existir em produção o caminho
-- não-atômico para day use.
--
-- A checagem de "ainda está dentro do prazo de 30min" também precisa
-- acontecer DENTRO da transação (não numa leitura anterior), senão uma
-- reserva que expira bem no meio do processamento do webhook poderia ser
-- confirmada com base num estado já stale.
--
-- Toma o MESMO advisory lock de book_dayuse_atomic (hashtext('dayuse:'||slot_id))
-- antes de decidir confirmar/cancelar. Sem isso, um webhook lento processando
-- perto da fronteira dos 30min e uma nova reserva concorrente no mesmo slot
-- usam relógios (`now()`) independentes: o webhook pode confirmar a reserva
-- pendente como "fresca" enquanto a nova reserva, rodando alguns segundos
-- depois, já a considera "vencida" na contagem de capacidade — as duas
-- prosseguem sem se ver, e o slot fica com mais ocupantes que a capacidade.
-- O lock compartilhado serializa as duas RPCs sobre o mesmo slot.
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
  -- Descobre o slot da reserva ligada a este pagamento ANTES de decidir
  -- confirmar/cancelar, para poder travar no mesmo lock de book_dayuse_atomic.
  -- slot_id é imutável por reserva, então essa leitura é segura sem o lock.
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
    -- Dentro do prazo → confirma. Fora do prazo → cancela (a vaga já pode
    -- ter sido retomada; o pagamento fica "paid" órfão e aparece como
    -- reembolso pendente no financeiro do admin — spec §3.5).
    update dayuse_bookings
    set status = case
          when booked_at > now() - make_interval(mins => p_fresh_minutes) then 'confirmed'
          else 'cancelled'
        end,
        cancelled_at = case
          when booked_at > now() - make_interval(mins => p_fresh_minutes) then cancelled_at
          else now()
        end
    where id = v_booking_id
      and status = 'pending_payment';
  end if;

  return true;
end;
$$;

revoke all on function public.record_dayuse_checkout_payment(uuid, text, int) from public, anon, authenticated;
