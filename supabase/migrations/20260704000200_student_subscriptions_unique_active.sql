-- Fecha uma corrida em subscribeToPlanCheckout (Task 13 do plano de
-- financeiro): o check-then-insert ("já existe active/past_due?") não é
-- atômico — duas chamadas concorrentes do mesmo aluno (dois cliques, duas
-- abas) podiam passar pelo check e inserir DUAS student_subscriptions
-- pending_payment, cada uma com seu próprio preapproval no Mercado Pago.
--
-- Índice único parcial: no máximo UMA assinatura "viva" (active, past_due ou
-- pending_payment) por (student_id, organization_id). A segunda inserção
-- concorrente falha com unique_violation (23505), que o código trata como
-- "já existe uma tentativa em andamento" em vez de criar duplicata.
create unique index if not exists student_subscriptions_one_live_per_student
  on student_subscriptions (student_id, organization_id)
  where status in ('active', 'past_due', 'pending_payment');
