-- Chamada validate do Access Control API (Wellhub/Gympass).
-- A Wellhub só paga a academia pelos check-ins VALIDADOS (POST /access/v1/validate),
-- que exige o api_key (Bearer) e o gym_id no header X-Gym-Id. Guardamos o api_key
-- por academia e o ambiente (sandbox/produção) que define a base URL da API.

alter table org_integrations
  add column if not exists api_key     text,
  add column if not exists environment text not null default 'production';

alter table org_integrations
  add constraint org_integrations_environment_chk
  check (environment in ('sandbox', 'production'));

-- Resultado da validação por check-in (não bloqueia o registro; um check-in pode
-- ser gravado e ficar pendente de validação para reprocessamento).
alter table checkins
  add column if not exists partner_validated       boolean not null default false,
  add column if not exists partner_validation_error text;
