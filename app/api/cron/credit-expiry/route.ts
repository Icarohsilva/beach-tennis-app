// app/api/cron/credit-expiry/route.ts
// Expira créditos vencidos. Até 2026-07 isto NÃO existia: credit_expiry_days era
// configurável na UI e não fazia nada. Passou a importar porque, com plano deixando
// de emitir crédito, o saldo acumula de verdade (spec §3.1).
//
// Reescrito para escala: a primeira versão lia as memberships com saldo (sem
// paginação — chegavam no máximo 1.000) e fazia, POR ALUNO e em série, um select
// no extrato mais um RPC. Com 300 mil alunos isso é ~100 mil round-trips
// sequenciais numa invocação só: não termina, e o teto de 1.000 escondia o
// problema fazendo o cron "passar" varrendo uma fatia arbitrária da base.
//
// Agora: memberships paginadas, extrato lido em lote por academia, e RPC só para
// quem realmente tem crédito vencido (subconjunto pequeno), com paralelismo
// limitado e orçamento de tempo. O que não couber na janela fica para amanhã —
// expirar é idempotente, a passada seguinte reencontra o mesmo saldo.
import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { createAdminClient } from '@/lib/supabase/server'
import { verifyCronSecret } from '@/lib/auth/cronAuth'
import { replayCredits, type CreditTx } from '@/lib/utils/creditLots'
import { fetchAllPages, chunk, IN_CHUNK_SIZE } from '@/lib/supabase/paginate'
import { mapWithConcurrency } from '@/lib/utils/concurrency'

export const maxDuration = 300

/** Margem para responder antes de a plataforma matar a função. */
const TIME_BUDGET_MS = 240_000

/** RPCs de expiração em voo ao mesmo tempo. */
const RPC_CONCURRENCY = 8

interface MemberRow {
  user_id: string
  organization_id: string
}

interface TxRow extends CreditTx {
  student_id: string
}

export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const startedAt = Date.now()
  const deadline = startedAt + TIME_BUDGET_MS

  try {
    const admin = createAdminClient()
    const now = new Date()

    // Só quem tem saldo pode ter crédito a expirar.
    const members = await fetchAllPages<MemberRow>(
      (from, to) =>
        admin
          .from('memberships')
          .select('user_id, organization_id')
          .gt('credits_balance', 0)
          .order('organization_id', { ascending: true })
          .order('user_id', { ascending: true })
          .range(from, to),
      { label: 'cron/credit-expiry:memberships' },
    )

    // Agrupa por academia: o extrato é por (aluno, academia), então a leitura em
    // lote precisa fixar a academia para não misturar carteira de arenas diferentes.
    const byOrg = new Map<string, string[]>()
    for (const m of members) {
      const list = byOrg.get(m.organization_id) ?? []
      list.push(m.user_id)
      byOrg.set(m.organization_id, list)
    }

    // Descobre quem tem crédito vencido — leitura em lote, sem tocar no banco
    // para escrever. replayCredits é puro (lib/utils/creditLots.ts).
    const pending: { studentId: string; orgId: string; amount: number }[] = []
    let readFailures = 0

    for (const [orgId, studentIds] of Array.from(byOrg.entries())) {
      if (Date.now() >= deadline) break

      for (const slice of chunk(studentIds, IN_CHUNK_SIZE)) {
        if (Date.now() >= deadline) break
        try {
          const txs = await fetchAllPages<TxRow>(
            (from, to) =>
              admin
                .from('credit_transactions')
                .select('student_id, amount, created_at, expires_at')
                .eq('organization_id', orgId)
                .in('student_id', slice)
                .order('id', { ascending: true })
                .range(from, to),
            { label: 'cron/credit-expiry:transactions' },
          )

          const byStudent = new Map<string, CreditTx[]>()
          for (const t of txs) {
            const list = byStudent.get(t.student_id) ?? []
            list.push({ amount: t.amount, created_at: t.created_at, expires_at: t.expires_at })
            byStudent.set(t.student_id, list)
          }

          for (const studentId of slice) {
            const { expiredAmount } = replayCredits(byStudent.get(studentId) ?? [], now)
            if (expiredAmount > 0) pending.push({ studentId, orgId, amount: expiredAmount })
          }
        } catch (err) {
          readFailures++
          console.error('[cron/credit-expiry] falhou ao ler o extrato de um lote', {
            organizationId: orgId,
            students: slice.length,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }
    }

    // Escrita só para quem tem o que expirar.
    let expiredStudents = 0
    let expiredCredits = 0
    let writeFailures = 0

    const { skipped } = await mapWithConcurrency(
      pending,
      async (item) => {
        try {
          // adjust_credits mantém credit_transactions como fonte da verdade e o
          // saldo cacheado em sincronia — nunca faça UPDATE direto no saldo.
          const { error } = await admin.rpc('adjust_credits', {
            p_student_id: item.studentId,
            p_org: item.orgId,
            p_delta: -item.amount,
            p_type: 'expired',
            p_reason: `Expiração de ${item.amount} crédito(s) não utilizado(s)`,
          })
          if (error) throw new Error(error.message)
          expiredStudents++
          expiredCredits += item.amount
        } catch (err) {
          writeFailures++
          console.error('[cron/credit-expiry] falhou para um aluno', {
            studentId: item.studentId,
            organizationId: item.orgId,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      },
      { concurrency: RPC_CONCURRENCY, deadline },
    )

    const truncated = skipped > 0 || Date.now() >= deadline
    if (truncated) {
      // Não é erro, mas precisa aparecer: significa que a base passou do que cabe
      // numa invocação e o cron virou trabalho de várias passadas.
      Sentry.captureMessage('[cron/credit-expiry] varredura incompleta no orçamento de tempo', {
        level: 'warning',
        extra: { membersScanned: members.length, pending: pending.length, skipped },
      })
    }

    return NextResponse.json({
      membersScanned: members.length,
      expiredStudents,
      expiredCredits,
      failed: readFailures + writeFailures,
      skipped,
      truncated,
      elapsedMs: Date.now() - startedAt,
    })
  } catch (e) {
    Sentry.captureException(e, { tags: { cron: 'credit-expiry' } })
    return NextResponse.json({ error: 'Cron failed' }, { status: 500 })
  }
}
