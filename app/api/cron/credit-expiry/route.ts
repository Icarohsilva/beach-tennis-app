// app/api/cron/credit-expiry/route.ts
// Expira créditos vencidos. Até 2026-07 isto NÃO existia: credit_expiry_days era
// configurável na UI e não fazia nada. Passou a importar porque, com plano deixando
// de emitir crédito, o saldo acumula de verdade (spec §3.1).
import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { createAdminClient } from '@/lib/supabase/server'
import { verifyCronSecret } from '@/lib/auth/cronAuth'
import { replayCredits } from '@/lib/utils/creditLots'

export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const admin = createAdminClient()
    const now = new Date()

    // Só quem tem saldo pode ter crédito a expirar.
    const { data: membersRaw } = await admin
      .from('memberships')
      .select('user_id, organization_id, credits_balance')
      .gt('credits_balance', 0)

    const members = (membersRaw ?? []) as {
      user_id: string
      organization_id: string
      credits_balance: number
    }[]

    let expiredStudents = 0
    let expiredCredits = 0
    let failed = 0

    for (const m of members) {
      try {
        const { data: txsRaw } = await admin
          .from('credit_transactions')
          .select('amount, created_at, expires_at')
          .eq('student_id', m.user_id)
          .eq('organization_id', m.organization_id)

        const txs = (txsRaw ?? []) as {
          amount: number
          created_at: string
          expires_at: string | null
        }[]

        const { expiredAmount } = replayCredits(txs, now)
        if (expiredAmount <= 0) continue

        // adjust_credits mantém credit_transactions como fonte da verdade e o
        // saldo cacheado em sincronia — nunca faça UPDATE direto no saldo.
        const { error } = await admin.rpc('adjust_credits', {
          p_student_id: m.user_id,
          p_org: m.organization_id,
          p_delta: -expiredAmount,
          p_type: 'expired',
          p_reason: `Expiração de ${expiredAmount} crédito(s) não utilizado(s)`,
        })
        if (error) throw new Error(error.message)

        expiredStudents++
        expiredCredits += expiredAmount
      } catch (err) {
        failed++
        console.error('[cron/credit-expiry] falhou para um aluno', {
          studentId: m.user_id,
          organizationId: m.organization_id,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    return NextResponse.json({ expiredStudents, expiredCredits, failed })
  } catch (e) {
    Sentry.captureException(e, { tags: { cron: 'credit-expiry' } })
    return NextResponse.json({ error: 'Cron failed' }, { status: 500 })
  }
}
