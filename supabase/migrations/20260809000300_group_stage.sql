-- Fase de grupos + mata-mata no mesmo torneio.
--
-- As duas fases dividem `tournament_matches` e se distinguem por `group_label`:
-- 'A'/'B'/... na primeira fase, NULL no mata-mata. Uma tabela separada para os
-- jogos de grupo duplicaria placar, confirmação, agendamento e o avanço da
-- chave — tudo que já existe aqui.
alter table tournament_matches add column if not exists group_label text;

-- O mata-mata continua a numeração de rodadas de onde os grupos pararam, para
-- não colidir no índice único (tournament_id, round, match_no) criado em
-- 20260809000100. Quem lê desconta o deslocamento (lib/torneios/schedule/grupos.ts,
-- splitPhases), senão a chave leria "rodada 4" como a quinta fase e chamaria a
-- final de outro nome.

-- Ler a tabela de um grupo é a consulta mais quente da página durante a
-- primeira fase.
create index if not exists tournament_matches_group_idx
  on tournament_matches (tournament_id, group_label)
  where group_label is not null;

-- Configuração do formato. Ficam no torneio (e não em system_settings) porque
-- variam por evento: a mesma academia roda um Super 8 de 2 grupos numa semana e
-- um de 4 na outra.
alter table tournaments add column if not exists group_count int;
alter table tournaments add column if not exists advance_per_group int not null default 2;

alter table tournaments drop constraint if exists tournaments_group_count_check;
alter table tournaments add constraint tournaments_group_count_check
  check (group_count is null or (group_count between 2 and 8));

alter table tournaments drop constraint if exists tournaments_advance_per_group_check;
alter table tournaments add constraint tournaments_advance_per_group_check
  check (advance_per_group between 1 and 4);
