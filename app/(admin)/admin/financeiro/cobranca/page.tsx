// app/(admin)/admin/financeiro/cobranca/page.tsx
import { createAdminClient, getCurrentOrgId, requireOwner } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { FinanceiroSubnav } from '../FinanceiroSubnav'
import { getOrgDebtors } from '@/features/financeiro/debtQueries'
import { DebtorRow, type DebtItem } from './DebtorRow'
import { ChargeButton } from './ChargeButton'
import { isSubscriptionCurrent } from '@/lib/billing/periodicity'
import { requirePlatformAccess } from '@/lib/billing/guard'

export default async function CobrancaPage() {
  await requirePlatformAccess() // gate de cobranca; ver lib/billing/guard.ts
  await requireOwner()
  const adminClient = createAdminClient()
  const orgId = (await getCurrentOrgId()) as string

  // ─── Aulas avulsas em aberto (agregado por aluno) ────────────────────────
  const debtors = await getOrgDebtors(adminClient, orgId)

  // URL assinada por comprovante (bucket privado payment-receipts).
  const rowsForClient = await Promise.all(
    debtors.map(async (d) => {
      const debts: DebtItem[] = await Promise.all(
        d.debts.map(async (debt) => {
          let receiptSignedUrl: string | null = null
          if (debt.receiptUrl) {
            const { data } = await adminClient.storage
              .from('payment-receipts')
              .createSignedUrl(debt.receiptUrl, 60 * 10)
            receiptSignedUrl = data?.signedUrl ?? null
          }
          return {
            id: debt.id,
            amount: debt.amount,
            createdAt: debt.createdAt,
            receiptUrl: debt.receiptUrl,
            sessionDate: debt.sessionDate,
            receiptSignedUrl,
          }
        }),
      )
      return {
        studentId: d.studentId,
        fullName: d.fullName,
        total: d.summary.total,
        count: d.summary.count,
        isBlocked: d.summary.isBlocked,
        awaitingReview: d.summary.awaitingReview,
        debts,
      }
    }),
  )

  // ─── Assinaturas vencidas (mesmo cálculo da visão geral) ─────────────────
  const { data: subsRaw } = await adminClient
    .from('student_subscriptions')
    .select('student_id, status, gateway, current_period_end, profiles:profiles!student_subscriptions_student_id_fkey(full_name)')
    .in('status', ['active', 'past_due'])
    .eq('organization_id', orgId)

  const now = new Date()
  interface SubRow {
    student_id: string
    status: string
    gateway: string
    current_period_end: string | null
    profiles: { full_name: string } | null
  }
  const overdueSubs: SubRow[] = []
  for (const sub of (subsRaw ?? []) as unknown as SubRow[]) {
    if (sub.status === 'past_due' || !isSubscriptionCurrent(sub, now)) {
      overdueSubs.push(sub)
      continue
    }
    const { data: lastPayment } = await adminClient
      .from('payments')
      .select('status')
      .eq('student_id', sub.student_id)
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if ((lastPayment as { status: string } | null)?.status === 'failed') overdueSubs.push(sub)
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Financeiro</h1>
        <p className="text-slate-400 text-sm mt-1">Cobrança de aulas avulsas e assinaturas vencidas</p>
      </div>
      <FinanceiroSubnav />

      <section>
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">
          Aulas avulsas em aberto
        </h2>
        {rowsForClient.length === 0 ? (
          <Card>
            <p className="text-sm text-slate-400">Ninguém com aula avulsa em aberto. 🎉</p>
          </Card>
        ) : (
          <div className="space-y-2">
            {rowsForClient.map((r) => (
              <DebtorRow key={r.studentId} {...r} />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">
          Assinaturas vencidas
        </h2>
        {overdueSubs.length === 0 ? (
          <Card>
            <p className="text-sm text-slate-400">Nenhuma assinatura vencida.</p>
          </Card>
        ) : (
          <div className="space-y-2">
            {overdueSubs.map((sub) => (
              <Card key={sub.student_id}>
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm text-white">{sub.profiles?.full_name ?? sub.student_id}</p>
                    <p className="text-xs text-slate-400 mt-0.5">Assinatura vencida ou pagamento falhou</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="danger">Inadimplente</Badge>
                    <ChargeButton studentId={sub.student_id} />
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
