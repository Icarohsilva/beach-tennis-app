-- supabase/migrations/20260704000000_financeiro_enums.sql
-- SOMENTE alter type: novos valores de enum precisam de statement isolado
-- (não podem ser usados na mesma transação em que foram criados).
alter type subscription_status add value if not exists 'pending_payment';
alter type subscription_status add value if not exists 'past_due';
alter type payment_transaction_type add value if not exists 'day_use';
alter type credit_transaction_type add value if not exists 'purchased';
