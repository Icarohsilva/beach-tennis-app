-- Fundação multi-tenant (Plano 1) — parte 3/6
-- Cria a academia atual (Hudson Barros) como org default e preenche organization_id
-- em TODAS as linhas existentes. Idempotente. O NOT NULL vem na parte 5.

-- 1. Org #1 = academia atual de produção, marcada como default (fallback do cadastro).
insert into organizations (name, slug, invite_code, is_default, status)
values ('Academia Hudson Barros', 'hudson-barros', 'HUDSON1', true, 'active')
on conflict (slug) do nothing;

-- 2. Backfill: toda linha órfã pertence à org default.
do $$
declare
  t text;
  v_org uuid;
  tables text[] := array[
    'profiles', 'classes', 'class_sessions', 'enrollments', 'session_bookings',
    'attendance', 'credit_transactions', 'trial_bookings', 'subscription_plans',
    'student_subscriptions', 'payments', 'system_settings', 'tournaments',
    'tournament_matches', 'tournament_registrations', 'posts', 'post_likes',
    'post_comments', 'notifications', 'wellhub_checkins', 'totalpass_checkins',
    'dayuse_slots', 'dayuse_bookings', 'medical_profiles', 'checkins', 'waitlists'
  ];
begin
  select id into v_org from organizations where is_default limit 1;
  if v_org is null then
    raise exception 'Nenhuma organização default encontrada para o backfill';
  end if;

  foreach t in array tables loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    execute format(
      'update %I set organization_id = $1 where organization_id is null;', t
    ) using v_org;
  end loop;
end $$;

-- 3. system_settings é key/value (PK = key na 001). Multi-tenant: cada academia tem
-- seu próprio conjunto de chaves, então a PK passa a ser (organization_id, key).
-- Roda após o backfill acima já ter preenchido organization_id nas linhas existentes.
alter table system_settings drop constraint if exists system_settings_org_unique;
alter table system_settings drop constraint if exists system_settings_pkey;
alter table system_settings add primary key (organization_id, key);
