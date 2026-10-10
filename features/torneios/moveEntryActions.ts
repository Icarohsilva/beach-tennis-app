'use server'
// features/torneios/moveEntryActions.ts
// O admin passa uma inscrição para outro torneio (categoria) da mesma arena.
// Regras em lib/torneios/moveEntry.ts; aqui só a coleta e as escritas.
import { revalidatePath } from 'next/cache'
import { createAdminClient, getStaffContext } from '@/lib/supabase/server'
import { getConnectedMpToken } from '@/lib/billing/gatewayAccounts'
import { isEntryCharged } from '@/lib/torneios/entryCharge'
import { checkEntryMove, paidDifferenceNotice, repriceSide, type MoveTournament } from '@/lib/torneios/moveEntry'
import { moveTournamentEntryPoints } from '@/features/liga/tournamentPoints'
import { ensureEntryPaymentToken } from './entryPaymentActions'
import { expireAndPromote } from './waitlistPromotion'
import type { Gender } from '@/types'

type TournamentRow = MoveTournament & {
  entry_price_cents: number | null
  pix_key: string | null
  shirt_sizes_enabled: boolean | null
}

const TOURNAMENT_COLUMNS =
  'id, name, status, participant_type, allowed_pair_genders, max_players, entry_price_cents, pix_key, shirt_sizes_enabled'

interface EntryRow {
  id: string
  tournament_id: string
  player_id: string
  partner_id: string | null
  entry_status: 'confirmed' | 'waitlist' | 'offered'
  payment_status: 'free' | 'pending' | 'paid'
  discount_pct: number
  final_price_cents: number
  partner_payment_status: 'free' | 'pending' | 'paid' | null
  partner_discount_pct: number
  partner_final_price_cents: number
  shirt_size: string | null
  partner_shirt_size: string | null
}

export interface MoveEntryResult {
  error?: string
  /** Avisos para o admin depois de mover (diferença de preço, camisa faltando). */
  notices?: string[]
}

export async function moveEntryToTournament(entryId: string, targetTournamentId: string): Promise<MoveEntryResult> {
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
  if (membership?.role !== 'admin') return { error: 'Só o administrador da arena pode mudar a categoria.' }

  const { data: entryRaw } = await admin
    .from('tournament_entries')
    .select(
      'id, tournament_id, player_id, partner_id, entry_status, payment_status, discount_pct, final_price_cents, partner_payment_status, partner_discount_pct, partner_final_price_cents, shirt_size, partner_shirt_size',
    )
    .eq('id', entryId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!entryRaw) return { error: 'Inscrição não encontrada.' }
  const entry = entryRaw as EntryRow

  // Os dois torneios filtrados pela academia ATIVA: sem isso um id copiado de
  // outra arena levaria a inscrição para a chave alheia.
  const { data: tournamentsRaw } = await admin
    .from('tournaments')
    .select(TOURNAMENT_COLUMNS)
    .eq('organization_id', orgId)
    .in('id', [entry.tournament_id, targetTournamentId])
  const tournaments = (tournamentsRaw ?? []) as TournamentRow[]
  const source = tournaments.find((t) => t.id === entry.tournament_id)
  const target = tournaments.find((t) => t.id === targetTournamentId)
  if (!source) return { error: 'Torneio atual não encontrado.' }
  if (!target) return { error: 'Torneio de destino não encontrado.' }

  const people = [entry.player_id, entry.partner_id].filter((id): id is string => Boolean(id))
  const { data: profilesRaw } = await admin.from('profiles').select('id, full_name, gender').in('id', people)
  const profiles = new Map(
    ((profilesRaw ?? []) as { id: string; full_name: string | null; gender: Gender | null }[]).map((p) => [p.id, p]),
  )
  const nameOf = (id: string) => profiles.get(id)?.full_name?.trim() || 'O atleta'

  const or = people.flatMap((id) => [`player_id.eq.${id}`, `partner_id.eq.${id}`]).join(',')
  const { data: clashRaw } = await admin
    .from('tournament_entries')
    .select('player_id, partner_id')
    .eq('tournament_id', target.id)
    .or(or)
  const taken = new Set(
    ((clashRaw ?? []) as { player_id: string; partner_id: string | null }[]).flatMap((e) => [e.player_id, e.partner_id]),
  )
  const clashId = people.find((id) => taken.has(id))

  const { count: occupied } = await admin
    .from('tournament_entries')
    .select('id', { count: 'exact', head: true })
    .eq('tournament_id', target.id)
    .in('entry_status', ['confirmed', 'offered'])

  const verdict = checkEntryMove({
    entry: {
      entryStatus: entry.entry_status,
      playerGender: profiles.get(entry.player_id)?.gender ?? null,
      ...(entry.partner_id ? { partnerGender: profiles.get(entry.partner_id)?.gender ?? null } : {}),
    },
    source,
    target,
    targetOccupied: occupied ?? 0,
    clashName: clashId ? nameOf(clashId) : null,
  })
  if (!verdict.ok) return { error: verdict.reason }

  // Cobrança no destino. Na fila de espera a cobrança nasce quando a vaga é
  // aceita, então ali os campos de pagamento ficam como estão.
  const notices: string[] = []
  const update: Record<string, unknown> = { tournament_id: target.id, seed: null }
  const newlyPending: ('player' | 'partner')[] = []
  if (entry.entry_status === 'confirmed') {
    const priceCents = target.entry_price_cents
    const hasMpToken = (priceCents ?? 0) > 0 ? (await getConnectedMpToken(orgId)) !== null : false
    const charge = { charged: isEntryCharged({ entryPriceCents: priceCents, pixKey: target.pix_key, hasMpToken }), priceCents }

    const playerSide = {
      status: entry.payment_status,
      discountPct: entry.discount_pct,
      finalPriceCents: entry.final_price_cents,
    }
    const player = repriceSide(playerSide, charge)
    Object.assign(update, {
      payment_status: player.status,
      discount_pct: player.discountPct,
      final_price_cents: player.finalPriceCents,
    })
    if (player.status === 'pending') newlyPending.push('player')
    const playerNotice = paidDifferenceNotice(nameOf(entry.player_id), playerSide, charge)
    if (playerNotice) notices.push(playerNotice)

    if (entry.partner_id && entry.partner_payment_status) {
      const partnerSide = {
        status: entry.partner_payment_status,
        discountPct: entry.partner_discount_pct,
        finalPriceCents: entry.partner_final_price_cents,
      }
      const partner = repriceSide(partnerSide, charge)
      Object.assign(update, {
        partner_payment_status: partner.status,
        partner_discount_pct: partner.discountPct,
        partner_final_price_cents: partner.finalPriceCents,
      })
      if (partner.status === 'pending') newlyPending.push('partner')
      const partnerNotice = paidDifferenceNotice(nameOf(entry.partner_id), partnerSide, charge)
      if (partnerNotice) notices.push(partnerNotice)
    }
  }

  const { error } = await admin.from('tournament_entries').update(update).eq('id', entry.id)
  if (error) {
    // unique (tournament_id, player_id) e o índice de parceiro: alguém entrou
    // no destino entre a checagem e a escrita.
    if (error.code === '23505') return { error: `Alguém desta inscrição já está em "${target.name}".` }
    return { error: 'Não foi possível mudar a categoria. Tente novamente.' }
  }

  // O link de pagamento e o convite de parceiro são da inscrição, e seguem
  // junto: as páginas /p/[token] e /t/[id]/dupla/[token] leem o torneio deles.
  await Promise.all([
    admin.from('tournament_entry_payments').update({ tournament_id: target.id }).eq('entry_id', entry.id),
    admin.from('tournament_partner_invites').update({ tournament_id: target.id }).eq('entry_id', entry.id),
  ])

  for (const side of newlyPending) {
    try {
      await ensureEntryPaymentToken(admin, { orgId, tournamentId: target.id, entryId: entry.id, side })
    } catch (e) {
      console.error('[moveEntryToTournament] falha ao gerar link de pagamento', e)
    }
  }

  if (entry.entry_status === 'confirmed') {
    for (const studentId of people) {
      await moveTournamentEntryPoints(admin, {
        orgId,
        fromTournamentId: source.id,
        toTournamentId: target.id,
        studentId,
      })
    }
    // Abriu uma vaga na categoria de origem: a fila de lá anda.
    await expireAndPromote(admin, source.id, source.max_players)
  } else {
    // Chegou alguém na fila do destino, que pode ter vaga sobrando.
    await expireAndPromote(admin, target.id, target.max_players)
  }

  if (target.shirt_sizes_enabled) {
    const missing = [
      !entry.shirt_size ? entry.player_id : null,
      entry.partner_id && !entry.partner_shirt_size ? entry.partner_id : null,
    ].filter((id): id is string => Boolean(id))
    if (missing.length > 0) {
      notices.push(`Falta o tamanho da camisa de ${missing.map(nameOf).join(' e ')} em "${target.name}".`)
    }
  }

  for (const id of [source.id, target.id]) {
    revalidatePath(`/admin/torneios/${id}`)
    revalidatePath(`/t/${id}`)
    revalidatePath(`/torneios/${id}`)
  }
  return { notices }
}
