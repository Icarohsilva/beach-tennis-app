-- scripts/liga-refazer-pontuacoes.sql
--
-- Recalcula TODAS as pontuações da Liga a partir dos eventos que já estão no banco,
-- desde a data escolhida. Substitui o antigo `backfill-liga-presencas.sql`, que só
-- cobria presença — este cobre as nove fontes.
--
-- Seguro rodar mais de uma vez: quem garante isso não é este arquivo, é o índice
-- liga_points_dedup_idx (temporada, aluno, esporte, motivo, evento de origem). A
-- segunda execução insere zero linhas.
--
-- Justamente por ser idempotente, ele NÃO corrige pontuação errada: para recontar
-- com pesos diferentes, rode antes o `liga-limpar-pontuacoes.sql`.
--
-- FONTES COBERTAS
--   presença · confirmação pelo app · cancelamento a tempo · vaga da fila ·
--   agendamento antecipado · day use · cadastro completo · torneio (inscrição e
--   pódio) · elogios que pontuaram
--
-- NÃO COBERTA: bônus de sequência (reason 'streak'). Ele é semanal e o cron
-- liga-streak recalcula sozinho na próxima passada — refazer aqui daria bônus com
-- a sequência de hoje aplicada a semanas passadas.

do $$
declare
  v_from date := date '2026-08-01';
  v_to   date := current_date;

  -- null = todas as academias com a Liga ligada. Com slug preenchido, a flag é
  -- ignorada (permite creditar antes de ligar a Liga para os alunos).
  v_org_slug text := null;

  o record;
  r record;

  v_season uuid;
  v_sport  text;
  v_single_sport text;
  v_cancel_hours int;

  w_attendance int; w_self int; w_cancel int; w_wait int; w_early int;
  w_profile int; w_dayuse int; w_t_entry int; w_t_win int;
  w_kudos_given int; w_kudos_received int;

  n_attendance int := 0; n_self int := 0; n_cancel int := 0; n_wait int := 0;
  n_early int := 0; n_profile int := 0; n_dayuse int := 0; n_tourn int := 0;
  n_kudos int := 0;
  v_before bigint; v_after bigint;
begin
  select count(*) into v_before from liga_points;

  for o in
    select org.id, org.slug, org.sports
      from organizations org
     where (v_org_slug is null or org.slug = v_org_slug)
       and (
         v_org_slug is not null
         or exists (
           select 1 from system_settings s
            where s.organization_id = org.id and s.key = 'liga_enabled' and s.value = 'true'
         )
       )
  loop
    -- Pesos da academia. O regex evita que um valor digitado errado derrube tudo.
    select coalesce((select value::int from system_settings where organization_id=o.id and key='liga_points_attendance'       and value ~ '^[0-9]+$'), 10) into w_attendance;
    select coalesce((select value::int from system_settings where organization_id=o.id and key='liga_points_self_checkin'     and value ~ '^[0-9]+$'),  3) into w_self;
    select coalesce((select value::int from system_settings where organization_id=o.id and key='liga_points_cancel_in_time'   and value ~ '^[0-9]+$'),  5) into w_cancel;
    select coalesce((select value::int from system_settings where organization_id=o.id and key='liga_points_waitlist_accept'  and value ~ '^[0-9]+$'),  8) into w_wait;
    select coalesce((select value::int from system_settings where organization_id=o.id and key='liga_points_early_booking'    and value ~ '^[0-9]+$'),  3) into w_early;
    select coalesce((select value::int from system_settings where organization_id=o.id and key='liga_points_profile_complete' and value ~ '^[0-9]+$'), 20) into w_profile;
    select coalesce((select value::int from system_settings where organization_id=o.id and key='liga_points_dayuse'           and value ~ '^[0-9]+$'),  5) into w_dayuse;
    select coalesce((select value::int from system_settings where organization_id=o.id and key='liga_points_tournament_entry' and value ~ '^[0-9]+$'), 30) into w_t_entry;
    select coalesce((select value::int from system_settings where organization_id=o.id and key='liga_points_tournament_win'   and value ~ '^[0-9]+$'), 50) into w_t_win;
    select coalesce((select value::int from system_settings where organization_id=o.id and key='liga_points_kudos_given'      and value ~ '^[0-9]+$'),  5) into w_kudos_given;
    select coalesce((select value::int from system_settings where organization_id=o.id and key='liga_points_kudos_received'   and value ~ '^[0-9]+$'), 15) into w_kudos_received;
    select coalesce((select value::int from system_settings where organization_id=o.id and key='cancellation_window_hours'    and value ~ '^[0-9]+$'),  5) into v_cancel_hours;

    -- Modalidade única da academia: é o fallback de lib/liga/sportForPoints.ts.
    v_single_sport := case
      when coalesce(array_length(o.sports, 1), 0) = 1 then o.sports[1]
      else null
    end;

    -- Temporadas mensais de toda a janela, criadas de uma vez.
    insert into liga_seasons (organization_id, starts_on, ends_on)
    select o.id, d::date, (d + interval '1 month' - interval '1 day')::date
      from generate_series(
             date_trunc('month', v_from::timestamp),
             date_trunc('month', v_to::timestamp),
             interval '1 month'
           ) d
    on conflict (organization_id, starts_on) do nothing;

    -- ---------------------------------------------------------------------
    -- 1. Presença
    -- ---------------------------------------------------------------------
    if w_attendance > 0 then
      for r in
        select a.student_id, a.session_id, cs.session_date, c.sport
          from attendance a
          join class_sessions cs on cs.id = a.session_id
          left join classes c on c.id = cs.class_id
         where a.organization_id = o.id
           and a.status = 'present'
           and cs.session_date between v_from and v_to
      loop
        v_sport := coalesce(r.sport, v_single_sport);
        continue when v_sport is null;
        select id into v_season from liga_seasons
         where organization_id = o.id and starts_on = date_trunc('month', r.session_date)::date;
        perform liga_award_points(o.id, v_season, r.student_id, v_sport,
                                  w_attendance, 'attendance', r.session_id, null, null);
        n_attendance := n_attendance + 1;
      end loop;
    end if;

    -- ---------------------------------------------------------------------
    -- 2. Confirmação de presença pelo app (só a validada)
    -- ---------------------------------------------------------------------
    if w_self > 0 then
      for r in
        select sc.student_id, sc.session_id, cs.session_date, c.sport
          from self_checkins sc
          join class_sessions cs on cs.id = sc.session_id
          left join classes c on c.id = cs.class_id
         where sc.organization_id = o.id
           and sc.status = 'validated'
           and cs.session_date between v_from and v_to
      loop
        v_sport := coalesce(r.sport, v_single_sport);
        continue when v_sport is null;
        select id into v_season from liga_seasons
         where organization_id = o.id and starts_on = date_trunc('month', r.session_date)::date;
        perform liga_award_points(o.id, v_season, r.student_id, v_sport,
                                  w_self, 'self_checkin', r.session_id, null, null);
        n_self := n_self + 1;
      end loop;
    end if;

    -- ---------------------------------------------------------------------
    -- 3. Cancelamento dentro da janela
    -- ---------------------------------------------------------------------
    -- cancelled_at é timestamptz; o horário da aula é local. Converte para o fuso
    -- de Brasília antes de comparar, senão o corte sai 3 horas fora do lugar.
    if w_cancel > 0 then
      for r in
        select b.student_id, b.session_id, cs.session_date, c.sport
          from session_bookings b
          join class_sessions cs on cs.id = b.session_id
          join classes c on c.id = cs.class_id
         where b.organization_id = o.id
           and b.status = 'cancelled'
           and b.cancelled_at is not null
           and cs.session_date between v_from and v_to
           and (b.cancelled_at at time zone 'America/Sao_Paulo')
               <= (cs.session_date + c.start_time) - (v_cancel_hours || ' hours')::interval
      loop
        v_sport := coalesce(r.sport, v_single_sport);
        continue when v_sport is null;
        select id into v_season from liga_seasons
         where organization_id = o.id and starts_on = date_trunc('month', r.session_date)::date;
        perform liga_award_points(o.id, v_season, r.student_id, v_sport,
                                  w_cancel, 'cancel_in_time', r.session_id, null, null);
        n_cancel := n_cancel + 1;
      end loop;
    end if;

    -- ---------------------------------------------------------------------
    -- 4. Vaga da fila de espera
    -- ---------------------------------------------------------------------
    if w_wait > 0 then
      for r in
        select w.student_id, w.session_id, cs.session_date, c.sport
          from waitlists w
          join class_sessions cs on cs.id = w.session_id
          left join classes c on c.id = cs.class_id
         where w.organization_id = o.id
           and w.status = 'accepted'
           and cs.session_date between v_from and v_to
      loop
        v_sport := coalesce(r.sport, v_single_sport);
        continue when v_sport is null;
        select id into v_season from liga_seasons
         where organization_id = o.id and starts_on = date_trunc('month', r.session_date)::date;
        perform liga_award_points(o.id, v_season, r.student_id, v_sport,
                                  w_wait, 'waitlist_accept', r.session_id, null, null);
        n_wait := n_wait + 1;
      end loop;
    end if;

    -- ---------------------------------------------------------------------
    -- 5. Agendamento com antecedência
    -- ---------------------------------------------------------------------
    -- Exclui quem veio da fila (as duas fontes são excludentes, como no app) e as
    -- reservas geradas pela matrícula fixa, que não são um ato de planejamento.
    if w_early > 0 then
      for r in
        select b.student_id, b.session_id, cs.session_date, c.sport
          from session_bookings b
          join class_sessions cs on cs.id = b.session_id
          left join classes c on c.id = cs.class_id
         where b.organization_id = o.id
           and b.status = 'confirmed'
           and b.from_enrollment = false
           and cs.session_date between v_from and v_to
           and cs.session_date - (b.booked_at at time zone 'America/Sao_Paulo')::date >= 2
           and not exists (
             select 1 from waitlists w
              where w.session_id = b.session_id
                and w.student_id = b.student_id
                and w.status = 'accepted'
           )
      loop
        v_sport := coalesce(r.sport, v_single_sport);
        continue when v_sport is null;
        select id into v_season from liga_seasons
         where organization_id = o.id and starts_on = date_trunc('month', r.session_date)::date;
        perform liga_award_points(o.id, v_season, r.student_id, v_sport,
                                  w_early, 'early_booking', r.session_id, null, null);
        n_early := n_early + 1;
      end loop;
    end if;

    -- ---------------------------------------------------------------------
    -- 6. Day use
    -- ---------------------------------------------------------------------
    -- Sem modalidade própria: cai no primeiro esporte do aluno, senão na
    -- modalidade única da academia.
    if w_dayuse > 0 then
      for r in
        select db.id as booking_id, db.student_id, ds.date,
               coalesce(
                 (select m.sports[1] from memberships m
                   where m.organization_id = o.id and m.user_id = db.student_id
                     and coalesce(array_length(m.sports, 1), 0) > 0),
                 v_single_sport
               ) as sport
          from dayuse_bookings db
          join dayuse_slots ds on ds.id = db.slot_id
         where ds.organization_id = o.id
           and db.status = 'confirmed'
           and ds.date between v_from and v_to
      loop
        continue when r.sport is null;
        select id into v_season from liga_seasons
         where organization_id = o.id and starts_on = date_trunc('month', r.date)::date;
        perform liga_award_points(o.id, v_season, r.student_id, r.sport,
                                  w_dayuse, 'dayuse', r.booking_id, null, null);
        n_dayuse := n_dayuse + 1;
      end loop;
    end if;

    -- ---------------------------------------------------------------------
    -- 7. Torneio: inscrição confirmada e pódio
    -- ---------------------------------------------------------------------
    if w_t_entry > 0 or w_t_win > 0 then
      for r in
        select t.id as tournament_id, t.date, t.sport,
               t.winner1_id, t.winner1_partner_id,
               t.winner2_id, t.winner2_partner_id,
               t.winner3_id, t.winner3_partner_id
          from tournaments t
         where t.organization_id = o.id
           and t.status = 'finished'
           and t.date between v_from and v_to
           and t.sport is not null
      loop
        select id into v_season from liga_seasons
         where organization_id = o.id and starts_on = date_trunc('month', r.date)::date;

        if w_t_entry > 0 then
          perform liga_award_points(o.id, v_season, e.player_id, r.sport,
                                    w_t_entry, 'tournament_entry', r.tournament_id, null, null)
             from tournament_entries e
            where e.tournament_id = r.tournament_id
              and e.entry_status = 'confirmed';
        end if;

        if w_t_win > 0 then
          -- 2º e 3º recebem fração do peso da vitória, igual a pointsForTournamentResult.
          perform liga_award_points(o.id, v_season, x.student_id, r.sport, x.pts,
                                    'tournament_result', r.tournament_id, x.nota, null)
             from (
               select r.winner1_id as student_id, w_t_win as pts, '1º lugar' as nota
               union all select r.winner1_partner_id, w_t_win, '1º lugar'
               union all select r.winner2_id, round(w_t_win * 0.6)::int, '2º lugar'
               union all select r.winner2_partner_id, round(w_t_win * 0.6)::int, '2º lugar'
               union all select r.winner3_id, round(w_t_win * 0.3)::int, '3º lugar'
               union all select r.winner3_partner_id, round(w_t_win * 0.3)::int, '3º lugar'
             ) x
            where x.student_id is not null;
        end if;

        n_tourn := n_tourn + 1;
      end loop;
    end if;

    -- ---------------------------------------------------------------------
    -- 8. Elogios que pontuaram
    -- ---------------------------------------------------------------------
    -- Só os que a trava anti-farming deixou pontuar na hora (earns_points). Recontar
    -- os barrados aqui furaria justamente o teto semanal.
    for r in
      select k.id, k.season_id, k.sport, k.from_student_id, k.to_student_id, k.message
        from liga_kudos k
       where k.organization_id = o.id
         and k.earns_points = true
         and k.created_at::date between v_from and v_to
    loop
      if w_kudos_received > 0 then
        perform liga_award_points(o.id, r.season_id, r.to_student_id, r.sport,
                                  w_kudos_received, 'kudos_received', r.id, r.message, null);
      end if;
      if w_kudos_given > 0 then
        perform liga_award_points(o.id, r.season_id, r.from_student_id, r.sport,
                                  w_kudos_given, 'kudos_given', r.id, null, null);
      end if;
      n_kudos := n_kudos + 1;
    end loop;

    -- ---------------------------------------------------------------------
    -- 9. Cadastro completo (uma vez na vida, por academia)
    -- ---------------------------------------------------------------------
    if w_profile > 0 then
      for r in
        select m.user_id,
               coalesce(
                 case when coalesce(array_length(m.sports, 1), 0) > 0 then m.sports[1] end,
                 v_single_sport
               ) as sport
          from memberships m
          join profiles p on p.id = m.user_id
          join medical_profiles mp on mp.profile_id = m.user_id
         where m.organization_id = o.id
           and m.role = 'student'
           and coalesce(btrim(p.phone), '') <> ''
           and coalesce(btrim(mp.emergency_name), '') <> ''
           and coalesce(btrim(mp.emergency_phone), '') <> ''
           and coalesce(array_length(m.sports, 1), 0) > 0
           and not exists (
             select 1 from liga_points lp
              where lp.organization_id = o.id
                and lp.student_id = m.user_id
                and lp.reason = 'profile_complete'
           )
      loop
        continue when r.sport is null;
        select id into v_season from liga_seasons
         where organization_id = o.id and starts_on = date_trunc('month', v_to::timestamp)::date;
        perform liga_award_points(o.id, v_season, r.user_id, r.sport,
                                  w_profile, 'profile_complete', null, 'Cadastro completo', null);
        n_profile := n_profile + 1;
      end loop;
    end if;
  end loop;

  select count(*) into v_after from liga_points;

  raise notice '--- eventos processados ---';
  raise notice 'presenças: %  · confirmações no app: %', n_attendance, n_self;
  raise notice 'cancelamentos a tempo: %  · vagas da fila: %', n_cancel, n_wait;
  raise notice 'agendamentos antecipados: %  · day use: %', n_early, n_dayuse;
  raise notice 'torneios: %  · elogios: %  · cadastros completos: %', n_tourn, n_kudos, n_profile;
  raise notice 'LANÇAMENTOS NOVOS NO EXTRATO: %', v_after - v_before;
end $$;

-- ---------------------------------------------------------------------------
-- Conferência: ranking da temporada corrente.
-- ---------------------------------------------------------------------------
-- select o.name as academia, p.full_name as aluno, st.sport, st.division, st.points
--   from liga_standings st
--   join liga_seasons s   on s.id = st.season_id and s.status = 'active'
--   join profiles p       on p.id = st.student_id
--   join organizations o  on o.id = st.organization_id
--  order by o.name, st.sport, st.points desc;

-- ---------------------------------------------------------------------------
-- De onde vieram os pontos, por fonte.
-- ---------------------------------------------------------------------------
-- select p.reason, count(*) as lancamentos, sum(p.points) as pontos
--   from liga_points p
--   join liga_seasons s on s.id = p.season_id and s.status = 'active'
--  group by 1 order by 3 desc;
