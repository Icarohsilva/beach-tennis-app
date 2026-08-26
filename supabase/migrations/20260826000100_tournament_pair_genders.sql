-- supabase/migrations/20260826000100_tournament_pair_genders.sql
-- Que FORMAÇÕES de dupla o torneio aceita.
--
-- O pedido real: "livre com dupla fixa, mas não pode homem com homem; pode
-- mulher com mulher e homem com mulher". Nas 4 categorias de hoje isso é
-- inexprimível — 'livre' significa qualquer coisa. As formações possíveis são
-- três (MM, MF, FF), então a regra é um SUBCONJUNTO NÃO VAZIO delas: 7 casos.
--
-- Guardamos o CONJUNTO, não o nome do preset. Preset ("Sem dupla masculina" =
-- {MF,FF}) é função de rótulo em lib/torneios/pairRules.ts. Guardar o nome
-- exigiria migração + valor novo + troca de CHECK no 8º caso, e a função de
-- regra viraria um switch nome→conjunto: o MESMO mapa, duplicado no banco.
--
-- `category` NÃO é substituída: ela continua sendo o rótulo divulgado ("Misto B"),
-- o filtro de busca e o agrupamento do evento. O que muda é quem MANDA: a partir
-- daqui quem valida é esta coluna, e a categoria só escolhe o valor inicial dela.
--
-- Coluna lida de DUAS formas, de propósito:
--   dupla_fixa  → a formação da dupla é validada contra o conjunto;
--   individual e dupla_revezando → só a UNIÃO das letras vale ("quem pode se
--   inscrever"). Em revezamento o parceiro é sorteado a cada rodada: prometer
--   "sem dupla masculina" num americano de 5 homens e 3 mulheres é impossível de
--   cumprir, então lá a regra é sobre a INSCRIÇÃO, nunca sobre o par.
alter table tournaments
  add column if not exists allowed_pair_genders text[];

-- Backfill derivado da categoria: nenhuma linha existente muda de comportamento.
-- O MESMO mapa vive em pairGendersFor() (lib/torneios/pairRules.ts) e tem teste —
-- divergir aqui faria o formulário oferecer o que o banco não aceita.
update tournaments set allowed_pair_genders = case category
    when 'masculino' then array['MM']
    when 'feminino'  then array['FF']
    when 'misto'     then array['MF']
    else                  array['MM','MF','FF']   -- 'livre'
  end
  where allowed_pair_genders is null;

alter table tournaments
  alter column allowed_pair_genders set default array['MM','MF','FF'];
alter table tournaments
  alter column allowed_pair_genders set not null;

-- Os 7 subconjuntos não vazios, em ordem canônica MM < MF < FF.
-- Enumerar é feio e é o único jeito: "sem repetição" exigiria subconsulta
-- (count(distinct ...)), proibida em CHECK. O efeito colateral é bem-vindo — a
-- ordem canônica passa a ser obrigatória, e canonicalizePairGenders() no app é
-- a porta; este CHECK é a armadilha para quem esquecer de passar por ela.
alter table tournaments drop constraint if exists tournaments_allowed_pair_genders_check;
alter table tournaments add constraint tournaments_allowed_pair_genders_check
  check (allowed_pair_genders in (
    array['MM'], array['MF'], array['FF'],
    array['MM','MF'], array['MM','FF'], array['MF','FF'],
    array['MM','MF','FF']
  ));

comment on column tournaments.allowed_pair_genders is
  'Formações de dupla aceitas (MM/MF/FF), ordem canônica. Em dupla_fixa valida o par; em individual/dupla_revezando vale só a união das letras. Nasce derivada de category e passa a mandar sobre ela.';
