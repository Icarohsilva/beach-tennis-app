-- supabase/migrations/20260602000000_waitlists.sql

create table waitlists (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references class_sessions(id) on delete cascade,
  student_id uuid not null references profiles(id) on delete cascade,
  position int not null default 1,
  status text not null default 'waiting'
    check (status in ('waiting', 'offered', 'accepted', 'expired', 'cancelled')),
  joined_at timestamptz not null default now(),
  notified_at timestamptz,
  created_at timestamptz not null default now(),
  unique(session_id, student_id)
);

create index waitlists_session_status_idx on waitlists (session_id, status, position, joined_at);
create index waitlists_student_idx on waitlists (student_id);

-- RLS
alter table waitlists enable row level security;

-- Students can see their own waitlist entries
create policy "student_select_own_waitlist"
  on waitlists for select
  using (student_id = auth.uid());

-- Students can insert their own waitlist entries
create policy "student_insert_own_waitlist"
  on waitlists for insert
  with check (student_id = auth.uid());

-- Students can update their own waitlist entries
create policy "student_update_own_waitlist"
  on waitlists for update
  using (student_id = auth.uid());

-- Admins can see all
create policy "admin_all_waitlists"
  on waitlists for all
  using (
    exists (
      select 1 from profiles
      where id = auth.uid() and role = 'admin'
    )
  );
