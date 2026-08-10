import Link from 'next/link'
import { createAdminClient, getCurrentOrgId } from '@/lib/supabase/server'
import { CreateDayUseForm } from '@/features/dayuse/CreateDayUseForm'
import { DayUseSlotCard } from '@/features/dayuse/DayUseSlotCard'
import { formatDate } from '@/lib/utils/dateHelpers'
import type { DayUseSlot } from '@/types'
import { requirePlatformAccess } from '@/lib/billing/guard'
import { brtToday } from '@/lib/utils/gridSchedule'

export default async function AdminDayUsePage() {
  await requirePlatformAccess() // gate de cobranca; ver lib/billing/guard.ts
  const adminClient = createAdminClient()
  const orgId = await getCurrentOrgId()
  const today = brtToday(new Date()) // BRT: em servidor UTC o "hoje" cru virava amanhã depois das 21h

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
      <CreateDayUseForm />
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
