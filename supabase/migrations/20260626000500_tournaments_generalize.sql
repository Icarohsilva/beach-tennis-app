-- format vira text: aceita americano|round_robin|eliminatoria|ranking sem mexer no enum,
-- e permite backfill super8->americano no mesmo txn (ADD VALUE de enum não pode ser
-- usado na mesma transação). modality vira nullable p/ suportar participant_type individual.
alter table tournaments alter column format type text using format::text;
alter table tournaments alter column format set default 'americano';
alter table tournaments alter column modality drop not null;

alter table tournaments add column if not exists sport text not null default 'beach_tennis';
alter table tournaments add column if not exists category text not null default 'livre';
alter table tournaments add column if not exists participant_type text not null default 'dupla_revezando';
alter table tournaments add column if not exists sets_to_win int not null default 1;
alter table tournaments add column if not exists games_per_set int not null default 6;
alter table tournaments add column if not exists tiebreak_games boolean not null default true;

-- Backfill idempotente dos torneios existentes (Hudson em prod).
update tournaments set format = 'americano' where format = 'super8';
update tournaments set participant_type = 'dupla_fixa' where modality = 'dupla_fixa';
update tournaments set participant_type = 'dupla_revezando' where modality = 'dupla_revezando';

-- Guardas de domínio.
alter table tournaments drop constraint if exists tournaments_category_check;
alter table tournaments add constraint tournaments_category_check
  check (category in ('masculino', 'feminino', 'misto', 'livre'));
alter table tournaments drop constraint if exists tournaments_participant_type_check;
alter table tournaments add constraint tournaments_participant_type_check
  check (participant_type in ('individual', 'dupla_fixa', 'dupla_revezando'));
