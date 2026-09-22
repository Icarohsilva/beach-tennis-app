-- supabase/migrations/20260923130000_tournament_shirt_names.sql
-- O nome que vai ESTAMPADO na camisa, quando a arena manda fazer com nome.
--
-- Coluna própria, e não o nome do cadastro: a estampa diz "Zeca" e a lista de
-- conferência precisa dizer "José Carlos da Silva". Reaproveitar `full_name`
-- mandaria o nome do documento para a serigrafia — e não caberia nas costas.
alter table tournament_entries
  add column if not exists shirt_name text,
  add column if not exists partner_shirt_name text;

comment on column tournament_entries.shirt_name is
  'Nome estampado na camisa do titular. Nulo = torneio sem nome na camisa. Limite de largura de estampa em lib/torneios/shirt.ts (MAX_SHIRT_NAME).';
comment on column tournament_entries.partner_shirt_name is
  'Nome estampado do parceiro em dupla fixa.';

-- Chave própria, e ANINHADA na de camisa: nome sem camisa não existe. O código
-- trata `shirt_sizes_enabled` como teto (shirtConfig em lib/torneios/shirt.ts),
-- então ligar só esta não faz a inscrição pedir nada — mesma ideia do
-- payment_timing do day use, em que a configuração limita a escolha.
alter table tournaments
  add column if not exists shirt_names_enabled boolean not null default false;

comment on column tournaments.shirt_names_enabled is
  'Ligada (junto com shirt_sizes_enabled), a inscrição também pede o nome que vai estampado.';
