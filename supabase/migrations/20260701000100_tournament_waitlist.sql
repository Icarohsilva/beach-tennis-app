-- supabase/migrations/20260701000100_tournament_waitlist.sql
-- Adiciona limite de vagas ao torneio
ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS max_players integer;
-- null = sem limite de vagas

-- Adiciona status de entrada e prazo da oferta
ALTER TABLE tournament_entries
  ADD COLUMN IF NOT EXISTS entry_status text NOT NULL DEFAULT 'confirmed'
    CHECK (entry_status IN ('confirmed', 'waitlist', 'offered')),
  ADD COLUMN IF NOT EXISTS offer_expires_at timestamptz;
-- offer_expires_at só preenchido quando entry_status = 'offered'
-- Entradas existentes recebem entry_status = 'confirmed' pelo DEFAULT (sem backfill necessário)
