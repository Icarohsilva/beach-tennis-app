// features/torneios/waitlistPromotion.ts
// Fora de actions.ts de propósito: aquele arquivo é 'use server', e tudo o que
// ele exporta vira endpoint chamável pelo navegador. Este helper é chamado por
// mais de um arquivo de actions (remover inscrição, mover de categoria) e não
// pode ser exposto.
import type { createAdminClient } from '@/lib/supabase/server'

// ---------------------------------------------------------------------------
// expireAndPromote — helper interno
// Chama toda action que remove uma entry. Expira ofertas vencidas e promove
// a lista de espera para o número de vagas disponíveis.
// ---------------------------------------------------------------------------

export async function expireAndPromote(
  adminClient: ReturnType<typeof createAdminClient>,
  tournamentId: string,
  maxPlayers: number | null,
): Promise<void> {
  if (maxPlayers === null) return // sem limite, nada a fazer

  // 1. Expirar entradas 'offered' com prazo vencido → volta para 'waitlist'
  await adminClient
    .from('tournament_entries')
    .update({ entry_status: 'waitlist', offer_expires_at: null })
    .eq('tournament_id', tournamentId)
    .eq('entry_status', 'offered')
    .lt('offer_expires_at', new Date().toISOString())

  // 2. Contar vagas ocupadas (confirmed + offered restantes)
  const { count: occupiedCount } = await adminClient
    .from('tournament_entries')
    .select('id', { count: 'exact', head: true })
    .eq('tournament_id', tournamentId)
    .in('entry_status', ['confirmed', 'offered'])

  const available = maxPlayers - (occupiedCount ?? 0)
  if (available <= 0) return

  // 3. Promover os N mais antigos da fila para 'offered'
  const offerExpiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
  const { data: toPromote } = await adminClient
    .from('tournament_entries')
    .select('id')
    .eq('tournament_id', tournamentId)
    .eq('entry_status', 'waitlist')
    .order('created_at', { ascending: true })
    .limit(available)

  if (!toPromote?.length) return

  await adminClient
    .from('tournament_entries')
    .update({ entry_status: 'offered', offer_expires_at: offerExpiresAt })
    .in('id', toPromote.map((e) => e.id))
}

