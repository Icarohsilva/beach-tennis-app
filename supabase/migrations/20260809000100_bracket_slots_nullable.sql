-- Chave de mata-mata: a semifinal existe antes de alguém se classificar.
--
-- A eliminatória gera a chave INTEIRA de uma vez para o aluno enxergar o
-- caminho até a final desde o primeiro dia. As partidas das rodadas seguintes
-- nascem sem nome nos dois lados, então player1_id/player2_id precisam aceitar
-- null. Nos formatos sem chave (americano, todos-contra-todos) nada muda: os
-- dois lados continuam sendo preenchidos na geração.
alter table tournament_matches alter column player1_id drop not null;
alter table tournament_matches alter column player2_id drop not null;

-- (tournament_id, round, match_no) é a COORDENADA da partida na chave: é por
-- ela que o vencedor da partida 3 da rodada 1 acha a partida 2 da rodada 2.
-- Duas partidas na mesma coordenada fariam um vencedor apagar o outro, então o
-- índice único é a trava e o caminho de leitura do avanço ao mesmo tempo.
-- match_no nulo (linhas anteriores a 20260626000700) não conflita: no Postgres
-- nulos são distintos entre si em índice único.
create unique index if not exists tournament_matches_bracket_slot_idx
  on tournament_matches (tournament_id, round, match_no);
