// app/api/cron/credit-backfill/route.ts
// Execução pontual: desconta os créditos das aulas do mês corrente para
// alunos ativos que já têm matrícula fixa. Idempotente (pula sessões já
// reservadas). Disparar manualmente via curl com o CRON_SECRET.
import { NextRequest, NextResponse } from 'next/server'
import { reconcileAllActiveEnrollments } from '@/features/aulas/creditReconciliation'
import { getRemainingMonthWindow } from '@/lib/utils/monthWindow'

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { from, to } = getRemainingMonthWindow(new Date())
  const summary = await reconcileAllActiveEnrollments(from, to)

  return NextResponse.json({ window: { from, to }, ...summary })
}
