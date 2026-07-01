-- supabase/migrations/20260630000100_tournament_entry_payment.sql

-- tournaments: preço e chave PIX (ambos null = gratuito)
ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS entry_price_cents integer,
  ADD COLUMN IF NOT EXISTS pix_key text;

-- tournament_entries: campos de pagamento
ALTER TABLE tournament_entries
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'free'
    CHECK (payment_status IN ('free', 'pending', 'paid')),
  ADD COLUMN IF NOT EXISTS discount_pct numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS final_price_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS receipt_url text;

-- organizations: percentuais de desconto configuráveis
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS tournament_discount_2_pct integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS tournament_discount_3_pct integer NOT NULL DEFAULT 50;
