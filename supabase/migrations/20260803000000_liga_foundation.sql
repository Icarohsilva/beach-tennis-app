-- Liga: motor de pontos, divisões e temporada (spec 2026-08-02-liga-gamificacao-aluno).
--
-- Padrão: liga_points é o extrato (fonte da verdade) e liga_standings é cache da
-- posição, exatamente como credit_transactions → memberships.credits_balance. As duas
-- só são escritas pelas RPCs de 20260803000100_liga_rpcs.sql.
--
-- Esporte é dimensão do ponto, não filtro de tela: presença em turma de padel e em
-- turma de beach tennis são pontos em rankings diferentes por construção. O slug vem de
-- lib/arenas/sports.ts, sem tabela — mesmo modelo de organizations.sports,
-- tournaments.sport e classes.sport.

create table if not exists liga_seasons (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  starts_on date not null,
  ends_on date not null,
  status text not null default 'active' check (status in ('active', 'closed')),
  created_at timestamptz not null default now(),
  unique (organization_id, starts_on)
);

create index if not exists liga_seasons_active_idx
  on liga_seasons (organization_id, status);

create table if not exists liga_points (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  season_id uuid not null references liga_seasons(id) on delete cascade,
  student_id uuid not null references profiles(id) on delete cascade,
  sport text not null,
  points int not null,
  reason text not null check (reason in (
    'attendance', 'streak', 'tournament_entry', 'tournament_result',
    'manual', 'kudos_given', 'kudos_received'
  )),
  source_id uuid,
  note text,
  awarded_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- Idempotência. Sem isto, um duplo clique na chamada ou um retry de rede creditaria o
-- ponto duas vezes, e como o cache é o que aparece na tela ninguém descobriria por
-- semanas. coalesce porque 'manual' e 'streak' podem não ter source_id de origem.
create unique index if not exists liga_points_dedup_idx
  on liga_points (
    season_id, student_id, sport, reason,
    coalesce(source_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

create index if not exists liga_points_student_idx
  on liga_points (season_id, student_id, sport, created_at desc);

create table if not exists liga_standings (
  organization_id uuid not null references organizations(id) on delete cascade,
  season_id uuid not null references liga_seasons(id) on delete cascade,
  student_id uuid not null references profiles(id) on delete cascade,
  sport text not null,
  division text not null default 'bronze'
    check (division in ('bronze', 'prata', 'ouro', 'diamante')),
  points int not null default 0,
  streak_weeks int not null default 0,
  primary key (season_id, student_id, sport)
);

-- Consulta do ranking: temporada + esporte + divisão, ordenado por pontos.
create index if not exists liga_standings_rank_idx
  on liga_standings (season_id, sport, division, points desc);

-- Opt-out do ranking. Continua acumulando pontos e medalhas; só não aparece para os
-- outros alunos (spec §Telas).
alter table memberships add column if not exists liga_opted_out boolean not null default false;

-- RLS: leitura para membros da própria academia; escrita SÓ pelas RPCs security definer.
alter table liga_seasons   enable row level security;
alter table liga_points    enable row level security;
alter table liga_standings enable row level security;

drop policy if exists liga_seasons_read_own_org on liga_seasons;
create policy liga_seasons_read_own_org on liga_seasons for select to authenticated
  using (organization_id in (
    select organization_id from memberships where user_id = auth.uid()
  ));

drop policy if exists liga_points_read_own_org on liga_points;
create policy liga_points_read_own_org on liga_points for select to authenticated
  using (organization_id in (
    select organization_id from memberships where user_id = auth.uid()
  ));

drop policy if exists liga_standings_read_own_org on liga_standings;
create policy liga_standings_read_own_org on liga_standings for select to authenticated
  using (organization_id in (
    select organization_id from memberships where user_id = auth.uid()
  ));
