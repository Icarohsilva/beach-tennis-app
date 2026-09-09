import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createAdminClient, getCurrentOrgId } from '@/lib/supabase/server'
import { CreateDayUseForm } from '@/features/dayuse/CreateDayUseForm'
import { DayUseSlotCard } from '@/features/dayuse/DayUseSlotCard'
import { formatDate } from '@/lib/utils/dateHelpers'
import type { DayUseSlot } from '@/types'
import { requirePlatformAccess } from '@/lib/billing/guard'
import { brtToday } from '@/lib/utils/gridSchedule'
import { getOrgSports } from '@/lib/arenas/orgSports'
import { getDayUsePricing } from '@/features/dayuse/pricing'
import { dayUseChargeCents } from '@/lib/dayuse/dayUseKind'

export default async function AdminDayUsePage() {
  await requirePlatformAccess() // gate de cobranca; ver lib/billing/guard.ts
  const adminClient = createAdminClient()
  const orgId = await getCurrentOrgId()
  // Sem academia ativa não há day use para listar nem criar — e o preço padrão
  // (getDayUsePricing) é por academia.
  if (!orgId) redirect('/selecionar-academia')
  const today = brtToday(new Date()) // BRT: em servidor UTC o "hoje" cru virava amanhã depois das 21h

  // Preço vem da MESMA resolução do checkout: o admin tem de ver na lista o
  // número que o aluno vai pagar, inclusive o "Gratuito" de quando a venda está
  // desligada ou o Mercado Pago não está conectado.
  const [orgSports, pricing] = await Promise.all([
    getOrgSports(orgId),
    getDayUsePricing(orgId),
  ])

  const { data: slots } = await adminClient
    .from('dayuse_slots')
    .select('*')
    .eq('is_active', true)
    .eq('organization_id', orgId)
    .gte('date', today)
    .order('date', { ascending: true })
    .order('start_time', { ascending: true })

  const slotList = (slots ?? []) as DayUseSlot[]
  const slotIds = slotList.map((s) => s.id)

  const { data: bookingsRaw } =
    slotIds.length > 0
      ? await adminClient
          .from('dayuse_bookings')
          .select('slot_id')
          .in('slot_id', slotIds)
          .eq('organization_id', orgId)
          .eq('status', 'confirmed')
      : { data: [] }

  const countMap = new Map<string, number>()
  for (const b of (bookingsRaw ?? []) as { slot_id: string }[]) {
    countMap.set(b.slot_id, (countMap.get(b.slot_id) ?? 0) + 1)
  }

  const byDate = new Map<string, DayUseSlot[]>()
  for (const slot of slotList) {
    const arr = byDate.get(slot.date) ?? []
    arr.push(slot)
    byDate.set(slot.date, arr)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/admin/grade" className="text-slate-400 hover:text-white text-sm">
          ← Grade
        </Link>
      </div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Day Use</h1>
        <p className="text-slate-400 text-sm">{slotList.length} slots futuros</p>
      </div>
      <CreateDayUseForm orgSports={orgSports} orgDefaultPriceCents={pricing.defaultCents} />
      <div className="space-y-6">
        {byDate.size === 0 ? (
          <p className="text-slate-400 text-sm">Nenhum slot agendado. Crie um acima.</p>
        ) : (
          Array.from(byDate.entries()).map(([date, dateSlots]) => (
            <div key={date}>
              <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-2">
                {formatDate(date, "EEEE, dd 'de' MMMM")}
              </h2>
              <div className="space-y-2">
                {dateSlots.map((slot) => (
                  <DayUseSlotCard
                    key={slot.id}
                    slot={slot}
                    bookingsCount={countMap.get(slot.id) ?? 0}
                    priceCents={dayUseChargeCents(slot, pricing)}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
