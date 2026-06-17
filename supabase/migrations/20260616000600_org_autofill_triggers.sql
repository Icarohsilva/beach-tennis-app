-- Fundação multi-tenant (Plano 1) — parte 7/7
-- Preenche organization_id automaticamente em INSERTs quando o app (ou uma RPC)
-- não o informa. Um BEFORE INSERT por tabela deriva a org do registro-pai.
--
-- Por que triggers: as RPCs atômicas (book_session_atomic, adjust_credits) e a
-- maioria dos ~30 inserts do app não passam organization_id. Em vez de editar
-- cada call site, o banco resolve a org a partir da FK que o registro já carrega.
--
-- Tabelas SEM trigger (org explícita no app, pois não têm pai de onde derivar):
--   classes, subscription_plans, system_settings.
-- profiles é preenchida pelo trigger handle_new_user.
-- wellhub_checkins/totalpass_checkins são legadas e sem novos inserts.

-- Função genérica: deriva NEW.organization_id de uma FK para um registro-pai.
-- tg_argv[0] = coluna local (FK)   ex: 'student_id'
-- tg_argv[1] = tabela-pai          ex: 'profiles'
-- tg_argv[2] = coluna-chave do pai ex: 'id'
-- SECURITY DEFINER para ler a org do pai independentemente da RLS do chamador.
create or replace function public.set_org_from_parent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_local_col   text := tg_argv[0];
  v_parent_tbl  text := tg_argv[1];
  v_parent_key  text := tg_argv[2];
  v_local_val   uuid;
  v_org         uuid;
begin
  -- Respeita org já informada pelo app (defesa em profundidade, não sobrescreve).
  if new.organization_id is not null then
    return new;
  end if;

  v_local_val := (to_jsonb(new) ->> v_local_col)::uuid;

  -- Sem FK preenchida não há como derivar; deixa o NOT NULL acusar se aplicável.
  if v_local_val is null then
    return new;
  end if;

  execute format(
    'select organization_id from public.%I where %I = $1',
    v_parent_tbl, v_parent_key
  )
  into v_org
  using v_local_val;

  new.organization_id := v_org;
  return new;
end;
$$;

-- Cria um BEFORE INSERT por tabela, passando a derivação (coluna local, pai, chave).
do $$
declare
  r       text[];
  -- {tabela, coluna_local, tabela_pai, coluna_chave_pai}
  maps text[] := array[
    'class_sessions,class_id,classes,id',
    'enrollments,student_id,profiles,id',
    'session_bookings,student_id,profiles,id',
    'attendance,student_id,profiles,id',
    'credit_transactions,student_id,profiles,id',
    'trial_bookings,session_id,class_sessions,id',
    'student_subscriptions,student_id,profiles,id',
    'payments,student_id,profiles,id',
    'tournaments,created_by,profiles,id',
    'tournament_matches,tournament_id,tournaments,id',
    'tournament_registrations,tournament_id,tournaments,id',
    'posts,author_id,profiles,id',
    'post_likes,user_id,profiles,id',
    'post_comments,author_id,profiles,id',
    'notifications,user_id,profiles,id',
    'checkins,student_id,profiles,id',
    'waitlists,student_id,profiles,id',
    'dayuse_slots,created_by,profiles,id',
    'dayuse_bookings,slot_id,dayuse_slots,id',
    'medical_profiles,profile_id,profiles,id'
  ];
  m       text;
begin
  foreach m in array maps loop
    r := string_to_array(m, ',');
    if to_regclass('public.' || r[1]) is null then
      continue;
    end if;
    execute format('drop trigger if exists trg_set_org on public.%I;', r[1]);
    execute format(
      'create trigger trg_set_org before insert on public.%I ' ||
      'for each row execute function public.set_org_from_parent(%L, %L, %L);',
      r[1], r[2], r[3], r[4]
    );
  end loop;
end $$;

revoke all on function public.set_org_from_parent() from public, anon, authenticated;
