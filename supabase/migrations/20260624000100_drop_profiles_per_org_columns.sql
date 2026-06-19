-- Multi-vínculo (Plano 3) — parte 2/2: drop final das colunas por-academia de profiles.
-- Pré-requisito: 20260624000000 aplicado e o app já não escreve nessas colunas (fonte dupla
-- removida e implantada). Esta migration é IRREVERSÍVEL sem restore.
--
-- auth_org_id() (single-org, lia profiles.organization_id) não tem mais consumidores desde
-- o Plano 1 (RLS usa auth_org_ids()); removida aqui junto das colunas.
--
-- Renumerada de 20260623000100 para 20260624000100 para manter o par com a parte 1/2
-- (20260624000000), já que a 20260623000000 foi usada pelo hotfix de produção.

drop function if exists auth_org_id();

alter table profiles
  drop column if exists organization_id,
  drop column if exists role,
  drop column if exists level,
  drop column if exists payment_type,
  drop column if exists is_dependent,
  drop column if exists parent_id,
  drop column if exists contract_active,
  drop column if exists credits_balance,
  drop column if exists monthly_checkin_target,
  drop column if exists pending_partner,
  drop column if exists wellhub_id,
  drop column if exists totalpass_id;
