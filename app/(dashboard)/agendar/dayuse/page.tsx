import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { DayUseBookingCard } from '@/features/dayuse/DayUseBookingCard'
import { formatDate } from '@/lib/utils/dateHelpers'
import type { DayUseSlot } from '@/types'

export default async function AgendarDayUsePage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const today = new Date().toISOString().slice(0, 10)

  const { data: slots } = await supabase
    .from('dayuse_slots')
    .select('*')
    .eq('is_active', true)
    .gte('date', today)
    .order('date', { ascending: true })
    .order('start_time', { ascending: true })

  const slotList = (slots ?? []) as DayUseSlot[]
  const slotIds = slotList.map((s) => s.id)

  const { data: allBookings } =
    slotIds.length > 0
      ? await supabase
          .from('dayuse_bookings')
          .select('id, slot_id, student_id')
          .in('slot_id', slotIds)
          .eq('status', 'confirmed')
      : { data: [] }

  const countMap = new Map<string, number>()
  const myBookings = new Map<string, string>()
  for (const b of (allBookings ?? []) as { id: string; slot_id: string; student_id: string }[]) {
    countMap.set(b.slot_id, (countMap.get(b.slot_id) ?? 0) + 1)
    if (b.student_id === user.id) myBookings.set(b.slot_id, b.id)
  }

  const byDate = new Map<string, DayUseSlot[]>()
  for (const slot of slotList) {
    const arr = byDate.get(slot.date) ?? []
    arr.push(slot)
    byDate.set(slot.date, arr)
  }

  return (
    <div className="p-4 space-y-6 pb-24">
      <div className="flex items-center gap-3">
        <Link href="/agendar" className="text-slate-400 hover:text-white text-sm">
          ← Agendar
        </Link>
      </div>
      <div>
        <h1 className="text-xl font-bold text-white">Day Use</h1>
        <p className="text-slate-400 text-sm mt-1">Reserva de quadra sem usar créditos</p>
      </div>
      {byDate.size === 0 ? (
        <div className="bg-surface-card border border-surface-border rounded-xl p-6 text-center">
          <p className="text-slate-400 text-sm">Nenhum horário de day use disponível no momento.</p>
          <p className="text-slate-500 text-xs mt-1">O professor divulga os horários com antecedência.</p>
        </div>
      ) : (
        Array.from(byDate.entries()).map(([date, dateSlots]) => (
          <div key={date}>
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-2">
              {formatDate(date, "EEEE, dd 'de' MMMM")}
            </h2>
            <div className="space-y-2">
              {dateSlots.map((slot) => (
                <DayUseBookingCard
                  key={slot.id}
                  slot={slot}
                  bookingsCount={countMap.get(slot.id) ?? 0}
                  myBookingId={myBookings.get(slot.id) ?? null}
                />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  )
}
