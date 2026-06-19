-- Cobrança do SaaS (Plano 3) — parte 1/2: tabela de assinaturas da plataforma.
-- Uma assinatura por academia. O acesso ao painel admin é derivado das datas em tempo
-- de request (sem cron); ver lib/billing/platformAccess.ts.
--
-- Eixos independentes:
--   - organizations.status (active/suspended) = suspensão operacional manual (super-admin, Plano 4).
--   - platform_subscriptions.status = estado da cobrança da plataforma (este arquivo).

create table if not exists platform_subscriptions (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null unique references organizations(id) on delete cascade,
  status             text not null default 'trialing'
                       check (status in ('trialing','active','past_due','canceled')),
  trial_ends_at      timestamptz,        -- fim dos 30 dias grátis
  current_period_end timestamptz,        -- pago até (empurrado a cada cobrança confirmada)
  mp_preapproval_id  text,               -- id da assinatura no MercadoPago
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Lookup pelo id do MP (webhook subscription_authorized_payment encontra a org por aqui).
create index if not exists idx_platform_subscriptions_mp_preapproval_id
  on platform_subscriptions (mp_preapproval_id);

-- RLS: a tabela é manipulada só via service role (createAdminClient ignora RLS) — webhook,
-- server actions e o getter de acesso. Ativa RLS sem políticas → nega todo acesso anon/auth,
-- mantendo o padrão "nada exposto ao cliente" das tabelas de billing.
alter table platform_subscriptions enable row level security;
