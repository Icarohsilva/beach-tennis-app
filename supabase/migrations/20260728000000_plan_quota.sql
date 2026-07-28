-- supabase/migrations/20260728000000_plan_quota.sql
-- Cota de aulas por plano. Ver docs/superpowers/specs/2026-07-28-cota-de-aulas-por-plano-design.md

create type plan_cycle as enum ('weekly', 'monthly');

alter table subscription_plans
  add column cycle                plan_cycle not null default 'monthly',
  add column max_classes_per_day  int        not null default 2,
  add column refund_on_late_cancel boolean   not null default true;

-- Teto diário para aluno SEM plano (o do plano cobre quem tem).
insert into system_settings (organization_id, key, value)
select id, 'max_classes_per_day', '2' from organizations
on conflict (organization_id, key) do nothing;

-- A cota nasce DESLIGADA. Ligar numa migração bloquearia alunos no meio de um
-- ciclo em curso, sem aviso. Cada academia liga quando revisar seus planos.
insert into system_settings (organization_id, key, value)
select id, 'quota_enforcement_enabled', 'false' from organizations
on conflict (organization_id, key) do nothing;

-- Índice para a contagem de reservas do ciclo (student + janela de datas).
create index if not exists session_bookings_student_status_idx
  on session_bookings (student_id, status);
