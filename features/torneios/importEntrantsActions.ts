'use server'
// features/torneios/importEntrantsActions.ts
// Trazer para este torneio gente que já se inscreveu em outro da arena.
//
// Nasceu do Super Tiebreak: a arena junta, depois de um campeonato (aberto ou
// já encerrado), uma turma de quem jogou e monta um torneio rápido com ela.
// Sem isto, cada pessoa tinha de ser inscrita de novo no "Inscrever
// participante", digitando nome e e-mail que o sistema já tinha.
//
// Cada pessoa entra pela mesma régua de qualquer inscrição: regra de gênero da
// categoria, vaga (decideNewEntryStatus: confirmada, lista de espera ou
// esgotado) e cobrança (computePersonPayment). Quem não passa é devolvido com o
// motivo, em vez de a importação inteira falhar por uma pessoa.
import { revalidatePath } from 'next/cache'
import { createAdminClient, getStaffContext } from '@/lib/supabase/server'
import { chunk, fetchAllPages, IN_CHUNK_SIZE } from '@/lib/supabase/paginate'
import { canEnter, canonicalizePairGenders } from '@/lib/torneios/pairRules'
import { awardTournamentEntry } from '@/features/liga/tournamentPoints'
import { computePersonPayment } from './actions'
import { ensureEntryPaymentToken } from './entryPaymentActions'
import { decideNewEntryStatus } from './waitlistPromotion'
import type { Gender, PairGenders } from '@/types'

type AdminClient = ReturnType<typeof createAdminClient>

export interface ImportSourceTournament {
  id: string
  name: string
  date: string | null
  status: string
}

export interface ImportCandidate {
  id: string
  name: string
  /** Torneios de onde a pessoa pode vir (para o filtro por torneio). */
  tournamentIds: string[]
}

export interface ImportCandidatesResult {
  error?: string
  tournaments?: ImportSourceTournament[]
  people?: ImportCandidate[]
}

interface TournamentRow {
  id: string
  name: string
  organization_id: string
  status: string
  participant_type: string
  allowed_pair_genders: PairGenders[] | null
  max_players: number | null
  entry_price_cents: number | null
  pix_key: string | null
}

async function requireAdminTournament(
  tournamentId: string,
): Promise<{ admin: AdminClient; orgId: string; tournament: TournamentRow } | { error: string }> {
  const ctx = await getStaffContext()
  if (!ctx) return { error: 'Não autenticado.' }
  const admin = createAdminClient()
  const { data: membership } = await admin
    .from('memberships')
    .select('role')
    .eq('user_id', ctx.userId)
    .eq('organization_id', ctx.organizationId)
    .maybeSingle()
  if (membership?.role !== 'admin') return { error: 'Só o administrador da arena pode fazer isso.' }

  const { data } = await admin
    .from('tournaments')
    .select('id, name, organization_id, status, participant_type, allowed_pair_genders, max_players, entry_price_cents, pix_key')
    .eq('id', tournamentId)
    .eq('organization_id', ctx.organizationId)
    .maybeSingle()
  if (!data) return { error: 'Torneio não encontrado.' }
  return { admin, orgId: ctx.organizationId, tournament: data as TournamentRow }
}

/** Quem se inscreveu (confirmado) em OUTROS torneios da arena e ainda não está neste. */
export async function listImportCandidates(tournamentId: string): Promise<ImportCandidatesResult> {
  const ctx = await requireAdminTournament(tournamentId)
  if ('error' in ctx) return ctx
  const { admin, orgId } = ctx

  const { data: tournamentsRaw } = await admin
    .from('tournaments')
    .select('id, name, date, status')
    .eq('organization_id', orgId)
    .neq('id', tournamentId)
    .order('date', { ascending: false })
  const tournaments = (tournamentsRaw ?? []) as ImportSourceTournament[]

  // Cresce com a vida da arena (todo inscrito de todo torneio): paginado.
  const entries = await fetchAllPages<{ id: string; tournament_id: string; player_id: string; partner_id: string | null }>(
    (from, to) =>
      admin
        .from('tournament_entries')
        .select('id, tournament_id, player_id, partner_id')
        .eq('organization_id', orgId)
        .eq('entry_status', 'confirmed')
        .order('id', { ascending: true })
        .range(from, to),
    { label: 'torneios/importCandidates' },
  )

  const inThis = new Set<string>()
  const sources = new Map<string, Set<string>>()
  for (const e of entries) {
    for (const person of [e.player_id, e.partner_id]) {
      if (!person) continue
      if (e.tournament_id === tournamentId) {
        inThis.add(person)
        continue
      }
      if (!sources.has(person)) sources.set(person, new Set())
      sources.get(person)!.add(e.tournament_id)
    }
  }
  // Na fila deste torneio também conta como "já está aqui".
  const { data: waitingRaw } = await admin
    .from('tournament_entries')
    .select('player_id, partner_id')
    .eq('tournament_id', tournamentId)
    .neq('entry_status', 'confirmed')
  for (const w of (waitingRaw ?? []) as { player_id: string; partner_id: string | null }[]) {
    inThis.add(w.player_id)
    if (w.partner_id) inThis.add(w.partner_id)
  }

  const ids = Array.from(sources.keys()).filter((id) => !inThis.has(id))
  const names = new Map<string, string>()
  for (const part of chunk(ids, IN_CHUNK_SIZE)) {
    const { data } = await admin.from('profiles').select('id, full_name').in('id', part)
    for (const p of (data ?? []) as { id: string; full_name: string | null }[]) {
      names.set(p.id, p.full_name?.trim() || 'Sem nome')
    }
  }

  const people = ids
    .filter((id) => names.has(id))
    .map((id) => ({ id, name: names.get(id)!, tournamentIds: Array.from(sources.get(id)!) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))

  return { tournaments, people }
}

export interface ImportResult {
  error?: string
  confirmed?: number
  waitlisted?: number
  skipped?: { name: string; reason: string }[]
}

export async function addEntrantsFromOtherTournaments(
  tournamentId: string,
  personIds: string[],
): Promise<ImportResult> {
  const ctx = await requireAdminTournament(tournamentId)
  if ('error' in ctx) return ctx
  const { admin, orgId, tournament } = ctx

  if (tournament.status !== 'draft' && tournament.status !== 'open') {
    return { error: 'A chave deste torneio já foi gerada. Desfaça a chave antes de incluir mais gente.' }
  }
  if (tournament.participant_type === 'dupla_fixa') {
    return { error: 'Em dupla fixa a inscrição é da dupla. Use "Inscrever participante" para montar cada dupla.' }
  }
  const unique = Array.from(new Set(personIds)).slice(0, 64)
  if (unique.length === 0) return { error: 'Selecione pelo menos uma pessoa.' }

  const { data: profilesRaw } = await admin.from('profiles').select('id, full_name, gender').in('id', unique)
  const profiles = new Map(
    ((profilesRaw ?? []) as { id: string; full_name: string | null; gender: Gender | null }[]).map((p) => [p.id, p]),
  )

  const { data: existingRaw } = await admin
    .from('tournament_entries')
    .select('player_id, partner_id')
    .eq('tournament_id', tournament.id)
  const already = new Set(
    ((existingRaw ?? []) as { player_id: string; partner_id: string | null }[]).flatMap((e) => [e.player_id, e.partner_id]),
  )

  const allowed = canonicalizePairGenders(tournament.allowed_pair_genders ?? [])
  const skipped: { name: string; reason: string }[] = []
  let confirmed = 0
  let waitlisted = 0
  let soldOut = false

  for (const id of unique) {
    const profile = profiles.get(id)
    const name = profile?.full_name?.trim() || 'Sem nome'
    if (!profile) { skipped.push({ name, reason: 'cadastro não encontrado' }); continue }
    if (already.has(id)) { skipped.push({ name, reason: 'já está neste torneio' }); continue }
    if (soldOut) { skipped.push({ name, reason: 'vagas esgotadas' }); continue }
    const verdict = canEnter(profile.gender, allowed)
    if (!verdict.ok) { skipped.push({ name, reason: verdict.reason ?? 'regra de gênero da categoria' }); continue }

    const status = await decideNewEntryStatus(admin, tournament.id, tournament.max_players)
    if (status === 'full') {
      soldOut = true
      skipped.push({ name, reason: 'vagas esgotadas' })
      continue
    }

    const pay = status === 'confirmed'
      ? await computePersonPayment(admin, id, orgId, tournament.entry_price_cents, tournament.pix_key)
      : { payment_status: 'free' as const, discount_pct: 0, final_price_cents: 0 }

    const { data: inserted, error } = await admin
      .from('tournament_entries')
      .insert({
        organization_id: orgId,
        tournament_id: tournament.id,
        player_id: id,
        partner_id: null,
        entry_status: status,
        payment_status: pay.payment_status,
        discount_pct: pay.discount_pct,
        final_price_cents: pay.final_price_cents,
      })
      .select('id')
      .single()
    if (error || !inserted) {
      skipped.push({ name, reason: error?.code === '23505' ? 'já está neste torneio' : 'erro ao inscrever' })
      continue
    }
    already.add(id)

    // Quem vem de outro torneio já é da arena; o upsert só cobre cadastro antigo
    // sem vínculo, sem rebaixar quem é aluno ou admin.
    await admin
      .from('memberships')
      .upsert(
        { user_id: id, organization_id: orgId, role: 'athlete' },
        { onConflict: 'user_id,organization_id', ignoreDuplicates: true },
      )

    if (status === 'confirmed') {
      confirmed++
      await awardTournamentEntry(admin, { orgId, tournamentId: tournament.id, studentId: id })
      if (pay.payment_status === 'pending') {
        try {
          await ensureEntryPaymentToken(admin, {
            orgId, tournamentId: tournament.id, entryId: (inserted as { id: string }).id, side: 'player',
          })
        } catch (e) {
          console.error('[addEntrantsFromOtherTournaments] falha ao gerar link de pagamento', e)
        }
      }
    } else {
      waitlisted++
    }
  }

  revalidatePath(`/admin/torneios/${tournament.id}`)
  revalidatePath(`/t/${tournament.id}`)
  revalidatePath(`/torneios/${tournament.id}`)
  return { confirmed, waitlisted, skipped }
}
