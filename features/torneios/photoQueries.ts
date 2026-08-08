// features/torneios/photoQueries.ts
// Leitura do mural de fotos (spec §Fase 4).
//
// O bucket é privado (são rostos de alunos), então a URL é assinada no servidor e
// expira. É a diferença para `tournament-images`, que é capa de divulgação e pública.
import { createAdminClient } from '@/lib/supabase/server'

/** Validade da URL assinada. Uma hora cobre a visita e não vira link permanente. */
const SIGNED_URL_TTL = 3600

export interface TournamentPhotoView {
  id: string
  url: string
  caption: string | null
  tournamentId: string
  createdAt: string
}

interface PhotoRow {
  id: string
  storage_path: string
  caption: string | null
  tournament_id: string
  created_at: string
}

async function signRows(rows: PhotoRow[]): Promise<TournamentPhotoView[]> {
  if (rows.length === 0) return []

  const admin = createAdminClient()
  const { data: signed } = await admin.storage
    .from('tournament-photos')
    .createSignedUrls(
      rows.map((r) => r.storage_path),
      SIGNED_URL_TTL,
    )

  const urlByPath = new Map(
    ((signed ?? []) as { path: string | null; signedUrl: string }[])
      .filter((s) => s.path)
      .map((s) => [s.path as string, s.signedUrl]),
  )

  return rows
    .map((r) => ({
      id: r.id,
      url: urlByPath.get(r.storage_path) ?? '',
      caption: r.caption,
      tournamentId: r.tournament_id,
      createdAt: r.created_at,
    }))
    // Assinatura falhou (arquivo removido do bucket na mão): melhor sumir do que
    // renderizar um quadrado quebrado.
    .filter((p) => p.url !== '')
}

/** Fotos de um torneio, da mais recente para a mais antiga. */
export async function getTournamentPhotos(
  orgId: string,
  tournamentId: string,
): Promise<TournamentPhotoView[]> {
  const { data } = await createAdminClient()
    .from('tournament_photos')
    .select('id, storage_path, caption, tournament_id, created_at')
    .eq('organization_id', orgId)
    .eq('tournament_id', tournamentId)
    .order('created_at', { ascending: false })

  return signRows((data ?? []) as PhotoRow[])
}

/** Últimas fotos da academia inteira, para o bloco de destaque na Liga. */
export async function getRecentOrgPhotos(
  orgId: string,
  limit = 8,
): Promise<TournamentPhotoView[]> {
  const { data } = await createAdminClient()
    .from('tournament_photos')
    .select('id, storage_path, caption, tournament_id, created_at')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
    .limit(limit)

  return signRows((data ?? []) as PhotoRow[])
}
