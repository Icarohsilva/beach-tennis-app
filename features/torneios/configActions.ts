'use server'
// features/torneios/configActions.ts
// Configuração de conteúdo público do torneio — descrição, regulamento,
// local, horário, prazo de inscrição — e premiação. Separado de actions.ts
// (que já passa de 1600 linhas) porque é uma responsabilidade diferente:
// aquele arquivo é o motor (inscrição, chave, placar); este é o que a
// academia ESCREVE sobre o torneio antes dele acontecer.
import { revalidatePath } from 'next/cache'
import { createClient, createAdminClient, getActiveOrgId } from '@/lib/supabase/server'
import { presentOrNull } from '@/lib/torneios/content'

async function requireAdmin(): Promise<
  { orgId: string; adminClient: ReturnType<typeof createAdminClient> } | { error: string }
> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  const adminClient = createAdminClient()
  const { data: membership } = await adminClient
    .from('memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .single()
  if (membership?.role !== 'admin') return { error: 'Sem permissão.' }

  return { orgId, adminClient }
}

function revalidateTournament(tournamentId: string, eventSlug?: string | null) {
  revalidatePath(`/admin/torneios/${tournamentId}`)
  revalidatePath(`/admin/torneios/${tournamentId}/editar`)
  revalidatePath(`/t/${tournamentId}`)
  if (eventSlug) revalidatePath(`/e/${eventSlug}`)
}

// ---------------------------------------------------------------------------
// updateTournamentContent
// ---------------------------------------------------------------------------

export async function updateTournamentContent(
  tournamentId: string,
  input: {
    description?: string | null
    rules?: string | null
    venue?: string | null
    start_time?: string | null
    registration_deadline?: string | null
  },
): Promise<{ error?: string }> {
  const ctx = await requireAdmin()
  if ('error' in ctx) return ctx
  const { orgId, adminClient } = ctx

  const { data: tournament } = await adminClient
    .from('tournaments')
    .select('id, date, event:tournament_events(slug)')
    .eq('id', tournamentId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!tournament) return { error: 'Torneio não encontrado.' }

  // Prazo não pode passar do próprio dia do torneio — comparação na action
  // (não em CHECK): misturar timestamptz com date+interval puxaria o fuso do
  // GUC e deixaria de ser imutável.
  if (input.registration_deadline) {
    const deadline = new Date(input.registration_deadline)
    const endOfTournamentDay = new Date(`${tournament.date as string}T23:59:59-03:00`)
    if (deadline.getTime() > endOfTournamentDay.getTime()) {
      return { error: 'O prazo de inscrição não pode ser depois do dia do torneio.' }
    }
  }

  const update: Record<string, string | null> = {}
  if ('description' in input) update.description = presentOrNull(input.description)
  if ('rules' in input) update.rules = presentOrNull(input.rules)
  if ('venue' in input) update.venue = presentOrNull(input.venue)
  if ('start_time' in input) update.start_time = presentOrNull(input.start_time)
  if ('registration_deadline' in input) update.registration_deadline = input.registration_deadline ?? null

  const { error } = await adminClient.from('tournaments').update(update).eq('id', tournamentId)
  if (error) return { error: 'Erro ao salvar. Tente novamente.' }

  const eventRaw = tournament.event as { slug: string } | { slug: string }[] | null
  const eventSlug = Array.isArray(eventRaw) ? eventRaw[0]?.slug : eventRaw?.slug
  revalidateTournament(tournamentId, eventSlug)
  return {}
}

// ---------------------------------------------------------------------------
// Premiação — tournament_prizes
// ---------------------------------------------------------------------------

export async function upsertTournamentPrize(
  tournamentId: string,
  prize: {
    id?: string
    kind: 'podium' | 'special'
    position?: number | null
    description: string
    value_cents?: number | null
  },
): Promise<{ error?: string; id?: string }> {
  const ctx = await requireAdmin()
  if ('error' in ctx) return ctx
  const { orgId, adminClient } = ctx

  if (!prize.description.trim()) return { error: 'Descreva o prêmio.' }
  if (prize.kind === 'podium' && !prize.position) return { error: 'Informe a colocação do prêmio.' }

  const { data: tournament } = await adminClient
    .from('tournaments')
    .select('id')
    .eq('id', tournamentId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!tournament) return { error: 'Torneio não encontrado.' }

  const payload = {
    organization_id: orgId,
    tournament_id: tournamentId,
    kind: prize.kind,
    position: prize.kind === 'podium' ? prize.position : null,
    description: prize.description.trim(),
    value_cents: prize.value_cents ?? null,
  }

  if (prize.id) {
    const { error } = await adminClient
      .from('tournament_prizes')
      .update(payload)
      .eq('id', prize.id)
      .eq('tournament_id', tournamentId)
    if (error) return { error: 'Erro ao salvar prêmio. Tente novamente.' }
    revalidateTournament(tournamentId)
    return { id: prize.id }
  }

  const { data, error } = await adminClient.from('tournament_prizes').insert(payload).select('id').single()
  if (error) {
    // unique parcial (tournament_id, position) — já existe prêmio para essa colocação.
    if (error.code === '23505') return { error: 'Já existe um prêmio para esta colocação.' }
    return { error: 'Erro ao salvar prêmio. Tente novamente.' }
  }
  revalidateTournament(tournamentId)
  return { id: data.id as string }
}

export async function deleteTournamentPrize(prizeId: string): Promise<{ error?: string }> {
  const ctx = await requireAdmin()
  if ('error' in ctx) return ctx
  const { orgId, adminClient } = ctx

  const { data: prize } = await adminClient
    .from('tournament_prizes')
    .select('tournament_id')
    .eq('id', prizeId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!prize) return { error: 'Prêmio não encontrado.' }

  const { error } = await adminClient.from('tournament_prizes').delete().eq('id', prizeId)
  if (error) return { error: 'Erro ao remover prêmio. Tente novamente.' }

  revalidateTournament(prize.tournament_id as string)
  return {}
}

// ---------------------------------------------------------------------------
// updateTournamentEventContent — descrição/regulamento/local do EVENTO
// ---------------------------------------------------------------------------
// Os torneios do evento herdam daqui quando o campo próprio está vazio (ver
// lib/torneios/content.ts). createTournamentEvent (eventActions.ts) só grava
// na criação; esta é a única forma de corrigir depois.

export async function updateTournamentEventContent(
  eventId: string,
  input: { description?: string | null; rules?: string | null; venue?: string | null },
): Promise<{ error?: string }> {
  const ctx = await requireAdmin()
  if ('error' in ctx) return ctx
  const { orgId, adminClient } = ctx

  const { data: event } = await adminClient
    .from('tournament_events')
    .select('id, slug')
    .eq('id', eventId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!event) return { error: 'Evento não encontrado.' }

  const update: Record<string, string | null> = {}
  if ('description' in input) update.description = presentOrNull(input.description)
  if ('rules' in input) update.rules = presentOrNull(input.rules)
  if ('venue' in input) update.venue = presentOrNull(input.venue)

  const { error } = await adminClient.from('tournament_events').update(update).eq('id', eventId)
  if (error) return { error: 'Erro ao salvar. Tente novamente.' }

  revalidatePath('/admin/torneios')
  revalidatePath(`/e/${event.slug as string}`)
  return {}
}

export async function markPrizeDelivered(prizeId: string, delivered: boolean): Promise<{ error?: string }> {
  const ctx = await requireAdmin()
  if ('error' in ctx) return ctx
  const { orgId, adminClient } = ctx

  const { data: prize } = await adminClient
    .from('tournament_prizes')
    .select('tournament_id')
    .eq('id', prizeId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!prize) return { error: 'Prêmio não encontrado.' }

  const { error } = await adminClient
    .from('tournament_prizes')
    .update({ delivered_at: delivered ? new Date().toISOString() : null })
    .eq('id', prizeId)
  if (error) return { error: 'Erro ao atualizar prêmio. Tente novamente.' }

  revalidateTournament(prize.tournament_id as string)
  return {}
}
