-- RPCs da Liga: escrita atômica de extrato + cache.
--
-- Espelha public.adjust_credits (20260624000000_profiles_identity_cutover.sql): o app
-- NUNCA faz update direto em liga_standings.points. Se o app fizesse os dois updates,
-- uma falha entre eles deixaria extrato e cache divergentes para sempre — e o cache é
-- o que aparece na tela.

create or replace function public.liga_award_points(
  p_org uuid,
  p_season uuid,
  p_student uuid,
  p_sport text,
  p_points int,
  p_reason text,
  p_source_id uuid default null,
  p_note text default null,
  p_awarded_by uuid default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted int;
begin
  if p_sport is null or p_sport = '' then
    raise exception 'LIGA_SPORT_REQUIRED';
  end if;

  -- 1. Extrato. on conflict do nothing torna a chamada idempotente: o índice
  --    liga_points_dedup_idx é quem decide se este evento já foi creditado.
  insert into liga_points (
    organization_id, season_id, student_id, sport, points, reason,
    source_id, note, awarded_by
  )
  values (
    p_org, p_season, p_student, p_sport, p_points, p_reason,
    p_source_id, p_note, p_awarded_by
  )
  on conflict do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return; -- já creditado; não mexe no cache
  end if;

  -- 2. Cache da posição, na mesma transação.
  insert into liga_standings (organization_id, season_id, student_id, sport, points)
  values (p_org, p_season, p_student, p_sport, p_points)
  on conflict (season_id, student_id, sport)
  do update set points = liga_standings.points + excluded.points;

  -- 3. Quem treinou, participa: se o esporte não estava na lista do aluno naquela
  --    academia, entra agora (spec §Decisões 9). Sem isto ele receberia ponto num
  --    ranking que a própria tela não listaria para ele.
  update memberships
     set sports = array_append(sports, p_sport)
   where user_id = p_student
     and organization_id = p_org
     and not (p_sport = any(sports));
end;
$$;

revoke all on function public.liga_award_points(uuid, uuid, uuid, text, int, text, uuid, text, uuid)
  from public, anon, authenticated;

-- Revogação: usada quando o professor DESMARCA a presença. Remove exatamente a linha
-- daquele evento e desconta o mesmo valor do cache.
create or replace function public.liga_revoke_points(
  p_season uuid,
  p_student uuid,
  p_sport text,
  p_reason text,
  p_source_id uuid default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_points int;
  v_current int;
begin
  delete from liga_points
   where season_id = p_season
     and student_id = p_student
     and sport = p_sport
     and reason = p_reason
     and coalesce(source_id, '00000000-0000-0000-0000-000000000000'::uuid)
       = coalesce(p_source_id, '00000000-0000-0000-0000-000000000000'::uuid)
  returning points into v_points;

  if v_points is null then
    return; -- nada a revogar
  end if;

  select points into v_current
    from liga_standings
   where season_id = p_season and student_id = p_student and sport = p_sport;

  -- greatest(0, ...): o cache nunca fica negativo, mesmo que o extrato tenha sido
  -- mexido à mão em produção. Quando o piso realmente é acionado, extrato e cache já
  -- tinham divergido ANTES desta chamada — sem o warning, essa divergência fica
  -- permanentemente invisível.
  if v_current is not null and v_current - v_points < 0 then
    raise warning 'liga_revoke_points: clamp em 0 para season=%, student=%, sport=% (cache=% - %)',
      p_season, p_student, p_sport, v_current, v_points;
  end if;

  update liga_standings
     set points = greatest(0, points - v_points)
   where season_id = p_season
     and student_id = p_student
     and sport = p_sport;
end;
$$;

revoke all on function public.liga_revoke_points(uuid, uuid, text, text, uuid)
  from public, anon, authenticated;
