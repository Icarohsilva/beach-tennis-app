// app/(admin)/admin/financeiro/day-use/page.tsx
// Fila de estornos de day use: o que a academia deve devolver, a quem, e onde
// anexar o comprovante do PIX feito.
//
// Mover dinheiro é ato humano — o app registra, guarda o comprovante e cobra a
// confirmação do aluno. Mesma escolha de platform_refund_requests.
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createAdminClient, getCurrentOrgId } from '@/lib/supabase/server'
import { requirePlatformAccess } from '@/lib/billing/guard'
import { Card } from '@/components/ui/Card'
import { getOrgRefunds } from '@/features/dayuse/refundQueries'
import { formatDayUsePrice } from '@/lib/dayuse/dayUseKind'
import { RefundQueueRow } from './RefundQueueRow'

export default async function AdminDayUseFinanceiroPage() {
  await requirePlatformAccess() // gate de cobranca; ver lib/billing/guard.ts
  const orgId = await getCurrentOrgId()
  if (!orgId) redirect('/selecionar-academia')

  const refunds = await getOrgRefunds(createAdminClient(), orgId)
  const aPagar = refunds.filter((r) => r.status === 'pendente')
  const aguardando = refunds.filter((r) => r.status === 'pago')
  const encerrados = refunds.filter((r) => r.status === 'confirmado' || r.status === 'creditado')

  const totalDevido = aPagar.reduce((sum, r) => sum + r.amount_cents, 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/admin/financeiro" className="text-sm text-slate-400 hover:text-white">
          ← Financeiro
        </Link>
      </div>

      <div className="flex flex-col gap-1 xs:flex-row xs:items-baseline xs:justify-between">
        <h1 className="text-2xl font-bold text-white">Estornos de day use</h1>
        <p className="shrink-0 text-sm text-slate-400">
          {aPagar.length > 0
            ? `${formatDayUsePrice(totalDevido)} a devolver`
            : 'Nada a devolver'}
        </p>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
          A pagar
        </h2>
        <Card>
          {aPagar.length === 0 ? (
            <p className="text-sm text-slate-400">
              Nenhum estorno pendente. Cancelamento de horário pago entra aqui automaticamente.
            </p>
          ) : (
            <ul className="divide-y divide-white/[0.06]">
              {aPagar.map((r) => <RefundQueueRow key={r.id} refund={r} />)}
            </ul>
          )}
        </Card>
      </section>

      {aguardando.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
            Aguardando confirmação do aluno
          </h2>
          <Card>
            <ul className="divide-y divide-white/[0.06]">
              {aguardando.map((r) => <RefundQueueRow key={r.id} refund={r} />)}
            </ul>
          </Card>
        </section>
      )}

      {encerrados.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
            Encerrados
          </h2>
          <Card>
            <ul className="divide-y divide-white/[0.06]">
              {encerrados.slice(0, 20).map((r) => <RefundQueueRow key={r.id} refund={r} />)}
            </ul>
          </Card>
        </section>
      )}
    </div>
  )
}
