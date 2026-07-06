-- Mesma classe de bug da Task 14 (record_student_subscription_payment),
-- desta vez em handleOrgCheckoutPayment: marcar payments.status='paid' e
-- depois chamar adjust_credits eram duas escritas separadas. Se a segunda
-- falhasse (ou o processo caísse entre as duas), o pagamento ficava "pago"
-- para sempre sem crédito nenhum — e uma reentrega do MP batia no
-- status='paid' já setado e retornava sem tentar de novo. Uma RPC com as
-- duas escritas na mesma transação garante tudo-ou-nada: se adjust_credits
-- falhar, o rollback desfaz também a marcação de pago, deixando o pagamento
-- ainda 'pending' para a próxima reentrega processar do zero.
create or replace function public.record_checkout_credit_purchase(
  p_payment_id uuid,
  p_gateway_payment_id text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student_id uuid;
  v_org_id uuid;
  v_credits_qty int;
begin
  update payments
  set status = 'paid',
      paid_at = now(),
      gateway_payment_id = p_gateway_payment_id
  where id = p_payment_id
    and status = 'pending'
    and type = 'per_class'
  returning student_id, organization_id, credits_qty
    into v_student_id, v_org_id, v_credits_qty;

  if not found then
    -- Reentrega do MP (já processado) ou payment não é per_class/pending.
    return false;
  end if;

  if v_credits_qty is not null and v_credits_qty > 0 then
    perform public.adjust_credits(
      v_student_id, v_org_id, v_credits_qty, 'purchased',
      format('Compra de aula avulsa (%sx) — pagamento %s', v_credits_qty, p_gateway_payment_id)
    );
  end if;

  return true;
end;
$$;

revoke all on function public.record_checkout_credit_purchase(uuid, text) from public, anon, authenticated;
