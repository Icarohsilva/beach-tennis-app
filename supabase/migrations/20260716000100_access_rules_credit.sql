-- supabase/migrations/20260716000100_access_rules_credit.sql
-- Regras novas: plano = acesso ilimitado (não emite mais crédito); crédito só
-- para avulsa; matrícula fixa exige plano ou parceiro.
-- Spec: docs/superpowers/specs/2026-07-16-regras-acesso-credito-design.md

-- ── 1. Plano não emite mais crédito ──────────────────────────────────────────
-- classes_per_week PERMANECE, como texto comercial (deixa de ser regra).
alter table subscription_plans drop column if exists credits_per_month;

-- ── 2. Uma pendência por (aluno, sessão) ─────────────────────────────────────
-- Idempotência da dívida por schema, não por lógica: marcar presença duas vezes
-- não cobra duas. É também o mecanismo que faz a pré-declaração do admin
-- (experimental / pago na hora) SUPRIMIR a dívida automática.
-- O filtro session_id is not null preserva as linhas de compra de crédito
-- (session_id null, credits_qty preenchido), que não são pendência de aula.
create unique index if not exists payments_session_student_unique
  on payments (student_id, session_id)
  where session_id is not null;

-- ── 3. Desvincula fixas de quem não tem plano nem parceiro ───────────────────
-- Crédito não compra mais vaga fixa. Guarda os afetados numa temp table para
-- notificar no passo 4 (depois do update os filtros já não os encontram).
create temp table _unlinked on commit drop as
select e.id as enrollment_id, e.student_id, e.organization_id, c.name as class_name
from enrollments e
join classes c on c.id = e.class_id
join memberships m
  on m.user_id = e.student_id and m.organization_id = e.organization_id
where e.is_active
  and m.partner is null
  and not exists (
    select 1 from student_subscriptions s
    where s.student_id = e.student_id
      and s.organization_id = e.organization_id
      and s.status = 'active'
      -- Espelha isSubscriptionCurrent (lib/billing/periodicity.ts): manual (ou
      -- qualquer gateway != mercadopago) é sempre vigente, gerido por fora;
      -- mercadopago exige current_period_end futuro. Divergir daqui criaria
      -- duas noções de "plano ativo" no mesmo sistema (spec §1) — a versão
      -- anterior desta migration ignorava gateway e podia desvincular um
      -- manual com period_end passado, ou manter um mercadopago sem period_end.
      and (s.gateway <> 'mercadopago' or (s.current_period_end is not null and s.current_period_end >= now()))
  );

update enrollments
set is_active = false, cancelled_at = now()
where id in (select enrollment_id from _unlinked);

-- ── 4. Notifica os desvinculados (in-app) ────────────────────────────────────
-- Só in-app: notifyUsers é TypeScript e não roda dentro de migration. Um aluno
-- em várias turmas recebe uma notificação por turma — é o que ele precisa saber.
insert into notifications (organization_id, user_id, type, title, body)
select
  u.organization_id,
  u.student_id,
  'enrollment_unlinked',
  'Sua vaga fixa foi encerrada',
  'Sua vaga fixa em "' || u.class_name || '" foi encerrada porque aulas fixas agora ' ||
  'exigem um plano ativo ou Wellhub/TotalPass. Suas aulas já agendadas seguem válidas. ' ||
  'Fale com a academia para contratar um plano.'
from _unlinked u;
