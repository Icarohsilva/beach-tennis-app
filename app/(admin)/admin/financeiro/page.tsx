// app/(admin)/financeiro/page.tsx
import { createAdminClient, getCurrentOrgId, requireOwner } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { PlansManager } from './PlansManager'
import type { SubscriptionPlan, PaymentStatus } from '@/types'

interface RevenueRow {
  amount: number
  status: PaymentStatus
}

interface InadimplentRow {
  student_id: string
  profiles: { full_name: string } | null
}

interface PendingPayment {
  id: string
  student_id: string
  amount: number
  currency: string
  created_at: string
  profiles: { full_name: string } | null
}

export default async function FinanceiroPage() {
  await requireOwner() // professor → redirecionado para /admin/dashboard
  const adminClient = createAdminClient()
  const orgId = await getCurrentOrgId()

  // ─── Receita do mês ──────────────────────────────────────────────────────
  const startOfMonth = new Date()
  startOfMonth.setDate(1)
  startOfMonth.setHours(0, 0, 0, 0)

  const { data: monthlyPayments } = await adminClient
    .from('payments')
    .select('amount, status')
    .eq('organization_id', orgId)
    .gte('created_at', startOfMonth.toISOString())

  const monthlyRevenue = (monthlyPayments as RevenueRow[] ?? [])
    .filter((p) => p.status === 'paid')
    .reduce((sum, p) => sum + p.amount, 0)

  const pendingRevenue = (monthlyPayments as RevenueRow[] ?? [])
    .filter((p) => p.status === 'pending')
    .reduce((sum, p) => sum + p.amount, 0)

  // ─── Inadimplentes: active subscription + last payment failed ────────────
  const { data: inadimplentesRaw } = await adminClient
    .from('student_subscriptions')
    .select('student_id, profiles:profiles!student_subscriptions_student_id_fkey(full_name)')
    .eq('status', 'active')
    .eq('organization_id', orgId)

  // Filter: students whose last payment has status = 'failed'
  const inadimplentes: InadimplentRow[] = []
  if (inadimplentesRaw) {
    for (const sub of inadimplentesRaw as unknown as InadimplentRow[]) {
      const { data: lastPayment } = await adminClient
        .from('payments')
        .select('status')
        .eq('student_id', sub.student_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (lastPayment?.status === 'failed') {
        inadimplentes.push(sub)
      }
    }
  }

  // ─── Pagamentos pendentes ────────────────────────────────────────────────
  const { data: pendingPaymentsRaw } = await adminClient
    .from('payments')
    .select('id, student_id, amount, currency, created_at, profiles:profiles!payments_student_id_fkey(full_name)')
    .eq('status', 'pending')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
    .limit(20)

  const pendingPayments: PendingPayment[] = (pendingPaymentsRaw as unknown as PendingPayment[]) ?? []

  // ─── Planos ──────────────────────────────────────────────────────────────
  const { data: plansRaw } = await adminClient
    .from('subscription_plans')
    .select('*')
    .eq('organization_id', orgId)
    .order('classes_per_week', { ascending: true })

  const plans: SubscriptionPlan[] = plansRaw ?? []

  function formatCurrency(amount: number) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(amount)
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Financeiro</h1>
        <p className="text-slate-400 text-sm mt-1">Visão geral das finanças da academia</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <p className="text-slate-400 text-xs uppercase tracking-wide mb-1">Receita do mês</p>
          <p className="text-2xl font-bold text-green-400">{formatCurrency(monthlyRevenue)}</p>
          {pendingRevenue > 0 && (
            <p className="text-xs text-yellow-400 mt-1">{formatCurrency(pendingRevenue)} pendente</p>
          )}
        </Card>
        <Card>
          <p className="text-slate-400 text-xs uppercase tracking-wide mb-1">Inadimplentes</p>
          <p className="text-2xl font-bold text-red-400">{inadimplentes.length}</p>
          <p className="text-xs text-slate-400 mt-1">assinaturas ativas com último pagamento falhou</p>
        </Card>
        <Card>
          <p className="text-slate-400 text-xs uppercase tracking-wide mb-1">Pagamentos pendentes</p>
          <p className="text-2xl font-bold text-yellow-400">{pendingPayments.length}</p>
        </Card>
      </div>

      {/* Inadimplentes list */}
      {inadimplentes.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">
            Inadimplentes
          </h2>
          <div className="space-y-2">
            {inadimplentes.map((item) => (
              <Card key={item.student_id}>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-white">
                    {item.profiles?.full_name ?? item.student_id}
                  </span>
                  <Badge variant="danger">Pagamento falhou</Badge>
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* Pagamentos pendentes list */}
      {pendingPayments.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">
            Pagamentos Pendentes
          </h2>
          <div className="space-y-2">
            {pendingPayments.map((payment) => (
              <Card key={payment.id}>
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm text-white">
                      {payment.profiles?.full_name ?? payment.student_id}
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">{formatDate(payment.created_at)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-white">
                      {formatCurrency(payment.amount)}
                    </span>
                    <Badge variant="warning">Pendente</Badge>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* Gerenciar Planos */}
      <section>
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">
          Gerenciar Planos
        </h2>
        <PlansManager plans={plans} />
      </section>
    </div>
  )
}
