// app/(admin)/admin/grade/dayuse/[id]/page.tsx
// A tela de UM day use para o admin, no papel que /admin/torneios/[id] faz
// para o torneio: quem está inscrito, quem pagou, o comprovante de cada um, a
// chave PIX de quem tem estorno a receber, edição e divulgação.
//
// Existe porque a lista de day use mostrava só a contagem de reservas — o admin
// não tinha como saber QUEM estava inscrito, nem como conferir um pagamento.
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createAdminClient, getCurrentOrgId } from '@/lib/supabase/server'
import { requirePlatformAccess } from '@/lib/billing/guard'
import { Card } from '@/components/ui/Card'
import { formatDate, formatTime } from '@/lib/utils/dateHelpers'
import { getOrgSports } from '@/lib/arenas/orgSports'
import { getSiteUrl } from '@/lib/utils/siteUrl'
import { sportEmoji, sportLabel } from '@/lib/arenas/sports'
import {
  DAY_USE_KIND_LABEL,
  dayUsePriceView,
  formatDayUsePrice,
} from '@/lib/dayuse/dayUseKind'
import { dayUseShareMessage } from '@/lib/dayuse/publicPage'
import { getDayUsePricing } from '@/features/dayuse/pricing'
import { getAdminDayUse } from '@/features/dayuse/adminSlotQuery'
import { DayUseShareCard } from './DayUseShareCard'
import { EditDayUseForm } from './EditDayUseForm'
import { AttendeeRow } from './AttendeeRow'

interface PageProps { params: { id: string } }

export default async function AdminDayUseSlotPage({ params }: PageProps) {
  await requirePlatformAccess() // gate de cobranca; ver lib/billing/guard.ts
  const orgId = await getCurrentOrgId()
  if (!orgId) redirect('/selecionar-academia')

  const admin = createAdminClient()
  const [data, pricing, orgSports, orgRow] = await Promise.all([
    getAdminDayUse(admin, { slotId: params.id, orgId }),
    getDayUsePricing(orgId),
    getOrgSports(orgId),
    admin.from('organizations').select('name').eq('id', orgId).maybeSingle(),
  ])
  if (!data) notFound()

  const { slot, attendees, occupied } = data
  // O preço é o preço; o que varia é onde ele é pago (dayUsePriceView).
  const price = dayUsePriceView(slot, pricing)

  const dateLabel = formatDate(slot.date, "EEEE, dd 'de' MMMM")
  const shareUrl = `${getSiteUrl()}/d/${slot.id}`
  const shareMessage = dayUseShareMessage({
    orgName: (orgRow.data?.name as string | undefined) ?? 'nossa arena',
    sportLabel: slot.sport ? sportLabel(slot.sport) : null,
    kind: slot.kind,
    dateLabel,
    startLabel: formatTime(slot.start_time),
    endLabel: formatTime(slot.end_time),
    priceCents: price.priceCents,
    url: shareUrl,
  })

  const ativos = attendees.filter((a) => a.status !== 'cancelled')
  const aConferir = attendees.filter(
    (a) => a.paymentMethod === 'pix_manual' && a.status === 'pending_payment',
  )
  const comEstorno = attendees.filter((a) => a.refund && a.refund.status === 'pendente')

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/admin/grade/dayuse" className="text-sm text-slate-400 hover:text-white">
          ← Day Use
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-bold text-white first-letter:uppercase">{dateLabel}</h1>
        <p className="mt-1 text-sm text-slate-400">
          {formatTime(slot.start_time)}–{formatTime(slot.end_time)} · Espaço {slot.court}
          {slot.sport && ` · ${sportEmoji(slot.sport)} ${sportLabel(slot.sport)}`}
          {' · '}{DAY_USE_KIND_LABEL[slot.kind]}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-lg font-bold text-white">
            {formatDayUsePrice(price.priceCents)}
          </span>
          {price.payOnSite && (
            <span className="rounded-full border border-yellow-700/50 bg-yellow-900/40 px-2 py-0.5 text-xs text-yellow-300">
              Pago na arena
            </span>
          )}
          <span className="text-sm text-slate-400">
            {occupied}/{slot.capacity} {slot.kind === 'open' ? 'pessoas' : 'vagas'}
          </span>
        </div>
        {price.payOnSite && (
          <p className="mt-1 text-xs text-slate-400">
            O aluno vê o preço e reserva pelo app, mas paga na porta — dê baixa na lista
            de inscritos. Para receber online,{' '}
            <Link href="/admin/financeiro/integracoes" className="text-brand-400 hover:text-brand-300">
              conecte o Mercado Pago
            </Link>
            {' ou '}
            <Link href="/admin/configuracoes" className="text-brand-400 hover:text-brand-300">
              cadastrar chave PIX
            </Link>.
          </p>
        )}
        {slot.notes && <p className="mt-2 text-sm text-slate-300">{slot.notes}</p>}
      </div>

      {(aConferir.length > 0 || comEstorno.length > 0) && (
        <Card className="border-yellow-700/50">
          <p className="text-sm font-semibold text-yellow-300">Pendências deste day use</p>
          <ul className="mt-1 space-y-0.5 text-xs text-slate-300">
            {aConferir.length > 0 && (
              <li>
                {aConferir.length} pagamento(s) por PIX aguardando conferência — confirme na
                lista abaixo.
              </li>
            )}
            {comEstorno.length > 0 && (
              <li>
                {comEstorno.length} estorno(s) a pagar. As chaves PIX aparecem na lista; o
                comprovante do estorno é anexado em{' '}
                <Link href="/admin/financeiro/day-use" className="text-brand-400 hover:text-brand-300">
                  Financeiro › Day use
                </Link>.
              </li>
            )}
          </ul>
        </Card>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
          Inscritos ({ativos.length})
        </h2>
        <Card>
          {attendees.length === 0 ? (
            <p className="text-sm text-slate-400">
              Ninguém reservou ainda. Divulgue o link abaixo.
            </p>
          ) : (
            <ul className="divide-y divide-white/[0.06]">
              {attendees.map((a) => <AttendeeRow key={a.bookingId} item={a} />)}
            </ul>
          )}
        </Card>
      </section>

      <DayUseShareCard
        slotId={slot.id}
        shareUrl={shareUrl}
        shareMessage={shareMessage}
        coverImageUrl={slot.cover_image_url}
      />

      <EditDayUseForm
        slot={slot}
        orgSports={orgSports}
        orgDefaultPriceCents={pricing.defaultCents}
        activeBookings={ativos.length}
      />
    </div>
  )
}
