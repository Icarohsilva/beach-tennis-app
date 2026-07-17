// app/api/cron/credit-backfill/route.ts
// Execução pontual: reserva as sessões do mês corrente para alunos ativos que
// já têm matrícula fixa. Não mexe em crédito (spec 2026-07: matrícula fixa
// exige plano ou parceiro, não crédito). Idempotente (pula sessões já
// reservadas). Disparar manualmente via curl com o CRON_SECRET.
import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { reconcileAllActiveEnrollments } from '@/features/aulas/creditReconciliation'
import { getRemainingMonthWindow } from '@/lib/utils/monthWindow'
import { verifyCronSecret } from '@/lib/auth/cronAuth'

export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { from, to } = getRemainingMonthWindow(new Date())
    const summary = await reconcileAllActiveEnrollments(from, to)
    return NextResponse.json({ window: { from, to }, ...summary })
  } catch (e) {
    Sentry.captureException(e, { tags: { cron: 'credit-backfill' } })
    return NextResponse.json({ error: 'Cron failed' }, { status: 500 })
  }
}
