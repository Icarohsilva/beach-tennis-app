-- supabase/migrations/20261027120000_tournament_draw_same_type.sql
-- Super com "confrontos do mesmo tipo": cada jogo é dupla masculina contra
-- masculina, feminina contra feminina ou mista contra mista. Nunca uma dupla
-- masculina contra uma mista (o "3 homens e 1 mulher" na quadra).
--
-- Exclusiva com draw_no_male_pairs (a action liga uma e desliga a outra): as
-- duas são regras de gênero do sorteio, e só uma vale por torneio.
-- Sorteio em lib/torneios/schedule/americanoMixed.ts.
alter table public.tournaments
  add column if not exists draw_same_type boolean not null default false;

comment on column public.tournaments.draw_same_type is
  'Super: todo jogo do mesmo tipo (MM x MM, FF x FF, misto x misto). Ver lib/torneios/schedule/americanoMixed.ts.';
