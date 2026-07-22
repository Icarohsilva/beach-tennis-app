-- supabase/migrations/20260722000000_payment_receipt_and_settlement.sql
-- Comprovante PIX + auditoria da baixa manual (spec 2026-07-22 §1).
-- Aditiva: nenhum enum alterado. "Aguardando confirmação" é estado DERIVADO
-- (status='pending' AND receipt_url is not null), justamente para não precisar
-- de `alter type payment_status add value` (que exige statement isolado e já
-- causou problema neste projeto).

-- settled_method: como a pendência foi quitada. Baixa manual do admin usa
-- 'dinheiro' | 'pix' | 'maquininha' | 'outro'; a baixa automática do webhook
-- grava 'mercadopago'. settled_by fica null na automática (não houve admin).
alter table payments
  add column if not exists receipt_url text,
  add column if not exists receipt_uploaded_at timestamptz,
  add column if not exists settled_by uuid references profiles(id),
  add column if not exists settled_method text;

-- Devedores por academia: pendências de aula (session_id não nulo) com valor.
create index if not exists idx_payments_org_pending_session
  on payments (organization_id, status, session_id)
  where status = 'pending' and session_id is not null;
