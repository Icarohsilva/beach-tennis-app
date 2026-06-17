-- Fundação multi-tenant (Plano 1) — parte 6/6
-- Reescreve TODA a RLS escopando por academia. Cada linha só é visível/gravável
-- por usuários da mesma organização (organization_id = auth_org_id()), preservando
-- as regras de papel já existentes (aluno vê o próprio; admin gere a academia dele).
--
-- IMPORTANTE: server actions usam service role (createAdminClient), que IGNORA a RLS.
-- A RLS protege o acesso direto via anon key (browser). O isolamento nas server actions
-- depende do filtro explícito por organization_id no código (ver auditoria do app).

-- is_admin() recriada com search_path fixo (robustez; mesmo motivo do fix do trigger).
create or replace function is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$$;

-- 1. Limpa todas as policies existentes nas tabelas tenant (independente do nome).
do $$
declare
  r record;
  tables text[] := array[
    'profiles', 'classes', 'class_sessions', 'enrollments', 'session_bookings',
    'attendance', 'credit_transactions', 'trial_bookings', 'subscription_plans',
    'student_subscriptions', 'payments', 'system_settings', 'tournaments',
    'tournament_matches', 'tournament_registrations', 'posts', 'post_likes',
    'post_comments', 'notifications', 'dayuse_slots', 'dayuse_bookings',
    'medical_profiles', 'checkins', 'waitlists'
  ];
begin
  for r in
    select policyname, tablename
    from pg_policies
    where schemaname = 'public' and tablename = any(tables)
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- 2. Recria as policies org-scoped.

-- profiles
create policy "profiles_select_own" on profiles for select using (id = auth.uid());
create policy "profiles_select_admin_org" on profiles for select using (is_admin() and organization_id = auth_org_id());
create policy "profiles_update_own" on profiles for update using (id = auth.uid());
create policy "profiles_update_admin_org" on profiles for update using (is_admin() and organization_id = auth_org_id());
create policy "profiles_insert_admin_org" on profiles for insert with check (is_admin() and organization_id = auth_org_id());

-- classes
create policy "classes_select_org" on classes for select using (organization_id = auth_org_id() and is_active = true);
create policy "classes_admin_org" on classes for all using (is_admin() and organization_id = auth_org_id());

-- class_sessions
create policy "class_sessions_select_org" on class_sessions for select using (organization_id = auth_org_id());
create policy "class_sessions_admin_org" on class_sessions for all using (is_admin() and organization_id = auth_org_id());

-- enrollments
create policy "enrollments_select_own" on enrollments for select using (student_id = auth.uid());
create policy "enrollments_admin_org" on enrollments for all using (is_admin() and organization_id = auth_org_id());

-- session_bookings
create policy "session_bookings_select_own" on session_bookings for select using (student_id = auth.uid());
create policy "session_bookings_insert_own" on session_bookings for insert with check (student_id = auth.uid() and organization_id = auth_org_id());
create policy "session_bookings_update_own" on session_bookings for update using (student_id = auth.uid());
create policy "session_bookings_admin_org" on session_bookings for all using (is_admin() and organization_id = auth_org_id());

-- attendance
create policy "attendance_select_own" on attendance for select using (student_id = auth.uid());
create policy "attendance_admin_org" on attendance for all using (is_admin() and organization_id = auth_org_id());

-- credit_transactions
create policy "credit_tx_select_own" on credit_transactions for select using (student_id = auth.uid());
create policy "credit_tx_select_admin_org" on credit_transactions for select using (is_admin() and organization_id = auth_org_id());
create policy "credit_tx_insert_admin_org" on credit_transactions for insert with check (is_admin() and organization_id = auth_org_id());

-- subscription_plans
create policy "plans_select_org" on subscription_plans for select using (organization_id = auth_org_id() and is_active = true);
create policy "plans_admin_org" on subscription_plans for all using (is_admin() and organization_id = auth_org_id());

-- student_subscriptions
create policy "subs_select_own" on student_subscriptions for select using (student_id = auth.uid() or payer_id = auth.uid());
create policy "subs_admin_org" on student_subscriptions for all using (is_admin() and organization_id = auth_org_id());

-- payments
create policy "payments_select_own" on payments for select using (student_id = auth.uid());
create policy "payments_select_admin_org" on payments for select using (is_admin() and organization_id = auth_org_id());

-- system_settings (por academia)
create policy "settings_admin_org" on system_settings for all using (is_admin() and organization_id = auth_org_id());

-- tournaments
create policy "tournaments_select_org" on tournaments for select using (organization_id = auth_org_id());
create policy "tournaments_admin_org" on tournaments for all using (is_admin() and organization_id = auth_org_id());

-- tournament_matches
create policy "matches_select_org" on tournament_matches for select using (organization_id = auth_org_id());
create policy "matches_admin_org" on tournament_matches for all using (is_admin() and organization_id = auth_org_id());

-- tournament_registrations: referenciada pelo app mas ausente em alguns ambientes
-- (não existe em migrations 001-005 nem em produção). Só aplica RLS se a tabela existir.
do $$
begin
  if to_regclass('public.tournament_registrations') is not null then
    execute 'alter table tournament_registrations enable row level security';
    execute 'drop policy if exists "treg_select_org" on tournament_registrations';
    execute 'drop policy if exists "treg_insert_own" on tournament_registrations';
    execute 'drop policy if exists "treg_admin_org" on tournament_registrations';
    execute 'create policy "treg_select_org" on tournament_registrations for select using (organization_id = auth_org_id())';
    execute 'create policy "treg_insert_own" on tournament_registrations for insert with check (player_id = auth.uid() and organization_id = auth_org_id())';
    execute 'create policy "treg_admin_org" on tournament_registrations for all using (is_admin() and organization_id = auth_org_id())';
  end if;
end $$;

-- posts
create policy "posts_select_org" on posts for select using (organization_id = auth_org_id());
create policy "posts_insert_own" on posts for insert with check (author_id = auth.uid() and organization_id = auth_org_id());
create policy "posts_update_own" on posts for update using (author_id = auth.uid());
create policy "posts_delete_own" on posts for delete using (author_id = auth.uid());
create policy "posts_admin_org" on posts for all using (is_admin() and organization_id = auth_org_id());

-- post_likes
create policy "likes_select_org" on post_likes for select using (organization_id = auth_org_id());
create policy "likes_insert_own" on post_likes for insert with check (user_id = auth.uid() and organization_id = auth_org_id());
create policy "likes_delete_own" on post_likes for delete using (user_id = auth.uid());

-- post_comments
create policy "comments_select_org" on post_comments for select using (organization_id = auth_org_id());
create policy "comments_insert_own" on post_comments for insert with check (author_id = auth.uid() and organization_id = auth_org_id());
create policy "comments_delete_own" on post_comments for delete using (author_id = auth.uid());

-- notifications
create policy "notif_select_own" on notifications for select using (user_id = auth.uid());
create policy "notif_update_own" on notifications for update using (user_id = auth.uid());
create policy "notif_insert_admin_org" on notifications for insert with check (is_admin() and organization_id = auth_org_id());

-- trial_bookings (insert é via service role na API pública)
create policy "trials_admin_org" on trial_bookings for select using (is_admin() and organization_id = auth_org_id());

-- dayuse_slots
create policy "dayuse_slots_select_org" on dayuse_slots for select using (organization_id = auth_org_id() and is_active = true);
create policy "dayuse_slots_admin_org" on dayuse_slots for all using (is_admin() and organization_id = auth_org_id());

-- dayuse_bookings
create policy "dayuse_bookings_select" on dayuse_bookings for select using (student_id = auth.uid() or (is_admin() and organization_id = auth_org_id()));
create policy "dayuse_bookings_insert_own" on dayuse_bookings for insert with check (student_id = auth.uid() and organization_id = auth_org_id());
create policy "dayuse_bookings_update_own" on dayuse_bookings for update using (student_id = auth.uid());
create policy "dayuse_bookings_admin_org" on dayuse_bookings for all using (is_admin() and organization_id = auth_org_id());

-- medical_profiles
create policy "medical_own_select" on medical_profiles for select using (profile_id = auth.uid());
create policy "medical_own_insert" on medical_profiles for insert with check (profile_id = auth.uid() and organization_id = auth_org_id());
create policy "medical_own_update" on medical_profiles for update using (profile_id = auth.uid());
create policy "medical_admin_org" on medical_profiles for select using (is_admin() and organization_id = auth_org_id());

-- checkins
create policy "checkins_select_own" on checkins for select using (student_id = auth.uid());
create policy "checkins_admin_org" on checkins for all using (is_admin() and organization_id = auth_org_id());

-- waitlists: referenciada pelo app mas ausente em alguns ambientes (não existe em
-- produção). Só aplica RLS se a tabela existir.
do $$
begin
  if to_regclass('public.waitlists') is not null then
    execute 'alter table waitlists enable row level security';
    execute 'drop policy if exists "waitlists_select_own" on waitlists';
    execute 'drop policy if exists "waitlists_insert_own" on waitlists';
    execute 'drop policy if exists "waitlists_update_own" on waitlists';
    execute 'drop policy if exists "waitlists_admin_org" on waitlists';
    execute 'create policy "waitlists_select_own" on waitlists for select using (student_id = auth.uid())';
    execute 'create policy "waitlists_insert_own" on waitlists for insert with check (student_id = auth.uid() and organization_id = auth_org_id())';
    execute 'create policy "waitlists_update_own" on waitlists for update using (student_id = auth.uid())';
    execute 'create policy "waitlists_admin_org" on waitlists for all using (is_admin() and organization_id = auth_org_id())';
  end if;
end $$;
