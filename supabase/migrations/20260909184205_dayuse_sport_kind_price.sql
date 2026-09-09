-- Day use ganha os três campos que faltavam: modalidade, tipo e preço próprio.
--
-- `sport`: rótulo da modalidade, mesmo papel de classes.sport — identifica a
-- turma/slot e NÃO restringe quem reserva. NULL = sem modalidade declarada.
--
-- `kind`: os dois modelos que as arenas usam de fato.
--   'scheduled' = horário marcado, vaga contada (o que já existia)
--   'open'      = livre no período, rotativo; `capacity` vira teto de pessoas
-- Default 'scheduled' para nenhum slot existente mudar de comportamento.
--
-- `price_cents`: preço DESTE day use. NULL = herda system_settings.day_use_price
-- da academia, que é o comportamento de hoje — então nada muda sem o admin
-- preencher. Centavo inteiro para acompanhar o resto do dinheiro novo do app
-- (tournaments.entry_price_cents), em vez de numeric.
alter table dayuse_slots
  add column if not exists sport text,
  add column if not exists kind text not null default 'scheduled',
  add column if not exists price_cents int;

alter table dayuse_slots drop constraint if exists dayuse_slots_kind_check;
alter table dayuse_slots add constraint dayuse_slots_kind_check
  check (kind in ('scheduled', 'open'));

alter table dayuse_slots drop constraint if exists dayuse_slots_price_cents_check;
alter table dayuse_slots add constraint dayuse_slots_price_cents_check
  check (price_cents is null or price_cents >= 0);

comment on column dayuse_slots.sport is
  'Modalidade (slug de lib/arenas/sports.ts). Rótulo: identifica o day use, não restringe quem reserva.';
comment on column dayuse_slots.kind is
  'scheduled = horário marcado com vaga contada; open = livre no período (rotativo), capacity é o teto de pessoas.';
comment on column dayuse_slots.price_cents is
  'Preço deste day use em centavos. NULL = usa o padrão da academia (system_settings.day_use_price).';
