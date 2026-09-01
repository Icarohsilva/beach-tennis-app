'use server'
// features/torneios/actions.ts

import { createClient, createAdminClient, getActiveOrgId, getActiveMembership } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { canReportResult, canConfirmResult, type EligibilityMatch } from '@/lib/torneios/eligibility'
import { canonicalizePairGenders, pairGendersFor, validateEntry } from '@/lib/torneios/pairRules'
import { findEntrantClash, clashMessage, selfPairError } from '@/lib/torneios/entryDuplicates'
import { resolveRegistrationWindow } from '@/lib/torneios/registrationWindow'
import {
  DEFAULT_ADVANCE_PER_GROUP,
  DEFAULT_GROUP_COUNT,
  FORMATS,
  hasGroupStage,
  isBracketFormat,
} from '@/lib/torneios/formats'
import { splitBySeed, winnerSlot } from '@/lib/torneios/bracket'
import {
  computeGroupTables,
  generateKnockoutFromGroups,
  isGroupStageComplete,
} from '@/lib/torneios/schedule/grupos'
import { getWeekBounds } from '@/lib/utils/weekHelpers'
import { computeEntryDiscount, applyDiscount } from '@/lib/torneios/entryDiscount'
import { availableSlots, isOfferExpired } from '@/lib/torneios/waitlist'
import { awardTournamentEntry, syncTournamentResultPoints } from '@/features/liga/tournamentPoints'
import { ensureEntryPaymentToken } from './entryPaymentActions'
import { buildWhatsAppUrl } from '@/lib/utils/whatsappLink'
import { getSiteUrl } from '@/lib/utils/siteUrl'
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

// Calcula os campos de pagamento para uma nova inscrição, para UMA pessoa
// (titular ou parceiro — dupla fixa é cobrada por atleta, cada um com o
// próprio degrau de desconto semanal).
export async function computePersonPayment(
  adminClient: ReturnType<typeof createAdminClient>,
  personId: string,
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

  // Contar inscrições pagas desta pessoa nesta semana calendário (BRT), nos
  // DOIS papéis: um torneio pago como parceiro numa semana anterior tinha que
  // contar para o degrau de desconto do 2º/3º torneio, e não contava (só
  // player_id entrava na conta) — dava desconto a mais para quem só entrou
  // como titular nesta semana.
  const { start, end } = getWeekBounds(new Date())
  const { count: weeklyCount } = await adminClient
    .from('tournament_entries')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .or(
      `and(player_id.eq.${personId},final_price_cents.gt.0),and(partner_id.eq.${personId},partner_final_price_cents.gt.0)`,
    )
    .gte('created_at', start.toISOString())
    .lte('created_at', end.toISOString())

  const discountPct = computeEntryDiscount(weeklyCount ?? 0, discount2, discount3)
  const finalPriceCents = applyDiscount(entryPriceCents!, discountPct)

  return { payment_status: 'pending', discount_pct: discountPct, final_price_cents: finalPriceCents }
}

// Recalcula o desconto de UMA pessoa depois que uma inscrição dela (titular ou
// parceiro) saiu da semana — a mesma lógica de computePersonPayment, mas
// olhando para trás em vez de para a próxima inscrição. Cada linha pendente
// dessa pessoa na semana pode ter sido titular OU parceiro, então a coluna
// atualizada varia por linha.
async function reversePersonWeeklyDiscount(
  adminClient: ReturnType<typeof createAdminClient>,
  personId: string,
  orgId: string,
  referenceDate: Date,
): Promise<void> {
  const { data: orgRow } = await adminClient
    .from('organizations')
    .select('tournament_discount_2_pct, tournament_discount_3_pct')
    .eq('id', orgId)
    .single()
  const discount2 = (orgRow?.tournament_discount_2_pct as number | null) ?? 30
  const discount3 = (orgRow?.tournament_discount_3_pct as number | null) ?? 50

  const { start, end } = getWeekBounds(referenceDate)

  type PendingRow = {
    id: string
    player_id: string
    tournament: { entry_price_cents: number } | { entry_price_cents: number }[] | null
  }
  const { data: pendingRaw } = await adminClient
    .from('tournament_entries')
    .select('id, player_id, tournament:tournaments!inner(entry_price_cents)')
    .eq('organization_id', orgId)
    .or(
      `and(player_id.eq.${personId},payment_status.eq.pending,final_price_cents.gt.0),and(partner_id.eq.${personId},partner_payment_status.eq.pending,partner_final_price_cents.gt.0)`,
    )
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
    const isPlayerSide = pending[i].player_id === personId
    await adminClient
      .from('tournament_entries')
      .update(
        isPlayerSide
          ? { discount_pct: newDiscountPct, final_price_cents: newFinalPrice }
          : { partner_discount_pct: newDiscountPct, partner_final_price_cents: newFinalPrice },
      )
      .eq('id', pending[i].id)
  }
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
  /** Só no formato 'grupos'. */
  group_count?: number | null
  advance_per_group?: number | null
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
      // Só o valor INICIAL vem da categoria — dali em diante quem manda é esta
      // coluna (comentário da migração 20260826000100). Sem isto, todo torneio
      // novo nasce com o default do banco (qualquer formação), e "Masculino"/
      // "Feminino" viram só um rótulo: a inscrição aceitaria qualquer gênero.
      allowed_pair_genders: pairGendersFor(input.category),
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
      // Fora do formato 'grupos' a configuração não se aplica e fica nula, para
      // não sugerir na tela um grupo que o torneio não tem.
      group_count: input.format === 'grupos' ? input.group_count ?? DEFAULT_GROUP_COUNT : null,
      advance_per_group: input.advance_per_group ?? DEFAULT_ADVANCE_PER_GROUP,
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
): Promise<{ error?: string; partnerPaymentUrl?: string; partnerWhatsappUrl?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const adminClient = createAdminClient()
  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  const { data: tournament, error: tErr } = await adminClient
    .from('tournaments')
    .select(
      'id, status, level, category, participant_type, allowed_pair_genders, entry_price_cents, pix_key, max_players, registration_deadline',
    )
    .eq('id', tournamentId)
    .eq('organization_id', orgId)
    .single()
  if (tErr || !tournament) return { error: 'Torneio não encontrado.' }
  const regWindow = resolveRegistrationWindow(
    { status: tournament.status as TournamentStatus, registration_deadline: tournament.registration_deadline as string | null },
    new Date(),
  )
  if (!regWindow.open) return { error: regWindow.reason ?? 'Inscrições encerradas para este torneio.' }

  const membership = await getActiveMembership()
  if (!membership) return { error: 'Perfil não encontrado.' }

  const selfErr = selfPairError(user.id, partnerId)
  if (selfErr) return { error: selfErr }

  // Gênero é identidade → vem de profiles. Os dois lados de uma vez: BUG A
  // (parceiro nunca era conferido) era exatamente ler só o meu gênero aqui.
  const ids = partnerId ? [user.id, partnerId] : [user.id]
  const { data: profilesRaw } = await adminClient
    .from('profiles')
    .select('id, full_name, gender, phone')
    .in('id', ids)
  const profileById = new Map(
    ((profilesRaw ?? []) as { id: string; full_name: string | null; gender: Gender | null; phone: string | null }[]).map((p) => [
      p.id,
      p,
    ]),
  )
  const myGender = (profileById.get(user.id)?.gender ?? null) as Gender | null
  const partnerGender = partnerId
    ? ((profileById.get(partnerId)?.gender ?? null) as Gender | null)
    : undefined

  const allowedPairGenders = canonicalizePairGenders(
    (tournament.allowed_pair_genders as string[] | null) ?? [],
  )
  const verdict = validateEntry({
    participantType: tournament.participant_type as ParticipantType,
    allowed: allowedPairGenders,
    myGender,
    partnerGender,
  })
  if (!verdict.ok) return { error: verdict.reason ?? 'Inscrição não permitida nesta categoria.' }

  // Duplicidade dos DOIS lados: o unique (tournament_id, player_id) não impede
  // que a mesma pessoa seja partner_id numa dupla e player_id (ou partner_id)
  // em outra — BUG B.
  const orFilter = ids.flatMap((id) => [`player_id.eq.${id}`, `partner_id.eq.${id}`]).join(',')
  const { data: existingRaw } = await adminClient
    .from('tournament_entries')
    .select('player_id, partner_id')
    .eq('tournament_id', tournamentId)
    .or(orFilter)
  const existing = (existingRaw ?? []) as { player_id: string; partner_id: string | null }[]
  const people = ids.map((id) => ({ id, name: profileById.get(id)?.full_name ?? null }))
  const clash = findEntrantClash(existing, people, user.id)
  if (clash) return { error: clashMessage(clash) }

  // Verificar capacidade
  const { count: occupiedCount } = await adminClient
    .from('tournament_entries')
    .select('id', { count: 'exact', head: true })
    .eq('tournament_id', tournamentId)
    .in('entry_status', ['confirmed', 'offered'])

  const slots = availableSlots(occupiedCount ?? 0, (tournament.max_players as number | null))
  const entryStatus = slots > 0 ? 'confirmed' : 'waitlist'

  const partner = tournament.participant_type === 'dupla_fixa' ? partnerId ?? null : null

  let insertPayload: {
    organization_id: string
    tournament_id: string
    player_id: string
    partner_id: string | null
    entry_status: 'confirmed' | 'waitlist'
    payment_status: 'free' | 'pending'
    discount_pct: number
    final_price_cents: number
    partner_payment_status: 'free' | 'pending' | null
    partner_discount_pct: number
    partner_final_price_cents: number
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
      partner_payment_status: partner ? 'free' : null,
      partner_discount_pct: 0,
      partner_final_price_cents: 0,
    }
  } else {
    // Dupla fixa é cobrada por atleta: os dois pagam a sua parte, cada um com
    // o próprio degrau de desconto semanal — BUG C era o parceiro entrar de
    // graça porque só o titular era cobrado.
    const paymentFields = await computePersonPayment(
      adminClient,
      user.id,
      orgId,
      (tournament.entry_price_cents as number | null),
      (tournament.pix_key as string | null),
    )
    const partnerPaymentFields = partner
      ? await computePersonPayment(
          adminClient,
          partner,
          orgId,
          (tournament.entry_price_cents as number | null),
          (tournament.pix_key as string | null),
        )
      : null
    insertPayload = {
      organization_id: orgId,
      tournament_id: tournamentId,
      player_id: user.id,
      partner_id: partner,
      entry_status: 'confirmed',
      payment_status: paymentFields.payment_status,
      discount_pct: paymentFields.discount_pct,
      final_price_cents: paymentFields.final_price_cents,
      partner_payment_status: partnerPaymentFields?.payment_status ?? (partner ? 'free' : null),
      partner_discount_pct: partnerPaymentFields?.discount_pct ?? 0,
      partner_final_price_cents: partnerPaymentFields?.final_price_cents ?? 0,
    }
  }

  const { data: insertedEntry, error: insertErr } = await adminClient
    .from('tournament_entries')
    .insert(insertPayload)
    .select('id')
    .single()
  if (insertErr || !insertedEntry) return { error: 'Erro ao realizar inscrição. Tente novamente.' }

  let partnerPaymentUrl: string | undefined
  let partnerWhatsappUrl: string | undefined

  if (entryStatus === 'confirmed') {
    await awardTournamentEntry(adminClient, { orgId, tournamentId, studentId: user.id })
    // O parceiro de dupla fixa também entrou no torneio — merece o mesmo ponto
    // da Liga. Antes só quem clicou "Inscrever-se" ganhava.
    if (partner) {
      await awardTournamentEntry(adminClient, { orgId, tournamentId, studentId: partner })
    }

    // Link pessoal de pagamento por lado — best-effort: uma falha aqui não
    // pode derrubar uma inscrição que já segurou a vaga e cobrou.
    try {
      if (insertPayload.payment_status === 'pending') {
        await ensureEntryPaymentToken(adminClient, {
          orgId, tournamentId, entryId: insertedEntry.id as string, side: 'player',
        })
      }
      if (insertPayload.partner_payment_status === 'pending' && partner) {
        const token = await ensureEntryPaymentToken(adminClient, {
          orgId, tournamentId, entryId: insertedEntry.id as string, side: 'partner',
        })
        if (token) {
          partnerPaymentUrl = `${getSiteUrl()}/p/${token}`
          const partnerPhone = profileById.get(partner)?.phone
          if (partnerPhone) {
            const myName = profileById.get(user.id)?.full_name ?? 'Alguém'
            partnerWhatsappUrl = buildWhatsAppUrl(
              partnerPhone,
              `${myName} te inscreveu no torneio! Sua parte é R$ ${(insertPayload.partner_final_price_cents / 100).toFixed(2).replace('.', ',')} — pague por aqui: ${partnerPaymentUrl}`,
            )
          }
        }
      }
    } catch (e) {
      console.error('[registerForTournament] falha ao gerar link de pagamento', e)
    }
  }

  revalidatePath(`/t/${tournamentId}`)
  revalidatePath(`/admin/torneios/${tournamentId}`)
  return { partnerPaymentUrl, partnerWhatsappUrl }
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
    .select('id, status, format, group_count, advance_per_group')
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

  // partner_id vem junto: em dupla fixa a dupla é a unidade que entra na chave,
  // e sem o parceiro o mata-mata montaria confronto de uma pessoa só.
  const { data: entriesRaw } = await adminClient
    .from('tournament_entries')
    .select('player_id, partner_id, seed')
    .eq('tournament_id', tournamentId)
    .eq('organization_id', orgId)
    .eq('entry_status', 'confirmed')
  type EntryDraw = { player_id: string; partner_id: string | null; seed: number | null }
  const { seeded, unseeded } = splitBySeed((entriesRaw ?? []) as EntryDraw[])
  // Cabeças-de-chave na ordem declarada; o resto sorteado.
  const entries = [...seeded, ...shuffle(unseeded)].map((e) => ({
    playerId: e.player_id,
    partnerId: e.partner_id,
  }))

  let plan
  try {
    plan = engine.generate(entries, {
      groupCount: (tournament.group_count as number | null) ?? DEFAULT_GROUP_COUNT,
      advancePerGroup: (tournament.advance_per_group as number | null) ?? DEFAULT_ADVANCE_PER_GROUP,
    })
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
      // Na eliminatória o matchNo é a coordenada da chave, não a ordem de
      // inserção: uma partida dispensada por bye deixa buraco na numeração de
      // propósito, e renumerar aqui quebraria o caminho do vencedor.
      match_no: m.matchNo ?? i + 1,
      // 'A'/'B'/... na fase de grupos, null no mata-mata. É o que separa as
      // duas fases dentro da mesma tabela.
      group_label: m.group ?? null,
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
// seedKnockoutFromGroups — monta o mata-mata quando a fase de grupos acaba
// ---------------------------------------------------------------------------

/**
 * Lê as tabelas dos grupos e cria a chave com os classificados.
 *
 * Roda sozinha depois do último placar de grupo confirmado, e também pelo botão
 * do admin — que é a saída quando alguém desiste e um jogo nunca é lançado.
 *
 * Idempotente pelo caminho seguro: se já existe partida de mata-mata, não faz
 * nada. Regerar por cima apagaria resultados de quartas já jogadas por causa de
 * uma correção de placar na fase de grupos.
 */
export async function seedKnockoutFromGroups(
  tournamentId: string,
): Promise<{ error?: string; created?: number }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const adminClient = createAdminClient()
  // Sem exigir admin de propósito: a action roda sozinha quando um ALUNO
  // confirma o último placar da fase de grupos. O resultado é o mesmo em
  // qualquer mão — a chave é derivada dos jogos já confirmados, e a action é
  // idempotente e limitada à academia do usuário pelo orgId abaixo.
  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  const { data: tournament } = await adminClient
    .from('tournaments')
    .select('id, format, group_count, advance_per_group, sets_to_win, games_per_set, tiebreak_games')
    .eq('id', tournamentId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!tournament) return { error: 'Torneio não encontrado.' }
  if (!hasGroupStage(tournament.format as string)) {
    return { error: 'Este torneio não tem fase de grupos.' }
  }

  const { data: matchRows } = await adminClient
    .from('tournament_matches')
    .select('round, match_no, group_label, player1_id, partner1_id, player2_id, partner2_id, games1, games2, result_status')
    .eq('tournament_id', tournamentId)
    .eq('organization_id', orgId)

  const matches = (matchRows ?? []).map((m) => ({
    player1_id: m.player1_id as string | null,
    partner1_id: m.partner1_id as string | null,
    player2_id: m.player2_id as string | null,
    partner2_id: m.partner2_id as string | null,
    games1: (m.games1 as number | null) ?? 0,
    games2: (m.games2 as number | null) ?? 0,
    result_status: m.result_status as 'pending' | 'confirmed' | null,
    round: m.round as number,
    group: m.group_label as string | null,
  }))

  if (matches.some((m) => !m.group)) return { created: 0 } // chave já existe
  if (!isGroupStageComplete(matches)) {
    return { error: 'Ainda faltam resultados na fase de grupos.' }
  }

  const { data: entryRows } = await adminClient
    .from('tournament_entries')
    .select('player_id, partner_id, seed')
    .eq('tournament_id', tournamentId)
    .eq('organization_id', orgId)
    .eq('entry_status', 'confirmed')

  type EntryDraw = { player_id: string; partner_id: string | null; seed: number | null }
  // A distribuição em grupos é posicional, então a ordem tem que ser a MESMA da
  // geração — senão as tabelas seriam lidas contra os grupos errados.
  const { seeded, unseeded } = splitBySeed((entryRows ?? []) as EntryDraw[])
  const entries = [...seeded, ...unseeded].map((e) => ({
    playerId: e.player_id,
    partnerId: e.partner_id,
  }))

  const groupCount = (tournament.group_count as number | null) ?? DEFAULT_GROUP_COUNT
  const advancePerGroup = (tournament.advance_per_group as number | null) ?? DEFAULT_ADVANCE_PER_GROUP
  const scoring: ScoringConfig = {
    sets_to_win: (tournament.sets_to_win as number) ?? 1,
    games_per_set: (tournament.games_per_set as number) ?? 6,
    tiebreak_games: (tournament.tiebreak_games as boolean) ?? true,
  }

  const tables = computeGroupTables(entries, matches, groupCount, scoring)
  const groupRounds = Math.max(...matches.map((m) => m.round))

  let plan
  try {
    plan = generateKnockoutFromGroups(tables, advancePerGroup, groupRounds)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erro ao montar o mata-mata.' }
  }
  if (plan.length === 0) return { error: 'Classificados insuficientes para o mata-mata.' }

  const rows = plan.flatMap((rp) =>
    rp.matches.map((m, i) => ({
      organization_id: orgId,
      tournament_id: tournamentId,
      round: rp.round,
      match_no: m.matchNo ?? i + 1,
      group_label: null,
      player1_id: m.p1,
      partner1_id: m.partner1,
      player2_id: m.p2,
      partner2_id: m.partner2,
    })),
  )

  const { error: insErr } = await adminClient.from('tournament_matches').insert(rows)
  if (insErr) return { error: 'Erro ao salvar o mata-mata. Tente novamente.' }

  revalidatePath(`/torneios/${tournamentId}`)
  revalidatePath(`/admin/torneios/${tournamentId}`)
  return { created: rows.length }
}

// ---------------------------------------------------------------------------
// afterResultConfirmed — o que acontece depois de todo placar confirmado
// ---------------------------------------------------------------------------

/**
 * Dois efeitos, ambos best-effort: promover o vencedor na chave e, num torneio
 * de grupos, montar o mata-mata se aquele foi o último jogo da primeira fase.
 *
 * Nenhum dos dois pode derrubar a confirmação do placar — o jogo aconteceu, e
 * o admin tem botão para refazer a chave se algo falhar aqui.
 */
async function afterResultConfirmed(
  adminClient: ReturnType<typeof createAdminClient>,
  matchId: string,
  orgId: string,
): Promise<void> {
  await advanceBracketWinner(adminClient, matchId, orgId)

  const { data: match } = await adminClient
    .from('tournament_matches')
    .select('tournament_id, group_label')
    .eq('id', matchId)
    .eq('organization_id', orgId)
    .maybeSingle()
  // Só o fim de um jogo de GRUPO pode fechar a primeira fase.
  if (!match?.group_label) return

  // A própria action confere se a fase acabou e se a chave já existe; aqui o
  // erro é esperado no caso comum (ainda falta jogo) e não vai para o usuário.
  await seedKnockoutFromGroups(match.tournament_id as string)
}

// ---------------------------------------------------------------------------
// advanceBracketWinner — promove o vencedor para a partida seguinte
// ---------------------------------------------------------------------------

/**
 * Sobe quem venceu para o lado que lhe cabe na rodada seguinte.
 *
 * Chamado depois de todo resultado CONFIRMADO. É best-effort de propósito: se
 * o avanço falhar, o placar já está gravado e o admin regenera ou corrige a
 * chave — derrubar a confirmação por causa disso seria pior, porque o jogo
 * aconteceu de qualquer jeito.
 *
 * Idempotente: gravar o mesmo vencedor duas vezes escreve o mesmo valor, e
 * corrigir um placar reescreve o slot com o novo vencedor.
 */
async function advanceBracketWinner(
  adminClient: ReturnType<typeof createAdminClient>,
  matchId: string,
  orgId: string,
): Promise<void> {
  const { data: match } = await adminClient
    .from('tournament_matches')
    .select('id, tournament_id, round, match_no, group_label, player1_id, partner1_id, player2_id, partner2_id, games1, games2')
    .eq('id', matchId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!match || match.match_no === null) return
  // Partida de fase de grupos não promove ninguém: quem passa sai da TABELA do
  // grupo no fim da fase, não de um confronto direto.
  if (match.group_label) return

  const { data: tournament } = await adminClient
    .from('tournaments')
    .select('format')
    .eq('id', match.tournament_id)
    .maybeSingle()
  if (!tournament || !isBracketFormat(tournament.format as string)) return

  const games1 = match.games1 as number | null
  const games2 = match.games2 as number | null
  if (games1 === null || games2 === null || games1 === games2) return // empate não classifica

  // A última rodada da chave é a final. Vem do próprio torneio em vez de ser
  // recalculada do número de inscritos, que muda com desistência.
  const { data: lastRow } = await adminClient
    .from('tournament_matches')
    .select('round')
    .eq('tournament_id', match.tournament_id)
    .order('round', { ascending: false })
    .limit(1)
    .maybeSingle()
  const totalRounds = (lastRow?.round as number | undefined) ?? match.round
  const dest = winnerSlot(match.round as number, match.match_no as number, totalRounds)
  if (!dest) return // campeão: não há para onde subir

  const winnerIsSide1 = games1 > games2
  const playerId = winnerIsSide1 ? match.player1_id : match.player2_id
  const partnerId = winnerIsSide1 ? match.partner1_id : match.partner2_id
  if (!playerId) return

  const patch =
    dest.slot === 1
      ? { player1_id: playerId, partner1_id: partnerId }
      : { player2_id: playerId, partner2_id: partnerId }

  await adminClient
    .from('tournament_matches')
    .update(patch)
    .eq('tournament_id', match.tournament_id)
    .eq('round', dest.round)
    .eq('match_no', dest.matchNo)
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

  await afterResultConfirmed(adminClient, matchId, orgId)
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

  await afterResultConfirmed(adminClient, matchId, orgId)
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

  // Busca dados do entry antes de deletar (para reversal de desconto). Casa
  // player_id OU partner_id: quem entrou como parceiro de dupla fixa não
  // conseguia cancelar a própria inscrição (só o titular era encontrado).
  const { data: deletedEntry } = await adminClient
    .from('tournament_entries')
    .select('id, player_id, partner_id, final_price_cents, partner_final_price_cents, created_at')
    .eq('tournament_id', tournamentId)
    .eq('organization_id', orgId)
    .or(`player_id.eq.${target},partner_id.eq.${target}`)
    .maybeSingle()

  if (!deletedEntry) return { error: 'Inscrição não encontrada.' }

  const { error: delErr } = await adminClient
    .from('tournament_entries')
    .delete()
    .eq('id', deletedEntry.id as string)
  if (delErr) return { error: 'Erro ao cancelar inscrição. Tente novamente.' }

  // Reversal de desconto para os DOIS lados: cancelar uma dupla libera semana
  // para o titular e, se houve parceiro cobrado, para o parceiro também.
  const referenceDate = new Date(deletedEntry.created_at as string)
  if ((deletedEntry.final_price_cents as number) > 0) {
    await reversePersonWeeklyDiscount(adminClient, deletedEntry.player_id as string, orgId, referenceDate)
  }
  if (deletedEntry.partner_id && (deletedEntry.partner_final_price_cents as number) > 0) {
    await reversePersonWeeklyDiscount(adminClient, deletedEntry.partner_id as string, orgId, referenceDate)
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
    .select('id, tournament_id, player_id, partner_id, payment_status, final_price_cents, partner_final_price_cents, created_at')
    .eq('id', entryId)
    .eq('organization_id', orgId)
    .single()
  if (!entry) return { error: 'Inscrição não encontrada.' }

  // Só faz sentido cancelar pagamento pendente
  if (entry.payment_status !== 'pending') {
    return { error: 'Só é possível cancelar inscrições com pagamento pendente.' }
  }

  const tournamentId = entry.tournament_id as string
  const referenceDate = new Date(entry.created_at as string)

  // Deletar entry primeiro: a reversal (abaixo) recalcula a partir do que
  // SOBRA na semana, então precisa rodar depois que esta linha já saiu.
  const { error: delErr } = await adminClient
    .from('tournament_entries')
    .delete()
    .eq('id', entryId)
    .eq('organization_id', orgId)
  if (delErr) return { error: 'Erro ao cancelar inscrição. Tente novamente.' }

  // Reversal de desconto para os DOIS lados — a linha saiu da semana tanto do
  // titular quanto do parceiro (se houve).
  if ((entry.final_price_cents as number) > 0) {
    await reversePersonWeeklyDiscount(adminClient, entry.player_id as string, orgId, referenceDate)
  }
  if (entry.partner_id && (entry.partner_final_price_cents as number) > 0) {
    await reversePersonWeeklyDiscount(adminClient, entry.partner_id as string, orgId, referenceDate)
  }

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
    .select('id, partner_id, offer_expires_at, payment_status, created_at')
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
  let partnerPaymentStatus: 'free' | 'pending' | null = entry.partner_id ? 'free' : null
  let partnerFinalPriceCents = 0
  let partnerDiscountPct = 0

  if (isPaid) {
    const paymentFields = await computePersonPayment(
      adminClient,
      user.id,
      tournament.organization_id as string,
      tournament.entry_price_cents as number | null,
      tournament.pix_key as string | null,
    )
    paymentStatus = paymentFields.payment_status
    finalPriceCents = paymentFields.final_price_cents
    discountPct = paymentFields.discount_pct

    if (entry.partner_id) {
      const partnerFields = await computePersonPayment(
        adminClient,
        entry.partner_id as string,
        tournament.organization_id as string,
        tournament.entry_price_cents as number | null,
        tournament.pix_key as string | null,
      )
      partnerPaymentStatus = partnerFields.payment_status
      partnerFinalPriceCents = partnerFields.final_price_cents
      partnerDiscountPct = partnerFields.discount_pct
    }
  }

  const { error: updateErr } = await adminClient
    .from('tournament_entries')
    .update({
      entry_status: 'confirmed',
      offer_expires_at: null,
      payment_status: paymentStatus,
      final_price_cents: finalPriceCents,
      discount_pct: discountPct,
      partner_payment_status: partnerPaymentStatus,
      partner_final_price_cents: partnerFinalPriceCents,
      partner_discount_pct: partnerDiscountPct,
    })
    .eq('id', entry.id)

  if (updateErr) return { error: 'Erro ao confirmar inscrição. Tente novamente.' }

  await awardTournamentEntry(adminClient, {
    orgId: tournament.organization_id as string,
    tournamentId,
    studentId: user.id,
  })
  if (entry.partner_id) {
    await awardTournamentEntry(adminClient, {
      orgId: tournament.organization_id as string,
      tournamentId,
      studentId: entry.partner_id as string,
    })
  }

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

  await syncTournamentResultPoints(adminClient, { orgId, tournamentId })

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

  const { data: before } = await adminClient
    .from('tournaments')
    .select('winner1_id, winner1_partner_id, winner2_id, winner2_partner_id, winner3_id, winner3_partner_id')
    .eq('id', tournamentId)
    .eq('organization_id', orgId)
    .maybeSingle()
  const previousWinnerIds = Object.values(before ?? {}).filter(
    (v): v is string => typeof v === 'string',
  )

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

  await syncTournamentResultPoints(adminClient, { orgId, tournamentId, previousWinnerIds })

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
    .select(
      'id, organization_id, status, participant_type, allowed_pair_genders, entry_price_cents, pix_key, max_players, registration_deadline',
    )
    .eq('id', tournamentId)
    .single()
  if (!tournament) return { error: 'Torneio não encontrado.' }
  const regWindow = resolveRegistrationWindow(
    { status: tournament.status as TournamentStatus, registration_deadline: tournament.registration_deadline as string | null },
    new Date(),
  )
  if (!regWindow.open) return { error: regWindow.reason ?? 'Inscrições encerradas.' }

  // Dupla fixa exige escolher parceiro, e o link público ainda não tem essa
  // tela — sem esta trava, o link coletava inscrição solteira num torneio que
  // precisa de dupla, sem aviso nenhum.
  if (tournament.participant_type === 'dupla_fixa') {
    return { error: 'Este torneio é de dupla fixa: entre no app para escolher o parceiro.' }
  }

  const tournamentOrgId = tournament.organization_id as string

  // Vincula o jogador à academia do torneio como ATLETA, não como aluno: ele
  // precisa da membership para a RLS liberar a leitura do torneio e da chave
  // (auth_org_ids), mas não tem plano nem entra na chamada — e por isso não
  // aparece na lista de alunos do professor, que filtra role = 'student'.
  //
  // Idempotente e não-destrutivo: `ignoreDuplicates` garante que quem JÁ é aluno
  // (ou admin) daquela academia não seja rebaixado a atleta ao se inscrever.
  await adminClient
    .from('memberships')
    .upsert(
      { user_id: user.id, organization_id: tournamentOrgId, role: 'athlete' },
      { onConflict: 'user_id,organization_id', ignoreDuplicates: true },
    )

  // Gênero: hoje registerExternal não conferia nada — um torneio 'masculino'
  // aceitava qualquer inscrição avulsa, sem olhar profiles.gender.
  const { data: profile } = await adminClient
    .from('profiles')
    .select('gender')
    .eq('id', user.id)
    .single()
  const myGender = (profile?.gender ?? null) as Gender | null
  const allowedPairGenders = canonicalizePairGenders(
    (tournament.allowed_pair_genders as string[] | null) ?? [],
  )
  const verdict = validateEntry({
    participantType: tournament.participant_type as ParticipantType,
    allowed: allowedPairGenders,
    myGender,
  })
  if (!verdict.ok) return { error: verdict.reason ?? 'Inscrição não permitida nesta categoria.' }

  // Checar duplicidade nos dois lados — o mesmo cuidado de registerForTournament:
  // esta pessoa pode já ter sido escrita como partner_id em outra inscrição.
  const { data: existingRaw } = await adminClient
    .from('tournament_entries')
    .select('player_id, partner_id')
    .eq('tournament_id', tournamentId)
    .or(`player_id.eq.${user.id},partner_id.eq.${user.id}`)
  const existing = (existingRaw ?? []) as { player_id: string; partner_id: string | null }[]
  const clash = findEntrantClash(existing, [{ id: user.id }], user.id)
  if (clash) return { error: clashMessage(clash) }

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
      organization_id: tournamentOrgId,
      tournament_id: tournamentId,
      player_id: user.id,
      partner_id: null,
      entry_status: 'waitlist',
      payment_status: 'free',
      discount_pct: 0,
      final_price_cents: 0,
    }
  } else {
    const paymentFields = await computePersonPayment(
      adminClient,
      user.id,
      tournamentOrgId,
      (tournament.entry_price_cents as number | null),
      (tournament.pix_key as string | null),
    )
    insertPayload = {
      organization_id: tournamentOrgId,
      tournament_id: tournamentId,
      player_id: user.id,
      partner_id: null,
      entry_status: 'confirmed',
      payment_status: paymentFields.payment_status,
      discount_pct: paymentFields.discount_pct,
      final_price_cents: paymentFields.final_price_cents,
    }
  }

  const { data: insertedEntry, error: insertErr } = await adminClient
    .from('tournament_entries')
    .insert(insertPayload)
    .select('id')
    .single()
  if (insertErr || !insertedEntry) return { error: 'Erro ao realizar inscrição. Tente novamente.' }

  if (entryStatus === 'confirmed' && insertPayload.payment_status === 'pending') {
    try {
      await ensureEntryPaymentToken(adminClient, {
        orgId: tournamentOrgId, tournamentId, entryId: insertedEntry.id as string, side: 'player',
      })
    } catch (e) {
      console.error('[registerExternal] falha ao gerar link de pagamento', e)
    }
  }

  revalidatePath(`/t/${tournamentId}`)
  revalidatePath(`/admin/torneios/${tournamentId}`)
  return {}
}

// ---------------------------------------------------------------------------
// confirmEntryPayment — admin confirma recebimento do PIX
// ---------------------------------------------------------------------------

export async function confirmEntryPayment(
  entryId: string,
  side: 'player' | 'partner' = 'player',
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
    .select('id, tournament_id, partner_id, payment_status, partner_payment_status')
    .eq('id', entryId)
    .eq('organization_id', orgId)
    .single()
  if (entryErr || !entry) return { error: 'Inscrição não encontrada.' }

  if (side === 'partner') {
    if (!entry.partner_id) return { error: 'Esta inscrição não tem parceiro.' }
    if (entry.partner_payment_status !== 'pending') {
      return { error: 'Esta inscrição não está aguardando pagamento.' }
    }
    const { error: updateErr } = await adminClient
      .from('tournament_entries')
      .update({ partner_payment_status: 'paid' })
      .eq('id', entryId)
    if (updateErr) return { error: 'Erro ao confirmar pagamento. Tente novamente.' }
  } else {
    if (entry.payment_status !== 'pending') {
      return { error: 'Esta inscrição não está aguardando pagamento.' }
    }
    const { error: updateErr } = await adminClient
      .from('tournament_entries')
      .update({ payment_status: 'paid' })
      .eq('id', entryId)
    if (updateErr) return { error: 'Erro ao confirmar pagamento. Tente novamente.' }
  }

  revalidatePath(`/admin/torneios/${entry.tournament_id as string}`)
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

// ---------------------------------------------------------------------------
// scheduleMatch — admin OU qualquer jogador do confronto (last-write-wins)
// ---------------------------------------------------------------------------

export async function scheduleMatch(
  matchId: string,
  playedAtIso: string | null,
): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const adminClient = createAdminClient()
  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  const { data: match, error: mErr } = await adminClient
    .from('tournament_matches')
    .select('id, tournament_id, player1_id, partner1_id, player2_id, partner2_id, reported_by')
    .eq('id', matchId)
    .eq('organization_id', orgId)
    .single()
  if (mErr || !match) return { error: 'Confronto não encontrado.' }

  const { data: membership } = await adminClient
    .from('memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .single()
  const isAdmin = membership?.role === 'admin'

  if (!isAdmin && !canReportResult(user.id, match as EligibilityMatch)) {
    return { error: 'Sem permissão para marcar este confronto.' }
  }

  if (playedAtIso !== null) {
    const d = new Date(playedAtIso)
    if (Number.isNaN(d.getTime())) return { error: 'Data/hora inválida.' }
  }

  const { error: updErr } = await adminClient
    .from('tournament_matches')
    .update({ played_at: playedAtIso })
    .eq('id', matchId)
    .eq('organization_id', orgId)
  if (updErr) return { error: 'Erro ao salvar a data/hora. Tente novamente.' }

  revalidatePath(`/torneios/${match.tournament_id}`)
  revalidatePath(`/admin/torneios/${match.tournament_id}`)
  revalidatePath('/home')
  return {}
}
