-- Check-ins Wellhub/TotalPass.
-- Tabela própria (attendance exige session_id NOT NULL; check-in avulso não tem sessão).

create type checkin_partner as enum ('wellhub', 'totalpass');

alter table profiles
  add column if not exists monthly_checkin_target int not null default 0;

create table checkins (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references profiles(id) on delete cascade,
  partner checkin_partner not null,
  checkin_date date not null,
  session_id uuid references class_sessions(id) on delete set null,
  external_ref text,
  validation text not null default 'manual',
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index checkins_student_date_idx on checkins (student_id, checkin_date);
create unique index checkins_partner_ref_idx
  on checkins (partner, external_ref) where external_ref is not null;

alter table checkins enable row level security;

-- Espelha o padrão de attendance: aluno vê os próprios; admin gerencia tudo.
create policy "Students view own checkins" on checkins
  for select using (student_id = auth.uid());
create policy "Admin manages all checkins" on checkins
  for all using (is_admin());
