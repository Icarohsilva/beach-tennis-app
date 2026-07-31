// features/financeiro/debtQueries.ts
// Consultas de dívida compartilhadas: o cálculo de bloqueio (features/aulas),
// a tela de cobrança do admin e o bloco do aluno leem daqui.
import type { createAdminClient } from '@/lib/supabase/server'
import { summarizeDebts, type DebtRow, type DebtSummary } from '@/lib/utils/debtRules'

type AdminClient = ReturnType<typeof createAdminClient>

export const DEFAULT_GRACE_DAYS = 7

/** Carência configurada da academia (system_settings), com padrão seguro. */
export async function getDebtGraceDays(client: AdminClient, orgId: string): Promise<number> {
  const { data } = await client
    .from('system_settings')
    .select('value')
    .eq('organization_id', orgId)
    .eq('key', 'debt_block_grace_days')
    .maybeSingle()
  const n = Number((data as { value: string } | null)?.value)
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_GRACE_DAYS
}

export interface DebtorRow {
  studentId: string
  fullName: string
  summary: DebtSummary
  debts: (DebtRow & { sessionDate: string | null })[]
}

/** Devedores de aula avulsa da academia, agregados por aluno. */
export async function getOrgDebtors(client: AdminClient, orgId: string): Promise<DebtorRow[]> {
  const { data: rowsRaw } = await client
    .from('payments')
    .select('id, student_id, amount, created_at, receipt_url, session_id, class_sessions(session_date)')
    .eq('organization_id', orgId)
    .eq('status', 'pending')
    .not('session_id', 'is', null)
    // Pendência de check-in de parceiro tem tela própria (/admin/wellhub) e regra
    // própria de bloqueio. Misturá-la aqui confundiria as duas cobranças.
    .eq('missed_checkin', false)
    .order('created_at', { ascending: true })

  type Row = {
    id: string; student_id: string; amount: number; created_at: string
    receipt_url: string | null
    class_sessions: { session_date: string } | { session_date: string }[] | null
  }
  const rows = (rowsRaw ?? []) as unknown as Row[]
  if (rows.length === 0) return []

  const graceDays = await getDebtGraceDays(client, orgId)
  const now = new Date()

  const ids = Array.from(new Set(rows.map((r) => r.student_id)))
  const { data: profs } = await client.from('profiles').select('id, full_name').in('id', ids)
  const nameById = new Map(
    ((profs ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name]),
  )

  const byStudent = new Map<string, (DebtRow & { sessionDate: string | null })[]>()
  for (const r of rows) {
    const cls = Array.isArray(r.class_sessions) ? r.class_sessions[0] : r.class_sessions
    const list = byStudent.get(r.student_id) ?? []
    list.push({
      id: r.id,
      amount: Number(r.amount),
      createdAt: r.created_at,
      receiptUrl: r.receipt_url,
      sessionDate: cls?.session_date ?? null,
    })
    byStudent.set(r.student_id, list)
  }

  return Array.from(byStudent.entries())
    .map(([studentId, debts]) => ({
      studentId,
      fullName: nameById.get(studentId) ?? 'Aluno',
      summary: summarizeDebts(debts, graceDays, now),
      debts,
    }))
    // Aguardando conferência primeiro (o admin precisa agir), depois maior dívida.
    .sort((a, b) =>
      b.summary.awaitingReview - a.summary.awaitingReview || b.summary.total - a.summary.total,
    )
}
