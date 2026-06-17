-- Fundação multi-tenant (Plano 1) — parte 5/6
-- Trava organization_id como NOT NULL em todas as tabelas. Roda após o backfill
-- (parte 3) e após o trigger já gravar org em novos cadastros (parte 4).

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
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    execute format('alter table %I alter column organization_id set not null;', t);
  end loop;
end $$;
