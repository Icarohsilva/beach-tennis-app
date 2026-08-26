-- supabase/migrations/20260826000900_payments_tournament_entry.sql
-- Liga o Checkout Pro (já em uso para crédito avulso, dívida de aula e day
-- use — lib/billing/mpClient.ts) ao pagamento por atleta de torneio. payments
-- ganha o vínculo com a inscrição + o lado (titular/parceiro) para o webhook
-- saber qual metade da dupla dar baixa — a dupla fixa é cobrada por atleta
-- (Fase 2a), então uma cobrança avulsa por inscrição perderia essa distinção.
alter table payments
  add column if not exists tournament_entry_id uuid references tournament_entries(id) on delete set null,
  add column if not exists tournament_entry_side text check (tournament_entry_side in ('player', 'partner'));

-- Baixa atômica do checkout de inscrição de torneio: marca payments pago E o
-- lado certo de tournament_entries na mesma transação — mesmo padrão de
-- record_dayuse_checkout_payment / record_checkout_credit_purchase (a
-- alternativa, duas escritas separadas do webhook, já causou payment "pago"
-- sem o efeito correspondente quando a segunda escrita falhava).
create or replace function public.record_tournament_entry_checkout_payment(
  p_payment_id uuid,
  p_gateway_payment_id text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry_id uuid;
  v_side text;
  v_rows int;
begin
  update payments
  set status = 'paid',
      paid_at = now(),
      gateway_payment_id = p_gateway_payment_id,
      settled_method = 'mercadopago'
  where id = p_payment_id
    and status = 'pending'
    and type = 'tournament_entry'
  returning tournament_entry_id, tournament_entry_side into v_entry_id, v_side;

  get diagnostics v_rows = row_count;
  if v_rows = 0 or v_entry_id is null then
    -- Reentrega do MP (já processado) ou payment não é de inscrição de torneio.
    return false;
  end if;

  if v_side = 'partner' then
    update tournament_entries set partner_payment_status = 'paid'
      where id = v_entry_id and partner_payment_status = 'pending';
  else
    update tournament_entries set payment_status = 'paid'
      where id = v_entry_id and payment_status = 'pending';
  end if;

  return true;
end;
$$;

revoke all on function public.record_tournament_entry_checkout_payment(uuid, text) from public, anon, authenticated;
