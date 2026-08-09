-- scripts/liga-creditar-cadastro-completo.sql
--
-- Credita o bônus de "cadastro completo" a quem já está com os dados preenchidos.
--
-- Use quando alguém completou o cadastro antes de a regra existir (ou por um caminho
-- que ainda não creditava, como a secretaria preenchendo pelo painel). Para recontar
-- tudo, o script certo é `liga-refazer-pontuacoes.sql` — este aqui mexe só numa fonte.
--
-- PRÉ-REQUISITO: a migration 20260808000300_liga_pontos_extras.sql precisa estar
-- aplicada. Sem ela o `check` de liga_points.reason recusa 'profile_complete' e o
-- script falha (com erro visível, ao contrário do app, que engole por ser best-effort).
--
-- Não depende do deploy do código: é SQL puro sobre os dados que já existem.

do $$
declare
  -- null = todas as academias com a Liga ligada. Preencha o slug para limitar a uma.
  v_org_slug text := null;

  -- null = todos os alunos. Ex.: '%camila%' para conferir um caso específico.
  v_student_like text := null;

  o record;
  r record;
  v_season uuid;
  v_single_sport text;
  w_profile int;
  n_ok int := 0;
begin
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
    select coalesce((
      select value::int from system_settings
       where organization_id = o.id and key = 'liga_points_profile_complete'
         and value ~ '^[0-9]+$'
    ), 20) into w_profile;

    continue when w_profile <= 0;  -- academia desligou essa fonte

    v_single_sport := case
      when coalesce(array_length(o.sports, 1), 0) = 1 then o.sports[1]
      else null
    end;

    -- Temporada do mês corrente, criada se ainda não existir.
    insert into liga_seasons (organization_id, starts_on, ends_on)
    values (
      o.id,
      date_trunc('month', current_date)::date,
      (date_trunc('month', current_date) + interval '1 month' - interval '1 day')::date
    )
    on conflict (organization_id, starts_on) do nothing;

    select id into v_season from liga_seasons
     where organization_id = o.id and starts_on = date_trunc('month', current_date)::date;

    for r in
      select m.user_id,
             p.full_name,
             coalesce(
               case when coalesce(array_length(m.sports, 1), 0) > 0 then m.sports[1] end,
               v_single_sport
             ) as sport
        from memberships m
        join profiles p on p.id = m.user_id
        join medical_profiles mp on mp.profile_id = m.user_id
       where m.organization_id = o.id
         and m.role = 'student'
         and (v_student_like is null or p.full_name ilike v_student_like)
         -- A régua do app (features/liga/extraPoints.ts → checkProfileComplete):
         -- telefone para chamar, contato de emergência para acidente na quadra e
         -- ao menos uma modalidade, sem a qual o aluno não entra em ranking nenhum.
         and coalesce(btrim(p.phone), '') <> ''
         and coalesce(btrim(mp.emergency_name), '') <> ''
         and coalesce(btrim(mp.emergency_phone), '') <> ''
         and coalesce(array_length(m.sports, 1), 0) > 0
         -- Uma vez na vida, não uma por temporada.
         and not exists (
           select 1 from liga_points lp
            where lp.organization_id = o.id
              and lp.student_id = m.user_id
              and lp.reason = 'profile_complete'
         )
    loop
      continue when r.sport is null;
      perform liga_award_points(o.id, v_season, r.user_id, r.sport,
                                w_profile, 'profile_complete', null, 'Cadastro completo', null);
      n_ok := n_ok + 1;
      raise notice 'creditado: % (% pontos em %)', r.full_name, w_profile, r.sport;
    end loop;
  end loop;

  raise notice '--- alunos creditados: % ---', n_ok;
end $$;

-- ---------------------------------------------------------------------------
-- Quem NÃO foi creditado, e o que falta em cada um.
-- ---------------------------------------------------------------------------
-- É esta query que responde "por que fulano não recebeu?". Rode sempre depois do
-- bloco acima; se a pessoa aparecer aqui, o problema é dado faltando, não a Liga.
select
  p.full_name                                                as aluno,
  case when coalesce(btrim(p.phone), '') = ''                then 'FALTA' else 'ok' end as telefone,
  case when coalesce(btrim(mp.emergency_name), '') = ''      then 'FALTA' else 'ok' end as contato_emergencia,
  case when coalesce(btrim(mp.emergency_phone), '') = ''     then 'FALTA' else 'ok' end as telefone_emergencia,
  case when coalesce(array_length(m.sports, 1), 0) = 0       then 'FALTA' else 'ok' end as modalidade,
  case when exists (
         select 1 from liga_points lp
          where lp.organization_id = m.organization_id
            and lp.student_id = m.user_id
            and lp.reason = 'profile_complete'
       ) then 'sim' else 'nao' end                            as ja_pontuou
from memberships m
join profiles p on p.id = m.user_id
left join medical_profiles mp on mp.profile_id = m.user_id
where m.role = 'student'
  and not exists (
    select 1 from liga_points lp
     where lp.organization_id = m.organization_id
       and lp.student_id = m.user_id
       and lp.reason = 'profile_complete'
  )
order by p.full_name;
