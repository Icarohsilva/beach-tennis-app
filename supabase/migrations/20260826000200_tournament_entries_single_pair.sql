-- supabase/migrations/20260826000200_tournament_entries_single_pair.sql
-- Uma pessoa, no máximo UMA dupla por torneio.
--
-- O unique (tournament_id, player_id) de 20260626000600 não diz isso: B pode ser
-- partner_id na inscrição de A e, ao mesmo tempo, ter inscrição própria com C —
-- duas linhas, nenhuma violação, e B entra na chave em dois pares. Percebido
-- depois do sorteio, não tem correção: as partidas já existem.
--
-- ANTES DE APLICAR, confira se a base já tem esse caso (o índice abaixo falha se
-- tiver, e aí a limpeza é decisão da academia, não desta migração):
--
--   select tournament_id, pessoa, count(*) from (
--     select tournament_id, player_id  as pessoa from tournament_entries
--     union all
--     select tournament_id, partner_id as pessoa from tournament_entries
--       where partner_id is not null
--   ) t group by 1, 2 having count(*) > 1;

-- Backstop de banco, não substituto da checagem da action: a action dá a mensagem
-- legível, o trigger fecha a janela entre o SELECT e o INSERT (duas pessoas
-- convidando o mesmo B ao mesmo tempo passam pelos dois SELECTs).
create or replace function tournament_entries_single_pair()
returns trigger language plpgsql as $$
begin
  if exists (
    select 1 from tournament_entries e
     where e.tournament_id = new.tournament_id
       and e.id is distinct from new.id
       and (e.player_id  = new.player_id
         or e.partner_id = new.player_id
         or (new.partner_id is not null and e.player_id  = new.partner_id)
         or (new.partner_id is not null and e.partner_id = new.partner_id))
  ) then
    -- 23505 (unique_violation) de propósito: quem chama já trata violação de
    -- unicidade como "já inscrito" e não devolve 500.
    raise exception 'jogador ja inscrito neste torneio' using errcode = '23505';
  end if;
  return new;
end $$;

drop trigger if exists tournament_entries_single_pair_trg on tournament_entries;
create trigger tournament_entries_single_pair_trg
  before insert or update of player_id, partner_id on tournament_entries
  for each row execute function tournament_entries_single_pair();

-- Garantia declarativa do caso mais comum (o mesmo parceiro em duas duplas).
-- Parcial porque partner_id nulo é a regra em individual/revezamento e NULLs não
-- colidem. Último statement da migração: se falhar por dado sujo, o trigger acima
-- já está no lugar.
create unique index if not exists tournament_entries_partner_unique_idx
  on tournament_entries (tournament_id, partner_id) where partner_id is not null;
