-- Bucket público para imagens de capa de torneios.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'tournament-images',
  'tournament-images',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Qualquer admin autenticado pode fazer upload.
CREATE POLICY IF NOT EXISTS "tournament-images upload"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'tournament-images');

-- Leitura pública (o bucket já é público, mas a policy explicita).
CREATE POLICY IF NOT EXISTS "tournament-images public read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'tournament-images');
