-- Multi-vínculo (Plano 3) — parte 1/2: cutover de profiles para identidade.
-- Remove toda referência a colunas por-academia de profiles em funções/triggers/RLS,
-- para que a parte 2/2 (20260624000100) possa dropá-las. NÃO dropa colunas aqui.
--
-- Renomeada de 20260623000000 para 20260624000000: a 20260623000000 já foi usada pelo
-- hotfix de produção (fix_adjust_credits_row_count).

-- 1. handle_new_user: grava apenas identidade em profiles + cria a membership inicial.
--    Os campos por-academia (parceiro de check-in incluso) vão para a membership.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_partner    text := new.raw_user_meta_data->>'pending_partner';
  v_partner_id text := new.raw_user_meta_data->>'partner_id';
  v_invite     text := new.raw_user_meta_data->>'org_invite_code';
  v_org        uuid;
  v_pp         checkin_partner := case when v_partner in ('wellhub','totalpass') then v_partner::checkin_partner else null end;
  v_wellhub    text := case when v_partner = 'wellhub' then nullif(v_partner_id, '') else null end;
  v_totalpass  text := case when v_partner = 'totalpass' then nullif(v_partner_id, '') else null end;
begin
  select id into v_org
    from organizations
    where invite_code = v_invite and status = 'active';

  if v_org is null then
    select id into v_org from organizations where is_default limit 1;
  end if;

  -- profiles agora é só identidade.
  insert into public.profiles (id, full_name, avatar_url, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    new.raw_user_meta_data->>'avatar_url',
    new.raw_user_meta_data->>'phone'
  );

  -- Campos por-academia (inclusive parceiro de check-in) vão para a membership.
  if v_org is not null then
    insert into public.memberships (
      user_id, organization_id, role, pending_partner, wellhub_id, totalpass_id
    )
    values (new.id, v_org, 'student', v_pp, v_wellhub, v_totalpass)
    on conflict (user_id, organization_id) do nothing;
  end if;

  return new;
end;
$$;

-- 2. adjust_credits: remove o update de fonte dupla em profiles.
--    Mantém a contagem como INTEGER (v_rows) — o bug do hotfix 20260623000000 foi
--    declará-la boolean; NÃO reintroduzir isso aqui.
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
  v_rows int;
begin
  update memberships
  set credits_balance = credits_balance + p_delta
  where user_id = p_student_id
    and organization_id = p_org
    and credits_balance + p_delta >= 0;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    perform 1 from memberships where user_id = p_student_id and organization_id = p_org;
    if not found then
      raise exception 'STUDENT_NOT_FOUND';
    end if;
    raise exception 'INSUFFICIENT_CREDITS';
  end if;

  insert into credit_transactions (student_id, organization_id, type, amount, reason, session_id, expires_at)
  values (p_student_id, p_org, p_type::credit_transaction_type, p_delta, p_reason, p_session_id, p_expires_at);
end;
$$;

revoke all on function public.adjust_credits(uuid, uuid, int, text, text, uuid, timestamptz) from public, anon, authenticated;

-- 3. book_session_atomic: passa a derivar organization_id da SESSÃO (class_sessions),
--    em vez de depender do trigger trg_set_org (que derivava de profiles e é removido
--    no passo 4). A org de um booking é a da academia dona da sessão — o que é correto
--    para multi-vínculo (o aluno reserva uma sessão de uma academia específica).
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
  v_org uuid;
begin
  perform pg_advisory_xact_lock(hashtext(p_session_id::text));

  select organization_id into v_org from class_sessions where id = p_session_id;
  if v_org is null then
    raise exception 'SESSION_NOT_FOUND';
  end if;

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

  insert into session_bookings (student_id, session_id, organization_id, type, status, from_enrollment, credit_used)
  values (p_student_id, p_session_id, v_org, p_type::booking_type, 'confirmed'::booking_status, p_from_enrollment, p_credit_used)
  returning id into v_booking_id;

  return v_booking_id;
end;
$$;

revoke all on function public.book_session_atomic(uuid, uuid, int, text, boolean, boolean) from public, anon, authenticated;

-- 4. Remove os triggers de autofill que derivavam organization_id de PROFILES.
--    O app (e as RPCs acima) passam a informar organization_id explicitamente nesses
--    inserts. Os triggers que derivam de pais que AINDA têm organization_id
--    (class_sessions<-classes, dayuse_bookings<-dayuse_slots, tournament_matches<-
--    tournaments, tournament_registrations<-tournaments, trial_bookings<-class_sessions)
--    permanecem.
do $$
declare
  t text;
  profiles_derived text[] := array[
    'enrollments', 'session_bookings', 'attendance', 'credit_transactions',
    'student_subscriptions', 'payments', 'tournaments', 'posts', 'post_likes',
    'post_comments', 'notifications', 'checkins', 'waitlists', 'dayuse_slots',
    'medical_profiles'
  ];
begin
  foreach t in array profiles_derived loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists trg_set_org on public.%I;', t);
    end if;
  end loop;
end $$;

-- 5. RLS de profiles: admin enxerga/edita um perfil se houver membership ligando esse
--    perfil a uma academia que o admin administra (substitui is_org_admin(profiles.organization_id)).
drop policy if exists "profiles_select_admin_org" on profiles;
drop policy if exists "profiles_update_admin_org" on profiles;
drop policy if exists "profiles_insert_admin_org" on profiles;

create policy "profiles_select_admin_org" on profiles for select using (
  exists (
    select 1 from memberships m
    where m.user_id = profiles.id and is_org_admin(m.organization_id)
  )
);
create policy "profiles_update_admin_org" on profiles for update using (
  exists (
    select 1 from memberships m
    where m.user_id = profiles.id and is_org_admin(m.organization_id)
  )
);
-- profiles é criado pelo trigger (service role); não há insert via authenticated.

-- Policies de SELECT/UPDATE do próprio perfil (id = auth.uid()) permanecem como estão.
