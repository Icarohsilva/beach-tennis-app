-- supabase/migrations/20260826000500_tournament_content.sql
-- O que o torneio ANUNCIA: descrição, regulamento, local, horário e prazo de
-- inscrição. Nada disso existia — o único "conteúdo" de um torneio era nome,
-- data e as pastilhas de esporte/nível/categoria. A academia não tinha onde
-- escrever "chega 30 min antes" ou "leve seu próprio kit".
--
-- Herança torneio → evento: uma "Copa de Agosto" tem 6 categorias que dividem
-- UM regulamento e UM local. Regulamento copiado seis vezes diverge na
-- primeira correção de digitação — por isso description/rules/venue também
-- entram em tournament_events (ver lib/torneios/content.ts, que resolve a
-- herança e devolve a ORIGEM, para a UI nunca fingir que texto herdado é
-- próprio).
--
-- start_time e registration_deadline NÃO herdam: variam por categoria de
-- verdade (misto às 8h, masculino às 14h), e um prazo herdado mudaria a
-- janela de inscrição de seis torneios sem ninguém ter aberto aqueles seis.
alter table tournaments
  add column if not exists description text,
  add column if not exists rules text,
  add column if not exists venue text,
  -- `time`, não timestamptz: o admin digita "08:00" como relógio de parede;
  -- juntar com `date` num instante arrastaria fuso para um campo que não tem.
  add column if not exists start_time time,
  -- timestamptz aqui SIM: comparado com now() ("inscrições até sexta 23:59"),
  -- é instante de verdade. Nulo = comportamento de hoje — só fecha quando o
  -- admin troca o status na mão.
  add column if not exists registration_deadline timestamptz;

alter table tournament_events
  add column if not exists rules text,
  add column if not exists venue text;

comment on column tournaments.rules is
  'Regulamento próprio. Vazio/nulo = herda o do evento (lib/torneios/content.ts). "" e nulo contam igual — apagar o textarea volta a herdar.';
comment on column tournaments.registration_deadline is
  'Instante em que a inscrição fecha sozinha. Nulo = só fecha por troca de status (comportamento de hoje). Ordenação contra a data do torneio é validada na action, não em CHECK — comparar timestamptz com date+interval puxa o fuso do GUC e deixa de ser imutável.';
