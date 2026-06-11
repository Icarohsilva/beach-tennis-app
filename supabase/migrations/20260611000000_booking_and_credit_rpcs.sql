-- Atomicidade para créditos e capacidade de turma.

-- SECURITY DEFINER bypassa RLS intencionalmente; o acesso é restrito ao
-- service role via REVOKE de public/anon/authenticated no fim do arquivo.

-- Insere a transação de crédito e atualiza o saldo na mesma transação.
-- Bloqueia saldo negativo (raise INSUFFICIENT_CREDITS) e distingue
-- aluno inexistente (raise STUDENT_NOT_FOUND).
create or replace function public.adjust_credits(
  p_student_id uuid,
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
begin
  update profiles
  set credits_balance = credits_balance + p_delta
  where id = p_student_id
    and credits_balance + p_delta >= 0;

  if not found then
    perform 1 from profiles where id = p_student_id;
    if not found then
      raise exception 'STUDENT_NOT_FOUND';
    end if;
    raise exception 'INSUFFICIENT_CREDITS';
  end if;

  insert into credit_transactions (student_id, type, amount, reason, session_id, expires_at)
  values (p_student_id, p_type::credit_transaction_type, p_delta, p_reason, p_session_id, p_expires_at);
end;
$$;

-- Checa lotação e insere o booking sob lock por sessão (sem overbooking).
-- A tabela tem unique(student_id, session_id) cobrindo qualquer status:
-- um booking cancelado é REATIVADO (antes disso, reagendar a mesma sessão
-- após cancelar era impossível — violação de unique). Booking já confirmado
-- gera ALREADY_BOOKED.
create or replace function public.book_session_atomic(
  p_student_id uuid,
  p_session_id uuid,
  p_max_students int,
  p_type text default 'extra',
  p_from_enrollment boolean default false,
  p_credit_used boolean default false
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
  v_booking_id uuid;
  v_existing_status booking_status;
begin
  perform pg_advisory_xact_lock(hashtext(p_session_id::text));

  select count(*) into v_count
  from session_bookings
  where session_id = p_session_id and status = 'confirmed'::booking_status;

  if v_count >= p_max_students then
    raise exception 'SESSION_FULL';
  end if;

  select id, status into v_booking_id, v_existing_status
  from session_bookings
  where student_id = p_student_id and session_id = p_session_id;

  if found then
    if v_existing_status = 'confirmed'::booking_status then
      raise exception 'ALREADY_BOOKED';
    end if;

    update session_bookings
    set status = 'confirmed'::booking_status,
        type = p_type::booking_type,
        from_enrollment = p_from_enrollment,
        credit_used = p_credit_used,
        booked_at = now(),
        cancelled_at = null
    where id = v_booking_id;

    return v_booking_id;
  end if;

  insert into session_bookings (student_id, session_id, type, status, from_enrollment, credit_used)
  values (p_student_id, p_session_id, p_type::booking_type, 'confirmed'::booking_status, p_from_enrollment, p_credit_used)
  returning id into v_booking_id;

  return v_booking_id;
end;
$$;

revoke all on function public.adjust_credits(uuid, int, text, text, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.book_session_atomic(uuid, uuid, int, text, boolean, boolean) from public, anon, authenticated;
