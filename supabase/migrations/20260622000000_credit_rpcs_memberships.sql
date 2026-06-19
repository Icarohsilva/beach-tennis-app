-- Multi-vínculo (Plano 2) — RPC de crédito por academia.
-- adjust_credits ganha p_org: atualiza memberships.credits_balance da (aluno, org) e,
-- por fonte dupla (até o Plano 3), também profiles.credits_balance. Mantém a inserção
-- em credit_transactions. Assinatura antiga é removida para evitar ambiguidade.

drop function if exists public.adjust_credits(uuid, int, text, text, uuid, timestamptz);

create or replace function public.adjust_credits(
  p_student_id uuid,
  p_org uuid,
  p_delta int,
  p_type text,
  p_reason text,
  p_session_id uuid default null,
  p_expires_at timestamptz default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_found boolean;
begin
  update memberships
  set credits_balance = credits_balance + p_delta
  where user_id = p_student_id
    and organization_id = p_org
    and credits_balance + p_delta >= 0;

  get diagnostics v_found = row_count;
  if v_found = 0 then
    perform 1 from memberships where user_id = p_student_id and organization_id = p_org;
    if not found then
      raise exception 'STUDENT_NOT_FOUND';
    end if;
    raise exception 'INSUFFICIENT_CREDITS';
  end if;

  -- Fonte dupla: mantém profiles.credits_balance em sincronia (removido no Plano 3).
  update profiles set credits_balance = credits_balance + p_delta where id = p_student_id;

  insert into credit_transactions (student_id, organization_id, type, amount, reason, session_id, expires_at)
  values (p_student_id, p_org, p_type::credit_transaction_type, p_delta, p_reason, p_session_id, p_expires_at);
end;
$$;

revoke all on function public.adjust_credits(uuid, uuid, int, text, text, uuid, timestamptz) from public, anon, authenticated;
