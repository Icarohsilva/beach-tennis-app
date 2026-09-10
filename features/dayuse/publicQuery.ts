// features/dayuse/publicQuery.ts
// Leitura da página pública /d/[id]. Usa o admin client, como a pública de
// torneio: a policy dayuse_slots_select_org exige membership, e o ponto desta
// página é justamente abrir para quem não é membro de nada.
import { createAdminClient } from '@/lib/supabase/server'
import { getDayUsePricing } from './pricing'
import { dayUseChargeCents } from '@/lib/dayuse/dayUseKind'
import { getWalletBalance } from '@/features/wallet/walletQueries'
import type { DayUsePaymentMethod } from '@/lib/dayuse/paymentMethod'
import type { DayUseSlot } from '@/types'

export interface PublicDayUse {
  slot: DayUseSlot
  org: {
    id: string
    name: string
    slug: string
    logo_url: string | null
    whatsapp: string | null
    city: string | null
    state: string | null
  }
  /** Preço a cobrar, já resolvido pela mesma regra do checkout. */
  priceCents: number
  /** Saldo em dinheiro de quem está vendo, na academia deste day use. */
  walletCents: number
  /** Chave PIX da arena — só usada no caminho de pagamento manual. */
  pixKey: string | null
  pixOwner: string | null
  /** Reservas que ocupam vaga: confirmadas + pendentes de pagamento frescas. */
  occupied: number
  /**
   * Primeiro nome de quem já vai. Só o primeiro nome, de propósito: esta URL é
   * pública e compartilhada no WhatsApp, e o nome completo de quem reservou não
   * precisa ir junto para a prova social funcionar.
   */
  attendees: string[]
  /** Reserva de quem está vendo a página, quando há sessão. */
  mine: {
    id: string
    status: 'confirmed' | 'pending_payment'
    /** Para a carência de arrependimento de 1h (resolveRefundEligibility). */
    bookedAt: string
    /** Como está sendo pago — 'pix_manual' pede comprovante na própria tela. */
    paymentMethod: DayUsePaymentMethod
    /** Comprovante do PIX manual já enviado? */
    hasReceipt: boolean
    refundPixKey: string | null
    refundPixOwner: string | null
  } | null
}

/** Janela em que uma reserva pendente ainda ocupa a vaga (igual à RPC). */
const PENDING_WINDOW_MS = 30 * 60 * 1000

export async function getPublicDayUse(
  slotId: string,
  viewerId: string | null,
): Promise<PublicDayUse | null> {
  const admin = createAdminClient()

  const { data: slotRaw } = await admin
    .from('dayuse_slots')
    .select('*')
    .eq('id', slotId)
    .eq('is_active', true)
    .maybeSingle()
  if (!slotRaw) return null
  const slot = slotRaw as DayUseSlot

  const { data: orgRaw } = await admin
    .from('organizations')
    .select('id, name, slug, logo_url, whatsapp, city, state')
    .eq('id', slot.organization_id)
    .maybeSingle()
  if (!orgRaw) return null

  const freshLimit = new Date(Date.now() - PENDING_WINDOW_MS).toISOString()
  const nowIso = new Date().toISOString()
  // Teto natural (uma capacidade de slot), então `.select()` direto — ver
  // lib/supabase/paginate.ts.
  //
  // Ocupa vaga: confirmada, ou pendente ainda dentro do prazo do MÉTODO
  // (`hold_until`). Filtrar por `booked_at` daria 30 min para todos e apagaria
  // da contagem a reserva por PIX manual, que segura 24h — a vaga apareceria
  // livre e seria vendida duas vezes. O fallback por `booked_at` cobre linha
  // anterior a 20260910150000.
  const { data: bookingsRaw } = await admin
    .from('dayuse_bookings')
    .select('id, student_id, status, booked_at, payment_method, receipt_url, refund_pix_key, refund_pix_owner, profiles(full_name)')
    .eq('slot_id', slotId)
    .or(
      'status.eq.confirmed,'
      + `and(status.eq.pending_payment,hold_until.gt.${nowIso}),`
      + `and(status.eq.pending_payment,hold_until.is.null,booked_at.gt.${freshLimit})`,
    )

  const bookings = (bookingsRaw ?? []) as {
    id: string
    student_id: string
    status: 'confirmed' | 'pending_payment'
    booked_at: string
    payment_method: DayUsePaymentMethod
    receipt_url: string | null
    refund_pix_key: string | null
    refund_pix_owner: string | null
    profiles: { full_name: string } | { full_name: string }[] | null
  }[]

  const attendees: string[] = []
  let mine: PublicDayUse['mine'] = null
  for (const b of bookings) {
    const profile = Array.isArray(b.profiles) ? b.profiles[0] : b.profiles
    const first = profile?.full_name?.trim().split(/\s+/)[0]
    if (first) attendees.push(first)
    if (viewerId && b.student_id === viewerId) {
      mine = {
        id: b.id,
        status: b.status,
        bookedAt: b.booked_at,
        paymentMethod: b.payment_method,
        hasReceipt: Boolean(b.receipt_url),
        refundPixKey: b.refund_pix_key,
        refundPixOwner: b.refund_pix_owner,
      }
    }
  }

  const pricing = await getDayUsePricing(slot.organization_id)
  // Saldo de quem está vendo: a tela precisa dizer quanto o crédito abate ANTES
  // do clique, e o abatimento é a mesma conta que bookDayUse aplica.
  const walletCents = viewerId
    ? await getWalletBalance(admin, slot.organization_id, viewerId)
    : 0

  return {
    slot,
    org: orgRaw as PublicDayUse['org'],
    priceCents: dayUseChargeCents(slot, pricing),
    walletCents,
    pixKey: pricing.pixKey,
    pixOwner: pricing.pixOwner,
    occupied: bookings.length,
    attendees,
    mine,
  }
}
