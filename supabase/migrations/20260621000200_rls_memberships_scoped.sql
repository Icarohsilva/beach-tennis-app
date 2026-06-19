-- Multi-vínculo (Plano 1) — parte 3/4
-- Reescreve a RLS org-scoped para derivar a academia das MEMBERSHIPS, não mais de
-- profiles.organization_id. Espelha 20260616000500_rls_org_scoped.sql trocando:
--   is_admin() and organization_id = auth_org_id()  ->  is_org_admin(organization_id)
--   organization_id = auth_org_id()                 ->  organization_id in (select auth_org_ids())
-- Como o backfill cria 1 membership por perfil, a visibilidade é idêntica à de hoje.

-- 1. Limpa as policies existentes nas tabelas tenant (independente do nome).
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

-- 2. Recria as policies org-scoped via memberships.

-- profiles: o aluno lê o próprio; admin lê perfis das suas academias.
create policy "profiles_select_own" on profiles for select using (id = auth.uid());
create policy "profiles_select_admin_org" on profiles for select using (is_org_admin(organization_id));
create policy "profiles_update_own" on profiles for update using (id = auth.uid());
create policy "profiles_update_admin_org" on profiles for update using (is_org_admin(organization_id));
create policy "profiles_insert_admin_org" on profiles for insert with check (is_org_admin(organization_id));

-- classes
create policy "classes_select_org" on classes for select using (organization_id in (select auth_org_ids()) and is_active = true);
create policy "classes_admin_org" on classes for all using (is_org_admin(organization_id));

-- class_sessions
create policy "class_sessions_select_org" on class_sessions for select using (organization_id in (select auth_org_ids()));
create policy "class_sessions_admin_org" on class_sessions for all using (is_org_admin(organization_id));

-- enrollments
create policy "enrollments_select_own" on enrollments for select using (student_id = auth.uid());
create policy "enrollments_admin_org" on enrollments for all using (is_org_admin(organization_id));

-- session_bookings
create policy "session_bookings_select_own" on session_bookings for select using (student_id = auth.uid());
create policy "session_bookings_insert_own" on session_bookings for insert with check (student_id = auth.uid() and organization_id in (select auth_org_ids()));
create policy "session_bookings_update_own" on session_bookings for update using (student_id = auth.uid());
create policy "session_bookings_admin_org" on session_bookings for all using (is_org_admin(organization_id));

-- attendance
create policy "attendance_select_own" on attendance for select using (student_id = auth.uid());
create policy "attendance_admin_org" on attendance for all using (is_org_admin(organization_id));

-- credit_transactions
create policy "credit_tx_select_own" on credit_transactions for select using (student_id = auth.uid());
create policy "credit_tx_select_admin_org" on credit_transactions for select using (is_org_admin(organization_id));
create policy "credit_tx_insert_admin_org" on credit_transactions for insert with check (is_org_admin(organization_id));

-- subscription_plans
create policy "plans_select_org" on subscription_plans for select using (organization_id in (select auth_org_ids()) and is_active = true);
create policy "plans_admin_org" on subscription_plans for all using (is_org_admin(organization_id));

-- student_subscriptions
create policy "subs_select_own" on student_subscriptions for select using (student_id = auth.uid() or payer_id = auth.uid());
create policy "subs_admin_org" on student_subscriptions for all using (is_org_admin(organization_id));

-- payments
create policy "payments_select_own" on payments for select using (student_id = auth.uid());
create policy "payments_select_admin_org" on payments for select using (is_org_admin(organization_id));

-- system_settings (por academia)
create policy "settings_admin_org" on system_settings for all using (is_org_admin(organization_id));

-- tournaments
create policy "tournaments_select_org" on tournaments for select using (organization_id in (select auth_org_ids()));
create policy "tournaments_admin_org" on tournaments for all using (is_org_admin(organization_id));

-- tournament_matches
create policy "matches_select_org" on tournament_matches for select using (organization_id in (select auth_org_ids()));
create policy "matches_admin_org" on tournament_matches for all using (is_org_admin(organization_id));

-- tournament_registrations: só aplica se a tabela existir neste ambiente.
do $$
begin
  if to_regclass('public.tournament_registrations') is not null then
    execute 'drop policy if exists "treg_select_org" on tournament_registrations';
    execute 'drop policy if exists "treg_insert_own" on tournament_registrations';
    execute 'drop policy if exists "treg_admin_org" on tournament_registrations';
    execute 'create policy "treg_select_org" on tournament_registrations for select using (organization_id in (select auth_org_ids()))';
    execute 'create policy "treg_insert_own" on tournament_registrations for insert with check (player_id = auth.uid() and organization_id in (select auth_org_ids()))';
    execute 'create policy "treg_admin_org" on tournament_registrations for all using (is_org_admin(organization_id))';
  end if;
end $$;

-- posts
create policy "posts_select_org" on posts for select using (organization_id in (select auth_org_ids()));
create policy "posts_insert_own" on posts for insert with check (author_id = auth.uid() and organization_id in (select auth_org_ids()));
create policy "posts_update_own" on posts for update using (author_id = auth.uid());
create policy "posts_delete_own" on posts for delete using (author_id = auth.uid());
create policy "posts_admin_org" on posts for all using (is_org_admin(organization_id));

-- post_likes
create policy "likes_select_org" on post_likes for select using (organization_id in (select auth_org_ids()));
create policy "likes_insert_own" on post_likes for insert with check (user_id = auth.uid() and organization_id in (select auth_org_ids()));
create policy "likes_delete_own" on post_likes for delete using (user_id = auth.uid());

-- post_comments
create policy "comments_select_org" on post_comments for select using (organization_id in (select auth_org_ids()));
create policy "comments_insert_own" on post_comments for insert with check (author_id = auth.uid() and organization_id in (select auth_org_ids()));
create policy "comments_delete_own" on post_comments for delete using (author_id = auth.uid());

-- notifications
create policy "notif_select_own" on notifications for select using (user_id = auth.uid());
create policy "notif_update_own" on notifications for update using (user_id = auth.uid());
create policy "notif_insert_admin_org" on notifications for insert with check (is_org_admin(organization_id));

-- trial_bookings (insert é via service role na API pública)
create policy "trials_admin_org" on trial_bookings for select using (is_org_admin(organization_id));

-- dayuse_slots
create policy "dayuse_slots_select_org" on dayuse_slots for select using (organization_id in (select auth_org_ids()) and is_active = true);
create policy "dayuse_slots_admin_org" on dayuse_slots for all using (is_org_admin(organization_id));

-- dayuse_bookings
create policy "dayuse_bookings_select" on dayuse_bookings for select using (student_id = auth.uid() or is_org_admin(organization_id));
create policy "dayuse_bookings_insert_own" on dayuse_bookings for insert with check (student_id = auth.uid() and organization_id in (select auth_org_ids()));
create policy "dayuse_bookings_update_own" on dayuse_bookings for update using (student_id = auth.uid());
create policy "dayuse_bookings_admin_org" on dayuse_bookings for all using (is_org_admin(organization_id));

-- medical_profiles
create policy "medical_own_select" on medical_profiles for select using (profile_id = auth.uid());
create policy "medical_own_insert" on medical_profiles for insert with check (profile_id = auth.uid() and organization_id in (select auth_org_ids()));
create policy "medical_own_update" on medical_profiles for update using (profile_id = auth.uid());
create policy "medical_admin_org" on medical_profiles for select using (is_org_admin(organization_id));

-- checkins
create policy "checkins_select_own" on checkins for select using (student_id = auth.uid());
create policy "checkins_admin_org" on checkins for all using (is_org_admin(organization_id));

-- waitlists: só aplica se a tabela existir neste ambiente.
do $$
begin
  if to_regclass('public.waitlists') is not null then
    execute 'drop policy if exists "waitlists_select_own" on waitlists';
    execute 'drop policy if exists "waitlists_insert_own" on waitlists';
    execute 'drop policy if exists "waitlists_update_own" on waitlists';
    execute 'drop policy if exists "waitlists_admin_org" on waitlists';
    execute 'create policy "waitlists_select_own" on waitlists for select using (student_id = auth.uid())';
    execute 'create policy "waitlists_insert_own" on waitlists for insert with check (student_id = auth.uid() and organization_id in (select auth_org_ids()))';
    execute 'create policy "waitlists_update_own" on waitlists for update using (student_id = auth.uid())';
    execute 'create policy "waitlists_admin_org" on waitlists for all using (is_org_admin(organization_id))';
  end if;
end $$;

-- organizations: membro lê as academias das quais participa (substitui id = auth_org_id()).
drop policy if exists "Members view own organization" on organizations;
create policy "Members view own organization" on organizations
  for select using (id in (select auth_org_ids()));
