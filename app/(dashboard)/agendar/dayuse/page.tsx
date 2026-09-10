import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Sun } from 'lucide-react'
import { createClient, createAdminClient, getAuthUser, getActiveOrgId } from '@/lib/supabase/server'
import { DayUseBookingCard } from '@/features/dayuse/DayUseBookingCard'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { EmptyState } from '@/components/ui/EmptyState'
import { Card } from '@/components/ui/Card'
import { formatDate } from '@/lib/utils/dateHelpers'
import type { DayUseSlot } from '@/types'
import { brtToday } from '@/lib/utils/gridSchedule'
import { getDayUsePricing } from '@/features/dayuse/pricing'
import { dayUseChargeCents } from '@/lib/dayuse/dayUseKind'
import { cancelNoticeForStudent } from '@/lib/dayuse/refundRules'
import { PENDING_HOLD_MINUTES, expireStalePendingDayUse, getRefundWindowHours } from '@/features/dayuse/refunds'
import { getWalletBalance } from '@/features/wallet/walletQueries'

export default async function AgendarDayUsePage({
  searchParams,
}: {
  searchParams?: { retorno?: string }
}) {
  const supabase = createClient()
  const user = await getAuthUser()
  if (!user) redirect('/login')

  // Academia ATIVA, explícita: a RLS libera todas as orgs em que o aluno é
  // membro, então quem treina em duas arenas via os day use das duas
  // embaralhados, sem nada dizendo de qual arena era cada um.
  const orgId = await getActiveOrgId()
  if (!orgId) redirect('/selecionar-academia')

  // BRT: com o UTC cru o day use de hoje desaparecia da lista depois das 21h.
  const today = brtToday(new Date())

  // Use adminClient to bypass RLS and see all bookings + names
  const adminClient = createAdminClient()

  const freshLimit = new Date(Date.now() - PENDING_HOLD_MINUTES * 60 * 1000).toISOString()
  // Reservas pendentes vencidas (>30min sem pagamento) são canceladas ao listar.
  // Escopado à academia ativa: sem o filtro, abrir esta página varria e escrevia
  // em reserva de TODAS as academias da plataforma. Cada arena limpa a sua
  // quando alguém abre a lista dela.
  //
  // Passa por expireStalePendingDayUse e não por um update em massa porque a
  // reserva pode ter abatido crédito da carteira: liberar a vaga sem devolver o
  // saldo deixaria o aluno sem os dois.
  await expireStalePendingDayUse(adminClient, orgId)

  // Preço na tela pela MESMA regra do checkout (dayUseChargeCents): o card
  // dizia "Gratuito" fixo, então day use pago aparecia como de graça.
  const pricing = await getDayUsePricing(orgId)
  // Janela de estorno da academia: o aviso de cancelamento tem de citar o prazo
  // real dela, não o default.
  const refundWindowHours = await getRefundWindowHours(adminClient, orgId)
  const walletCents = await getWalletBalance(adminClient, orgId, user.id)
  const nowIso = new Date().toISOString()

  const { data: slots } = await supabase
    .from('dayuse_slots')
    .select('*')
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .gte('date', today)
    .order('date', { ascending: true })
    .order('start_time', { ascending: true })

  const slotList = (slots ?? []) as DayUseSlot[]
  const slotIds = slotList.map((s) => s.id)

  const { data: allBookings } =
    slotIds.length > 0
      ? await adminClient
          .from('dayuse_bookings')
          .select('id, slot_id, student_id, status, booked_at, profiles(full_name)')
          .in('slot_id', slotIds)
          // Prazo por MÉTODO (hold_until): o PIX manual segura 24h, e contar
          // por booked_at o tiraria da ocupação em 30 min.
          .or(
            'status.eq.confirmed,'
            + `and(status.eq.pending_payment,hold_until.gt.${nowIso}),`
            + `and(status.eq.pending_payment,hold_until.is.null,booked_at.gt.${freshLimit})`,
          )
      : { data: [] }

  const countMap = new Map<string, number>()
  const myBookings = new Map<string, string>()
  const myBookingStatus = new Map<string, string>()
  const myBookedAt = new Map<string, string>()
  const attendeesMap = new Map<string, string[]>()

  for (const b of (allBookings ?? []) as {
    id: string
    slot_id: string
    student_id: string
    status: string
    booked_at: string
    profiles: { full_name: string } | { full_name: string }[] | null
  }[]) {
    countMap.set(b.slot_id, (countMap.get(b.slot_id) ?? 0) + 1)
    if (b.student_id === user.id) {
      myBookings.set(b.slot_id, b.id)
      myBookingStatus.set(b.slot_id, b.status)
      myBookedAt.set(b.slot_id, b.booked_at)
    }
    const profile = Array.isArray(b.profiles) ? b.profiles[0] : b.profiles
    if (profile?.full_name) {
      attendeesMap.set(b.slot_id, [...(attendeesMap.get(b.slot_id) ?? []), profile.full_name])
    }
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
        <p className="text-slate-400 text-sm mt-1">Reserva de espaço sem usar créditos</p>
      </div>
      {searchParams?.retorno === '1' && (
        <Card>
          <p className="text-sm text-white">
            Pagamento em processamento. Sua reserva será confirmada em instantes.
          </p>
        </Card>
      )}
      {byDate.size === 0 ? (
        <EmptyState
          icon={Sun}
          title="Nenhum horário disponível"
          description="O professor divulga os horários de day use com antecedência."
        />
      ) : (
        Array.from(byDate.entries()).map(([date, dateSlots]) => (
          <div key={date}>
            <SectionHeader title={formatDate(date, "EEEE, dd 'de' MMMM")} />
            <div className="space-y-2">
              {dateSlots.map((slot) => (
                <DayUseBookingCard
                  key={slot.id}
                  slot={slot}
                  bookingsCount={countMap.get(slot.id) ?? 0}
                  myBookingId={myBookings.get(slot.id) ?? null}
                  myBookingStatus={myBookingStatus.get(slot.id) ?? null}
                  attendees={attendeesMap.get(slot.id) ?? []}
                  priceCents={dayUseChargeCents(slot, pricing)}
                  walletCents={walletCents}
                  cancelNotice={cancelNoticeForStudent({
                    date: slot.date,
                    start_time: slot.start_time,
                    bookedAtIso: myBookedAt.get(slot.id) ?? null,
                    nowIso,
                    paidCents: dayUseChargeCents(slot, pricing),
                    windowHours: refundWindowHours,
                  })}
                />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  )
}
