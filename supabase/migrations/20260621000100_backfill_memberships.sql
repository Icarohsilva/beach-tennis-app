-- Multi-vínculo (Plano 1) — parte 2/4
-- Backfill: uma membership por perfil existente, copiando os campos por-academia.
-- Idempotente: on conflict (user_id, organization_id) do nothing. Perfis sem
-- organization_id (não deveria haver após o Plano de fundação) são ignorados.

insert into memberships (
  user_id, organization_id, role, level, payment_type, is_dependent, parent_id,
  contract_active, credits_balance, monthly_checkin_target, pending_partner,
  wellhub_id, totalpass_id, created_at
)
select
  p.id, p.organization_id, p.role, p.level, p.payment_type, p.is_dependent, p.parent_id,
  p.contract_active, p.credits_balance, p.monthly_checkin_target, p.pending_partner,
  p.wellhub_id, p.totalpass_id, p.created_at
from profiles p
where p.organization_id is not null
on conflict (user_id, organization_id) do nothing;
