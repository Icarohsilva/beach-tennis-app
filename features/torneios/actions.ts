'use server'
// features/torneios/actions.ts

import { createClient, createAdminClient, getActiveOrgId, getActiveMembership } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { canStudentAttendLevel } from '@/lib/utils/levelAccess'
import { canRegister, canReportResult, canConfirmResult, type EligibilityMatch } from '@/lib/torneios/eligibility'
import { FORMATS } from '@/lib/torneios/formats'
import { getWeekBounds } from '@/lib/utils/weekHelpers'
import { computeEntryDiscount, applyDiscount } from '@/lib/torneios/entryDiscount'
import { availableSlots, isOfferExpired } from '@/lib/torneios/waitlist'
import type {
  StudentLevel,
  TournamentStatus,
  TournamentFormat,
  TournamentCategory,
  ParticipantType,
  TournamentModality,
  Gender,
  ScoringConfig,
} from '@/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function modalityFromParticipant(pt: ParticipantType): TournamentModality | null {
  if (pt === 'dupla_fixa') return 'dupla_fixa'
  if (pt === 'dupla_revezando') return 'dupla_revezando'
  return null // individual
}

// Embaralha sem mutar o original (Fisher-Yates).
function shuffle<T>(arr: T[]): T[] {
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// Calcula os campos de pagamento para uma nova inscrição.
// Retorna payment_status, discount_pct e final_price_cents.
async function computePaymentFields(
  adminClient: ReturnType<typeof createAdminClient>,
  playerId: string,
  orgId: string,
  entryPriceCents: number | null,
  pixKey: string | null,
): Promise<{ payment_status: 'free' | 'pending'; discount_pct: number; final_price_cents: number }> {
  const isPaid = (entryPriceCents ?? 0) > 0 && !!pixKey
  if (!isPaid) return { payment_status: 'free', discount_pct: 0, final_price_cents: 0 }

  // Ler configurações de desconto da academia
  const { data: orgRow } = await adminClient
    .from('organizations')
    .select('tournament_discount_2_pct, tournament_discount_3_pct')
    .eq('id', orgId)
    .single()
  const discount2 = (orgRow?.tournament_discount_2_pct as number | null) ?? 30
  const discount3 = (orgRow?.tournament_discount_3_pct as number | null) ?? 50

  // Contar inscrições pagas nesta semana calendário (BRT)
  const { start, end } = getWeekBounds(new Date())
  const { count: weeklyCount } = await adminClient
    .from('tournament_entries')
    .select('id', { count: 'exact', head: true })
    .eq('player_id', playerId)
    .eq('organization_id', orgId)
    .in('payment_status', ['pending', 'paid'])
    .gt('final_price_cents', 0)
    .gte('created_at', start.toISOString())
    .lte('created_at', end.toISOString())

  const discountPct = computeEntryDiscount(weeklyCount ?? 0, discount2, discount3)
  const finalPriceCents = applyDiscount(entryPriceCents!, discountPct)

  return { payment_status: 'pending', discount_pct: discountPct, final_price_cents: finalPriceCents }
}

// ---------------------------------------------------------------------------
// expireAndPromote — helper interno
// Chama toda action que remove uma entry. Expira ofertas vencidas e promove
// a lista de espera para o número de vagas disponíveis.
// ---------------------------------------------------------------------------

async function expireAndPromote(
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

// ---------------------------------------------------------------------------
// createTournament — admin only
// ---------------------------------------------------------------------------

export async function createTournament(input: {
  name: string
  date: string
  sport: string
  category: TournamentCategory
  participant_type: ParticipantType
  format: TournamentFormat
  level: StudentLevel
  scoring: ScoringConfig
  cover_image_url?: string | null
  entry_price_cents?: number | null
  pix_key?: string | null
  max_players?: number | null
}): Promise<{ error?: string; id?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const adminClient = createAdminClient()
  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  const { data: membership } = await adminClient
    .from('memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .single()
  if (membership?.role !== 'admin') return { error: 'Sem permissão.' }

  const { data, error } = await adminClient
    .from('tournaments')
    .insert({
      organization_id: orgId,
      name: input.name,
      date: input.date,
      sport: input.sport,
      category: input.category,
      participant_type: input.participant_type,
      modality: modalityFromParticipant(input.participant_type),
      format: input.format,
      level: input.level,
      sets_to_win: input.scoring.sets_to_win,
      games_per_set: input.scoring.games_per_set,
      tiebreak_games: input.scoring.tiebreak_games,
      status: 'draft' as TournamentStatus,
      created_by: user.id,
      cover_image_url: input.cover_image_url ?? null,
      entry_price_cents: input.entry_price_cents ?? null,
      pix_key: input.pix_key ?? null,
      max_players: input.max_players ?? null,
    })
    .select('id')
    .single()

  if (error || !data) return { error: 'Erro ao criar torneio. Tente novamente.' }
  return { id: data.id }
}

// ---------------------------------------------------------------------------
// registerForTournament — student
// ---------------------------------------------------------------------------

export async function registerForTournament(
  tournamentId: string,
  partnerId?: string,
): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const adminClient = createAdminClient()
  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  const { data: tournament, error: tErr } = await adminClient
    .from('tournaments')
    .select('id, status, level, category, participant_type, entry_price_cents, pix_key, max_players')
    .eq('id', tournamentId)
    .eq('organization_id', orgId)
    .single()
  if (tErr || !tournament) return { error: 'Torneio não encontrado.' }
  if (tournament.status !== 'open') {
    return { error: 'Inscrições encerradas para este torneio.' }
  }

  const membership = await getActiveMembership()
  if (!membership) return { error: 'Perfil não encontrado.' }

  if (!canStudentAttendLevel(membership.level as StudentLevel, tournament.level as StudentLevel)) {
    return {
      error: `Seu nível (${membership.level}) não permite participar deste torneio (${tournament.level}).`,
    }
  }

  // Gênero é identidade → vem de profiles.
  const { data: profile } = await adminClient
    .from('profiles')
    .select('gender')
    .eq('id', user.id)
    .single()
  const myGender = (profile?.gender ?? null) as Gender | null

  const elig = canRegister(myGender, tournament.category as TournamentCategory)
  if (!elig.ok) return { error: elig.reason ?? 'Inscrição não permitida nesta categoria.' }

  // Duplicidade.
  const { count: dupCount } = await adminClient
    .from('tournament_entries')
    .select('id', { count: 'exact', head: true })
    .eq('tournament_id', tournamentId)
    .eq('player_id', user.id)
  if ((dupCount ?? 0) > 0) return { error: 'Você já está inscrito neste torneio.' }

  // Verificar capacidade
  const { count: occupiedCount } = await adminClient
    .from('tournament_entries')
    .select('id', { count: 'exact', head: true })
    .eq('tournament_id', tournamentId)
    .in('entry_status', ['confirmed', 'offered'])

  const slots = availableSlots(occupiedCount ?? 0, (tournament.max_players as number | null))
  const entryStatus = slots > 0 ? 'confirmed' : 'waitlist'

  // Dupla fixa exige parceiro; em misto valida 1 M + 1 F.
  let partner: string | null = null
  if (tournament.participant_type === 'dupla_fixa') {
    if (!partnerId) return { error: 'Selecione um parceiro para dupla fixa.' }
    partner = partnerId
    if (tournament.category === 'misto') {
      const { data: partnerProfile } = await adminClient
        .from('profiles')
        .select('gender')
        .eq('id', partnerId)
        .single()
      const partnerGender = (partnerProfile?.gender ?? null) as Gender | null
      const oneEach =
        (myGender === 'M' && partnerGender === 'F') ||
        (myGender === 'F' && partnerGender === 'M')
      if (!oneEach) {
        return { error: 'Categoria mista exige uma dupla com 1 homem e 1 mulher.' }
      }
    }
  }

  let insertPayload: {
    organization_id: string
    tournament_id: string
    player_id: string
    partner_id: string | null
    entry_status: 'confirmed' | 'waitlist'
    payment_status: 'free' | 'pending'
    discount_pct: number
    final_price_cents: number
  }

  if (entryStatus === 'waitlist') {
    // Jogador vai para a fila de espera — sem cobrança por enquanto
    insertPayload = {
      organization_id: orgId,
      tournament_id: tournamentId,
      player_id: user.id,
      partner_id: partner,
      entry_status: 'waitlist',
      payment_status: 'free',
      discount_pct: 0,
      final_price_cents: 0,
    }
  } else {
    const paymentFields = await computePaymentFields(
      adminClient,
      user.id,
      orgId,
      (tournament.entry_price_cents as number | null),
      (tournament.pix_key as string | null),
    )
    insertPayload = {
      organization_id: orgId,
      tournament_id: tournamentId,
      player_id: user.id,
      partner_id: partner,
      entry_status: 'confirmed',
      payment_status: paymentFields.payment_status,
      discount_pct: paymentFields.discount_pct,
      final_price_cents: paymentFields.final_price_cents,
    }
  }

  const { error: insertErr } = await adminClient
    .from('tournament_entries')
    .insert(insertPayload)
  if (insertErr) return { error: 'Erro ao realizar inscrição. Tente novamente.' }
  revalidatePath(`/t/${tournamentId}`)
  revalidatePath(`/admin/torneios/${tournamentId}`)
  return {}
}

// ---------------------------------------------------------------------------
// generateBracket — admin only
// ---------------------------------------------------------------------------

export async function generateBracket(
  tournamentId: string,
): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const adminClient = createAdminClient()
  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  const { data: membership } = await adminClient
    .from('memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .single()
  if (membership?.role !== 'admin') return { error: 'Sem permissão.' }

  const { data: tournament, error: tErr } = await adminClient
    .from('tournaments')
    .select('id, status, format')
    .eq('id', tournamentId)
    .eq('organization_id', orgId)
    .single()
  if (tErr || !tournament) return { error: 'Torneio não encontrado.' }
  if (tournament.status === 'draft') {
    return { error: 'Abra as inscrições antes de gerar a chave.' }
  }
  if (tournament.status === 'finished') {
    return { error: 'Torneio encerrado.' }
  }

  const engine = FORMATS[tournament.format]
  if (!engine) return { error: 'Formato ainda não suportado para geração de chave.' }

  const { data: entriesRaw } = await adminClient
    .from('tournament_entries')
    .select('player_id')
    .eq('tournament_id', tournamentId)
    .eq('organization_id', orgId)
    .eq('entry_status', 'confirmed')
  const playerIds = (entriesRaw ?? []).map((e) => e.player_id as string)

  let plan
  try {
    plan = engine.generate(shuffle(playerIds))
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erro ao gerar a chave.' }
  }

  // Regenerar limpa a chave anterior (idempotente): delete + insert.
  await adminClient.from('tournament_matches').delete().eq('tournament_id', tournamentId)

  const rows = plan.flatMap((rp) =>
    rp.matches.map((m, i) => ({
      organization_id: orgId,
      tournament_id: tournamentId,
      round: rp.round,
      match_no: i + 1,
      player1_id: m.p1,
      partner1_id: m.partner1,
      player2_id: m.p2,
      partner2_id: m.partner2,
    })),
  )

  if (rows.length > 0) {
    const { error: insErr } = await adminClient.from('tournament_matches').insert(rows)
    if (insErr) return { error: 'Erro ao salvar a chave. Tente novamente.' }
  }

  // Gerar a chave coloca o torneio em andamento.
  if (tournament.status === 'open') {
    await adminClient
      .from('tournaments')
      .update({ status: 'in_progress' })
      .eq('id', tournamentId)
  }

  return {}
}

// ---------------------------------------------------------------------------
// recordMatchResult — admin only (lança direto, já confirmado)
// ---------------------------------------------------------------------------

export async function recordMatchResult(
  matchId: string,
  games1: number,
  games2: number,
): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const adminClient = createAdminClient()
  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  const { data: membership } = await adminClient
    .from('memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .single()
  if (membership?.role !== 'admin') return { error: 'Sem permissão.' }

  if (!Number.isInteger(games1) || !Number.isInteger(games2) || games1 < 0 || games2 < 0) {
    return { error: 'Placar inválido.' }
  }

  const { error: updErr } = await adminClient
    .from('tournament_matches')
    .update({
      games1,
      games2,
      result: { games1, games2 },
      result_status: 'confirmed',
      reported_by: user.id,
      confirmed_by: user.id,
      winner_id: null,
    })
    .eq('id', matchId)
    .eq('organization_id', orgId)
  if (updErr) return { error: 'Erro ao salvar resultado. Tente novamente.' }
  return {}
}

// ---------------------------------------------------------------------------
// reportMatchResult — qualquer jogador da partida
// ---------------------------------------------------------------------------

export async function reportMatchResult(
  matchId: string,
  games1: number,
  games2: number,
): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const adminClient = createAdminClient()
  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  if (!Number.isInteger(games1) || !Number.isInteger(games2) || games1 < 0 || games2 < 0) {
    return { error: 'Placar inválido.' }
  }

  const { data: match, error: mErr } = await adminClient
    .from('tournament_matches')
    .select('id, player1_id, partner1_id, player2_id, partner2_id, reported_by')
    .eq('id', matchId)
    .eq('organization_id', orgId)
    .single()
  if (mErr || !match) return { error: 'Confronto não encontrado.' }

  if (!canReportResult(user.id, match as EligibilityMatch)) {
    return { error: 'Você não participa deste confronto.' }
  }

  const { error: updErr } = await adminClient
    .from('tournament_matches')
    .update({
      games1,
      games2,
      result: { games1, games2 },
      result_status: 'pending',
      reported_by: user.id,
      confirmed_by: null,
    })
    .eq('id', matchId)
  if (updErr) return { error: 'Erro ao lançar placar. Tente novamente.' }
  return {}
}

// ---------------------------------------------------------------------------
// confirmMatchResult — dupla adversária ou admin
// ---------------------------------------------------------------------------

export async function confirmMatchResult(
  matchId: string,
): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const adminClient = createAdminClient()
  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  const { data: membership } = await adminClient
    .from('memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .single()
  const isAdmin = membership?.role === 'admin'

  const { data: match, error: mErr } = await adminClient
    .from('tournament_matches')
    .select('id, player1_id, partner1_id, player2_id, partner2_id, reported_by, result_status')
    .eq('id', matchId)
    .eq('organization_id', orgId)
    .single()
  if (mErr || !match) return { error: 'Confronto não encontrado.' }
  if (match.result_status !== 'pending') {
    return { error: 'Não há placar pendente de confirmação.' }
  }

  if (!canConfirmResult(user.id, match as EligibilityMatch, isAdmin)) {
    return { error: 'Só a dupla adversária ou o admin podem confirmar este placar.' }
  }

  const { error: updErr } = await adminClient
    .from('tournament_matches')
    .update({ result_status: 'confirmed', confirmed_by: user.id })
    .eq('id', matchId)
  if (updErr) return { error: 'Erro ao confirmar placar. Tente novamente.' }
  return {}
}

// ---------------------------------------------------------------------------
// removeEntry — cancela inscrição
// ---------------------------------------------------------------------------

export async function removeEntry(
  tournamentId: string,
  playerId?: string,
): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const adminClient = createAdminClient()
  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  const { data: membership } = await adminClient
    .from('memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .single()
  const isAdmin = membership?.role === 'admin'

  const target = isAdmin && playerId ? playerId : user.id

  const { data: tournament } = await adminClient
    .from('tournaments')
    .select('status, max_players')
    .eq('id', tournamentId)
    .eq('organization_id', orgId)
    .single()
  if (!tournament) return { error: 'Torneio não encontrado.' }
  if (!isAdmin && tournament.status !== 'open') {
    return { error: 'Só é possível cancelar a inscrição com inscrições abertas.' }
  }

  // Busca dados do entry antes de deletar (para reversal de desconto)
  const { data: deletedEntry } = await adminClient
    .from('tournament_entries')
    .select('final_price_cents, created_at')
    .eq('tournament_id', tournamentId)
    .eq('player_id', target)
    .eq('organization_id', orgId)
    .single()

  if (!deletedEntry) return { error: 'Inscrição não encontrada.' }

  const { error: delErr } = await adminClient
    .from('tournament_entries')
    .delete()
    .eq('tournament_id', tournamentId)
    .eq('player_id', target)
    .eq('organization_id', orgId)
  if (delErr) return { error: 'Erro ao cancelar inscrição. Tente novamente.' }

  // Reversal de desconto: recalcula entradas PENDING do mesmo jogador na mesma semana
  if ((deletedEntry.final_price_cents as number) > 0) {
    const { data: orgRow } = await adminClient
      .from('organizations')
      .select('tournament_discount_2_pct, tournament_discount_3_pct')
      .eq('id', orgId)
      .single()
    const discount2 = (orgRow?.tournament_discount_2_pct as number | null) ?? 30
    const discount3 = (orgRow?.tournament_discount_3_pct as number | null) ?? 50

    const { start, end } = getWeekBounds(new Date(deletedEntry.created_at as string))

    type PendingRow = {
      id: string
      tournament: { entry_price_cents: number } | { entry_price_cents: number }[] | null
    }
    const { data: pendingRaw } = await adminClient
      .from('tournament_entries')
      .select('id, tournament:tournaments!inner(entry_price_cents)')
      .eq('player_id', target)
      .eq('organization_id', orgId)
      .eq('payment_status', 'pending')
      .gt('final_price_cents', 0)
      .gte('created_at', start.toISOString())
      .lte('created_at', end.toISOString())
      .order('created_at', { ascending: true })

    const pending = (pendingRaw ?? []) as unknown as PendingRow[]

    for (let i = 0; i < pending.length; i++) {
      const tData = pending[i].tournament
      const tRow = Array.isArray(tData) ? (tData[0] ?? null) : tData
      if (!tRow) continue
      const priceCents = tRow.entry_price_cents as number
      const newDiscountPct = computeEntryDiscount(i, discount2, discount3)
      const newFinalPrice = applyDiscount(priceCents, newDiscountPct)
      await adminClient
        .from('tournament_entries')
        .update({ discount_pct: newDiscountPct, final_price_cents: newFinalPrice })
        .eq('id', pending[i].id)
    }
  }

  // Promover lista de espera se houver limite de vagas
  await expireAndPromote(adminClient, tournamentId, (tournament.max_players as number | null))

  revalidatePath(`/admin/torneios/${tournamentId}`)
  revalidatePath(`/t/${tournamentId}`)
  return {}
}

// ---------------------------------------------------------------------------
// cancelEntryForNonPayment — admin cancela inscrição por falta de pagamento
// ---------------------------------------------------------------------------

export async function cancelEntryForNonPayment(
  entryId: string,
): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const adminClient = createAdminClient()
  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  // Verificar role admin
  const { data: membership } = await adminClient
    .from('memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .single()
  if (membership?.role !== 'admin') return { error: 'Sem permissão.' }

  // Buscar entry
  const { data: entry } = await adminClient
    .from('tournament_entries')
    .select('id, tournament_id, player_id, payment_status, final_price_cents, created_at')
    .eq('id', entryId)
    .eq('organization_id', orgId)
    .single()
  if (!entry) return { error: 'Inscrição não encontrada.' }

  // Só faz sentido cancelar pagamento pendente
  if (entry.payment_status !== 'pending') {
    return { error: 'Só é possível cancelar inscrições com pagamento pendente.' }
  }

  const tournamentId = entry.tournament_id as string
  const target = entry.player_id as string

  // Reversal de desconto: recalcula entradas PENDING do mesmo jogador na mesma semana
  if ((entry.final_price_cents as number) > 0) {
    const { data: orgRow } = await adminClient
      .from('organizations')
      .select('tournament_discount_2_pct, tournament_discount_3_pct')
      .eq('id', orgId)
      .single()
    const discount2 = (orgRow?.tournament_discount_2_pct as number | null) ?? 30
    const discount3 = (orgRow?.tournament_discount_3_pct as number | null) ?? 50

    const { start, end } = getWeekBounds(new Date(entry.created_at as string))

    type PendingRow = {
      id: string
      tournament: { entry_price_cents: number } | { entry_price_cents: number }[] | null
    }
    const { data: pendingRaw } = await adminClient
      .from('tournament_entries')
      .select('id, tournament:tournaments!inner(entry_price_cents)')
      .eq('player_id', target)
      .eq('organization_id', orgId)
      .eq('payment_status', 'pending')
      .gt('final_price_cents', 0)
      .neq('id', entryId) // excluir a própria entry que será deletada
      .gte('created_at', start.toISOString())
      .lte('created_at', end.toISOString())
      .order('created_at', { ascending: true })

    const pending = (pendingRaw ?? []) as unknown as PendingRow[]

    for (let i = 0; i < pending.length; i++) {
      const tData = pending[i].tournament
      const tRow = Array.isArray(tData) ? (tData[0] ?? null) : tData
      if (!tRow) continue
      const priceCents = tRow.entry_price_cents as number
      const newDiscountPct = computeEntryDiscount(i, discount2, discount3)
      const newFinalPrice = applyDiscount(priceCents, newDiscountPct)
      await adminClient
        .from('tournament_entries')
        .update({ discount_pct: newDiscountPct, final_price_cents: newFinalPrice })
        .eq('id', pending[i].id)
    }
  }

  // Deletar entry
  const { error: delErr } = await adminClient
    .from('tournament_entries')
    .delete()
    .eq('id', entryId)
    .eq('organization_id', orgId)
  if (delErr) return { error: 'Erro ao cancelar inscrição. Tente novamente.' }

  // Buscar max_players e promover lista de espera
  const { data: tournament } = await adminClient
    .from('tournaments')
    .select('max_players')
    .eq('id', tournamentId)
    .single()

  await expireAndPromote(adminClient, tournamentId, (tournament?.max_players as number | null) ?? null)

  revalidatePath(`/admin/torneios/${tournamentId}`)
  return {}
}

// ---------------------------------------------------------------------------
// confirmWaitlistOffer — jogador aceita a oferta de vaga aberta para ele
// ---------------------------------------------------------------------------

export async function confirmWaitlistOffer(
  tournamentId: string,
): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const adminClient = createAdminClient()

  // Buscar dados do torneio primeiro para obter organization_id (necessário para escopo da entry)
  const { data: tournament } = await adminClient
    .from('tournaments')
    .select('entry_price_cents, pix_key, organization_id, max_players')
    .eq('id', tournamentId)
    .single()
  if (!tournament) return { error: 'Torneio não encontrado.' }

  // Buscar entry do usuário com entry_status = 'offered' nesse torneio (escopo por org)
  const { data: entry } = await adminClient
    .from('tournament_entries')
    .select('id, offer_expires_at, payment_status, created_at')
    .eq('tournament_id', tournamentId)
    .eq('player_id', user.id)
    .eq('organization_id', tournament.organization_id as string)
    .eq('entry_status', 'offered')
    .maybeSingle()

  if (!entry) return { error: 'Você não tem uma oferta de vaga ativa.' }

  // Verificar expiração
  if (isOfferExpired(entry.offer_expires_at as string | null)) {
    await expireAndPromote(adminClient, tournamentId, (tournament.max_players as number | null) ?? null)
    return { error: 'Sua oferta de vaga expirou. Você voltou para a lista de espera.' }
  }

  const isPaid =
    (tournament.entry_price_cents as number | null ?? 0) > 0 &&
    !!(tournament.pix_key)

  let paymentStatus: 'free' | 'pending' = 'free'
  let finalPriceCents = 0
  let discountPct = 0

  if (isPaid) {
    const paymentFields = await computePaymentFields(
      adminClient,
      user.id,
      tournament.organization_id as string,
      tournament.entry_price_cents as number | null,
      tournament.pix_key as string | null,
    )
    paymentStatus = paymentFields.payment_status
    finalPriceCents = paymentFields.final_price_cents
    discountPct = paymentFields.discount_pct
  }

  const { error: updateErr } = await adminClient
    .from('tournament_entries')
    .update({
      entry_status: 'confirmed',
      offer_expires_at: null,
      payment_status: paymentStatus,
      final_price_cents: finalPriceCents,
      discount_pct: discountPct,
    })
    .eq('id', entry.id)

  if (updateErr) return { error: 'Erro ao confirmar inscrição. Tente novamente.' }

  revalidatePath(`/t/${tournamentId}`)
  revalidatePath(`/admin/torneios/${tournamentId}`)
  return {}
}

// ---------------------------------------------------------------------------
// updateTournamentStatus — admin only
// ---------------------------------------------------------------------------

const STATUS_ORDER: TournamentStatus[] = ['draft', 'open', 'in_progress', 'finished']

export async function updateTournamentStatus(
  tournamentId: string,
  newStatus: TournamentStatus,
): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const adminClient = createAdminClient()
  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  const { data: membership } = await adminClient
    .from('memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .single()
  if (membership?.role !== 'admin') return { error: 'Sem permissão.' }

  const { data: tournament, error: tErr } = await adminClient
    .from('tournaments')
    .select('id, status')
    .eq('id', tournamentId)
    .eq('organization_id', orgId)
    .single()

  if (tErr || !tournament) return { error: 'Torneio não encontrado.' }

  const currentIdx = STATUS_ORDER.indexOf(tournament.status as TournamentStatus)
  const newIdx = STATUS_ORDER.indexOf(newStatus)

  if (newIdx !== currentIdx + 1) {
    return { error: 'Transição de status inválida. O fluxo é: rascunho → aberto → em andamento → encerrado.' }
  }

  const { error: updateErr } = await adminClient
    .from('tournaments')
    .update({ status: newStatus })
    .eq('id', tournamentId)

  if (updateErr) return { error: 'Erro ao atualizar status. Tente novamente.' }
  return {}
}

// ---------------------------------------------------------------------------
// closeTournament — admin only: encerra torneio e preenche pódio automático
// ---------------------------------------------------------------------------

export async function closeTournament(
  tournamentId: string,
): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const adminClient = createAdminClient()
  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  const { data: membership } = await adminClient
    .from('memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .single()
  if (membership?.role !== 'admin') return { error: 'Sem permissão.' }

  const { data: tournament, error: tErr } = await adminClient
    .from('tournaments')
    .select('id, status, format, sets_to_win, games_per_set, tiebreak_games')
    .eq('id', tournamentId)
    .eq('organization_id', orgId)
    .single()
  if (tErr || !tournament) return { error: 'Torneio não encontrado.' }
  if (tournament.status === 'finished') return { error: 'Torneio já encerrado.' }
  if (!['open', 'in_progress'].includes(tournament.status as string)) {
    return { error: 'Só é possível encerrar um torneio aberto ou em andamento.' }
  }

  // Buscar entradas confirmadas e partidas para calcular classificação
  const { data: entriesRaw } = await adminClient
    .from('tournament_entries')
    .select('player_id, partner_id')
    .eq('tournament_id', tournamentId)
    .eq('entry_status', 'confirmed')
  const entries = (entriesRaw ?? []).map((e) => ({
    playerId: e.player_id as string,
    partnerId: (e.partner_id as string | null) ?? null,
  }))

  const { data: matchesRaw } = await adminClient
    .from('tournament_matches')
    .select('player1_id, partner1_id, player2_id, partner2_id, games1, games2, result_status')
    .eq('tournament_id', tournamentId)
  const matches = (matchesRaw ?? []).map((m) => ({
    player1_id: m.player1_id as string,
    partner1_id: (m.partner1_id as string | null) ?? null,
    player2_id: m.player2_id as string,
    partner2_id: (m.partner2_id as string | null) ?? null,
    games1: (m.games1 as number | null) ?? 0,
    games2: (m.games2 as number | null) ?? 0,
    result_status: (m.result_status as 'pending' | 'confirmed' | null),
  }))

  // Calcular classificação via motor de formato
  const scoring: ScoringConfig = {
    sets_to_win: (tournament.sets_to_win as number) ?? 1,
    games_per_set: (tournament.games_per_set as number) ?? 6,
    tiebreak_games: (tournament.tiebreak_games as boolean) ?? true,
  }
  const fmt = FORMATS[(tournament.format as string) ?? 'americano']
  const standings = fmt
    ? fmt.computeStandings(entries, matches as import('@/lib/torneios/types').MatchResultInput[], scoring)
    : []

  const [w1, w2, w3] = standings

  const { error: updateErr } = await adminClient
    .from('tournaments')
    .update({
      status: 'finished' as TournamentStatus,
      winner1_id: w1?.playerId ?? null,
      winner2_id: w2?.playerId ?? null,
      winner3_id: w3?.playerId ?? null,
      winner1_partner_id: null,
      winner2_partner_id: null,
      winner3_partner_id: null,
    })
    .eq('id', tournamentId)
  if (updateErr) return { error: 'Erro ao encerrar torneio. Tente novamente.' }

  revalidatePath(`/admin/torneios/${tournamentId}`)
  revalidatePath(`/t/${tournamentId}`)
  return {}
}

// ---------------------------------------------------------------------------
// updateWinners — admin corrige pódio manualmente após encerramento
// ---------------------------------------------------------------------------

export async function updateWinners(
  tournamentId: string,
  winners: {
    winner1_id: string | null
    winner2_id: string | null
    winner3_id: string | null
  },
): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const adminClient = createAdminClient()
  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  const { data: membership } = await adminClient
    .from('memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .single()
  if (membership?.role !== 'admin') return { error: 'Sem permissão.' }

  // Validar que os IDs fornecidos são inscritos neste torneio (ou null).
  const candidateIds = [winners.winner1_id, winners.winner2_id, winners.winner3_id].filter(Boolean) as string[]
  if (candidateIds.length > 0) {
    const { data: validEntries } = await adminClient
      .from('tournament_entries')
      .select('player_id')
      .eq('tournament_id', tournamentId)
      .in('player_id', candidateIds)
    const validIds = new Set((validEntries ?? []).map((e) => e.player_id as string))
    const invalid = candidateIds.filter((id) => !validIds.has(id))
    if (invalid.length > 0) return { error: 'Um ou mais vencedores não estão inscritos neste torneio.' }
  }

  const { error: updateErr } = await adminClient
    .from('tournaments')
    .update({
      winner1_id: winners.winner1_id,
      winner2_id: winners.winner2_id,
      winner3_id: winners.winner3_id,
    })
    .eq('id', tournamentId)
    .eq('organization_id', orgId)
  if (updateErr) return { error: 'Erro ao salvar resultado. Tente novamente.' }

  revalidatePath(`/admin/torneios/${tournamentId}`)
  revalidatePath(`/t/${tournamentId}`)
  return {}
}

// ---------------------------------------------------------------------------
// updateTournamentCover — admin troca imagem de capa
// ---------------------------------------------------------------------------

export async function updateTournamentCover(
  tournamentId: string,
  coverImageUrl: string | null,
): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const adminClient = createAdminClient()
  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  const { data: membership } = await adminClient
    .from('memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .single()
  if (membership?.role !== 'admin') return { error: 'Sem permissão.' }

  const { error: updateErr } = await adminClient
    .from('tournaments')
    .update({ cover_image_url: coverImageUrl })
    .eq('id', tournamentId)
    .eq('organization_id', orgId)
  if (updateErr) return { error: 'Erro ao salvar imagem. Tente novamente.' }

  revalidatePath(`/admin/torneios/${tournamentId}`)
  revalidatePath(`/t/${tournamentId}`)
  return {}
}

// ---------------------------------------------------------------------------
// registerExternal — inscrição avulsa (sem membership): acessa via link público
// ---------------------------------------------------------------------------

export async function registerExternal(
  tournamentId: string,
): Promise<{ error?: string }> {
  // Usa createClient() apenas para ler sessão (uid); não precisa de org do usuário.
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  // adminClient para ler org_id do torneio e inserir sem RLS de membership.
  const adminClient = createAdminClient()

  const { data: tournament } = await adminClient
    .from('tournaments')
    .select('id, organization_id, status, entry_price_cents, pix_key, max_players')
    .eq('id', tournamentId)
    .single()
  if (!tournament) return { error: 'Torneio não encontrado.' }
  if (tournament.status !== 'open') return { error: 'Inscrições encerradas.' }

  // Checar duplicidade
  const { count: dup } = await adminClient
    .from('tournament_entries')
    .select('id', { count: 'exact', head: true })
    .eq('tournament_id', tournamentId)
    .eq('player_id', user.id)
  if ((dup ?? 0) > 0) return { error: 'Você já está inscrito neste torneio.' }

  // Verificar capacidade
  const { count: occupiedCount } = await adminClient
    .from('tournament_entries')
    .select('id', { count: 'exact', head: true })
    .eq('tournament_id', tournamentId)
    .in('entry_status', ['confirmed', 'offered'])

  const slots = availableSlots(occupiedCount ?? 0, (tournament.max_players as number | null))
  const entryStatus = slots > 0 ? 'confirmed' : 'waitlist'

  let insertPayload: {
    organization_id: string
    tournament_id: string
    player_id: string
    partner_id: null
    entry_status: 'confirmed' | 'waitlist'
    payment_status: 'free' | 'pending'
    discount_pct: number
    final_price_cents: number
  }

  if (entryStatus === 'waitlist') {
    insertPayload = {
      organization_id: tournament.organization_id as string,
      tournament_id: tournamentId,
      player_id: user.id,
      partner_id: null,
      entry_status: 'waitlist',
      payment_status: 'free',
      discount_pct: 0,
      final_price_cents: 0,
    }
  } else {
    const paymentFields = await computePaymentFields(
      adminClient,
      user.id,
      tournament.organization_id as string,
      (tournament.entry_price_cents as number | null),
      (tournament.pix_key as string | null),
    )
    insertPayload = {
      organization_id: tournament.organization_id as string,
      tournament_id: tournamentId,
      player_id: user.id,
      partner_id: null,
      entry_status: 'confirmed',
      payment_status: paymentFields.payment_status,
      discount_pct: paymentFields.discount_pct,
      final_price_cents: paymentFields.final_price_cents,
    }
  }

  const { error: insertErr } = await adminClient
    .from('tournament_entries')
    .insert(insertPayload)
  if (insertErr) return { error: 'Erro ao realizar inscrição. Tente novamente.' }

  revalidatePath(`/t/${tournamentId}`)
  revalidatePath(`/admin/torneios/${tournamentId}`)
  return {}
}

// ---------------------------------------------------------------------------
// confirmEntryPayment — admin confirma recebimento do PIX
// ---------------------------------------------------------------------------

export async function confirmEntryPayment(
  entryId: string,
): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const adminClient = createAdminClient()
  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  const { data: membership } = await adminClient
    .from('memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .single()
  if (membership?.role !== 'admin') return { error: 'Sem permissão.' }

  const { data: entry, error: entryErr } = await adminClient
    .from('tournament_entries')
    .select('id, tournament_id, payment_status')
    .eq('id', entryId)
    .eq('organization_id', orgId)
    .single()
  if (entryErr || !entry) return { error: 'Inscrição não encontrada.' }
  if (entry.payment_status !== 'pending') {
    return { error: 'Esta inscrição não está aguardando pagamento.' }
  }

  const { error: updateErr } = await adminClient
    .from('tournament_entries')
    .update({ payment_status: 'paid' })
    .eq('id', entryId)
  if (updateErr) return { error: 'Erro ao confirmar pagamento. Tente novamente.' }

  revalidatePath(`/admin/torneios/${entry.tournament_id as string}`)
  return {}
}

// ---------------------------------------------------------------------------
// updateEntryReceipt — jogador salva path do comprovante após upload
// ---------------------------------------------------------------------------

export async function updateEntryReceipt(
  tournamentId: string,
  receiptPath: string,
): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  // Valida formato do path: deve ser {tournamentId}/{userId}/receipt.*
  if (!receiptPath.startsWith(`${tournamentId}/`)) {
    return { error: 'Caminho do comprovante inválido.' }
  }

  // adminClient usado porque jogadores externos (sem membership) não têm org ativa.
  // O filtro player_id = user.id garante que só a entrada do próprio jogador é atualizada.
  const adminClient = createAdminClient()

  // Verifica que o jogador está inscrito antes de gravar o comprovante
  const { count } = await adminClient
    .from('tournament_entries')
    .select('id', { count: 'exact', head: true })
    .eq('tournament_id', tournamentId)
    .eq('player_id', user.id)
  if ((count ?? 0) === 0) return { error: 'Você não está inscrito neste torneio.' }

  const { error } = await adminClient
    .from('tournament_entries')
    .update({ receipt_url: receiptPath })
    .eq('tournament_id', tournamentId)
    .eq('player_id', user.id)
  if (error) return { error: 'Erro ao salvar comprovante. Tente novamente.' }
  return {}
}

// ---------------------------------------------------------------------------
// updateTournamentDiscountSettings — admin configura percentuais de desconto
// ---------------------------------------------------------------------------

export async function updateTournamentDiscountSettings(
  discount2Pct: number,
  discount3Pct: number,
): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const adminClient = createAdminClient()
  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  const { data: membership } = await adminClient
    .from('memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .single()
  if (membership?.role !== 'admin') return { error: 'Sem permissão.' }

  if (
    !Number.isInteger(discount2Pct) || discount2Pct < 0 || discount2Pct > 100 ||
    !Number.isInteger(discount3Pct) || discount3Pct < 0 || discount3Pct > 100
  ) {
    return { error: 'Percentuais devem ser inteiros entre 0 e 100.' }
  }

  const { error: updateErr } = await adminClient
    .from('organizations')
    .update({
      tournament_discount_2_pct: discount2Pct,
      tournament_discount_3_pct: discount3Pct,
    })
    .eq('id', orgId)
  if (updateErr) return { error: 'Erro ao salvar configurações. Tente novamente.' }
  revalidatePath('/admin/configuracoes')
  return {}
}
