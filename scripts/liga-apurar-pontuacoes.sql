-- scripts/liga-apurar-pontuacoes.sql
--
-- Apuração completa das pontuações da Liga, em três partes que você roda na ordem:
--
--   PARTE 1  monta a lista de tudo que DEVERIA pontuar e mostra na tela. Não grava
--            ponto nenhum. É aqui que você confere se a contagem faz sentido.
--   PARTE 2  grava o que a Parte 1 listou.
--   PARTE 3  compara o esperado com o que entrou de fato e aponta divergência.
--
-- Por que em três partes: o script anterior contava EVENTOS PROCESSADOS, não
-- lançamentos gravados. Como o crédito é idempotente, ele dizia "320 presenças"
-- tendo inserido 100 — número correto para a pergunta errada. Aqui a lista de
-- eventos vira uma tabela que você inspeciona antes, e a conferência final olha o
-- extrato de verdade.
--
-- PRÉ-REQUISITOS
--   - migration 20260808000300_liga_pontos_extras.sql aplicada (senão as fontes
--     novas são recusadas pelo check de liga_points.reason)
--   - se for recontar do zero, rode antes o liga-limpar-pontuacoes.sql
--
-- Rode a PARTE 1 inteira de uma vez. Ela cria a tabela `liga_backfill_eventos`, que
-- fica no banco entre as execuções — é o que permite conferir antes de gravar.

-- ===========================================================================
-- PARTE 1 — APURAR (não grava pontuação)
-- ===========================================================================

drop table if exists liga_backfill_eventos;
drop table if exists liga_backfill_cfg;

-- --- Janela e escopo -------------------------------------------------------
-- Mude aqui e rode a Parte 1 de novo quantas vezes quiser: ela sempre recomeça.
create table liga_backfill_params as
select
  date '2026-08-01' as data_de,
  current_date      as data_ate,
  null::text        as org_slug;   -- null = todas as academias com a Liga ligada

-- --- Configuração de cada academia (pesos + modalidade única) --------------
create table liga_backfill_cfg as
select
  o.id   as org_id,
  o.name as org_nome,
  case when coalesce(array_length(o.sports, 1), 0) = 1 then o.sports[1] end as single_sport,
  coalesce(max(case when s.key = 'liga_points_attendance'       and s.value ~ '^[0-9]+$' then s.value::int end), 10) as w_attendance,
  coalesce(max(case when s.key = 'liga_points_self_checkin'     and s.value ~ '^[0-9]+$' then s.value::int end),  3) as w_self,
  coalesce(max(case when s.key = 'liga_points_cancel_in_time'   and s.value ~ '^[0-9]+$' then s.value::int end),  5) as w_cancel,
  coalesce(max(case when s.key = 'liga_points_waitlist_accept'  and s.value ~ '^[0-9]+$' then s.value::int end),  8) as w_wait,
  coalesce(max(case when s.key = 'liga_points_early_booking'    and s.value ~ '^[0-9]+$' then s.value::int end),  3) as w_early,
  coalesce(max(case when s.key = 'liga_points_profile_complete' and s.value ~ '^[0-9]+$' then s.value::int end), 20) as w_profile,
  coalesce(max(case when s.key = 'liga_points_dayuse'           and s.value ~ '^[0-9]+$' then s.value::int end),  5) as w_dayuse,
  coalesce(max(case when s.key = 'liga_points_tournament_entry' and s.value ~ '^[0-9]+$' then s.value::int end), 30) as w_t_entry,
  coalesce(max(case when s.key = 'liga_points_tournament_win'   and s.value ~ '^[0-9]+$' then s.value::int end), 50) as w_t_win,
  coalesce(max(case when s.key = 'liga_points_kudos_given'      and s.value ~ '^[0-9]+$' then s.value::int end),  5) as w_kudos_given,
  coalesce(max(case when s.key = 'liga_points_kudos_received'   and s.value ~ '^[0-9]+$' then s.value::int end), 15) as w_kudos_recv,
  coalesce(max(case when s.key = 'cancellation_window_hours'    and s.value ~ '^[0-9]+$' then s.value::int end),  5) as cancel_horas
from organizations o
left join system_settings s on s.organization_id = o.id
cross join liga_backfill_params prm
where (prm.org_slug is null or o.slug = prm.org_slug)
  and (
    prm.org_slug is not null
    or exists (
      select 1 from system_settings e
       where e.organization_id = o.id and e.key = 'liga_enabled' and e.value = 'true'
    )
  )
group by o.id, o.name, o.sports;

-- --- Temporadas mensais da janela (cria as que faltarem) -------------------
insert into liga_seasons (organization_id, starts_on, ends_on)
select c.org_id, d::date, (d + interval '1 month' - interval '1 day')::date
  from liga_backfill_cfg c
 cross join liga_backfill_params prm
 cross join lateral generate_series(
   date_trunc('month', prm.data_de::timestamp),
   date_trunc('month', prm.data_ate::timestamp),
   interval '1 month'
 ) d
on conflict (organization_id, starts_on) do nothing;

-- --- Lista de eventos elegíveis -------------------------------------------
-- Uma linha por ponto a creditar. É EXATAMENTE o que a Parte 2 vai gravar: a
-- prévia não é uma estimativa parecida, é a mesma lista.
create table liga_backfill_eventos (
  org_id      uuid not null,
  student_id  uuid not null,
  sport       text not null,
  reason      text not null,
  points      int  not null,
  source_id   uuid,
  event_date  date not null,
  nota        text
);

-- 1. Presença em aula
insert into liga_backfill_eventos
select c.org_id, a.student_id, coalesce(cl.sport, c.single_sport), 'attendance',
       c.w_attendance, a.session_id, cs.session_date, null
  from attendance a
  join class_sessions cs on cs.id = a.session_id
  left join classes cl on cl.id = cs.class_id
  join liga_backfill_cfg c on c.org_id = a.organization_id
 cross join liga_backfill_params prm
 where a.status = 'present'
   and cs.session_date between prm.data_de and prm.data_ate
   and c.w_attendance > 0
   and coalesce(cl.sport, c.single_sport) is not null;

-- 2. Confirmação de presença pelo app (só a validada)
insert into liga_backfill_eventos
select c.org_id, sc.student_id, coalesce(cl.sport, c.single_sport), 'self_checkin',
       c.w_self, sc.session_id, cs.session_date, null
  from self_checkins sc
  join class_sessions cs on cs.id = sc.session_id
  left join classes cl on cl.id = cs.class_id
  join liga_backfill_cfg c on c.org_id = sc.organization_id
 cross join liga_backfill_params prm
 where sc.status = 'validated'
   and cs.session_date between prm.data_de and prm.data_ate
   and c.w_self > 0
   and coalesce(cl.sport, c.single_sport) is not null;

-- 3. Cancelamento dentro da janela (o que libera a vaga a tempo)
-- cancelled_at é timestamptz e o horário da aula é local: converte para Brasília
-- antes de comparar, senão o corte sai 3 horas fora do lugar.
insert into liga_backfill_eventos
select c.org_id, b.student_id, coalesce(cl.sport, c.single_sport), 'cancel_in_time',
       c.w_cancel, b.session_id, cs.session_date, null
  from session_bookings b
  join class_sessions cs on cs.id = b.session_id
  join classes cl on cl.id = cs.class_id
  join liga_backfill_cfg c on c.org_id = b.organization_id
 cross join liga_backfill_params prm
 where b.status = 'cancelled'
   and b.cancelled_at is not null
   and cs.session_date between prm.data_de and prm.data_ate
   and c.w_cancel > 0
   and coalesce(cl.sport, c.single_sport) is not null
   and (b.cancelled_at at time zone 'America/Sao_Paulo')
       <= (cs.session_date + cl.start_time) - (c.cancel_horas || ' hours')::interval;

-- 4. Vaga pega na fila de espera
insert into liga_backfill_eventos
select c.org_id, w.student_id, coalesce(cl.sport, c.single_sport), 'waitlist_accept',
       c.w_wait, w.session_id, cs.session_date, null
  from waitlists w
  join class_sessions cs on cs.id = w.session_id
  left join classes cl on cl.id = cs.class_id
  join liga_backfill_cfg c on c.org_id = w.organization_id
 cross join liga_backfill_params prm
 where w.status = 'accepted'
   and cs.session_date between prm.data_de and prm.data_ate
   and c.w_wait > 0
   and coalesce(cl.sport, c.single_sport) is not null;

-- 5. Agendamento com antecedência
-- Exclui quem veio da fila (as duas fontes são excludentes, como no app) e as
-- reservas geradas pela matrícula fixa, que não são ato de planejamento.
insert into liga_backfill_eventos
select c.org_id, b.student_id, coalesce(cl.sport, c.single_sport), 'early_booking',
       c.w_early, b.session_id, cs.session_date, null
  from session_bookings b
  join class_sessions cs on cs.id = b.session_id
  left join classes cl on cl.id = cs.class_id
  join liga_backfill_cfg c on c.org_id = b.organization_id
 cross join liga_backfill_params prm
 where b.status = 'confirmed'
   and b.from_enrollment = false
   and cs.session_date between prm.data_de and prm.data_ate
   and c.w_early > 0
   and coalesce(cl.sport, c.single_sport) is not null
   and cs.session_date - (b.booked_at at time zone 'America/Sao_Paulo')::date >= 2
   and not exists (
     select 1 from waitlists wl
      where wl.session_id = b.session_id
        and wl.student_id = b.student_id
        and wl.status = 'accepted'
   );

-- 6. Day use (sem modalidade própria: cai no esporte principal do aluno)
insert into liga_backfill_eventos
select c.org_id, db.student_id,
       coalesce(
         (select m.sports[1] from memberships m
           where m.organization_id = c.org_id and m.user_id = db.student_id
             and coalesce(array_length(m.sports, 1), 0) > 0),
         c.single_sport
       ),
       'dayuse', c.w_dayuse, db.id, ds.date, null
  from dayuse_bookings db
  join dayuse_slots ds on ds.id = db.slot_id
  join liga_backfill_cfg c on c.org_id = ds.organization_id
 cross join liga_backfill_params prm
 where db.status = 'confirmed'
   and ds.date between prm.data_de and prm.data_ate
   and c.w_dayuse > 0
   and coalesce(
         (select m.sports[1] from memberships m
           where m.organization_id = c.org_id and m.user_id = db.student_id
             and coalesce(array_length(m.sports, 1), 0) > 0),
         c.single_sport
       ) is not null;

-- 7a. Inscrição em torneio finalizado
insert into liga_backfill_eventos
select c.org_id, e.player_id, t.sport, 'tournament_entry',
       c.w_t_entry, t.id, t.date, null
  from tournament_entries e
  join tournaments t on t.id = e.tournament_id
  join liga_backfill_cfg c on c.org_id = t.organization_id
 cross join liga_backfill_params prm
 where t.status = 'finished'
   and t.sport is not null
   and t.date between prm.data_de and prm.data_ate
   and e.entry_status = 'confirmed'
   and c.w_t_entry > 0;

-- 7b. Pódio (2º e 3º recebem fração, igual a pointsForTournamentResult)
insert into liga_backfill_eventos
select c.org_id, x.student_id, t.sport, 'tournament_result', x.pts, t.id, t.date, x.nota
  from tournaments t
  join liga_backfill_cfg c on c.org_id = t.organization_id
 cross join liga_backfill_params prm
 cross join lateral (
   values
     (t.winner1_id,         c.w_t_win,                    '1º lugar'),
     (t.winner1_partner_id, c.w_t_win,                    '1º lugar'),
     (t.winner2_id,         round(c.w_t_win * 0.6)::int,  '2º lugar'),
     (t.winner2_partner_id, round(c.w_t_win * 0.6)::int,  '2º lugar'),
     (t.winner3_id,         round(c.w_t_win * 0.3)::int,  '3º lugar'),
     (t.winner3_partner_id, round(c.w_t_win * 0.3)::int,  '3º lugar')
 ) as x(student_id, pts, nota)
 where t.status = 'finished'
   and t.sport is not null
   and t.date between prm.data_de and prm.data_ate
   and c.w_t_win > 0
   and x.student_id is not null;

-- 8. Elogios que pontuaram
-- Só os que a trava anti-farming deixou pontuar na hora. Recontar os barrados aqui
-- furaria justamente o teto semanal.
insert into liga_backfill_eventos
select c.org_id, k.to_student_id, k.sport, 'kudos_received',
       c.w_kudos_recv, k.id, k.created_at::date, k.message
  from liga_kudos k
  join liga_backfill_cfg c on c.org_id = k.organization_id
 cross join liga_backfill_params prm
 where k.earns_points = true
   and k.created_at::date between prm.data_de and prm.data_ate
   and c.w_kudos_recv > 0;

insert into liga_backfill_eventos
select c.org_id, k.from_student_id, k.sport, 'kudos_given',
       c.w_kudos_given, k.id, k.created_at::date, null
  from liga_kudos k
  join liga_backfill_cfg c on c.org_id = k.organization_id
 cross join liga_backfill_params prm
 where k.earns_points = true
   and k.created_at::date between prm.data_de and prm.data_ate
   and c.w_kudos_given > 0;

-- 9. Cadastro completo (uma vez na vida, por academia)
insert into liga_backfill_eventos
select c.org_id, m.user_id,
       coalesce(
         case when coalesce(array_length(m.sports, 1), 0) > 0 then m.sports[1] end,
         c.single_sport
       ),
       'profile_complete', c.w_profile, null, prm.data_ate, 'Cadastro completo'
  from memberships m
  join profiles p on p.id = m.user_id
  join medical_profiles mp on mp.profile_id = m.user_id
  join liga_backfill_cfg c on c.org_id = m.organization_id
 cross join liga_backfill_params prm
 where m.role = 'student'
   and c.w_profile > 0
   and coalesce(btrim(p.phone), '') <> ''
   and coalesce(btrim(mp.emergency_name), '') <> ''
   and coalesce(btrim(mp.emergency_phone), '') <> ''
   and coalesce(array_length(m.sports, 1), 0) > 0
   and coalesce(
         case when coalesce(array_length(m.sports, 1), 0) > 0 then m.sports[1] end,
         c.single_sport
       ) is not null
   -- Já recebeu em qualquer temporada? Então não entra.
   and not exists (
     select 1 from liga_points lp
      where lp.organization_id = c.org_id
        and lp.student_id = m.user_id
        and lp.reason = 'profile_complete'
   );

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA A: quanto cada fonte vai somar
-- ---------------------------------------------------------------------------
select reason                as fonte,
       count(*)              as eventos,
       count(distinct student_id) as alunos,
       sum(points)           as pontos
  from liga_backfill_eventos
 group by reason
 order by pontos desc;

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA B: quanto cada aluno vai receber, por modalidade
-- ---------------------------------------------------------------------------
-- É esta a tabela para bater o olho: se algum número parecer alto demais, filtre
-- o aluno na CONFERÊNCIA C e veja evento por evento.
select p.full_name as aluno,
       e.sport     as modalidade,
       sum(e.points) as pontos,
       count(*)      as eventos
  from liga_backfill_eventos e
  join profiles p on p.id = e.student_id
 group by p.full_name, e.sport
 order by pontos desc;

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA C: extrato detalhado de um aluno (troque o nome)
-- ---------------------------------------------------------------------------
-- select p.full_name, e.event_date, e.reason, e.sport, e.points, e.nota
--   from liga_backfill_eventos e
--   join profiles p on p.id = e.student_id
--  where p.full_name ilike '%camila%'
--  order by e.event_date, e.reason;

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA D: o que JÁ está gravado hoje, para comparar com o previsto acima
-- ---------------------------------------------------------------------------
-- Se aqui já houver linhas, a Parte 2 vai gravar só a diferença (o crédito é
-- idempotente). Para recontar do zero, rode antes o liga-limpar-pontuacoes.sql.
select lp.reason as fonte, count(*) as lancamentos, sum(lp.points) as pontos
  from liga_points lp
  join liga_seasons s on s.id = lp.season_id
 cross join liga_backfill_params prm
 where s.ends_on >= prm.data_de and s.starts_on <= prm.data_ate
 group by lp.reason
 order by pontos desc;


-- ===========================================================================
-- PARTE 2 — GRAVAR
-- ===========================================================================
-- Rode só depois de conferir as tabelas acima. Grava exatamente o que está em
-- liga_backfill_eventos, pela RPC oficial (extrato + cache na mesma transação).

do $$
declare
  r record;
  v_season uuid;
  v_antes bigint;
  v_depois bigint;
  v_lidos int := 0;
begin
  select count(*) into v_antes from liga_points;

  for r in select * from liga_backfill_eventos order by event_date loop
    select id into v_season
      from liga_seasons
     where organization_id = r.org_id
       and starts_on = date_trunc('month', r.event_date)::date;

    continue when v_season is null;

    perform liga_award_points(r.org_id, v_season, r.student_id, r.sport,
                              r.points, r.reason, r.source_id, r.nota, null);
    v_lidos := v_lidos + 1;
  end loop;

  select count(*) into v_depois from liga_points;

  raise notice 'eventos na lista: %', v_lidos;
  -- A diferença é o que ENTROU DE FATO. Quando ela é menor que a lista, o resto já
  -- estava creditado — o índice de deduplicação recusou, que é o comportamento certo.
  raise notice 'lancamentos NOVOS no extrato: %', v_depois - v_antes;
end $$;


-- ===========================================================================
-- PARTE 3 — CONFERIR
-- ===========================================================================
-- Esperado (lista) x gravado (extrato), por fonte. As duas colunas de pontos
-- precisam bater. Se não baterem, a coluna `diferenca` mostra onde.

select
  coalesce(prev.fonte, real.fonte)               as fonte,
  coalesce(prev.pontos_previstos, 0)             as pontos_previstos,
  coalesce(real.pontos_gravados, 0)              as pontos_gravados,
  coalesce(real.pontos_gravados, 0) - coalesce(prev.pontos_previstos, 0) as diferenca
from (
  select reason as fonte, sum(points) as pontos_previstos
    from liga_backfill_eventos
   group by reason
) prev
full outer join (
  select lp.reason as fonte, sum(lp.points) as pontos_gravados
    from liga_points lp
    join liga_seasons s on s.id = lp.season_id
   cross join liga_backfill_params prm
   where s.ends_on >= prm.data_de and s.starts_on <= prm.data_ate
   group by lp.reason
) real on real.fonte = prev.fonte
order by 1;

-- Ranking final, para bater com o que o app mostra.
select o.name as academia, p.full_name as aluno, st.sport, st.division, st.points
  from liga_standings st
  join liga_seasons s   on s.id = st.season_id and s.status = 'active'
  join profiles p       on p.id = st.student_id
  join organizations o  on o.id = st.organization_id
 order by o.name, st.sport, st.points desc;

-- ===========================================================================
-- LIMPEZA (opcional) — as tabelas de apoio não são usadas pelo app.
-- ===========================================================================
-- drop table if exists liga_backfill_eventos;
-- drop table if exists liga_backfill_cfg;
-- drop table if exists liga_backfill_params;
