'use server'
// features/torneios/entryFixActions.ts
// Toolkit do admin para consertar dupla fixa quando o convite nunca foi
// aceito, o parceiro desistiu, ou o titular quer sair. Três ações
// cirúrgicas, nenhuma delete: trocar parceiro, remover parceiro (a
// inscrição sobrevive incompleta) e promover o parceiro a titular — esta
// última é a essencial não óbvia, porque hoje quando quem pagou desiste o
// único caminho é apagar a inscrição, destruindo pagamento, comprovante,
// seed e posição na fila.
//
// Só com o torneio 'open': depois que a chave é sorteada, o par (titular,
// parceiro) já está gravado por id em tournament_matches — mexer aqui
// desalinharia partidas já geradas.
import { revalidatePath } from 'next/cache'
import { createClient, createAdminClient, getActiveOrgId } from '@/lib/supabase/server'
import { canonicalizePairGenders, canPairUp } from '@/lib/torneios/pairRules'
import { findEntrantClash, clashMessage, selfPairError } from '@/lib/torneios/entryDuplicates'
import { computePersonPayment } from './actions'
import { ensureEntryPaymentToken } from './entryPaymentActions'
import { awardTournamentEntry } from '@/features/liga/tournamentPoints'
import type { Gender } from '@/types'

interface AdminCtx {
  orgId: string
  adminClient: ReturnType<typeof createAdminClient>
}

async function requireAdmin(): Promise<AdminCtx | { error: string }> {
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

interface EntryRow {
  id: string
  tournament_id: string
  player_id: string
  partner_id: string | null
  entry_status: 'confirmed' | 'waitlist' | 'offered'
  payment_status: 'free' | 'pending' | 'paid'
  discount_pct: number
  final_price_cents: number
  receipt_url: string | null
  partner_payment_status: 'free' | 'pending' | 'paid' | null
  partner_discount_pct: number
  partner_final_price_cents: number
  partner_receipt_url: string | null
}

interface TournamentRow {
  id: string
  status: string
  participant_type: string
  allowed_pair_genders: string[] | null
  entry_price_cents: number | null
  pix_key: string | null
}

async function loadOpenDuplaFixaEntry(
  adminClient: ReturnType<typeof createAdminClient>,
  orgId: string,
  entryId: string,
): Promise<{ entry: EntryRow; tournament: TournamentRow } | { error: string }> {
  const { data: entryRaw } = await adminClient
    .from('tournament_entries')
    .select(
      'id, tournament_id, player_id, partner_id, entry_status, payment_status, discount_pct, final_price_cents, receipt_url, partner_payment_status, partner_discount_pct, partner_final_price_cents, partner_receipt_url',
    )
    .eq('id', entryId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!entryRaw) return { error: 'Inscrição não encontrada.' }
  const entry = entryRaw as EntryRow

  const { data: tournamentRaw } = await adminClient
    .from('tournaments')
    .select('id, status, participant_type, allowed_pair_genders, entry_price_cents, pix_key')
    .eq('id', entry.tournament_id)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!tournamentRaw) return { error: 'Torneio não encontrado.' }
  const tournament = tournamentRaw as TournamentRow
  if (tournament.participant_type !== 'dupla_fixa') {
    return { error: 'Esta ação só existe em torneios de dupla fixa.' }
  }
  if (tournament.status !== 'open') {
    return {
      error: 'Só é possível ajustar a dupla com as inscrições abertas — depois que a chave é sorteada, mexer aqui desalinharia as partidas.',
    }
  }

  return { entry, tournament }
}

function declineOpenInvite(adminClient: ReturnType<typeof createAdminClient>, entryId: string) {
  // Convite pendente amarrado a esta inscrição não faz mais sentido depois
  // que o admin resolveu a dupla manualmente — sem isso o link continuaria
  // válido e alguém poderia aceitá-lo por cima da troca.
  return adminClient
    .from('tournament_partner_invites')
    .update({ declined_at: new Date().toISOString() })
    .eq('entry_id', entryId)
    .is('accepted_at', null)
    .is('declined_at', null)
}

// ---------------------------------------------------------------------------
// swapEntryPartner — admin escolhe (ou troca) o parceiro de uma inscrição
// ---------------------------------------------------------------------------

export async function swapEntryPartner(entryId: string, newPartnerId: string): Promise<{ error?: string }> {
  const ctx = await requireAdmin()
  if ('error' in ctx) return ctx
  const { orgId, adminClient } = ctx

  const loaded = await loadOpenDuplaFixaEntry(adminClient, orgId, entryId)
  if ('error' in loaded) return loaded
  const { entry, tournament } = loaded

  // O parceiro atual (se houver) já pagou: trocar aqui apagaria o registro
  // do pagamento em silêncio, sem sobrar rastro de quem deve o estorno —
  // mesma trava de clearEntryPartner.
  if (entry.partner_id && entry.partner_payment_status === 'paid') {
    return { error: 'O parceiro atual já pagou. Estorne antes de trocar — trocar aqui perderia o registro do pagamento.' }
  }

  const selfErr = selfPairError(entry.player_id, newPartnerId)
  if (selfErr) return { error: selfErr }

  const { data: profilesRaw } = await adminClient
    .from('profiles')
    .select('id, gender')
    .in('id', [entry.player_id, newPartnerId])
  const genderById = new Map(
    ((profilesRaw ?? []) as { id: string; gender: Gender | null }[]).map((p) => [p.id, p.gender]),
  )
  const allowed = canonicalizePairGenders(tournament.allowed_pair_genders ?? [])
  const verdict = canPairUp(genderById.get(entry.player_id) ?? null, genderById.get(newPartnerId) ?? null, allowed)
  if (!verdict.ok) return { error: verdict.reason ?? 'Esta dupla não é permitida nesta categoria.' }

  const { data: existingRaw } = await adminClient
    .from('tournament_entries')
    .select('player_id, partner_id')
    .eq('tournament_id', entry.tournament_id)
    .neq('id', entryId)
    .or(`player_id.eq.${newPartnerId},partner_id.eq.${newPartnerId}`)
  const existing = (existingRaw ?? []) as { player_id: string; partner_id: string | null }[]
  const clash = findEntrantClash(existing, [{ id: newPartnerId }], entry.player_id)
  if (clash) return { error: clashMessage(clash) }

  const paymentFields = entry.entry_status === 'confirmed'
    ? await computePersonPayment(adminClient, newPartnerId, orgId, tournament.entry_price_cents, tournament.pix_key)
    : { payment_status: 'free' as const, discount_pct: 0, final_price_cents: 0 }

  const { error } = await adminClient
    .from('tournament_entries')
    .update({
      partner_id: newPartnerId,
      partner_payment_status: paymentFields.payment_status,
      partner_discount_pct: paymentFields.discount_pct,
      partner_final_price_cents: paymentFields.final_price_cents,
      // Reseta o comprovante — pertencia (se existisse) ao parceiro anterior.
      partner_receipt_url: null,
    })
    .eq('id', entryId)
  if (error) {
    if (error.code === '23505') return { error: 'Este jogador já está em outra dupla deste torneio.' }
    return { error: 'Erro ao trocar parceiro. Tente novamente.' }
  }

  await declineOpenInvite(adminClient, entryId)

  if (entry.entry_status === 'confirmed') {
    await awardTournamentEntry(adminClient, { orgId, tournamentId: entry.tournament_id, studentId: newPartnerId })
    if (paymentFields.payment_status === 'pending') {
      try {
        await ensureEntryPaymentToken(adminClient, {
          orgId, tournamentId: entry.tournament_id, entryId, side: 'partner',
        })
      } catch (e) {
        console.error('[swapEntryPartner] falha ao gerar link de pagamento', e)
      }
    }
  }

  revalidatePath(`/admin/torneios/${entry.tournament_id}`)
  revalidatePath(`/t/${entry.tournament_id}`)
  return {}
}

// ---------------------------------------------------------------------------
// clearEntryPartner — remove o parceiro; a inscrição sobrevive incompleta
// ---------------------------------------------------------------------------

export async function clearEntryPartner(entryId: string): Promise<{ error?: string }> {
  const ctx = await requireAdmin()
  if ('error' in ctx) return ctx
  const { orgId, adminClient } = ctx

  const loaded = await loadOpenDuplaFixaEntry(adminClient, orgId, entryId)
  if ('error' in loaded) return loaded
  const { entry } = loaded

  if (!entry.partner_id) return { error: 'Esta inscrição não tem parceiro.' }
  if (entry.partner_payment_status === 'paid') {
    return { error: 'O parceiro já pagou. Estorne antes de remover — remover aqui perderia o registro do pagamento.' }
  }

  const { error } = await adminClient
    .from('tournament_entries')
    .update({
      partner_id: null,
      partner_payment_status: null,
      partner_discount_pct: 0,
      partner_final_price_cents: 0,
      partner_receipt_url: null,
    })
    .eq('id', entryId)
  if (error) return { error: 'Erro ao remover parceiro. Tente novamente.' }

  await declineOpenInvite(adminClient, entryId)

  revalidatePath(`/admin/torneios/${entry.tournament_id}`)
  revalidatePath(`/t/${entry.tournament_id}`)
  return {}
}

// ---------------------------------------------------------------------------
// promotePartnerToPlayer — o titular desiste; o parceiro assume a inscrição
// ---------------------------------------------------------------------------

export async function promotePartnerToPlayer(entryId: string): Promise<{ error?: string }> {
  const ctx = await requireAdmin()
  if ('error' in ctx) return ctx
  const { orgId, adminClient } = ctx

  const loaded = await loadOpenDuplaFixaEntry(adminClient, orgId, entryId)
  if ('error' in loaded) return loaded
  const { entry } = loaded

  if (!entry.partner_id) return { error: 'Esta inscrição não tem parceiro para promover.' }
  // O titular que sai já pagou: promover por cima apagaria o registro desse
  // pagamento sem deixar rastro de quem deve o estorno — mesma trava de
  // clearEntryPartner/swapEntryPartner. O admin estorna primeiro (fluxo do
  // financeiro) e só então promove.
  if (entry.payment_status === 'paid') {
    return { error: 'O titular já pagou. Estorne antes de promover — promover aqui perderia o registro do pagamento.' }
  }

  const { error } = await adminClient
    .from('tournament_entries')
    .update({
      player_id: entry.partner_id,
      payment_status: entry.partner_payment_status ?? 'free',
      discount_pct: entry.partner_discount_pct,
      final_price_cents: entry.partner_final_price_cents,
      receipt_url: entry.partner_receipt_url,
      // O titular que saiu deixa de dever qualquer coisa por esta inscrição —
      // a vaga de parceiro fica aberta para ser preenchida de novo.
      partner_id: null,
      partner_payment_status: null,
      partner_discount_pct: 0,
      partner_final_price_cents: 0,
      partner_receipt_url: null,
    })
    .eq('id', entryId)
  if (error) return { error: 'Erro ao promover parceiro. Tente novamente.' }

  await declineOpenInvite(adminClient, entryId)

  revalidatePath(`/admin/torneios/${entry.tournament_id}`)
  revalidatePath(`/t/${entry.tournament_id}`)
  return {}
}
