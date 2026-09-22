-- supabase/migrations/20260922120000_tournament_scoring_mode.sql
-- COMO a partida do torneio é contada: set clássico ou games fixos.
--
-- `games_per_set` sozinho não conseguia expressar o formato que o beach tennis
-- usa de verdade no Super/Americano. Ele significa "alvo do set": ganha quem
-- chega a 6, e a soma dos dois lados é livre. O Super de 5 games é outra coisa
-- — a partida TEM 5 games, todos são jogados, e vence quem fizer 3. A soma é
-- sempre 5.
--
-- Por que a distinção importa além do rótulo: com games fixos toda partida
-- entrega o mesmo total, e só por isso "games ganhos" vira critério de
-- desempate justo na classificação. Parar em 3x0 daria a quem venceu cedo menos
-- games do que a quem venceu apertado.
--
-- 'set'         = comportamento de hoje, e por isso é o default: nenhum torneio
--                 já criado muda de significado.
-- 'fixed_games' = games_per_set passa a ser o TOTAL da partida.
alter table tournaments
  add column if not exists scoring_mode text not null default 'set';

alter table tournaments drop constraint if exists tournaments_scoring_mode_check;
alter table tournaments add constraint tournaments_scoring_mode_check
  check (scoring_mode in ('set', 'fixed_games'));

comment on column tournaments.scoring_mode is
  'set = games_per_set é o alvo do set (soma livre); fixed_games = games_per_set é o total de games da partida, todos jogados, vence a maioria.';
