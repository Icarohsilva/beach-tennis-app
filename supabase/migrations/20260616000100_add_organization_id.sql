-- Fundação multi-tenant (Plano 1) — parte 2/5
-- Adiciona organization_id (NULLABLE por enquanto) e índice em todas as tabelas
-- de dados. O NOT NULL é aplicado só na parte 3 (após o backfill dos dados).

do $$
declare
  t text;
  tables text[] := array[
    'profiles', 'classes', 'class_sessions', 'enrollments', 'session_bookings',
    'attendance', 'credit_transactions', 'trial_bookings', 'subscription_plans',
    'student_subscriptions', 'payments', 'system_settings', 'tournaments',
    'tournament_matches', 'tournament_registrations', 'posts', 'post_likes',
    'post_comments', 'notifications', 'wellhub_checkins', 'totalpass_checkins',
    'dayuse_slots', 'dayuse_bookings', 'medical_profiles', 'checkins', 'waitlists'
  ];
begin
  foreach t in array tables loop
    -- Pula tabelas ausentes neste ambiente (algumas sofreram drift e não estão
    -- em migrations; em produção existem, em CI/local podem não existir).
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    execute format(
      'alter table %I add column if not exists organization_id uuid references organizations(id);',
      t
    );
    execute format(
      'create index if not exists %I on %I (organization_id);',
      t || '_org_idx', t
    );
  end loop;
end $$;
