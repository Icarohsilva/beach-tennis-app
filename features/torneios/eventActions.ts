'use server'
// features/torneios/eventActions.ts
// Criação e manutenção do evento de torneio (painel do admin).
import { createAdminClient, createClient, getActiveOrgId } from '@/lib/supabase/server'
import { generateUniqueSlugIn } from '@/lib/org/identifiers'
import { revalidatePath } from 'next/cache'

async function requireAdmin(): Promise<{ error?: string; userId?: string; orgId?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  const { data: membership } = await createAdminClient()
    .from('memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (membership?.role !== 'admin') return { error: 'Sem permissão.' }

  return { userId: user.id, orgId }
}

export async function createTournamentEvent(input: {
  name: string
  starts_on: string
  ends_on?: string | null
  description?: string | null
  cover_image_url?: string | null
}): Promise<{ error?: string; id?: string; slug?: string }> {
  const auth = await requireAdmin()
  if (auth.error) return { error: auth.error }

  const name = input.name.trim()
  if (!name) return { error: 'Dê um nome ao evento.' }
  if (!input.starts_on) return { error: 'Informe a data de início.' }
  // Intervalo invertido produziria "24 a 22 de agosto" e um evento que nunca
  // está acontecendo (today > lastDay e today < starts_on ao mesmo tempo).
  if (input.ends_on && input.ends_on < input.starts_on) {
    return { error: 'A data de fim não pode ser antes do início.' }
  }

  const admin = createAdminClient()
  const slug = await generateUniqueSlugIn(admin, 'tournament_events', name, 'evento')

  const { data, error } = await admin
    .from('tournament_events')
    .insert({
      organization_id: auth.orgId,
      name,
      slug,
      description: input.description?.trim() || null,
      cover_image_url: input.cover_image_url ?? null,
      starts_on: input.starts_on,
      ends_on: input.ends_on || null,
      // Nasce rascunho: a academia vincula os torneios com calma e só depois
      // divulga o link. Publicar de cara exporia uma página vazia.
      is_published: false,
      created_by: auth.userId,
    })
    .select('id, slug')
    .single()

  if (error || !data) return { error: 'Erro ao criar o evento. Tente novamente.' }

  revalidatePath('/admin/torneios')
  return { id: data.id as string, slug: data.slug as string }
}

/** Publica ou volta a rascunho. É o interruptor do link divulgado. */
export async function setEventPublished(
  eventId: string,
  published: boolean,
): Promise<{ error?: string }> {
  const auth = await requireAdmin()
  if (auth.error) return { error: auth.error }

  const admin = createAdminClient()

  if (published) {
    // Publicar evento sem torneio nenhum entrega ao público uma página vazia —
    // e o link já estará no Instagram quando alguém perceber.
    const { count } = await admin
      .from('tournaments')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', eventId)
      .neq('status', 'draft')
    if ((count ?? 0) === 0) {
      return { error: 'Vincule ao menos um torneio antes de publicar o evento.' }
    }
  }

  const { error } = await admin
    .from('tournament_events')
    .update({ is_published: published })
    .eq('id', eventId)
    .eq('organization_id', auth.orgId)
  if (error) return { error: 'Erro ao atualizar o evento.' }

  revalidatePath('/admin/torneios')
  return {}
}

/**
 * Vincula (ou desvincula, com eventId null) um torneio ao evento.
 *
 * Os dois precisam ser da mesma academia — sem essa checagem um id de torneio de
 * outra arena entraria na capa alheia.
 */
export async function setTournamentEvent(
  tournamentId: string,
  eventId: string | null,
): Promise<{ error?: string }> {
  const auth = await requireAdmin()
  if (auth.error) return { error: auth.error }

  const admin = createAdminClient()

  if (eventId) {
    const { data: event } = await admin
      .from('tournament_events')
      .select('id')
      .eq('id', eventId)
      .eq('organization_id', auth.orgId)
      .maybeSingle()
    if (!event) return { error: 'Evento não encontrado nesta academia.' }
  }

  const { error } = await admin
    .from('tournaments')
    .update({ event_id: eventId })
    .eq('id', tournamentId)
    .eq('organization_id', auth.orgId)
  if (error) return { error: 'Erro ao vincular o torneio ao evento.' }

  revalidatePath('/admin/torneios')
  revalidatePath(`/admin/torneios/${tournamentId}`)
  return {}
}
