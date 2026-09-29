// features/dayuse/pageQueries.ts
// Leitura da página pública de day use (/dayuse/[slug]).
//
// Abre SEM login — é o link que a arena divulga no grupo —, então passa pela
// service role e o recorte de visibilidade é explícito aqui: página publicada,
// academia ativa, data ativa e de hoje em diante.
import { createAdminClient } from '@/lib/supabase/server'
import { getDayUsePricing } from '@/features/dayuse/pricing'
import { dayUsePriceView } from '@/lib/dayuse/dayUseKind'
import { partnerOptionsFor, type DayUsePartner } from '@/lib/dayuse/partnerCheckin'
import { brtToday } from '@/lib/utils/gridSchedule'
import type { DayUsePaymentTiming } from '@/lib/dayuse/paymentMethod'
import type { DayUseKind, DayUsePage } from '@/types'

export interface PublicDayUsePageSlot {
  id: string
  date: string
  start_time: string
  end_time: string
  court: number
  capacity: number
  sport: string | null
  kind: DayUseKind
  priceCents: number
  timing: DayUsePaymentTiming
  occupied: number
  /** Parceiros aceitos nesta data (Wellhub/TotalPass), para o chip do card. */
  partners: DayUsePartner[]
}

export interface PublicDayUsePageData {
  page: DayUsePage
  org: {
    id: string
    name: string
    slug: string
    city: string | null
    state: string | null
    logo_url: string | null
    brand_color: string | null
    whatsapp: string | null
  }
  slots: PublicDayUsePageSlot[]
}

export async function getPublicDayUsePage(slug: string): Promise<PublicDayUsePageData | null> {
  const admin = createAdminClient()

  const { data: pageRow } = await admin
    .from('dayuse_pages')
    .select('*')
    .eq('slug', slug)
    .eq('is_published', true)
    .maybeSingle()
  if (!pageRow) return null
  const page = pageRow as DayUsePage

  const { data: orgRow } = await admin
    .from('organizations')
    .select('id, name, slug, city, state, logo_url, brand_color, whatsapp, status')
    .eq('id', page.organization_id)
    .maybeSingle()
  // Academia suspensa não divulga: a página sai do ar junto.
  if (!orgRow || (orgRow as { status: string }).status !== 'active') return null

  // Teto natural: as datas futuras de UM day use (a recorrência gera 4 semanas).
  const { data: slotRows } = await admin
    .from('dayuse_slots')
    .select('id, date, start_time, end_time, court, capacity, sport, kind, price_cents, payment_timing')
    .eq('page_id', page.id)
    .eq('organization_id', page.organization_id)
    .eq('is_active', true)
    .gte('date', brtToday(new Date()))
    .order('date', { ascending: true })
    .order('start_time', { ascending: true })

  type SlotRow = {
    id: string
    date: string
    start_time: string
    end_time: string
    court: number
    capacity: number
    sport: string | null
    kind: DayUseKind
    price_cents: number | null
    payment_timing: DayUsePaymentTiming | null
  }
  const rows = (slotRows ?? []) as SlotRow[]

  // Ocupação pela mesma régua da página de cada data e da vitrine da arena:
  // confirmada, ou pendente dentro do prazo do método (hold_until). Contar por
  // booked_at tiraria o PIX manual da conta em 30 min e venderia a vaga duas vezes.
  const counts = new Map<string, number>()
  if (rows.length > 0) {
    const nowIso = new Date().toISOString()
    const freshLimit = new Date(Date.now() - 30 * 60 * 1000).toISOString()
    const { data: bookingRows } = await admin
      .from('dayuse_bookings')
      .select('slot_id')
      .in('slot_id', rows.map((r) => r.id))
      .or(
        'status.eq.confirmed,'
        + `and(status.eq.pending_payment,hold_until.gt.${nowIso}),`
        + `and(status.eq.pending_payment,hold_until.is.null,booked_at.gt.${freshLimit})`,
      )
    for (const b of (bookingRows ?? []) as { slot_id: string }[]) {
      counts.set(b.slot_id, (counts.get(b.slot_id) ?? 0) + 1)
    }
  }

  // Preço e onde se paga pela MESMA resolução do checkout (dayUsePriceView): a
  // capa não pode anunciar um valor e a reserva cobrar outro.
  const pricing = await getDayUsePricing(page.organization_id)
  const slots: PublicDayUsePageSlot[] = rows.map((r) => {
    const view = dayUsePriceView(r, pricing)
    return {
      id: r.id,
      date: r.date,
      start_time: r.start_time,
      end_time: r.end_time,
      court: r.court,
      capacity: r.capacity,
      sport: r.sport,
      kind: r.kind,
      priceCents: view.priceCents,
      timing: view.timing,
      occupied: counts.get(r.id) ?? 0,
      partners: partnerOptionsFor({ priceCents: view.priceCents, accepted: pricing.acceptedPartners }),
    }
  })

  return { page, org: orgRow as PublicDayUsePageData['org'], slots }
}
