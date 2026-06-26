-- Valor por check-in de parceiro (Wellhub/TotalPass), por academia, em reais.
-- Desacoplado de a integração estar conectada: a academia define o valor mesmo
-- antes de plugar o webhook. A receita do mês é calculada na hora a partir dos
-- check-ins já gravados (sem ledger, sem cron).
create table if not exists partner_checkin_rates (
  organization_id uuid not null references organizations(id) on delete cascade,
  partner         checkin_partner not null,
  value           numeric(10,2) not null default 0, -- reais por check-in
  updated_at      timestamptz not null default now(),
  primary key (organization_id, partner)
);

alter table partner_checkin_rates enable row level security;

-- Leitura: admin da própria academia. Escrita: service role (admin actions).
create policy "partner_rates_admin_org" on partner_checkin_rates
  for select using (is_org_admin(organization_id));
