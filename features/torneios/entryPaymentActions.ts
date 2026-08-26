'use server'
// features/torneios/entryPaymentActions.ts
// Link pessoal de pagamento por lado da inscrição (/p/[token]): quem paga é
// sempre uma pessoa, nunca a dupla inteira (Fase 2a — cada atleta paga a
// própria parte), então o link também é por pessoa. Página SEM login: quem
// aceitou um convite de dupla pode ainda não ter conta antes de aceitar, e
// mesmo depois não há por que exigir sessão para pagar — o token na URL é a
// própria credencial (mesmo desenho de tournament_partner_invites e do feed
// .ics em app/api/calendar/[token]).
import { randomBytes } from 'crypto'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { getConnectedMpToken } from '@/lib/billing/gatewayAccounts'
import { mpCreatePreference } from '@/lib/billing/mpClient'
import { computeMarketplaceFee } from '@/lib/billing/fees'
import { getSiteUrl } from '@/lib/utils/siteUrl'
import { chargeFor, type EntrySide, type PayableEntry } from '@/lib/torneios/entrySide'

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}
const MAX_RECEIPT_BYTES = 5 * 1024 * 1024

// ---------------------------------------------------------------------------
// ensureEntryPaymentToken — gera (ou reaproveita) o link de UM lado da
// inscrição. Chamado só quando aquele lado tem algo a pagar (payment_status
// 'pending'); não existe token para lado gratuito ou não cobrado ainda.
// ---------------------------------------------------------------------------

export async function ensureEntryPaymentToken(
  adminClient: ReturnType<typeof createAdminClient>,
  params: { orgId: string; tournamentId: string; entryId: string; side: EntrySide },
): Promise<string | null> {
  const { orgId, tournamentId, entryId, side } = params

  const { data: existing } = await adminClient
    .from('tournament_entry_payments')
    .select('token')
    .eq('entry_id', entryId)
    .eq('side', side)
    .maybeSingle()
  if (existing?.token) return existing.token as string

  const token = randomBytes(32).toString('hex')
  const { error } = await adminClient
    .from('tournament_entry_payments')
    .insert({ organization_id: orgId, tournament_id: tournamentId, entry_id: entryId, side, token })
  if (!error) return token

  // Corrida: duas chamadas concorrentes gerando o link do mesmo lado ao mesmo
  // tempo — o índice único (entry_id, side) rejeitou a segunda. Relê em vez
  // de propagar erro.
  const { data: retry } = await adminClient
    .from('tournament_entry_payments')
    .select('token')
    .eq('entry_id', entryId)
    .eq('side', side)
    .maybeSingle()
  return (retry?.token as string | undefined) ?? null
}

// ---------------------------------------------------------------------------
// getPublicEntryPayment — leitura para a página /p/[token]
// ---------------------------------------------------------------------------

export interface PublicEntryPayment {
  tournamentId: string
  tournamentName: string
  payeeName: string
  paymentStatus: 'free' | 'pending' | 'paid'
  discountPct: number
  finalPriceCents: number
  pixKey: string | null
  receiptUrl: string | null
  hasCheckoutPro: boolean
}

export async function getPublicEntryPayment(token: string): Promise<PublicEntryPayment | null> {
  const adminClient = createAdminClient()

  const { data: tep } = await adminClient
    .from('tournament_entry_payments')
    .select('organization_id, tournament_id, entry_id, side')
    .eq('token', token)
    .maybeSingle()
  if (!tep) return null

  const { data: tournament } = await adminClient
    .from('tournaments')
    .select('name, pix_key')
    .eq('id', tep.tournament_id as string)
    .maybeSingle()
  if (!tournament) return null

  const { data: entryRaw } = await adminClient
    .from('tournament_entries')
    .select(
      'player_id, partner_id, payment_status, discount_pct, final_price_cents, receipt_url, partner_payment_status, partner_discount_pct, partner_final_price_cents, partner_receipt_url',
    )
    .eq('id', tep.entry_id as string)
    .maybeSingle()
  if (!entryRaw) return null
  const entry = entryRaw as PayableEntry

  const side = tep.side as EntrySide
  const charge = chargeFor(side, entry)
  // Defensivo: token de parceiro cujo convite nunca foi aceito não deveria
  // existir (o token só é gerado depois que o lado tem cobrança), mas se
  // acontecer não há o que mostrar.
  if (charge.paymentStatus === null) return null

  const payeeId = side === 'partner' ? entry.partner_id : entry.player_id
  const { data: payeeProfile } = payeeId
    ? await adminClient.from('profiles').select('full_name').eq('id', payeeId).maybeSingle()
    : { data: null }

  const mpToken = await getConnectedMpToken(tep.organization_id as string)

  return {
    tournamentId: tep.tournament_id as string,
    tournamentName: tournament.name as string,
    payeeName: (payeeProfile?.full_name as string | null) ?? '',
    paymentStatus: charge.paymentStatus,
    discountPct: charge.discountPct,
    finalPriceCents: charge.finalPriceCents,
    pixKey: tournament.pix_key as string | null,
    receiptUrl: charge.receiptUrl,
    hasCheckoutPro: mpToken !== null,
  }
}

// ---------------------------------------------------------------------------
// startEntryCheckout — abre o Checkout Pro (PIX/cartão) para ESTE lado
// ---------------------------------------------------------------------------

export async function startEntryCheckout(token: string): Promise<{ error?: string; initPoint?: string }> {
  const adminClient = createAdminClient()

  const { data: tep } = await adminClient
    .from('tournament_entry_payments')
    .select('organization_id, tournament_id, entry_id, side')
    .eq('token', token)
    .maybeSingle()
  if (!tep) return { error: 'Link não encontrado.' }

  const orgId = tep.organization_id as string
  const entryId = tep.entry_id as string
  const side = tep.side as EntrySide

  const { data: entryRaw } = await adminClient
    .from('tournament_entries')
    .select(
      'player_id, partner_id, payment_status, discount_pct, final_price_cents, receipt_url, partner_payment_status, partner_discount_pct, partner_final_price_cents, partner_receipt_url',
    )
    .eq('id', entryId)
    .maybeSingle()
  if (!entryRaw) return { error: 'Inscrição não encontrada.' }
  const entry = entryRaw as PayableEntry
  const charge = chargeFor(side, entry)
  if (charge.paymentStatus !== 'pending') return { error: 'Não há pagamento pendente para este link.' }

  const payeeId = side === 'partner' ? entry.partner_id : entry.player_id
  if (!payeeId) return { error: 'Aguardando o parceiro aceitar o convite.' }

  const mpToken = await getConnectedMpToken(orgId)
  if (!mpToken) return { error: 'Pagamento online indisponível para esta academia.' }

  const { data: tournament } = await adminClient
    .from('tournaments')
    .select('name')
    .eq('id', tep.tournament_id as string)
    .maybeSingle()

  const amount = charge.finalPriceCents / 100

  const { data: payment, error: payErr } = await adminClient
    .from('payments')
    .insert({
      organization_id: orgId,
      student_id: payeeId,
      subscription_id: null,
      session_id: null,
      amount,
      currency: 'BRL',
      status: 'pending',
      type: 'tournament_entry',
      gateway: 'mercadopago',
      gateway_payment_id: null,
      tournament_entry_id: entryId,
      tournament_entry_side: side,
    })
    .select('id')
    .single()
  if (payErr || !payment) return { error: 'Erro ao iniciar o pagamento. Tente novamente.' }

  const { data: org } = await adminClient
    .from('organizations')
    .select('platform_fee_pct')
    .eq('id', orgId)
    .single()
  const feePct = Number((org as { platform_fee_pct?: number } | null)?.platform_fee_pct ?? 0)

  try {
    const pref = await mpCreatePreference(mpToken, {
      items: [
        { title: `Inscrição — ${(tournament?.name as string | undefined) ?? 'Torneio'}`, quantity: 1, unit_price: amount, currency_id: 'BRL' },
      ],
      external_reference: payment.id as string,
      notification_url: `${getSiteUrl()}/api/webhooks/mercadopago?org=${orgId}`,
      // Bug do validador do MP com TLD .website: back_url NÃO pode ter path
      // (mesma nota nos outros checkouts) — sempre a raiz.
      back_urls: { success: getSiteUrl(), pending: getSiteUrl(), failure: getSiteUrl() },
      marketplace_fee: computeMarketplaceFee(amount, feePct),
    })
    return { initPoint: pref.init_point }
  } catch (e) {
    console.error('[startEntryCheckout] preference falhou', e)
    await adminClient.from('payments').update({ status: 'failed' }).eq('id', payment.id as string)
    return { error: 'Não foi possível iniciar o pagamento. Tente novamente.' }
  }
}

// ---------------------------------------------------------------------------
// uploadEntryPaymentReceipt — fallback manual (sem MP conectado) quando o
// atleta anexa o comprovante do PIX. Passa pelo server (não upload direto do
// client) porque quem está em /p/[token] pode não ter sessão nenhuma, e a
// policy de storage do bucket payment-receipts exige `authenticated`.
// ---------------------------------------------------------------------------

export async function uploadEntryPaymentReceipt(token: string, formData: FormData): Promise<{ error?: string }> {
  const file = formData.get('file')
  if (!(file instanceof File)) return { error: 'Envie um arquivo.' }
  const ext = MIME_TO_EXT[file.type]
  if (!ext) return { error: 'Formato não suportado. Envie JPG, PNG ou WEBP.' }
  if (file.size > MAX_RECEIPT_BYTES) return { error: 'Arquivo muito grande (máx. 5MB).' }

  const adminClient = createAdminClient()
  const { data: tep } = await adminClient
    .from('tournament_entry_payments')
    .select('tournament_id, entry_id, side')
    .eq('token', token)
    .maybeSingle()
  if (!tep) return { error: 'Link não encontrado.' }

  const path = `${tep.tournament_id as string}/${tep.entry_id as string}-${tep.side as string}/receipt.${ext}`
  const bytes = new Uint8Array(await file.arrayBuffer())
  const { error: upErr } = await adminClient.storage
    .from('payment-receipts')
    .upload(path, bytes, { upsert: true, contentType: file.type })
  if (upErr) return { error: 'Erro ao enviar comprovante. Tente novamente.' }

  const { error: updErr } = await adminClient
    .from('tournament_entries')
    .update(tep.side === 'partner' ? { partner_receipt_url: path } : { receipt_url: path })
    .eq('id', tep.entry_id as string)
  if (updErr) return { error: 'Erro ao salvar comprovante. Tente novamente.' }

  revalidatePath(`/p/${token}`)
  return {}
}
