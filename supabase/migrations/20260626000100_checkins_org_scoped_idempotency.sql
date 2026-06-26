-- Idempotência de check-in por academia.
-- O índice antigo (partner, external_ref) é GLOBAL: dois alunos de academias
-- diferentes que usem o mesmo código manual colidem e o 2º insert falha em
-- silêncio. A verificação na aplicação já é org-scoped — o índice precisa casar.
-- Passa a chave única para (organization_id, partner, external_ref).

drop index if exists checkins_partner_ref_idx;

create unique index if not exists checkins_org_partner_ref_idx
  on checkins (organization_id, partner, external_ref) where external_ref is not null;
