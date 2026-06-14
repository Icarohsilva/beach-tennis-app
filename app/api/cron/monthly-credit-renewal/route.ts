import { NextRequest, NextResponse } from 'next/server'
import { reconcileAllActiveEnrollments } from '@/features/aulas/creditReconciliation'
import { getMonthWindow } from '@/lib/utils/monthWindow'

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Roda no dia 1 → janela = mês inteiro corrente.
  const { from, to } = getMonthWindow(new Date())
  const summary = await reconcileAllActiveEnrollments(from, to)

  return NextResponse.json({ window: { from, to }, ...summary })
}
