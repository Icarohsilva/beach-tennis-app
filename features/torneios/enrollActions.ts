'use server'
// features/torneios/enrollActions.ts
// Inscrição feita PELO organizador, no balcão.
//
// A inscrição do app pressupõe que a pessoa tem conta e se inscreve sozinha —
// e registerExternal() (o link público sem login) recusa de propósito qualquer
// torneio de dupla fixa ("entre no app para escolher o parceiro"), porque quem
// chega por ali ainda não tem conta para aparecer como candidato a parceiro.
// No torneio de rua isso não é opcional: metade das duplas chega pelo
// Instagram, manda os dois nomes no WhatsApp e paga por PIX na hora — não tem
// "entrar no app" antes de existir conta. Esta action cobre esse buraco: o
// organizador digita os dados de quem quer que seja (titular, e o parceiro
// quando o torneio é de dupla fixa), a conta nasce junto com a inscrição, e a
// mensagem de acesso sai pronta para mandar por WhatsApp.
//
// A validação (regra de gênero, duplicidade, janela de inscrição, cobrança por
// atleta) é a MESMA de registerForTournament/registerExternal — só a origem dos
// dois lados muda (perfil já existente vs. nome+e-mail digitados agora).
import { revalidatePath } from 'next/cache'
import { createAdminClient, getStaffContext } from '@/lib/supabase/server'
import { generateTempPassword } from '@/lib/auth/tempPassword'
import { availableSlots } from '@/lib/torneios/waitlist'
import { normalizeSportsForOrg } from '@/lib/arenas/sports'
import { canonicalizePairGenders, validateEntry } from '@/lib/torneios/pairRules'
import { findEntrantClash, clashMessage, selfPairError } from '@/lib/torneios/entryDuplicates'
import { getSiteUrl } from '@/lib/utils/siteUrl'
import { computePersonPayment } from './actions'
import { ensureEntryPaymentToken } from './entryPaymentActions'
import type { Gender, ParticipantType } from '@/types'

export interface EnrollPersonInput {
  fullName: string
  email: string
  phone?: string
  /** Identidade — o que valida a formação da dupla (canPairUp exige os dois lados). */
  gender?: Gender | null
}

export interface EnrollEntryInput {
  tournamentId: string
  player: EnrollPersonInput
  /** Obrigatório quando o torneio é dupla fixa; ignorado nos outros formatos. */
  partner?: EnrollPersonInput
}

export interface EnrolledPerson {
  id: string
  name: string
  email: string
  phone: string | null
  /** Senha provisória — ausente quando a conta já existia. */
  password?: string
  /** Preenchido quando esta pessoa ficou com pagamento pendente. */
  pendingAmountCents?: number
  paymentUrl?: string
}

export interface EnrollEntryResult {
  error?: string
  entryStatus?: 'confirmed' | 'waitlist'
  player?: EnrolledPerson
  partner?: EnrolledPerson
}

type AdminClient = ReturnType<typeof createAdminClient>

/** Só quem é admin DA academia do torneio inscreve por fora. */
async function requireTournamentAdmin(tournamentId: string) {
  const ctx = await getStaffContext()
  if (!ctx) return { error: 'Não autenticado.' as const }

  const admin = createAdminClient()
  const { data: tournament } = await admin
    .from('tournaments')
    .select(
      'id, name, organization_id, status, category, participant_type, allowed_pair_genders, entry_price_cents, pix_key, max_players',
    )
    .eq('id', tournamentId)
    .maybeSingle()
  if (!tournament) return { error: 'Torneio não encontrado.' as const }

  // A academia ATIVA precisa ser a dona do torneio: sem isso, um admin de outra
  // arena inscreveria gente na chave alheia com um id copiado.
  if (tournament.organization_id !== ctx.organizationId) {
    return { error: 'Este torneio é de outra academia.' as const }
  }

  const { data: membership } = await admin
    .from('memberships')
    .select('role')
    .eq('user_id', ctx.userId)
    .eq('organization_id', ctx.organizationId)
    .maybeSingle()
  if (membership?.role !== 'admin') return { error: 'Apenas o staff inscreve participantes.' as const }

  // A chave já foi sorteada (in_progress) ou o torneio acabou: inserir uma
  // inscrição avulsa aqui ficaria de fora da chave e da classificação — o
  // mesmo limite que PairFixControls aplica ao conserto de dupla.
  if (tournament.status === 'in_progress' || tournament.status === 'finished') {
    return { error: 'Não é possível inscrever depois que a chave foi gerada.' as const }
  }

  return { admin, ctx, tournament }
}

type PersonResult = { ok: true; person: EnrolledPerson } | { ok: false; error: string }

/**
 * Acha o perfil pelo e-mail, ou cria a conta (atleta, senha provisória).
 *
 * O e-mail mora no Auth, não em `profiles`, e não há endpoint de busca por
 * e-mail — então varremos as páginas do listUsers. Aceitável porque roda por
 * pessoa inscrita na mão, não em laço sobre uma lista grande.
 */
async function resolveOrCreatePerson(
  admin: AdminClient,
  input: EnrollPersonInput,
  org: { invite_code: string; sports: string[] },
  orgId: string,
): Promise<PersonResult> {
  const fullName = input.fullName.trim()
  const email = input.email.trim().toLowerCase()
  const phone = input.phone?.trim() ?? ''
  if (!fullName) return { ok: false, error: 'Informe o nome completo.' }
  if (!email) return { ok: false, error: 'Informe o e-mail — é o login no app.' }

  const existing = await findProfileByEmail(admin, email)

  let personId: string
  let password: string | undefined

  if (existing) {
    personId = existing.id
    // Nome e telefone que o organizador digitou só entram se o cadastro estava
    // vazio: sobrescrever apagaria o que a própria pessoa preencheu.
    const patch: Record<string, string> = {}
    if (!existing.full_name?.trim() && fullName) patch.full_name = fullName
    if (!existing.phone?.trim() && phone) patch.phone = phone
    if (Object.keys(patch).length > 0) {
      await admin.from('profiles').update(patch).eq('id', personId)
    }
  } else {
    password = generateTempPassword()
    const sports = normalizeSportsForOrg([], org.sports ?? [])
    const { data: created, error: userErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        org_invite_code: org.invite_code,
        must_change_password: true,
        ...(phone ? { phone } : {}),
        ...(sports.length > 0 ? { sports: sports.join(',') } : {}),
      },
    })
    if (userErr || !created?.user) {
      const msg = userErr?.message?.toLowerCase().includes('already')
        ? `Já existe uma conta com o e-mail ${email}, mas não foi possível lê-la. Tente de novo.`
        : `Não foi possível criar o acesso de ${fullName}.`
      return { ok: false, error: msg }
    }
    personId = created.user.id
  }

  if (input.gender === 'M' || input.gender === 'F') {
    await admin.from('profiles').update({ gender: input.gender }).eq('id', personId)
  }

  // Vínculo com a academia como ATLETA — quem joga um torneio não virou aluno,
  // e misturar os dois enche a lista de alunos do professor de gente que ele
  // nunca vai dar aula. `ignoreDuplicates` não rebaixa quem já é aluno/admin.
  await admin
    .from('memberships')
    .upsert(
      { user_id: personId, organization_id: orgId, role: 'athlete' },
      { onConflict: 'user_id,organization_id', ignoreDuplicates: true },
    )
  // Conta nova entra como aluno pelo handle_new_user(); rebaixa para atleta.
  if (!existing) {
    await admin
      .from('memberships')
      .update({ role: 'athlete' })
      .eq('user_id', personId)
      .eq('organization_id', orgId)
      .eq('role', 'student')
  }

  return {
    ok: true,
    person: {
      id: personId,
      name: fullName || existing?.full_name || '',
      email,
      phone: phone || existing?.phone || null,
      password,
    },
  }
}

/**
 * Inscreve um participante (ou uma dupla, em torneio de dupla fixa) que veio
 * de fora do app — nome, e-mail e telefone digitados pelo organizador.
 */
export async function enrollExternalEntry(input: EnrollEntryInput): Promise<EnrollEntryResult> {
  const guard = await requireTournamentAdmin(input.tournamentId)
  if ('error' in guard) return { error: guard.error }
  const { admin, tournament } = guard

  const isDuplaFixa = tournament.participant_type === 'dupla_fixa'
  if (isDuplaFixa && (!input.partner?.fullName?.trim() || !input.partner?.email?.trim())) {
    return { error: 'Dupla fixa exige os dados dos dois jogadores.' }
  }

  const orgId = tournament.organization_id as string
  const { data: orgRow } = await admin
    .from('organizations')
    .select('invite_code, sports')
    .eq('id', orgId)
    .single()
  if (!orgRow) return { error: 'Academia não encontrada.' }
  const org = orgRow as { invite_code: string; sports: string[] }

  const playerResult = await resolveOrCreatePerson(admin, input.player, org, orgId)
  if (!playerResult.ok) return { error: playerResult.error }
  const player = playerResult.person

  let partner: EnrolledPerson | undefined
  if (isDuplaFixa && input.partner) {
    const partnerResult = await resolveOrCreatePerson(admin, input.partner, org, orgId)
    if (!partnerResult.ok) return { error: partnerResult.error }
    partner = partnerResult.person
  }

  const selfErr = selfPairError(player.id, partner?.id)
  if (selfErr) return { error: selfErr }

  // Mesma régua de registerForTournament: canPairUp (dupla fixa) exige os dois
  // gêneros conhecidos mesmo sem restrição de formação — é o que identifica a
  // formação MM/MF/FF a validar contra allowed_pair_genders.
  const allowedPairGenders = canonicalizePairGenders(
    (tournament.allowed_pair_genders as string[] | null) ?? [],
  )
  const verdict = validateEntry({
    participantType: tournament.participant_type as ParticipantType,
    allowed: allowedPairGenders,
    myGender: input.player.gender ?? null,
    partnerGender: isDuplaFixa ? (input.partner?.gender ?? null) : undefined,
  })
  if (!verdict.ok) return { error: verdict.reason ?? 'Inscrição não permitida nesta categoria.' }

  // Duplicidade nos dois lados — mesmo cuidado de registerForTournament: a
  // pessoa pode já estar como partner_id de outra inscrição.
  const people = partner ? [player, partner] : [player]
  const ids = people.map((p) => p.id)
  const orFilter = ids.flatMap((id) => [`player_id.eq.${id}`, `partner_id.eq.${id}`]).join(',')
  const { data: existingRaw } = await admin
    .from('tournament_entries')
    .select('player_id, partner_id')
    .eq('tournament_id', input.tournamentId)
    .or(orFilter)
  const existingEntries = (existingRaw ?? []) as { player_id: string; partner_id: string | null }[]
  const clash = findEntrantClash(
    existingEntries,
    people.map((p) => ({ id: p.id, name: p.name })),
    player.id,
  )
  if (clash) return { error: clashMessage(clash) }

  const { count: occupied } = await admin
    .from('tournament_entries')
    .select('id', { count: 'exact', head: true })
    .eq('tournament_id', input.tournamentId)
    .in('entry_status', ['confirmed', 'offered'])

  const slots = availableSlots(occupied ?? 0, tournament.max_players as number | null)
  const entryStatus: 'confirmed' | 'waitlist' = slots > 0 ? 'confirmed' : 'waitlist'

  // Dupla fixa é cobrada por atleta: cada um paga a própria parte, no próprio
  // degrau de desconto semanal — mesma regra de registerForTournament.
  let insertPayload: Record<string, unknown>
  if (entryStatus === 'waitlist') {
    insertPayload = {
      organization_id: orgId,
      tournament_id: input.tournamentId,
      player_id: player.id,
      partner_id: partner?.id ?? null,
      entry_status: 'waitlist',
      payment_status: 'free',
      discount_pct: 0,
      final_price_cents: 0,
      partner_payment_status: partner ? 'free' : null,
      partner_discount_pct: 0,
      partner_final_price_cents: 0,
    }
  } else {
    const playerPayment = await computePersonPayment(
      admin,
      player.id,
      orgId,
      tournament.entry_price_cents as number | null,
      tournament.pix_key as string | null,
    )
    const partnerPayment = partner
      ? await computePersonPayment(
          admin,
          partner.id,
          orgId,
          tournament.entry_price_cents as number | null,
          tournament.pix_key as string | null,
        )
      : null
    insertPayload = {
      organization_id: orgId,
      tournament_id: input.tournamentId,
      player_id: player.id,
      partner_id: partner?.id ?? null,
      entry_status: 'confirmed',
      payment_status: playerPayment.payment_status,
      discount_pct: playerPayment.discount_pct,
      final_price_cents: playerPayment.final_price_cents,
      partner_payment_status: partnerPayment?.payment_status ?? (partner ? 'free' : null),
      partner_discount_pct: partnerPayment?.discount_pct ?? 0,
      partner_final_price_cents: partnerPayment?.final_price_cents ?? 0,
    }
  }

  const { data: insertedEntry, error: insertErr } = await admin
    .from('tournament_entries')
    .insert(insertPayload)
    .select('id')
    .single()
  if (insertErr || !insertedEntry) return { error: 'Erro ao inscrever. Tente novamente.' }
  const entryId = insertedEntry.id as string

  // Link pessoal de pagamento por lado — best-effort: uma falha aqui não pode
  // derrubar uma inscrição que já segurou a vaga.
  if (entryStatus === 'confirmed') {
    try {
      if (insertPayload.payment_status === 'pending') {
        const token = await ensureEntryPaymentToken(admin, {
          orgId, tournamentId: input.tournamentId, entryId, side: 'player',
        })
        if (token) {
          player.paymentUrl = `${getSiteUrl()}/p/${token}`
          player.pendingAmountCents = insertPayload.final_price_cents as number
        }
      }
      if (insertPayload.partner_payment_status === 'pending' && partner) {
        const token = await ensureEntryPaymentToken(admin, {
          orgId, tournamentId: input.tournamentId, entryId, side: 'partner',
        })
        if (token) {
          partner.paymentUrl = `${getSiteUrl()}/p/${token}`
          partner.pendingAmountCents = insertPayload.partner_final_price_cents as number
        }
      }
    } catch (e) {
      console.error('[enrollExternalEntry] falha ao gerar link de pagamento', e)
    }
  }

  revalidatePath(`/admin/torneios/${input.tournamentId}`)
  revalidatePath(`/t/${input.tournamentId}`)

  return { entryStatus, player, partner }
}

/**
 * Gera uma senha provisória nova para um participante já inscrito.
 *
 * É o "reenviar acesso": quem foi inscrito no balcão semanas atrás perdeu a
 * mensagem, e mandá-lo para "esqueci minha senha" depende de ele ter acesso ao
 * e-mail que o organizador digitou — o que muitas vezes não é verdade.
 */
export async function resetParticipantAccess(
  tournamentId: string,
  playerId: string,
): Promise<{ error?: string; password?: string; email?: string }> {
  const guard = await requireTournamentAdmin(tournamentId)
  if ('error' in guard) return { error: guard.error }
  const { admin } = guard

  // Só reseta a senha de quem está inscrito NESTE torneio (titular ou
  // parceiro): sem essa checagem a action viraria "trocar a senha de qualquer
  // usuário por id".
  const { count } = await admin
    .from('tournament_entries')
    .select('id', { count: 'exact', head: true })
    .eq('tournament_id', tournamentId)
    .or(`player_id.eq.${playerId},partner_id.eq.${playerId}`)
  if ((count ?? 0) === 0) return { error: 'Esta pessoa não está inscrita neste torneio.' }

  const { data: userRes } = await admin.auth.admin.getUserById(playerId)
  const authUser = userRes?.user
  const email = authUser?.email
  if (!authUser || !email) return { error: 'Este participante não tem e-mail de acesso.' }

  const password = generateTempPassword()
  const { error } = await admin.auth.admin.updateUserById(playerId, {
    password,
    user_metadata: { ...(authUser.user_metadata ?? {}), must_change_password: true },
  })
  if (error) return { error: 'Não foi possível redefinir a senha.' }

  return { password, email }
}

async function findProfileByEmail(
  admin: AdminClient,
  email: string,
): Promise<{ id: string; full_name: string | null; phone: string | null } | null> {
  const alvo = email.toLowerCase()
  const PER_PAGE = 1000
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PER_PAGE })
    if (error) return null
    const found = data.users.find((u) => (u.email ?? '').toLowerCase() === alvo)
    if (found) {
      const { data: profile } = await admin
        .from('profiles')
        .select('id, full_name, phone')
        .eq('id', found.id)
        .maybeSingle()
      return (
        (profile as { id: string; full_name: string | null; phone: string | null } | null) ?? {
          id: found.id,
          full_name: null,
          phone: null,
        }
      )
    }
    if (data.users.length < PER_PAGE) return null
  }
  return null
}
