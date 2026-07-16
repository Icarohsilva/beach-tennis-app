-- Eixo parceiro independente do eixo cobrança.
-- Antes: payment_type ∈ (subscriber, per_class, wellhub, totalpass) — exclusivo.
-- Agora: payment_type = só cobrança (subscriber|per_class); partner = wellhub|totalpass|null.

alter table memberships
  add column if not exists partner checkin_partner;

-- Quem era só-parceiro vira "avulso + parceiro": move o valor para `partner`
-- e zera a cobrança para per_class. IDs e meta já estão em colunas próprias.
update memberships
set partner = payment_type::text::checkin_partner,
    payment_type = 'per_class'
where payment_type::text in ('wellhub', 'totalpass');

-- Índice para o cálculo de repasse (memberships de parceiro da academia).
create index if not exists memberships_org_partner_idx
  on memberships (organization_id, partner)
  where partner is not null;
