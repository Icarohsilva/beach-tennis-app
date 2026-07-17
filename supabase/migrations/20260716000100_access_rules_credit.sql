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

-- ── 3. Desvincula fixas de quem não tem plano nem parceiro, e notifica ───────
-- Crédito não compra mais vaga fixa.
--
-- UPDATE...RETURNING alimentando o INSERT numa única instrução (CTE), em vez
-- de uma temp table `on commit drop` + UPDATE + INSERT em 3 statements: uma
-- temp table "on commit drop" só sobrevive até o fim da transação ATUAL, e
-- ferramentas de SQL que rodam cada statement em autocommit (uma transação
-- por comando) descartam a tabela antes do UPDATE seguinte conseguir lê-la
-- (erro "relation _unlinked does not exist" ao aplicar esta migration na
-- prática). Uma única instrução atômica não depende de como a ferramenta
-- faz o batching entre statements.
--
-- O join classes/memberships é 1:1:1 por linha de enrollment: class_id é FK
-- para classes.id (PK), e memberships tem unique(user_id, organization_id) —
-- por isso é seguro converter o join em UPDATE ... FROM sem multiplicar
-- linhas nem duplicar o RETURNING.
with unlinked as (
  update enrollments e
  set is_active = false, cancelled_at = now()
  from classes c, memberships m
  where c.id = e.class_id
    and m.user_id = e.student_id
    and m.organization_id = e.organization_id
    and e.is_active
    and m.partner is null
    and not exists (
      select 1 from student_subscriptions s
      where s.student_id = e.student_id
        and s.organization_id = e.organization_id
        and s.status = 'active'
        -- Espelha isSubscriptionCurrent (lib/billing/periodicity.ts): manual
        -- (ou qualquer gateway != mercadopago) é sempre vigente, gerido por
        -- fora; mercadopago exige current_period_end futuro. Divergir daqui
        -- criaria duas noções de "plano ativo" no mesmo sistema (spec §1).
        and (s.gateway <> 'mercadopago' or (s.current_period_end is not null and s.current_period_end >= now()))
    )
  returning e.student_id, e.organization_id, c.name as class_name
)
-- Notifica os desvinculados (in-app). Só in-app: notifyUsers é TypeScript e
-- não roda dentro de migration. Um aluno em várias turmas recebe uma
-- notificação por turma — é o que ele precisa saber.
insert into notifications (organization_id, user_id, type, title, body)
select
  u.organization_id,
  u.student_id,
  'enrollment_unlinked',
  'Sua vaga fixa foi encerrada',
  'Sua vaga fixa em "' || u.class_name || '" foi encerrada porque aulas fixas agora ' ||
  'exigem um plano ativo ou Wellhub/TotalPass. Suas aulas já agendadas seguem válidas. ' ||
  'Fale com a academia para contratar um plano.'
from unlinked u;
