-- scripts/cleanup-db.sql
-- ATENÇÃO: Execute apenas no Supabase SQL Editor. Irreversível.
-- Mantém apenas o usuário admin Hudson Barros.

-- ============================================================
-- PASSO 1: Verificação — confirme o que será deletado
-- ============================================================
SELECT id, email, created_at
FROM auth.users
ORDER BY created_at;

-- ============================================================
-- PASSO 2: Verificação — confirme que Hudson Barros existe
-- ============================================================
SELECT au.id, au.email, p.full_name, p.role
FROM auth.users au
JOIN public.profiles p ON p.id = au.id
WHERE p.full_name ILIKE '%hudson%' OR au.email ILIKE '%hudson%';

-- ============================================================
-- PASSO 3: DELETE — substitua 'EMAIL_DO_HUDSON' pelo email real
-- ============================================================
-- Descomente e execute SOMENTE após confirmar os passos 1 e 2:

-- DELETE FROM auth.users
-- WHERE email != 'EMAIL_DO_HUDSON';

-- O cascade de FK apaga automaticamente:
--   profiles, enrollments, student_subscriptions,
--   session_bookings, credit_transactions, waitlists, payments, etc.

-- ============================================================
-- PASSO 4 (opcional): Limpar planos inativos
-- ============================================================
-- DELETE FROM public.subscription_plans WHERE is_active = false;

-- ============================================================
-- PASSO 5: Verificação final
-- ============================================================
SELECT au.email, p.full_name, p.role
FROM auth.users au
JOIN public.profiles p ON p.id = au.id;
