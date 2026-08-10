// features/financeiro/DebtSection.tsx
// Bloco de pendências de aula avulsa do aluno (spec 2026-07-22 §3): mostra o
// que está em aberto, o resumo/bloqueio e as trilhas de pagamento (MP e PIX).
import { createAdminClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { summarizeDebts, type DebtRow } from '@/lib/utils/debtRules'
import { formatDate } from '@/lib/utils/dateHelpers'
import { getDebtGraceDays } from './debtQueries'
import { PayDebtButton } from './PayDebtButton'
import { DebtReceiptUpload } from './DebtReceiptUpload'

const DAY_MS = 24 * 60 * 60 * 1000

function fmt(amount: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(amount)
}
// formatDate, não `new Date(...)`: `sessionDate` é data pura (yyyy-MM-dd) e o
// construtor a lê como meia-noite UTC — em BRT (UTC−3) isso volta 3h e a aula do
// dia 01 era exibida como dia 31 do mês anterior. `formatDate` preserva o dia do
// calendário para data pura e mantém o parse normal para timestamptz (createdAt).
function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return formatDate(iso)
}

interface Props {
  userId: string
  orgId: string
  mpConnected: boolean
}

export async function DebtSection({ userId, orgId, mpConnected }: Props) {
  const admin = createAdminClient()

  const { data: rowsRaw } = await admin
    .from('payments')
    .select('id, amount, created_at, receipt_url, class_sessions(session_date)')
    .eq('student_id', userId)
    .eq('organization_id', orgId)
    .eq('status', 'pending')
    .not('session_id', 'is', null)
    .order('created_at', { ascending: true })

  type Row = {
    id: string
    amount: number
    created_at: string
    receipt_url: string | null
    class_sessions: { session_date: string } | { session_date: string }[] | null
  }
  const rows = (rowsRaw ?? []) as unknown as Row[]
  if (rows.length === 0) return null

  const graceDays = await getDebtGraceDays(admin, orgId)
  const now = new Date()

  const debts: (DebtRow & { sessionDate: string | null })[] = rows.map((r) => {
    const cls = Array.isArray(r.class_sessions) ? r.class_sessions[0] : r.class_sessions
    return {
      id: r.id,
      amount: Number(r.amount),
      createdAt: r.created_at,
      receiptUrl: r.receipt_url,
      sessionDate: cls?.session_date ?? null,
    }
  })
  const summary = summarizeDebts(debts, graceDays, now)

  // Chave PIX da academia (opcional).
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

  // Se ainda não bloqueado, quantos dias faltam (a partir da mais antiga).
  let daysUntilBlock: number | null = null
  if (!summary.isBlocked && summary.oldestAt) {
    const blockAt = new Date(summary.oldestAt).getTime() + graceDays * DAY_MS
    daysUntilBlock = Math.max(0, Math.ceil((blockAt - now.getTime()) / DAY_MS))
  }

  return (
    <section>
      <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">Aulas em aberto</h2>
      <Card accent>
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-sm text-white font-semibold">{fmt(summary.total)} em aberto</p>
            <p className="text-xs text-slate-400 mt-0.5">
              {summary.count} {summary.count === 1 ? 'aula avulsa' : 'aulas avulsas'}
            </p>
          </div>
          {summary.isBlocked ? (
            <Badge variant="danger">Agendamento bloqueado</Badge>
          ) : (
            <Badge variant="warning">Em aberto</Badge>
          )}
        </div>

        {summary.isBlocked ? (
          <p className="text-xs text-red-400 mt-2">
            Regularize para voltar a agendar aulas.
          </p>
        ) : daysUntilBlock !== null ? (
          <p className="text-xs text-yellow-400 mt-2">
            {daysUntilBlock === 0
              ? 'Seu agendamento será bloqueado em breve se não regularizar.'
              : `Você tem ${daysUntilBlock} ${daysUntilBlock === 1 ? 'dia' : 'dias'} antes do bloqueio.`}
          </p>
        ) : null}

        <div className="mt-3 space-y-3 border-t border-surface-border pt-3">
          {debts.map((d) => (
            <div key={d.id} className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm text-white">{fmt(d.amount)}</p>
                  <p className="text-xs text-slate-400">Aula de {fmtDate(d.sessionDate)}</p>
                </div>
                {mpConnected && d.amount > 0 && <PayDebtButton paymentId={d.id} />}
              </div>
              <DebtReceiptUpload
                paymentId={d.id}
                userId={userId}
                hasReceipt={!!d.receiptUrl}
                pixKey={pixKey}
                pixKeyOwner={pixKeyOwner}
              />
            </div>
          ))}
        </div>
      </Card>
    </section>
  )
}
