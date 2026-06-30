-- Imagem de capa do torneio (URL do Storage bucket tournament-images).
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS cover_image_url text;

-- Pódio: 1º, 2º e 3º lugar. Preenchidos automaticamente ao encerrar;
-- admin pode corrigir. winner*_partner_id para dupla_fixa (null no americano).
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS winner1_id uuid REFERENCES profiles(id);
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS winner2_id uuid REFERENCES profiles(id);
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS winner3_id uuid REFERENCES profiles(id);
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS winner1_partner_id uuid REFERENCES profiles(id);
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS winner2_partner_id uuid REFERENCES profiles(id);
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS winner3_partner_id uuid REFERENCES profiles(id);
