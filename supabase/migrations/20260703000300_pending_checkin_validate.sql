-- O validate do Access Control API só precisa de gym_id + gympass_id + api_key —
-- tudo já vem no webhook, então não faz sentido esperar o vínculo interno com um
-- aluno cadastrado para confirmar o acesso e gerar a transação de pagamento na
-- Wellhub. Sem isso, testes da própria Wellhub (tokens que nunca vão casar com um
-- aluno nosso) e usuários reais ainda não cadastrados nunca seriam validados.
-- Guardamos o resultado no próprio check-in pendente (mesmo padrão de `checkins`).
alter table pending_checkins
  add column if not exists partner_validated       boolean not null default false,
  add column if not exists partner_validation_error text;
