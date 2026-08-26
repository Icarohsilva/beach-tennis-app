-- supabase/migrations/20260826000850_payment_transaction_type_tournament_entry.sql
-- SOMENTE alter type: novo valor de enum precisa de statement isolado (não
-- pode ser usado na mesma transação em que foi criado) — mesma convenção de
-- 20260704000000_financeiro_enums.sql.
alter type payment_transaction_type add value if not exists 'tournament_entry';
