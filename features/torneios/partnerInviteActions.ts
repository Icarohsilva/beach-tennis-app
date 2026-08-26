'use server'
// features/torneios/partnerInviteActions.ts
// Convite de parceiro por link/WhatsApp — para quando quem inscreve numa
// dupla fixa não tem como escolher o parceiro na lista (ele ainda não tem
// conta). A inscrição existe e segura a vaga (e o pagamento do titular) com
// partner_id nulo; o convite é o que resolve quem é o parceiro depois, sem
// travar a vaga esperando alguém abrir o WhatsApp.
import { randomBytes } from 'crypto'
import { revalidatePath } from 'next/cache'
import { createClient, createAdminClient, getActiveOrgId, getAuthUser } from '@/lib/supabase/server'
import { canonicalizePairGenders, canEnter, canPairUp, requiresKnownGender } from '@/lib/torneios/pairRules'
import { findEntrantClash, clashMessage, selfPairError } from '@/lib/torneios/entryDuplicates'
import { inviteState, inviteExpiry } from '@/lib/torneios/invite'
import { availableSlots } from '@/lib/torneios/waitlist'
import { computePersonPayment } from './actions'
import { awardTournamentEntry } from '@/features/liga/tournamentPoints'
import { normalizePhone } from '@/lib/notifications/whatsapp'
import { buildWhatsAppUrl } from '@/lib/utils/whatsappLink'
import { getSiteUrl } from '@/lib/utils/siteUrl'
import type { ParticipantType, Gender } from '@/types'

function newInviteToken(): string {
  return randomBytes(32).toString('hex')
}

// ---------------------------------------------------------------------------
// inviteTournamentPartner
// ---------------------------------------------------------------------------

export async function inviteTournamentPartner(
  tournamentId: string,
  input: { name: string; phone: string; gender?: Gender | null },
): Promise<{ error?: string; inviteUrl?: string; whatsappUrl?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const adminClient = createAdminClient()
  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  const name = input.name.trim()
  if (!name) return { error: 'Informe o nome do parceiro.' }
  const phone = input.phone.trim()
  if (!phone) return { error: 'Informe o telefone do parceiro (para enviar o convite).' }

  const { data: tournament } = await adminClient
    .from('tournaments')
    .select('id, status, participant_type, allowed_pair_genders, entry_price_cents, pix_key, max_players, registration_deadline')
    .eq('id', tournamentId)
    .eq('organization_id', orgId)
    .single()
  if (!tournament) return { error: 'Torneio não encontrado.' }
  if (tournament.status !== 'open') return { error: 'Inscrições encerradas para este torneio.' }
  if (tournament.participant_type !== 'dupla_fixa') {
    return { error: 'Convite de parceiro só existe em torneios de dupla fixa.' }
  }

  const { data: profile } = await adminClient.from('profiles').select('gender').eq('id', user.id).single()
  const myGender = (profile?.gender ?? null) as Gender | null
  const allowed = canonicalizePairGenders((tournament.allowed_pair_genders as string[] | null) ?? [])

  // Meu próprio gênero precisa caber na regra — sem isso o convite nasceria
  // fadado a falhar no aceite, com o parceiro já tendo recebido o link.
  const myVerdict = canEnter(myGender, allowed)
  if (!myVerdict.ok) return { error: myVerdict.reason ?? 'Inscrição não permitida nesta categoria.' }

  // Se quem convida já sabe o gênero do parceiro, falha rápido em vez de
  // deixar o parceiro descobrir só no aceite.
  if (input.gender) {
    const pairVerdict = canPairUp(myGender, input.gender, allowed)
    if (!pairVerdict.ok) return { error: pairVerdict.reason }
  }

  // Duplicidade — mesmo cuidado de registerForTournament/registerExternal.
  const { data: existingRaw } = await adminClient
    .from('tournament_entries')
    .select('player_id, partner_id')
    .eq('tournament_id', tournamentId)
    .or(`player_id.eq.${user.id},partner_id.eq.${user.id}`)
  const existing = (existingRaw ?? []) as { player_id: string; partner_id: string | null }[]
  const clash = findEntrantClash(existing, [{ id: user.id }], user.id)
  if (clash) return { error: clashMessage(clash) }

  const { count: occupiedCount } = await adminClient
    .from('tournament_entries')
    .select('id', { count: 'exact', head: true })
    .eq('tournament_id', tournamentId)
    .in('entry_status', ['confirmed', 'offered'])
  const slots = availableSlots(occupiedCount ?? 0, tournament.max_players as number | null)
  const entryStatus = slots > 0 ? 'confirmed' : 'waitlist'

  const paymentFields =
    entryStatus === 'confirmed'
      ? await computePersonPayment(
          adminClient,
          user.id,
          orgId,
          tournament.entry_price_cents as number | null,
          tournament.pix_key as string | null,
        )
      : { payment_status: 'free' as const, discount_pct: 0, final_price_cents: 0 }

  const { data: entry, error: insertErr } = await adminClient
    .from('tournament_entries')
    .insert({
      organization_id: orgId,
      tournament_id: tournamentId,
      player_id: user.id,
      partner_id: null,
      entry_status: entryStatus,
      payment_status: paymentFields.payment_status,
      discount_pct: paymentFields.discount_pct,
      final_price_cents: paymentFields.final_price_cents,
      // Nulo, não 'free': o parceiro ainda não existe, então não há "cobrança
      // dele" nenhuma para descrever ainda.
      partner_payment_status: null,
    })
    .select('id')
    .single()
  if (insertErr || !entry) return { error: 'Erro ao realizar inscrição. Tente novamente.' }

  if (entryStatus === 'confirmed') {
    await awardTournamentEntry(adminClient, { orgId, tournamentId, studentId: user.id })
  }

  const token = newInviteToken()
  const expiresAt = inviteExpiry(new Date(), tournament.registration_deadline as string | null)

  const { error: inviteErr } = await adminClient.from('tournament_partner_invites').insert({
    organization_id: orgId,
    tournament_id: tournamentId,
    entry_id: entry.id as string,
    token,
    invited_name: name,
    invited_phone: normalizePhone(phone),
    invited_gender: input.gender ?? null,
    created_by: user.id,
    expires_at: expiresAt,
  })
  if (inviteErr) {
    // A inscrição já existe e segura a vaga; o convite é o que falhou. Não
    // desfaz a inscrição — o admin consegue corrigir manualmente, e desfazer
    // aqui devolveria a vaga em silêncio para quem pagou.
    return { error: 'Inscrição feita, mas houve erro ao gerar o convite. Tente reenviar mais tarde.' }
  }

  const inviteUrl = `${getSiteUrl()}/t/${tournamentId}/dupla/${token}`
  const registrantName = (await adminClient.from('profiles').select('full_name').eq('id', user.id).single()).data
    ?.full_name as string | undefined
  const whatsappUrl = buildWhatsAppUrl(
    phone,
    `${registrantName ? `${registrantName} te` : 'Você foi'} convidou para jogar em dupla! Confirme aqui: ${inviteUrl}`,
  )

  revalidatePath(`/t/${tournamentId}`)
  revalidatePath(`/admin/torneios/${tournamentId}`)
  return { inviteUrl, whatsappUrl }
}

// ---------------------------------------------------------------------------
// acceptPartnerInvite
// ---------------------------------------------------------------------------

export async function acceptPartnerInvite(
  token: string,
  input?: { gender?: Gender },
): Promise<{ error?: string; tournamentId?: string }> {
  const user = await getAuthUser()
  if (!user) return { error: 'Entre ou crie uma conta para aceitar o convite.' }

  const adminClient = createAdminClient()

  const { data: invite } = await adminClient
    .from('tournament_partner_invites')
    .select('id, organization_id, tournament_id, entry_id, invited_gender, expires_at, accepted_at, declined_at')
    .eq('token', token)
    .maybeSingle()
  if (!invite) return { error: 'Convite não encontrado.' }

  const state = inviteState(
    { expires_at: invite.expires_at as string, accepted_at: invite.accepted_at as string | null, declined_at: invite.declined_at as string | null },
    new Date(),
  )
  if (state === 'accepted') return { error: 'Este convite já foi aceito.' }
  if (state === 'declined') return { error: 'Este convite foi recusado.' }
  if (state === 'expired') return { error: 'Este convite expirou.' }

  const orgId = invite.organization_id as string
  const tournamentId = invite.tournament_id as string

  const { data: tournament } = await adminClient
    .from('tournaments')
    .select('id, allowed_pair_genders, entry_price_cents, pix_key')
    .eq('id', tournamentId)
    .single()
  if (!tournament) return { error: 'Torneio não encontrado.' }

  const { data: entry } = await adminClient
    .from('tournament_entries')
    .select('id, player_id, partner_id, entry_status')
    .eq('id', invite.entry_id as string)
    .maybeSingle()
  if (!entry) return { error: 'Inscrição não encontrada — pode ter sido cancelada.' }
  if (entry.partner_id) return { error: 'Esta inscrição já tem parceiro.' }

  const selfErr = selfPairError(entry.player_id as string, user.id)
  if (selfErr) return { error: selfErr }

  // Vincula como ATLETA — o mesmo cuidado de registerExternal: quem aceita
  // pode não ter membership nesta academia ainda, e não é aluno dela.
  await adminClient
    .from('memberships')
    .upsert(
      { user_id: user.id, organization_id: orgId, role: 'athlete' },
      { onConflict: 'user_id,organization_id', ignoreDuplicates: true },
    )

  const { data: myProfile } = await adminClient.from('profiles').select('gender').eq('id', user.id).single()
  let myGender = (myProfile?.gender ?? invite.invited_gender ?? null) as Gender | null
  if (!myGender && input?.gender) {
    myGender = input.gender
    await adminClient.from('profiles').update({ gender: input.gender }).eq('id', user.id)
  }

  const { data: registrantProfile } = await adminClient
    .from('profiles')
    .select('gender')
    .eq('id', entry.player_id as string)
    .single()
  const registrantGender = (registrantProfile?.gender ?? null) as Gender | null

  const allowed = canonicalizePairGenders((tournament.allowed_pair_genders as string[] | null) ?? [])
  const pairVerdict = canPairUp(registrantGender, myGender, allowed)
  if (!pairVerdict.ok) return { error: pairVerdict.reason }

  // Duplicidade — a pessoa que aceita pode já estar noutra dupla do mesmo torneio.
  const { data: existingRaw } = await adminClient
    .from('tournament_entries')
    .select('player_id, partner_id')
    .eq('tournament_id', tournamentId)
    .or(`player_id.eq.${user.id},partner_id.eq.${user.id}`)
  const existing = (existingRaw ?? []) as { player_id: string; partner_id: string | null }[]
  const clash = findEntrantClash(existing, [{ id: user.id }], user.id)
  if (clash) return { error: clashMessage(clash) }

  const partnerPayment =
    entry.entry_status === 'confirmed'
      ? await computePersonPayment(
          adminClient,
          user.id,
          orgId,
          tournament.entry_price_cents as number | null,
          tournament.pix_key as string | null,
        )
      : { payment_status: 'free' as const, discount_pct: 0, final_price_cents: 0 }

  const { error: updateErr } = await adminClient
    .from('tournament_entries')
    .update({
      partner_id: user.id,
      partner_payment_status: partnerPayment.payment_status,
      partner_discount_pct: partnerPayment.discount_pct,
      partner_final_price_cents: partnerPayment.final_price_cents,
    })
    .eq('id', entry.id as string)
  if (updateErr) return { error: 'Erro ao aceitar o convite. Tente novamente.' }

  await adminClient
    .from('tournament_partner_invites')
    .update({ accepted_at: new Date().toISOString(), accepted_by: user.id })
    .eq('id', invite.id as string)

  if (entry.entry_status === 'confirmed') {
    await awardTournamentEntry(adminClient, { orgId, tournamentId, studentId: user.id })
  }

  revalidatePath(`/t/${tournamentId}`)
  revalidatePath(`/admin/torneios/${tournamentId}`)
  return { tournamentId }
}

// ---------------------------------------------------------------------------
// declinePartnerInvite
// ---------------------------------------------------------------------------

export async function declinePartnerInvite(token: string): Promise<{ error?: string }> {
  const adminClient = createAdminClient()

  const { data: invite } = await adminClient
    .from('tournament_partner_invites')
    .select('id, expires_at, accepted_at, declined_at')
    .eq('token', token)
    .maybeSingle()
  if (!invite) return { error: 'Convite não encontrado.' }

  const state = inviteState(
    { expires_at: invite.expires_at as string, accepted_at: invite.accepted_at as string | null, declined_at: invite.declined_at as string | null },
    new Date(),
  )
  if (state !== 'pending') return { error: 'Este convite não está mais pendente.' }

  await adminClient
    .from('tournament_partner_invites')
    .update({ declined_at: new Date().toISOString() })
    .eq('id', invite.id as string)
  return {}
}

// ---------------------------------------------------------------------------
// getPartnerInvitePublicData — leitura para a página de aceite
// ---------------------------------------------------------------------------

export interface PartnerInvitePublicData {
  state: 'pending' | 'accepted' | 'declined' | 'expired'
  tournamentId: string
  tournamentName: string
  registrantName: string
  invitedName: string
  needsGender: boolean
}

export async function getPartnerInvitePublicData(token: string): Promise<PartnerInvitePublicData | null> {
  const adminClient = createAdminClient()

  const { data: invite } = await adminClient
    .from('tournament_partner_invites')
    .select('tournament_id, entry_id, invited_name, invited_gender, expires_at, accepted_at, declined_at')
    .eq('token', token)
    .maybeSingle()
  if (!invite) return null

  const { data: tournament } = await adminClient
    .from('tournaments')
    .select('name, allowed_pair_genders')
    .eq('id', invite.tournament_id as string)
    .maybeSingle()
  if (!tournament) return null

  const { data: entry } = await adminClient
    .from('tournament_entries')
    .select('player_id')
    .eq('id', invite.entry_id as string)
    .maybeSingle()

  const { data: registrant } = entry
    ? await adminClient.from('profiles').select('full_name').eq('id', entry.player_id as string).maybeSingle()
    : { data: null }

  const allowed = canonicalizePairGenders((tournament.allowed_pair_genders as string[] | null) ?? [])

  return {
    state: inviteState(
      { expires_at: invite.expires_at as string, accepted_at: invite.accepted_at as string | null, declined_at: invite.declined_at as string | null },
      new Date(),
    ),
    tournamentId: invite.tournament_id as string,
    tournamentName: tournament.name as string,
    registrantName: (registrant?.full_name as string | null) ?? 'Alguém',
    invitedName: invite.invited_name as string,
    needsGender: !invite.invited_gender && requiresKnownGender(allowed),
  }
}
