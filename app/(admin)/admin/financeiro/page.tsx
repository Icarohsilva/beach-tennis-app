// app/(admin)/financeiro/page.tsx
import Link from 'next/link'
import { createAdminClient, getCurrentOrgId, requireOwner } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { FinanceiroSubnav } from './FinanceiroSubnav'
import { PartnerRevenueCard } from './PartnerRevenueCard'
import {
  getPartnerCheckinRates,
  getPartnerRevenueThisMonth,
} from '@/features/financeiro/partnerRevenueActions'
import { isSubscriptionCurrent } from '@/lib/billing/periodicity'
import type { PaymentStatus } from '@/types'

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

  // ─── Inadimplentes: assinatura ativa/vencida OU último pagamento falhou ───
  const { data: inadimplentesRaw } = await adminClient
    .from('student_subscriptions')
    .select('student_id, status, gateway, current_period_end, profiles:profiles!student_subscriptions_student_id_fkey(full_name)')
    .in('status', ['active', 'past_due'])
    .eq('organization_id', orgId)

  const now = new Date()
  const inadimplentes: InadimplentRow[] = []
  if (inadimplentesRaw) {
    for (const sub of inadimplentesRaw as unknown as (InadimplentRow & {
      status: string
      gateway: string
      current_period_end: string | null
    })[]) {
      if (sub.status === 'past_due' || !isSubscriptionCurrent(sub, now)) {
        inadimplentes.push(sub)
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
      if (lastPayment?.status === 'failed') inadimplentes.push(sub)
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

  // Day use pago fora do prazo: pagamento entrou mas a reserva expirou →
  // estornar manualmente no painel do MP (spec §3.5).
  const { data: refundsRaw } = await adminClient
    .from('payments')
    .select('id, amount, created_at, profiles:profiles!payments_student_id_fkey(full_name), dayuse_bookings!payments_dayuse_booking_id_fkey!inner(status)')
    .eq('organization_id', orgId)
    .eq('type', 'day_use')
    .eq('status', 'paid')
    .eq('dayuse_bookings.status', 'cancelled')

  interface RefundRow {
    id: string
    amount: number
    created_at: string
    profiles: { full_name: string } | null
  }
  const pendingRefunds = (refundsRaw as unknown as RefundRow[]) ?? []

  // ─── Receita de parceiro (Wellhub/TotalPass) ─────────────────────────────
  const partnerRates = await getPartnerCheckinRates()
  const partnerRevenue = await getPartnerRevenueThisMonth()

  // Aviso: aluno de parceiro com meta 0 não soma na receita.
  const { data: partnerMembershipsRaw } = await adminClient
    .from('memberships')
    .select('monthly_checkin_target')
    .eq('organization_id', orgId)
    .in('payment_type', ['wellhub', 'totalpass'])
  const hasZeroTargetStudents = (
    (partnerMembershipsRaw ?? []) as { monthly_checkin_target: number }[]
  ).some((m) => (m.monthly_checkin_target ?? 0) === 0)

  // ─── Status da conexão Mercado Pago ──────────────────────────────────────
  const { data: mpAccount } = await adminClient
    .from('org_gateway_accounts')
    .select('status, mp_user_id')
    .eq('organization_id', orgId)
    .eq('gateway', 'mercadopago')
    .maybeSingle()

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
      <FinanceiroSubnav />

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
          <p className="text-xs text-slate-400 mt-1">assinaturas vencidas ou com último pagamento falhou</p>
        </Card>
        <Card>
          <p className="text-slate-400 text-xs uppercase tracking-wide mb-1">Pagamentos pendentes</p>
          <p className="text-2xl font-bold text-yellow-400">{pendingPayments.length}</p>
        </Card>
      </div>

      <Card>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-white">Mercado Pago</p>
            <p className="text-xs text-slate-400 mt-0.5">
              {mpAccount?.status === 'connected'
                ? `Conectado (conta ${mpAccount.mp_user_id ?? ''}) — alunos podem pagar pelo app.`
                : mpAccount?.status === 'expired'
                  ? 'Conexão expirada — reconecte para voltar a receber pelo app.'
                  : 'Conecte a conta da academia para receber planos, aula avulsa e day use pelo app.'}
            </p>
          </div>
          <Link
            href="/admin/financeiro/integracoes"
            className="shrink-0 text-sm font-medium text-brand-500"
          >
            {mpAccount?.status === 'connected' ? 'Gerenciar →' : 'Conectar →'}
          </Link>
        </div>
      </Card>

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
                  <Badge variant="danger">Inadimplente</Badge>
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

      {pendingRefunds.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">
            Reembolsos pendentes (day use)
          </h2>
          <div className="space-y-2">
            {pendingRefunds.map((r) => (
              <Card key={r.id}>
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm text-white">{r.profiles?.full_name ?? r.id}</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Pagou o day use, mas a reserva expirou — estorne no painel do Mercado Pago.
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-white">{formatCurrency(r.amount)}</span>
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* Parceiros (Wellhub/TotalPass) */}
      <section>
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">
          Parceiros (Wellhub/TotalPass)
        </h2>
        <PartnerRevenueCard
          initialRates={partnerRates}
          initialRevenue={partnerRevenue}
          hasZeroTargetStudents={hasZeroTargetStudents}
        />
      </section>
    </div>
  )
}
