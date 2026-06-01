-- supabase/migrations/001_initial_schema.sql

-- Enable extensions
-- uuid-ossp not needed; gen_random_uuid() is built-in since PostgreSQL 13

-- Enums
create type user_role as enum ('student', 'admin');
create type student_level as enum ('A', 'B', 'C', 'D', 'iniciante');
create type payment_type as enum ('subscriber', 'per_class', 'wellhub', 'totalpass');
create type class_type as enum ('kids', 'adult');
create type session_status as enum ('scheduled', 'completed', 'cancelled');
create type booking_status as enum ('confirmed', 'cancelled');
create type booking_type as enum ('extra', 'makeup');
create type attendance_status as enum ('present', 'absent', 'late');
create type attendance_source as enum ('manual', 'wellhub', 'totalpass');
create type credit_transaction_type as enum ('renewed', 'used', 'refunded', 'expired');
create type trial_status as enum ('pending', 'attended', 'no_show', 'cancelled');
create type subscription_status as enum ('active', 'paused', 'cancelled');
create type payment_status as enum ('pending', 'paid', 'failed', 'refunded');
create type payment_transaction_type as enum ('subscription', 'per_class', 'trial');
create type tournament_format as enum ('super8');
create type tournament_modality as enum ('dupla_fixa', 'dupla_revezando');
create type tournament_status as enum ('draft', 'open', 'in_progress', 'finished');

-- Profiles (extends auth.users)
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  avatar_url text,
  phone text,
  city text,
  role user_role not null default 'student',
  level student_level not null default 'iniciante',
  payment_type payment_type not null default 'per_class',
  is_dependent boolean not null default false,
  parent_id uuid references profiles(id) on delete set null,
  contract_active boolean not null default true,
  credits_balance int not null default 0,
  wellhub_id text,
  totalpass_id text,
  created_at timestamptz not null default now()
);

-- Classes (recurring schedule)
create table classes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  level student_level not null,
  type class_type not null default 'adult',
  day_of_week int not null check (day_of_week between 0 and 6),
  start_time time not null,
  end_time time not null,
  max_students int not null default 8,
  is_active boolean not null default true
);

-- Class Sessions (specific date instances)
create table class_sessions (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references classes(id) on delete cascade,
  session_date date not null,
  status session_status not null default 'scheduled',
  notes text,
  unique(class_id, session_date)
);

-- Enrollments (fixed schedule)
create table enrollments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references profiles(id) on delete cascade,
  class_id uuid not null references classes(id) on delete cascade,
  enrolled_at timestamptz not null default now(),
  cancelled_at timestamptz,
  is_active boolean not null default true,
  unique(student_id, class_id)
);

-- Session Bookings (all bookings: auto-enrolled, extra, makeup)
create table session_bookings (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references profiles(id) on delete cascade,
  session_id uuid not null references class_sessions(id) on delete cascade,
  type booking_type not null default 'extra',
  status booking_status not null default 'confirmed',
  from_enrollment boolean not null default false,
  credit_used boolean not null default false,
  booked_at timestamptz not null default now(),
  cancelled_at timestamptz,
  unique(student_id, session_id)
);

-- Attendance
create table attendance (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references profiles(id) on delete cascade,
  session_id uuid not null references class_sessions(id) on delete cascade,
  status attendance_status not null default 'present',
  source attendance_source not null default 'manual',
  checked_in_at timestamptz not null default now(),
  unique(student_id, session_id)
);

-- Credit Transactions
create table credit_transactions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references profiles(id) on delete cascade,
  type credit_transaction_type not null,
  amount int not null,
  reason text not null,
  session_id uuid references class_sessions(id) on delete set null,
  subscription_id uuid,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

-- Trial Bookings (public, no auth required)
create table trial_bookings (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  phone text not null,
  session_id uuid not null references class_sessions(id) on delete cascade,
  status trial_status not null default 'pending',
  must_pay_next boolean not null default false,
  created_at timestamptz not null default now()
);

-- Subscription Plans
create table subscription_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  classes_per_week int not null,
  credits_per_month int not null,
  price_monthly numeric(10,2) not null default 0,
  price_quarterly numeric(10,2) not null default 0,
  price_annual numeric(10,2) not null default 0,
  is_active boolean not null default true
);

-- Student Subscriptions
create table student_subscriptions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references profiles(id) on delete cascade,
  payer_id uuid not null references profiles(id),
  plan_id uuid not null references subscription_plans(id),
  status subscription_status not null default 'active',
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  next_billing_at timestamptz not null,
  discount_pct numeric(5,2) not null default 0,
  gateway_subscription_id text
);

-- Add FK from credit_transactions to student_subscriptions
alter table credit_transactions
  add constraint credit_transactions_subscription_id_fkey
  foreign key (subscription_id) references student_subscriptions(id) on delete set null;

-- Payments
create table payments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references profiles(id) on delete cascade,
  subscription_id uuid references student_subscriptions(id) on delete set null,
  session_id uuid references class_sessions(id) on delete set null,
  amount numeric(10,2) not null,
  currency text not null default 'BRL',
  status payment_status not null default 'pending',
  type payment_transaction_type not null,
  gateway_payment_id text,
  gateway text not null default 'mercadopago',
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

-- System Settings
create table system_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id)
);

-- Default settings
insert into system_settings (key, value) values
  ('credit_expiry_days', '30'),
  ('cancellation_window_hours', '5'),
  ('saturday_end_time', '11:00'),
  ('max_daily_bookings', '2');

-- Tournaments
create table tournaments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  date date not null,
  format tournament_format not null default 'super8',
  modality tournament_modality not null,
  level student_level not null,
  status tournament_status not null default 'draft',
  created_by uuid not null references profiles(id)
);

create table tournament_matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  player1_id uuid not null references profiles(id),
  player2_id uuid not null references profiles(id),
  partner1_id uuid references profiles(id),
  partner2_id uuid references profiles(id),
  score text,
  winner_id uuid references profiles(id),
  round int not null,
  played_at timestamptz
);

-- Social
create table posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references profiles(id) on delete cascade,
  content text not null,
  image_urls text[] not null default '{}',
  likes_count int not null default 0,
  session_id uuid references class_sessions(id) on delete set null,
  tournament_id uuid references tournaments(id) on delete set null,
  created_at timestamptz not null default now()
);

create table post_likes (
  post_id uuid not null references posts(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references posts(id) on delete cascade,
  author_id uuid not null references profiles(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);

-- Notifications
create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  type text not null,
  title text not null,
  body text not null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

-- Wellhub / TotalPass check-ins
create table wellhub_checkins (
  id uuid primary key default gen_random_uuid(),
  wellhub_user_id text not null,
  wellhub_member_id text,
  student_id uuid references profiles(id) on delete set null,
  session_id uuid references class_sessions(id) on delete set null,
  status text not null default 'unmatched',
  raw_payload jsonb not null,
  checked_in_at timestamptz not null default now()
);

create table totalpass_checkins (
  id uuid primary key default gen_random_uuid(),
  totalpass_user_id text not null,
  student_id uuid references profiles(id) on delete set null,
  session_id uuid references class_sessions(id) on delete set null,
  status text not null default 'unmatched',
  raw_payload jsonb not null,
  checked_in_at timestamptz not null default now()
);

-- Indexes
create index idx_class_sessions_date on class_sessions(session_date);
create index idx_class_sessions_class_id on class_sessions(class_id);
create index idx_session_bookings_student on session_bookings(student_id);
create index idx_session_bookings_session on session_bookings(session_id);
create index idx_attendance_session on attendance(session_id);
create index idx_credit_transactions_student on credit_transactions(student_id);
create index idx_notifications_user on notifications(user_id, read);
create index idx_posts_created on posts(created_at desc);
