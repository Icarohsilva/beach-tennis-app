-- scripts/liga-limpar-pontuacoes.sql
--
-- Apaga as pontuações da Liga para recomeçar do zero.
--
-- Use antes de `liga-refazer-pontuacoes.sql` quando quiser recontar tudo com pesos
-- ou regras diferentes. Rodar só o refazer NÃO corrige pontuação errada: ele é
-- idempotente e ignora o que já existe, então o valor antigo continuaria lá.
--
-- O QUE ESTE SCRIPT APAGA
--   - liga_points (extrato) das temporadas que tocam a janela
--   - o cache liga_standings.points volta a bater com o extrato que sobrou
--
-- O QUE ELE NÃO APAGA, de propósito
--   - medalhas (liga_medals): são conquistas, não pontos, e refazê-las é trabalho
--     do cron liga-streak
--   - elogios (liga_kudos): a mensagem que o colega escreveu não é ponto
--   - prêmios (liga_prize_awards): o que a academia deve a alguém não pode sumir
--     por causa de uma recontagem
--   - divisão e sequência (liga_standings.division / streak_weeks)
--
-- Se quiser mesmo zerar medalhas ou prêmios, há dois DELETEs comentados no fim.

do $$
declare
  -- Janela: qualquer temporada que encoste nela é limpa por inteiro.
  v_from date := date '2026-08-01';
  v_to   date := current_date;

  -- null = todas as academias. Preencha o slug para limitar a uma.
  v_org_slug text := null;

  -- null = todas as fontes. Ex.: array['attendance'] para limpar só presença.
  v_reasons text[] := null;

  v_deleted bigint;
  v_seasons int;
begin
  select count(*) into v_seasons
    from liga_seasons s
    join organizations o on o.id = s.organization_id
   where s.ends_on >= v_from and s.starts_on <= v_to
     and (v_org_slug is null or o.slug = v_org_slug);

  delete from liga_points p
   where p.season_id in (
           select s.id
             from liga_seasons s
             join organizations o on o.id = s.organization_id
            where s.ends_on >= v_from and s.starts_on <= v_to
              and (v_org_slug is null or o.slug = v_org_slug)
         )
     and (v_reasons is null or p.reason = any(v_reasons));

  get diagnostics v_deleted = row_count;

  -- Cache reconstruído a partir do extrato que sobrou, e não zerado na marra: com
  -- filtro por fonte, parte dos pontos continua válida. O extrato é a verdade.
  update liga_standings st
     set points = coalesce((
           select sum(p.points)
             from liga_points p
            where p.season_id = st.season_id
              and p.student_id = st.student_id
              and p.sport = st.sport
         ), 0)
   where st.season_id in (
           select s.id
             from liga_seasons s
             join organizations o on o.id = s.organization_id
            where s.ends_on >= v_from and s.starts_on <= v_to
              and (v_org_slug is null or o.slug = v_org_slug)
         );

  raise notice 'Temporadas afetadas: %', v_seasons;
  raise notice 'Lançamentos apagados do extrato: %', v_deleted;
  raise notice 'Cache de posição recalculado a partir do extrato restante.';
end $$;

-- ---------------------------------------------------------------------------
-- Conferência: deve sobrar zero (ou só o que você decidiu manter).
-- ---------------------------------------------------------------------------
-- select s.starts_on, p.reason, count(*), sum(p.points)
--   from liga_points p
--   join liga_seasons s on s.id = p.season_id
--  where s.starts_on >= date '2026-08-01'
--  group by 1, 2
--  order by 1, 2;

-- ---------------------------------------------------------------------------
-- Só se você quiser MESMO zerar também estes. Leia os comentários do topo antes.
-- ---------------------------------------------------------------------------
-- delete from liga_medals where organization_id = (select id from organizations where slug = 'SEU-SLUG');
-- delete from liga_prize_awards where organization_id = (select id from organizations where slug = 'SEU-SLUG');
