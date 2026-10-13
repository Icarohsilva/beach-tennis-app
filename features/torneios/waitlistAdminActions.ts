'use server'
// features/torneios/waitlistAdminActions.ts
// O admin tira alguém da lista de espera e coloca na vaga livre.
//
// A fila do torneio não anda sozinha (ver waitlistPromotion.ts): a arena
// pergunta antes pelo WhatsApp se a pessoa ainda quer jogar, e só então a
// coloca. Daqui a inscrição sai confirmada, com a cobrança calculada e o link de
// pagamento pronto, igual a quem se inscreveu com vaga.
import { revalidatePath } from 'next/cache'
import { createAdminClient, getStaffContext } from '@/lib/supabase/server'
import { availableSlots } from '@/lib/torneios/waitlist'
import { getSiteUrl } from '@/lib/utils/siteUrl'
import { awardTournamentEntry } from '@/features/liga/tournamentPoints'
import { computePersonPayment } from './actions'
import { ensureEntryPaymentToken } from './entryPaymentActions'
import { expireStaleOffers } from './waitlistPromotion'

export interface PlacedPerson {
  name: string
  phone: string | null
  /** Link /p/<token> quando ficou com pagamento pendente. */
  paymentUrl: string | null
  amountCents: number
}

export interface PlaceFromWaitlistResult {
  error?: string
  tournamentName?: string
  people?: PlacedPerson[]
}

export async function placeFromWaitlist(entryId: string): Promise<PlaceFromWaitlistResult> {
  const ctx = await getStaffContext()
  if (!ctx) return { error: 'Não autenticado.' }
  const orgId = ctx.organizationId
  const admin = createAdminClient()

  const { data: membership } = await admin
    .from('memberships')
    .select('role')
    .eq('user_id', ctx.userId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (membership?.role !== 'admin') return { error: 'Só o administrador da arena coloca alguém na vaga.' }

  const { data: entryRaw } = await admin
    .from('tournament_entries')
    .select('id, tournament_id, player_id, partner_id, entry_status')
    .eq('id', entryId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!entryRaw) return { error: 'Inscrição não encontrada.' }
  const entry = entryRaw as {
    id: string
    tournament_id: string
    player_id: string
    partner_id: string | null
    entry_status: 'confirmed' | 'waitlist' | 'offered'
  }
  if (entry.entry_status === 'confirmed') return { error: 'Esta pessoa já está inscrita.' }

  const { data: tournamentRaw } = await admin
    .from('tournaments')
    .select('id, name, status, max_players, entry_price_cents, pix_key')
    .eq('id', entry.tournament_id)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!tournamentRaw) return { error: 'Torneio não encontrado.' }
  const tournament = tournamentRaw as {
    id: string
    name: string
    status: string
    max_players: number | null
    entry_price_cents: number | null
    pix_key: string | null
  }
  if (tournament.status !== 'draft' && tournament.status !== 'open') {
    return { error: 'A chave já foi gerada. Não dá para colocar mais ninguém agora.' }
  }

  // Vaga livre de verdade: quem ainda não pagou continua ocupando a vaga até o
  // admin cancelar por falta de pagamento.
  await expireStaleOffers(admin, tournament.id)
  const { count: occupiedRaw } = await admin
    .from('tournament_entries')
    .select('id', { count: 'exact', head: true })
    .eq('tournament_id', tournament.id)
    .in('entry_status', ['confirmed', 'offered'])
    .neq('id', entry.id)
  if (availableSlots(occupiedRaw ?? 0, tournament.max_players) < 1) {
    return {
      error: 'Não há vaga livre. Cancele por falta de pagamento quem não pagou e depois coloque a pessoa na vaga.',
    }
  }

  const people = [entry.player_id, entry.partner_id].filter((id): id is string => Boolean(id))
  const [player, partner] = await Promise.all(
    people.map((id) =>
      computePersonPayment(admin, id, orgId, tournament.entry_price_cents, tournament.pix_key),
    ),
  )

  const { error } = await admin
    .from('tournament_entries')
    .update({
      entry_status: 'confirmed',
      offer_expires_at: null,
      payment_status: player.payment_status,
      discount_pct: player.discount_pct,
      final_price_cents: player.final_price_cents,
      partner_payment_status: partner ? partner.payment_status : null,
      partner_discount_pct: partner?.discount_pct ?? 0,
      partner_final_price_cents: partner?.final_price_cents ?? 0,
    })
    .eq('id', entry.id)
    .neq('entry_status', 'confirmed')
  if (error) return { error: 'Não foi possível colocar na vaga. Tente novamente.' }

  const { data: profilesRaw } = await admin.from('profiles').select('id, full_name, phone').in('id', people)
  const profiles = new Map(
    ((profilesRaw ?? []) as { id: string; full_name: string | null; phone: string | null }[]).map((p) => [p.id, p]),
  )

  const placed: PlacedPerson[] = []
  const sides = [
    { id: entry.player_id, side: 'player' as const, pay: player },
    ...(entry.partner_id && partner ? [{ id: entry.partner_id, side: 'partner' as const, pay: partner }] : []),
  ]
  for (const s of sides) {
    let paymentUrl: string | null = null
    if (s.pay.payment_status === 'pending') {
      try {
        const token = await ensureEntryPaymentToken(admin, {
          orgId,
          tournamentId: tournament.id,
          entryId: entry.id,
          side: s.side,
        })
        if (token) paymentUrl = `${getSiteUrl()}/p/${token}`
      } catch (e) {
        console.error('[placeFromWaitlist] falha ao gerar link de pagamento', e)
      }
    }
    await awardTournamentEntry(admin, { orgId, tournamentId: tournament.id, studentId: s.id })
    const profile = profiles.get(s.id)
    placed.push({
      name: profile?.full_name?.trim() || 'Atleta',
      phone: profile?.phone ?? null,
      paymentUrl,
      amountCents: s.pay.final_price_cents,
    })
  }

  revalidatePath(`/admin/torneios/${tournament.id}`)
  revalidatePath(`/t/${tournament.id}`)
  revalidatePath(`/torneios/${tournament.id}`)
  return { tournamentName: tournament.name, people: placed }
}
