-- supabase/migrations/20260923120000_tournament_shirt_sizes.sql
-- Tamanho de camisa do inscrito, para a arena encomendar sem sair perguntando
-- um por um no WhatsApp.
--
-- POR ENTRADA, e não no perfil: a camisa é feita para AQUELE torneio. A mesma
-- pessoa pede baby look M num evento e tradicional G noutro (corte diferente,
-- fornecedor diferente), e o que a arena precisa é da lista daquele torneio —
-- não do último tamanho que a pessoa digitou em algum lugar.
--
-- Duas colunas pelo mesmo motivo de `payment_status`/`partner_payment_status`:
-- em dupla fixa são DUAS pessoas na mesma linha, e as duas vestem camisa.
alter table tournament_entries
  add column if not exists shirt_size text,
  add column if not exists partner_shirt_size text;

-- A grade vive em lib/torneios/shirtSize.ts; o check só impede lixo entrar.
-- Acrescentar tamanho exige mexer aqui E lá — é deliberado: a planilha de
-- encomenda só soma entre torneios se a grade for a mesma para todo mundo.
alter table tournament_entries drop constraint if exists tournament_entries_shirt_size_check;
alter table tournament_entries add constraint tournament_entries_shirt_size_check
  check (shirt_size is null or shirt_size in ('p','m','g','gg','xg','baby_p','baby_m','baby_g','baby_gg'));

alter table tournament_entries drop constraint if exists tournament_entries_partner_shirt_size_check;
alter table tournament_entries add constraint tournament_entries_partner_shirt_size_check
  check (partner_shirt_size is null or partner_shirt_size in ('p','m','g','gg','xg','baby_p','baby_m','baby_g','baby_gg'));

comment on column tournament_entries.shirt_size is
  'Tamanho de camisa do titular. Nulo = torneio sem camisa, ou inscrição anterior a esta coluna.';
comment on column tournament_entries.partner_shirt_size is
  'Tamanho do parceiro em dupla fixa. Nulo quando não há parceiro.';

-- A chave por torneio. Default FALSE: torneio sem brinde não pode passar a
-- exigir um campo a mais de quem se inscreve — e é a maioria deles.
alter table tournaments
  add column if not exists shirt_sizes_enabled boolean not null default false;

comment on column tournaments.shirt_sizes_enabled is
  'Ligada, a inscrição exige tamanho de camisa e o admin baixa a planilha de encomenda. Desligada, o campo não existe na tela.';
