-- Operação profissional do painel de PLATAFORMA (super-admin). Duas peças:
--   1. platform_admin_audit_log — trilha de auditoria das ações do super-admin.
--   2. platform_subscriptions.is_comped — marca de conta cortesia.
--
-- Ambas só via service role (mesmo padrão das tabelas de billing): RLS ligada e
-- SEM políticas nega anon/authenticated por completo.

-- ---------------------------------------------------------------------------
-- 1. Trilha de auditoria
-- ---------------------------------------------------------------------------
-- Toda ação do super-admin sobre uma academia (suspender, reativar, estender
-- trial, dar/tirar cortesia) grava uma linha aqui. Motivo: essas ações mexem no
-- acesso e na cobrança de um cliente — precisa haver registro de quem fez, o
-- quê, quando e com qual observação.

create table if not exists platform_admin_audit_log (
  id              uuid primary key default gen_random_uuid(),
  actor_id        uuid not null references profiles(id),
  organization_id uuid references organizations(id) on delete set null,
  -- Texto livre com check: novas ações entram sem migration de enum.
  action          text not null check (action in (
                    'suspend_org',
                    'reactivate_org',
                    'extend_trial',
                    'grant_comp',
                    'revoke_comp'
                  )),
  -- Snapshot legível do antes/depois (ex.: {"trial_ends_at": "..."}).
  details         jsonb not null default '{}'::jsonb,
  note            text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_platform_audit_created
  on platform_admin_audit_log (created_at desc);

create index if not exists idx_platform_audit_org
  on platform_admin_audit_log (organization_id, created_at desc);

alter table platform_admin_audit_log enable row level security;

-- ---------------------------------------------------------------------------
-- 2. Conta cortesia
-- ---------------------------------------------------------------------------
-- Conta cortesia aparece como 'active' (acessa o painel normalmente) mas NÃO
-- entra no MRR — senão a receita reportada seria fictícia. Antes disso a única
-- cortesia era a academia vitalícia marcada com organizations.is_default; o
-- backfill abaixo torna esse caso explícito em vez de implícito.

alter table platform_subscriptions
  add column if not exists is_comped boolean not null default false;

update platform_subscriptions ps
   set is_comped = true
  from organizations o
 where o.id = ps.organization_id
   and o.is_default
   and ps.is_comped = false;
