'use server'
// features/torneios/photoActions.ts
// Mural de fotos do torneio (spec §Fase 4).
//
// Upload por server action com service role, no padrão de updateBranding, e não
// client-side: assim o bucket não precisa de policy de escrita para `authenticated`,
// e quem decide o que pode subir é o servidor.
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/features/aulas/authGuards'

const MAX_PHOTO_BYTES = 5 * 1024 * 1024
const MAX_CAPTION = 140
const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

/** Sobe uma foto para o mural do torneio. Admin da academia ativa apenas. */
export async function uploadTournamentPhoto(
  formData: FormData,
): Promise<{ error?: string; uploaded?: number }> {
  const { userId, orgId, error: authErr } = await requireAdmin()
  if (authErr) return { error: authErr }

  const tournamentId = String(formData.get('tournament_id') ?? '')
  if (!tournamentId) return { error: 'Torneio não informado.' }

  const admin = createAdminClient()

  // O torneio precisa ser da academia ativa: sem este filtro, um admin subiria foto
  // no torneio de outra arena passando o id na mão.
  const { data: tournament } = await admin
    .from('tournaments')
    .select('id')
    .eq('id', tournamentId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!tournament) return { error: 'Torneio não encontrado nesta academia.' }

  const caption = String(formData.get('caption') ?? '')
    .trim()
    .slice(0, MAX_CAPTION)

  const files = formData.getAll('photos').filter((f): f is File => f instanceof File && f.size > 0)
  if (files.length === 0) return { error: 'Escolha ao menos uma foto.' }

  let uploaded = 0
  for (const file of files) {
    const ext = ALLOWED_TYPES[file.type]
    if (!ext) return { error: 'Envie fotos em JPG, PNG ou WEBP.' }
    if (file.size > MAX_PHOTO_BYTES) return { error: 'Cada foto deve ter no máximo 5MB.' }

    // orgId como primeira pasta: é o que a policy de leitura do bucket confere.
    const path = `${orgId}/${tournamentId}/${crypto.randomUUID()}.${ext}`
    const { error: uploadErr } = await admin.storage
      .from('tournament-photos')
      .upload(path, file, { contentType: file.type, upsert: false })
    if (uploadErr) return { error: 'Erro ao enviar a foto. Tente novamente.' }

    const { error: insertErr } = await admin.from('tournament_photos').insert({
      organization_id: orgId,
      tournament_id: tournamentId,
      storage_path: path,
      caption: caption || null,
      uploaded_by: userId,
    })
    // Registro é o que faz a foto existir para o app; sem ele o arquivo vira lixo
    // invisível no bucket, então limpa.
    if (insertErr) {
      await admin.storage.from('tournament-photos').remove([path])
      return { error: 'Erro ao registrar a foto. Tente novamente.' }
    }
    uploaded++
  }

  revalidatePath(`/admin/torneios/${tournamentId}`)
  revalidatePath(`/torneios/${tournamentId}`)
  revalidatePath('/liga')
  return { uploaded }
}

/** Remove uma foto do mural. Admin da academia ativa apenas. */
export async function deleteTournamentPhoto(photoId: string): Promise<{ error?: string }> {
  const { orgId, error: authErr } = await requireAdmin()
  if (authErr) return { error: authErr }

  const admin = createAdminClient()
  const { data: photo } = await admin
    .from('tournament_photos')
    .select('id, storage_path, tournament_id')
    .eq('id', photoId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!photo) return { error: 'Foto não encontrada.' }

  const row = photo as { id: string; storage_path: string; tournament_id: string }

  // Linha primeiro, arquivo depois: se a ordem fosse invertida e o delete da linha
  // falhasse, a galeria mostraria uma foto que não existe mais.
  const { error } = await admin.from('tournament_photos').delete().eq('id', row.id)
  if (error) return { error: 'Erro ao remover a foto.' }

  await admin.storage.from('tournament-photos').remove([row.storage_path])

  revalidatePath(`/admin/torneios/${row.tournament_id}`)
  revalidatePath(`/torneios/${row.tournament_id}`)
  revalidatePath('/liga')
  return {}
}
