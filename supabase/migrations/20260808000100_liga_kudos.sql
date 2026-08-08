-- Liga Fase 3: elogios entre alunos e mural fixado (spec §Fase 3).
--
-- Elogio é a única parte fraudável da Liga: no momento em que dar elogio vale ponto,
-- as pessoas param de elogiar e começam a farmar. Por isso as travas moram no BANCO,
-- não só na UI — `unique (organization_id, from, to, iso_week)` é o que impede o
-- combinado de 30 elogios num domingo à noite, mesmo que alguém chame a action direto.

create table if not exists liga_kudos (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  season_id        uuid not null references liga_seasons(id) on delete cascade,
  sport            text not null,
  from_student_id  uuid not null references profiles(id) on delete cascade,
  to_student_id    uuid not null references profiles(id) on delete cascade,
  category         text not null check (category in ('evoluiu','parceiro','incentiva','dedicado')),
  message          text not null,
  -- 'YYYY-Www' (semana ISO). Base das travas semanais; guardado em vez de derivado
  -- para que a trava não dependa do fuso de quem consulta.
  iso_week         text not null,
  -- Este elogio creditou ponto? Falso quando bateu o teto semanal ou quando foi
  -- recíproco na mesma semana. Guardado para o teto ser contável sem varrer o
  -- extrato, e para a decisão anti-farming ficar auditável.
  earns_points     boolean not null default false,
  created_at       timestamptz not null default now(),
  constraint liga_kudos_nao_auto check (from_student_id <> to_student_id)
);

-- Uma pessoa elogia outra no máximo uma vez por semana, por academia. O
-- organization_id entra na chave porque a mesma dupla pode treinar em duas arenas e
-- a trava é de cada uma.
create unique index if not exists liga_kudos_semana_idx
  on liga_kudos (organization_id, from_student_id, to_student_id, iso_week);

-- Teto semanal de quem envia e checagem de reciprocidade.
create index if not exists liga_kudos_from_week_idx
  on liga_kudos (organization_id, from_student_id, iso_week);

-- Mural de elogios recebidos e feed da temporada.
create index if not exists liga_kudos_to_idx
  on liga_kudos (organization_id, to_student_id, created_at desc);

create index if not exists liga_kudos_season_idx
  on liga_kudos (season_id, created_at desc);

alter table liga_kudos enable row level security;

-- Elogio é público dentro da academia: ele existe para ser visto.
drop policy if exists liga_kudos_read_own_org on liga_kudos;
create policy liga_kudos_read_own_org on liga_kudos for select to authenticated
  using (organization_id in (
    select organization_id from memberships where user_id = auth.uid()
  ));

-- ---------------------------------------------------------------------------
-- Mural de comunicados: post fixado pela academia
-- ---------------------------------------------------------------------------
-- É a peça que faltava para o feed servir de canal oficial, e não só de conversa.

alter table posts add column if not exists is_pinned boolean not null default false;

-- O feed ordena por fixado primeiro; índice parcial porque fixado é exceção.
create index if not exists posts_pinned_idx
  on posts (organization_id, created_at desc) where is_pinned;

comment on table liga_kudos is
  'Elogios entre alunos. As travas anti-farming (uma por colega por semana) são do banco, não da UI.';
comment on column posts.is_pinned is
  'Post fixado no topo do feed pela academia (mural de comunicados).';
