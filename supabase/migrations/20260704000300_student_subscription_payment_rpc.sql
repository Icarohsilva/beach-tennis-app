-- Corrige uma falha de atomicidade em handleStudentRecurringPayment (Task 14
-- do plano de financeiro): o insert em `payments` (âncora de idempotência) e
-- o avanço de `current_period_end`/`next_billing_at` em `student_subscriptions`
-- eram duas chamadas separadas, não uma transação. Se a segunda falhasse (ou
-- o processo caísse entre as duas), o pagamento ficava marcado como pago mas
-- o período nunca avançava — e uma reentrega do MP (mesmo gateway_payment_id)
-- batia no unique index, retornava cedo, e NUNCA mais tentava avançar o
-- período. Uma RPC com as duas escritas na mesma transação garante que ou as
-- duas acontecem, ou nenhuma.
create or replace function public.record_student_subscription_payment(
  p_subscription_id uuid,
  p_organization_id uuid,
  p_student_id uuid,
  p_amount numeric,
  p_gateway_payment_id text,
  p_next_period_end timestamptz
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows int;
begin
  insert into payments (
    organization_id, student_id, subscription_id, amount, currency,
    status, type, gateway, gateway_payment_id, paid_at
  )
  values (
    p_organization_id, p_student_id, p_subscription_id, p_amount, 'BRL',
    'paid', 'subscription', 'mercadopago', p_gateway_payment_id, now()
  )
  on conflict (gateway, gateway_payment_id) where gateway_payment_id is not null
  do nothing;

  get diagnostics v_rows = row_count;

  -- 0 linhas inseridas = reentrega do MP (gateway_payment_id já processado).
  -- Não avança o período de novo — já avançou na entrega original.
  if v_rows = 0 then
    return false;
  end if;

  update student_subscriptions
  set status = 'active',
      current_period_end = p_next_period_end,
      next_billing_at = p_next_period_end
  where id = p_subscription_id;

  return true;
end;
$$;

revoke all on function public.record_student_subscription_payment(uuid, uuid, uuid, numeric, text, timestamptz) from public, anon, authenticated;
