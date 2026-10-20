-- supabase/migrations/20261020120000_tournament_scoring_tiebreak.sql
-- Super Tiebreak: a partida é UM tie-break de 7, 10 ou 15 pontos (ganha quem
-- chega ao número com 2 de vantagem). `games_per_set` guarda o alvo de pontos e
-- games1/games2 guardam os PONTOS de cada lado. Regra em lib/torneios/matchScore.ts.
alter table public.tournaments drop constraint if exists tournaments_scoring_mode_check;
alter table public.tournaments add constraint tournaments_scoring_mode_check
  check (scoring_mode in ('set', 'fixed_games', 'tiebreak'));
