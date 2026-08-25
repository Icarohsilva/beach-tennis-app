-- supabase/migrations/20260826000600_tournament_prizes.sql
-- Premiação: o que o competidor GANHA, anunciado antes do torneio.
--
-- Tabela e não coluna de texto porque prêmio é lista com estrutura: colocação,
-- descrição e valor. Coluna única não liga prêmio a colocação (nem a
-- winner2_id), não soma "R$ 1.200 em prêmios" na página e não tem onde marcar
-- entrega.
--
-- UMA tabela, ao contrário de liga_prizes + liga_prize_awards
-- (20260808000400_liga_premios.sql): aquelas linhas sobrevivem à temporada e
-- são reeditadas na seguinte, então precisam de cópia congelada no
-- fechamento. Estas pertencem a um torneio só, morrem com ele (on delete
-- cascade), e editar depois do pódio é CORREÇÃO — que tem de aparecer, não
-- ficar presa numa versão congelada.
create table if not exists tournament_prizes (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  tournament_id    uuid not null references tournaments(id) on delete cascade,
  -- 'podium'  = prêmio de colocação (1º, 2º, 3º...). position obrigatória.
  -- 'special' = fora do pódio (melhor saque, dupla revelação). position nula.
  kind             text not null default 'podium' check (kind in ('podium', 'special')),
  position         int check (position is null or position between 1 and 8),
  description      text not null,
  -- Dinheiro quando existe, para somar a premiação anunciada. Nulo = prêmio só
  -- em texto (troféu, kit, aulas) — 0 diria "prêmio de zero real".
  value_cents      int check (value_cents is null or value_cents >= 0),
  -- A academia marca quando entregou. Troféu na mão o sistema não vê sozinho.
  delivered_at     timestamptz,
  created_at       timestamptz not null default now(),
  constraint tournament_prizes_position_chk check (
    (kind = 'podium' and position is not null) or (kind = 'special' and position is null)
  )
);

-- Um prêmio por colocação. Parcial porque 'special' tem position nula e dois
-- NULLs nunca colidem num índice único comum — prêmio especial pode repetir.
create unique index if not exists tournament_prizes_podium_unique_idx
  on tournament_prizes (tournament_id, position) where position is not null;

create index if not exists tournament_prizes_tournament_idx
  on tournament_prizes (organization_id, tournament_id);

alter table tournament_prizes enable row level security;

-- Prêmio anunciado é público: é ele que faz a pessoa se inscrever. Espelha
-- tournaments_public_read (20260628000300) — rascunho não aparece.
drop policy if exists tournament_prizes_public_read on tournament_prizes;
create policy tournament_prizes_public_read on tournament_prizes
  for select to anon, authenticated
  using (tournament_id in (select id from tournaments where status <> 'draft'));

drop policy if exists tournament_prizes_admin_org on tournament_prizes;
create policy tournament_prizes_admin_org on tournament_prizes
  for all to authenticated
  using (organization_id in (select auth_admin_org_ids()));

comment on table tournament_prizes is
  'O que o competidor ganha neste torneio. Editável até a entrega; delivered_at é o "já foi entregue" que o sistema não tem como saber sozinho.';
