-- Cobrança do SaaS (Plano 3) — parte 2/2: backfill das academias já existentes.
-- Idempotente: on conflict (organization_id) do nothing — pode rodar de novo sem efeito.
--
-- Hudson Barros (is_default) = vitalício: status='active', current_period_end no futuro
-- distante (2099). Nunca cai no paywall e não precisa de special-case no enforcement.
-- Demais orgs (Arena Teste etc.) = trial de 30 dias a partir de agora.

insert into platform_subscriptions (organization_id, status, trial_ends_at, current_period_end)
select
  o.id,
  case when o.is_default then 'active'      else 'trialing'                 end,
  case when o.is_default then null          else now() + interval '30 days' end,
  case when o.is_default then timestamptz '2099-12-31' else null            end
from organizations o
on conflict (organization_id) do nothing;
