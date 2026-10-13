// features/torneios/waitlistPromotion.ts
// Fora de actions.ts de propósito: aquele arquivo é 'use server', e tudo o que
// ele exporta vira endpoint chamável pelo navegador. Estes helpers são chamados
// por mais de um arquivo de actions e não podem ser expostos.
//
// A fila de espera do torneio NÃO anda sozinha. Quem sai da fila e entra na
// vaga é decidido pelo admin (placeFromWaitlist), depois de perguntar por
// WhatsApp se a pessoa ainda quer jogar: pela régua da arena, oferecer a vaga
// automaticamente segurava o lugar 48h para quem às vezes nem lembrava do
// torneio. As ofertas que já existiam continuam valendo até vencer.
import type { createAdminClient } from '@/lib/supabase/server'
import { newEntryStatus, type NewEntryStatus, type OccupyingEntry } from '@/lib/torneios/waitlist'

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * Oferta vencida volta para a fila. Chamado por toda action que mexe nas vagas
 * de um torneio, para a contagem não segurar vaga de oferta morta.
 */
export async function expireStaleOffers(adminClient: AdminClient, tournamentId: string): Promise<void> {
  await adminClient
    .from('tournament_entries')
    .update({ entry_status: 'waitlist', offer_expires_at: null })
    .eq('tournament_id', tournamentId)
    .eq('entry_status', 'offered')
    .lt('offer_expires_at', new Date().toISOString())
}

/** Inscrições que ocupam vaga, com o pagamento: a entrada de `newEntryStatus`. */
export async function loadOccupyingEntries(adminClient: AdminClient, tournamentId: string): Promise<OccupyingEntry[]> {
  const { data } = await adminClient
    .from('tournament_entries')
    .select('entry_status, payment_status, partner_payment_status')
    .eq('tournament_id', tournamentId)
    .in('entry_status', ['confirmed', 'offered'])
  return (data ?? []) as OccupyingEntry[]
}

/** A mesma decisão nos quatro caminhos de inscrição (aluno, avulso, convite, admin). */
export async function decideNewEntryStatus(
  adminClient: AdminClient,
  tournamentId: string,
  maxPlayers: number | null,
): Promise<NewEntryStatus> {
  if (maxPlayers === null) return 'confirmed'
  await expireStaleOffers(adminClient, tournamentId)
  return newEntryStatus({ occupying: await loadOccupyingEntries(adminClient, tournamentId), maxPlayers })
}
