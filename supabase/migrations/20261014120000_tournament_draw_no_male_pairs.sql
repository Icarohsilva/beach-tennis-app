-- supabase/migrations/20261014120000_tournament_draw_no_male_pairs.sql
-- Sorteio do Super sem dupla masculina: todo homem joga com uma mulher de
-- parceira (duplas MF ou FF; nunca MM, e por isso nunca dois homens contra duas
-- mulheres).
--
-- Coluna própria, e não `allowed_pair_genders`: aquela é a regra de QUEM ENTRA
-- (e, em dupla fixa, com quem se inscreve). Num Super o parceiro é sorteado a
-- cada rodada, e esta chave governa o sorteio, não a inscrição. Usar a mesma
-- coluna faria "sem dupla masculina" recusar a inscrição dos homens.
-- Regra do sorteio em lib/torneios/schedule/americanoMixed.ts.
alter table public.tournaments
  add column if not exists draw_no_male_pairs boolean not null default false;

comment on column public.tournaments.draw_no_male_pairs is
  'Super: o sorteio das rodadas nunca forma dupla de dois homens. Ver lib/torneios/schedule/americanoMixed.ts.';
