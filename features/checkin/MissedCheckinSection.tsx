// features/checkin/MissedCheckinSection.tsx
// Bloco de pendências de CHECK-IN do aluno de parceiro. Espelha
// features/financeiro/DebtSection.tsx: mesmas trilhas de pagamento (Mercado Pago e
// PIX + comprovante), sobre o payments vinculado à pendência.
//
// Separado do DebtSection de propósito: a dívida de aula avulsa é "você assistiu e
// não pagou"; esta é "você faltou e a academia perdeu o repasse do parceiro". São
// cobranças diferentes, com regras de bloqueio diferentes.
import { createAdminClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { PayDebtButton } from '@/features/financeiro/PayDebtButton'
import { DebtReceiptUpload } from '@/features/financeiro/DebtReceiptUpload'
import { summarizeMissedCheckins } from '@/lib/checkin/missedCheckins'
import { getMissedCheckinSettings } from './missedCheckinSettings'
import { formatDate } from '@/lib/utils/dateHelpers'
import type { MissedCheckinStatus } from '@/types'

function fmt(amount: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(amount)
}

interface Props {
  userId: string
  orgId: string
  mpConnected: boolean
}

export async function MissedCheckinSection({ userId, orgId, mpConnected }: Props) {
  const admin = createAdminClient()

  const { data: rowsRaw } = await admin
    .from('missed_checkins')
    .select('id, session_date, amount, status, payment_id, class_sessions(classes(name))')
    .eq('student_id', userId)
    .eq('organization_id', orgId)
    .eq('status', 'open')
    .order('session_date', { ascending: true })

  type Row = {
    id: string
    session_date: string
    amount: number | string
    status: MissedCheckinStatus
    payment_id: string | null
    class_sessions: { classes: { name: string } | { name: string }[] } | null
  }
  const rows = (rowsRaw ?? []) as unknown as Row[]
  if (rows.length === 0) return null

  const pendencies = rows.map((r) => {
    const session = Array.isArray(r.class_sessions) ? r.class_sessions[0] : r.class_sessions
    const cls = Array.isArray(session?.classes) ? session?.classes[0] : session?.classes
    return {
      id: r.id,
      sessionDate: r.session_date,
      amount: Number(r.amount),
      status: r.status,
      paymentId: r.payment_id,
      className: cls?.name ?? 'Aula',
    }
  })

  const { blockLimit } = await getMissedCheckinSettings(admin, orgId)
  const summary = summarizeMissedCheckins(pendencies, blockLimit)

  // Comprovantes já enviados: o estado "aguardando conferência" vem do payments,
  // igual à dívida de avulsa.
  const paymentIds = pendencies.map((p) => p.paymentId).filter((id): id is string => !!id)
  const { data: paymentsRaw } = paymentIds.length > 0
    ? await admin
        .from('payments')
        .select('id, receipt_url')
        .in('id', paymentIds)
    : { data: [] }
  const receiptByPayment = new Map(
    ((paymentsRaw ?? []) as { id: string; receipt_url: string | null }[]).map((p) => [
      p.id,
      p.receipt_url,
    ]),
  )

  const { data: settingsRaw } = await admin
    .from('system_settings')
    .select('key, value')
    .eq('organization_id', orgId)
    .in('key', ['pix_key', 'pix_key_owner'])
  const settings = Object.fromEntries(
    ((settingsRaw ?? []) as { key: string; value: string }[]).map((s) => [s.key, s.value]),
  )
  const pixKey = settings.pix_key ?? ''
  const pixKeyOwner = settings.pix_key_owner ?? ''

  return (
    <section>
      <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">
        Check-ins do parceiro em aberto
      </h2>
      <Card accent>
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-sm text-white font-semibold">
              {summary.openAmount > 0
                ? `${fmt(summary.openAmount)} em aberto`
                : `${summary.openCount} check-in${summary.openCount !== 1 ? 's' : ''} em aberto`}
            </p>
            <p className="text-xs text-slate-400 mt-0.5">
              {summary.openCount} {summary.openCount === 1 ? 'aula' : 'aulas'} sem check-in
            </p>
          </div>
          {summary.blocked ? (
            <Badge variant="danger">Agendamento bloqueado</Badge>
          ) : (
            <Badge variant="warning">Em aberto</Badge>
          )}
        </div>

        {summary.blocked ? (
          <p className="text-xs text-red-400 mt-2">
            Resolva para voltar a agendar aulas.
          </p>
        ) : summary.untilBlock !== null ? (
          <p className="text-xs text-yellow-400 mt-2">
            {summary.untilBlock === 0
              ? 'Seu agendamento será bloqueado se acumular mais uma.'
              : `Mais ${summary.untilBlock} e seu agendamento é bloqueado.`}
          </p>
        ) : (
          <p className="text-xs text-slate-400 mt-2">
            Sem o seu check-in a academia não recebe pela aula.
          </p>
        )}

        <div className="mt-3 space-y-3 border-t border-surface-border pt-3">
          {pendencies.map((p) => (
            <div key={p.id} className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm text-white">
                    {p.amount > 0 ? fmt(p.amount) : 'Sem valor'}
                  </p>
                  <p className="text-xs text-slate-400">
                    {p.className} · {formatDate(p.sessionDate)}
                  </p>
                </div>
                {mpConnected && p.amount > 0 && p.paymentId && (
                  <PayDebtButton paymentId={p.paymentId} />
                )}
              </div>
              {p.paymentId && p.amount > 0 ? (
                <DebtReceiptUpload
                  paymentId={p.paymentId}
                  userId={userId}
                  hasReceipt={!!receiptByPayment.get(p.paymentId)}
                  pixKey={pixKey}
                  pixKeyOwner={pixKeyOwner}
                />
              ) : (
                <p className="text-xs text-slate-500">
                  A academia não definiu valor para este check-in. Fale com ela para
                  regularizar.
                </p>
              )}
            </div>
          ))}
        </div>
      </Card>
    </section>
  )
}
