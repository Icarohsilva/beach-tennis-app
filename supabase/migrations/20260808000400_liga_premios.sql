-- Liga: premiação da temporada.
--
-- Duas tabelas porque são duas coisas diferentes: o que a academia PROMETE
-- (liga_prizes, editável enquanto a temporada roda) e o que ela DEVE
-- (liga_prize_awards, congelado no fechamento). Sem a segunda, reescrever o prêmio
-- em janeiro mudaria retroativamente o que alguém ganhou em dezembro.

create table if not exists liga_prizes (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  season_id        uuid not null references liga_seasons(id) on delete cascade,
  -- 'leader'   = colocação no ranking da modalidade (position 1, 2, 3...)
  -- 'promoted' = quem subiu de divisão, independentemente de posição
  kind             text not null check (kind in ('leader', 'promoted')),
  position         int check (position is null or position between 1 and 10),
  description      text not null,
  -- Aulas creditadas automaticamente no fechamento. 0 = só o prêmio em texto.
  credit_classes   int not null default 0 check (credit_classes >= 0),
  created_at       timestamptz not null default now(),
  constraint liga_prizes_position_chk check (
    (kind = 'leader' and position is not null) or (kind = 'promoted' and position is null)
  )
);

-- Um prêmio por colocação por temporada. coalesce porque 'promoted' tem position
-- nula e dois NULLs nunca colidem num índice único comum.
create unique index if not exists liga_prizes_unique_idx
  on liga_prizes (season_id, kind, coalesce(position, 0));

create index if not exists liga_prizes_season_idx
  on liga_prizes (organization_id, season_id);

-- ---------------------------------------------------------------------------
-- Ganhadores apurados no fechamento
-- ---------------------------------------------------------------------------

create table if not exists liga_prize_awards (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  season_id        uuid not null references liga_seasons(id) on delete cascade,
  student_id       uuid not null references profiles(id) on delete cascade,
  sport            text not null,
  kind             text not null check (kind in ('leader', 'promoted')),
  position         int,
  -- Cópia do texto e do crédito no momento da apuração: reprecificar o prêmio da
  -- temporada seguinte não pode reescrever o que já foi prometido.
  description      text not null,
  credit_classes   int not null default 0,
  -- A academia marca quando entregou. Prêmio físico não tem como o sistema saber.
  delivered        boolean not null default false,
  delivered_at     timestamptz,
  created_at       timestamptz not null default now()
);

-- Um prêmio por aluno, por modalidade, por tipo. É também o que torna a apuração
-- idempotente: rodar o fechamento duas vezes não duplica o prêmio.
create unique index if not exists liga_prize_awards_unique_idx
  on liga_prize_awards (season_id, student_id, sport, kind);

create index if not exists liga_prize_awards_season_idx
  on liga_prize_awards (organization_id, season_id, delivered);

create index if not exists liga_prize_awards_student_idx
  on liga_prize_awards (student_id, created_at desc);

alter table liga_prizes       enable row level security;
alter table liga_prize_awards enable row level security;

-- Prêmio prometido é público na academia: é ele que faz o aluno querer disputar.
drop policy if exists liga_prizes_read_own_org on liga_prizes;
create policy liga_prizes_read_own_org on liga_prizes for select to authenticated
  using (organization_id in (
    select organization_id from memberships where user_id = auth.uid()
  ));

-- Ganhador também: pódio escondido não motiva ninguém.
drop policy if exists liga_prize_awards_read_own_org on liga_prize_awards;
create policy liga_prize_awards_read_own_org on liga_prize_awards for select to authenticated
  using (organization_id in (
    select organization_id from memberships where user_id = auth.uid()
  ));

comment on table liga_prizes is
  'O que a academia promete na temporada. Editável enquanto ela roda.';
comment on table liga_prize_awards is
  'O que a academia deve, congelado no fechamento. Mudar o prêmio depois não reescreve isto.';
