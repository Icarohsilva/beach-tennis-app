import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createAdminClient, getCurrentOrgId } from '@/lib/supabase/server'
import { CreateDayUseForm } from '@/features/dayuse/CreateDayUseForm'
import { DayUseRecurrencePanel } from '@/features/dayuse/DayUseRecurrencePanel'
import { DayUseSlotCard } from '@/features/dayuse/DayUseSlotCard'
import { formatDate } from '@/lib/utils/dateHelpers'
import { Card } from '@/components/ui/Card'
import type { DayUseRecurrence, DayUseSlot } from '@/types'
import { requirePlatformAccess } from '@/lib/billing/guard'
import { brtToday } from '@/lib/utils/gridSchedule'
import { getOrgSports } from '@/lib/arenas/orgSports'
import { canCollectOnline, getDayUsePricing } from '@/features/dayuse/pricing'
import { dayUsePriceView } from '@/lib/dayuse/dayUseKind'
import { DAY_USE_HORIZON_DAYS } from '@/features/dayuse/generation'

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

  const { data: recurrencesRaw } = await adminClient
    .from('dayuse_recurrences')
    .select('*')
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .order('day_of_week', { ascending: true })
    .order('start_time', { ascending: true })

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

  // Slots cobrados na arena (sem pagamento online). Não é defeito — é o modo
  // mais comum —, mas a arena precisa saber que o app não recolhe esse dinheiro.
  const naArena = slotList.filter((s) => dayUsePriceView(s, pricing).payOnSite)
  // Marcados para pagar na inscrição sem forma de receber online: o app cobra
  // na arena e o admin precisa saber POR QUÊ, senão parece defeito.
  const semComoCobrar = slotList.filter((s) => dayUsePriceView(s, pricing).needsSetup)
  const podeCobrarOnline = canCollectOnline(pricing)

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

      {/* Sem pagamento online, o preço é cobrado na arena. O aviso existe porque
          a arena precisa saber que o app não recolhe esse dinheiro — antes daqui
          a tela simplesmente dizia "Gratuito". */}
      {naArena.length > 0 && (
        <Card className="border-yellow-700/50">
          <p className="text-sm font-semibold text-yellow-300">
            {naArena.length === 1
              ? '1 day use é pago na arena'
              : `${naArena.length} day use são pagos na arena`}
          </p>
          <p className="mt-1 text-xs text-slate-300">
            O aluno vê o preço e reserva pelo app, mas o pagamento acontece na porta —
            a academia dá baixa na tela de cada day use. Para receber na inscrição, marque
            &quot;Pagar na inscrição&quot; no day use
            {podeCobrarOnline ? '.' : ' e conecte o Mercado Pago ou cadastre a chave PIX.'}
          </p>
          {semComoCobrar.length > 0 && (
            <p className="mt-1 text-xs text-yellow-300">
              {semComoCobrar.length === 1
                ? '1 deles pede pagamento na inscrição'
                : `${semComoCobrar.length} deles pedem pagamento na inscrição`}
              , mas não há Mercado Pago conectado nem chave PIX — por isso caíram na arena.
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-3">
            <Link
              href="/admin/financeiro/integracoes"
              className="text-xs text-brand-400 hover:text-brand-300"
            >
              Conectar Mercado Pago
            </Link>
            <Link
              href="/admin/configuracoes"
              className="text-xs text-brand-400 hover:text-brand-300"
            >
              Cadastrar chave PIX
            </Link>
          </div>
        </Card>
      )}
      <DayUseRecurrencePanel
        recurrences={(recurrencesRaw ?? []) as DayUseRecurrence[]}
        orgSports={orgSports}
        orgDefaultPriceCents={pricing.defaultCents}
        horizonDays={DAY_USE_HORIZON_DAYS}
        canCollectOnline={podeCobrarOnline}
      />
      <div>
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-2">
          Data avulsa
        </h2>
        <CreateDayUseForm
          orgSports={orgSports}
          orgDefaultPriceCents={pricing.defaultCents}
          canCollectOnline={podeCobrarOnline}
        />
      </div>
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
                    priceCents={dayUsePriceView(slot, pricing).priceCents}
                    payOnSite={dayUsePriceView(slot, pricing).payOnSite}
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
