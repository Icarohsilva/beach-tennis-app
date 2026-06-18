-- Onboarding pós-cadastro: endereço (CEP/número) + flag de conclusão.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS cep text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS address_number text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS no_number boolean NOT NULL DEFAULT false;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS onboarding_completed boolean NOT NULL DEFAULT false;

-- Backfill: orgs já existentes (Academia Hudson Barros / org #1 e orgs de teste)
-- não devem ser barradas pelo gate. Roda depois de criar a coluna (default false).
-- Orgs criadas a partir daqui nascem com onboarding_completed = false.
UPDATE organizations SET onboarding_completed = true;
