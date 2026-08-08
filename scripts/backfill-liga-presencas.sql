-- scripts/backfill-liga-presencas.sql
--
-- Credita na Liga as presenças que já estavam no sistema antes de ela existir.
--
-- Por que é preciso: o ponto de presença é creditado dentro de markAttendance, no
-- momento da chamada. Presença marcada ANTES da Liga entrar no ar nunca passou por
-- esse caminho, então o extrato não tem essas linhas.
--
-- Seguro rodar mais de uma vez. Quem garante isso não é este arquivo: é o índice
-- liga_points_dedup_idx (season, student, sport, reason, source_id), com source_id =
-- id da sessão. A segunda execução insere zero linhas e não mexe no cache.
--
-- Como usar: ajuste as três variáveis abaixo e rode o bloco inteiro no SQL Editor.

do $$
declare
  -- Janela a creditar, bordas incluídas.
  v_from date := date '2026-08-01';
  v_to   date := current_date;

  -- null = todas as academias que já ligaram a Liga (system_settings.liga_enabled).
  -- Preencha o slug para limitar a uma academia; nesse caso a flag é ignorada, o que
  -- permite creditar antes de ligar a Liga para os alunos.
  v_org_slug text := null;

  r record;
  v_sport   text;
  v_season  uuid;
  v_points  int;
  v_before  bigint;
  v_after   bigint;
  v_seen    int := 0;
  v_skipped int := 0;
begin
  select count(*) into v_before from liga_points where reason = 'attendance';

  for r in
    select
      a.student_id,
      a.session_id,
      a.organization_id,
      cs.session_date,
      c.sport  as class_sport,
      o.sports as org_sports
    from attendance a
    join class_sessions cs on cs.id = a.session_id
    left join classes c    on c.id  = cs.class_id
    join organizations o   on o.id  = a.organization_id
    where a.status = 'present'
      and cs.session_date between v_from and v_to
      and (v_org_slug is null or o.slug = v_org_slug)
      and (
        v_org_slug is not null
        or exists (
          select 1 from system_settings s
           where s.organization_id = o.id
             and s.key = 'liga_enabled'
             and s.value = 'true'
        )
      )
    order by cs.session_date
  loop
    -- Espelha lib/liga/sportForPoints.ts: a modalidade da turma manda; sem ela, só
    -- resolve quando a academia oferece exatamente uma modalidade. Chutar entre várias
    -- colocaria o ponto no ranking errado sem ninguém entender por quê.
    v_sport := coalesce(
      r.class_sport,
      case when coalesce(array_length(r.org_sports, 1), 0) = 1 then r.org_sports[1] end
    );

    if v_sport is null then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    -- Temporada mensal que contém a data da aula. Cria se faltar: creditar agosto não
    -- pode depender de alguém ter aberto a Liga em agosto.
    insert into liga_seasons (organization_id, starts_on, ends_on)
    values (
      r.organization_id,
      date_trunc('month', r.session_date)::date,
      (date_trunc('month', r.session_date) + interval '1 month' - interval '1 day')::date
    )
    on conflict (organization_id, starts_on) do nothing;

    select id into v_season
      from liga_seasons
     where organization_id = r.organization_id
       and starts_on = date_trunc('month', r.session_date)::date;

    -- Peso configurado pela academia. O regex evita que um valor digitado errado em
    -- system_settings derrube o backfill inteiro; 10 é o default do app.
    select coalesce(
      (select value::int
         from system_settings
        where organization_id = r.organization_id
          and key = 'liga_points_attendance'
          and value ~ '^[0-9]+$'),
      10
    ) into v_points;

    -- Pela RPC, nunca por insert direto: é ela que mantém extrato e cache na mesma
    -- transação e acrescenta a modalidade ao aluno que ainda não a declarou.
    perform public.liga_award_points(
      p_org        => r.organization_id,
      p_season     => v_season,
      p_student    => r.student_id,
      p_sport      => v_sport,
      p_points     => v_points,
      p_reason     => 'attendance',
      p_source_id  => r.session_id,
      p_note       => null,
      p_awarded_by => null
    );

    v_seen := v_seen + 1;
  end loop;

  select count(*) into v_after from liga_points where reason = 'attendance';

  raise notice 'Presenças elegíveis processadas: %', v_seen;
  raise notice 'Pontos NOVOS creditados: %', v_after - v_before;
  raise notice 'Ignoradas (turma sem modalidade em academia multi-modalidade): %', v_skipped;
end $$;

-- ---------------------------------------------------------------------------
-- Conferência: como ficou o ranking da temporada corrente.
-- ---------------------------------------------------------------------------
-- select o.name as academia,
--        p.full_name as aluno,
--        st.sport,
--        st.division,
--        st.points
--   from liga_standings st
--   join liga_seasons s   on s.id = st.season_id and s.status = 'active'
--   join profiles p       on p.id = st.student_id
--   join organizations o  on o.id = st.organization_id
--  order by o.name, st.sport, st.points desc;

-- ---------------------------------------------------------------------------
-- Quem ficou de fora, e por quê: turmas ativas sem modalidade.
-- ---------------------------------------------------------------------------
-- select o.name as academia, c.name as turma, c.day_of_week, c.start_time
--   from classes c
--   join organizations o on o.id = c.organization_id
--  where c.is_active and c.sport is null
--  order by o.name, c.day_of_week, c.start_time;
