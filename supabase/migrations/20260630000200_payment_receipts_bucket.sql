-- supabase/migrations/20260630000200_payment_receipts_bucket.sql

-- Bucket privado para comprovantes de pagamento de torneio.
-- Path convention: {tournament_id}/{user_id}/receipt.{ext}
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'payment-receipts',
  'payment-receipts',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Jogador só faz upload para o próprio path ({tournament_id}/{user_id}/...)
DROP POLICY IF EXISTS "receipts_upload" ON storage.objects;
CREATE POLICY "receipts_upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'payment-receipts'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

-- Jogador lê apenas os próprios comprovantes
DROP POLICY IF EXISTS "receipts_read_own" ON storage.objects;
CREATE POLICY "receipts_read_own" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'payment-receipts'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

-- Admin lê qualquer comprovante via service role (createAdminClient bypassa RLS)
-- Nenhuma policy adicional necessária para service role.
