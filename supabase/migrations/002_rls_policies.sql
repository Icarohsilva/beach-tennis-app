-- supabase/migrations/002_rls_policies.sql

-- Enable RLS on all tables
alter table profiles enable row level security;
alter table classes enable row level security;
alter table class_sessions enable row level security;
alter table enrollments enable row level security;
alter table session_bookings enable row level security;
alter table attendance enable row level security;
alter table credit_transactions enable row level security;
alter table trial_bookings enable row level security;
alter table subscription_plans enable row level security;
alter table student_subscriptions enable row level security;
alter table payments enable row level security;
alter table system_settings enable row level security;
alter table tournaments enable row level security;
alter table tournament_matches enable row level security;
alter table posts enable row level security;
alter table post_likes enable row level security;
alter table post_comments enable row level security;
alter table notifications enable row level security;
alter table wellhub_checkins enable row level security;
alter table totalpass_checkins enable row level security;

-- Helper function: is current user an admin?
create or replace function is_admin()
returns boolean language sql security definer as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$$;

-- profiles
create policy "Users can view own profile" on profiles for select using (id = auth.uid());
create policy "Admin can view all profiles" on profiles for select using (is_admin());
create policy "Users can update own profile" on profiles for update using (id = auth.uid());
create policy "Admin can update all profiles" on profiles for update using (is_admin());
create policy "Admin can insert profiles" on profiles for insert with check (is_admin());

-- classes (public read, admin write)
create policy "Anyone authenticated can view active classes" on classes
  for select using (auth.role() = 'authenticated' and is_active = true);
create policy "Admin can manage classes" on classes
  for all using (is_admin());

-- class_sessions (public read, admin write)
create policy "Authenticated can view sessions" on class_sessions
  for select using (auth.role() = 'authenticated');
create policy "Admin can manage sessions" on class_sessions
  for all using (is_admin());

-- enrollments
create policy "Students view own enrollments" on enrollments
  for select using (student_id = auth.uid());
create policy "Admin views all enrollments" on enrollments
  for select using (is_admin());
create policy "Admin manages enrollments" on enrollments
  for all using (is_admin());

-- session_bookings
create policy "Students view own bookings" on session_bookings
  for select using (student_id = auth.uid());
create policy "Admin views all bookings" on session_bookings
  for select using (is_admin());
create policy "Students can insert own bookings" on session_bookings
  for insert with check (student_id = auth.uid());
create policy "Students can cancel own bookings" on session_bookings
  for update using (student_id = auth.uid());
create policy "Admin manages all bookings" on session_bookings
  for all using (is_admin());

-- attendance
create policy "Students view own attendance" on attendance
  for select using (student_id = auth.uid());
create policy "Admin manages all attendance" on attendance
  for all using (is_admin());

-- credit_transactions
create policy "Students view own credits" on credit_transactions
  for select using (student_id = auth.uid());
create policy "Admin views all credits" on credit_transactions
  for select using (is_admin());
create policy "System inserts credits (service role only)" on credit_transactions
  for insert with check (is_admin());

-- subscription_plans (public read, admin write)
create policy "Authenticated can view active plans" on subscription_plans
  for select using (auth.role() = 'authenticated' and is_active = true);
create policy "Admin manages plans" on subscription_plans
  for all using (is_admin());

-- student_subscriptions
create policy "Students view own subscriptions" on student_subscriptions
  for select using (student_id = auth.uid() or payer_id = auth.uid());
create policy "Admin views all subscriptions" on student_subscriptions
  for select using (is_admin());
create policy "Admin manages subscriptions" on student_subscriptions
  for all using (is_admin());

-- payments
create policy "Students view own payments" on payments
  for select using (student_id = auth.uid());
create policy "Admin views all payments" on payments
  for select using (is_admin());

-- system_settings (admin only)
create policy "Admin manages system settings" on system_settings
  for all using (is_admin());

-- tournaments (public read, admin write)
create policy "Authenticated can view tournaments" on tournaments
  for select using (auth.role() = 'authenticated');
create policy "Admin manages tournaments" on tournaments
  for all using (is_admin());

create policy "Authenticated can view tournament matches" on tournament_matches
  for select using (auth.role() = 'authenticated');
create policy "Admin manages tournament matches" on tournament_matches
  for all using (is_admin());

-- posts
create policy "Authenticated can view posts" on posts
  for select using (auth.role() = 'authenticated');
create policy "Students can create posts" on posts
  for insert with check (author_id = auth.uid());
create policy "Students can update own posts" on posts
  for update using (author_id = auth.uid());
create policy "Students can delete own posts" on posts
  for delete using (author_id = auth.uid());
create policy "Admin manages all posts" on posts
  for all using (is_admin());

create policy "Authenticated can view likes" on post_likes
  for select using (auth.role() = 'authenticated');
create policy "Students can like posts" on post_likes
  for insert with check (user_id = auth.uid());
create policy "Students can unlike posts" on post_likes
  for delete using (user_id = auth.uid());

create policy "Authenticated can view comments" on post_comments
  for select using (auth.role() = 'authenticated');
create policy "Students can comment" on post_comments
  for insert with check (author_id = auth.uid());
create policy "Students can delete own comments" on post_comments
  for delete using (author_id = auth.uid());

-- notifications
create policy "Users view own notifications" on notifications
  for select using (user_id = auth.uid());
create policy "Users mark own notifications read" on notifications
  for update using (user_id = auth.uid());
create policy "Admin inserts notifications" on notifications
  for insert with check (is_admin());

-- trial_bookings (service role only write, public insert via API route)
create policy "Admin views trial bookings" on trial_bookings
  for select using (is_admin());
