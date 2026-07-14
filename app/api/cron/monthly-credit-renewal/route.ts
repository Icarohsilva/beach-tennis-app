import { NextRequest, NextResponse } from 'next/server'
import { reconcileAllActiveEnrollments } from '@/features/aulas/creditReconciliation'
import { getMonthWindow } from '@/lib/utils/monthWindow'
import { verifyCronSecret } from '@/lib/auth/cronAuth'

export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Roda no dia 1 → janela = mês inteiro corrente.
  const { from, to } = getMonthWindow(new Date())
  const summary = await reconcileAllActiveEnrollments(from, to)

  return NextResponse.json({ window: { from, to }, ...summary })
}
