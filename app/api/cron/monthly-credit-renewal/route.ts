// app/api/cron/monthly-credit-renewal/route.ts
// Plano não emite mais crédito (spec §3), então não há renovação a fazer. O que
// resta é reservar as sessões do mês para as matrículas fixas ativas — mesma
// janela, sem tocar em crédito.
import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { reconcileAllActiveEnrollments } from '@/features/aulas/creditReconciliation'
import { getMonthWindow } from '@/lib/utils/monthWindow'
import { verifyCronSecret } from '@/lib/auth/cronAuth'

export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Roda no dia 1 → janela = mês inteiro corrente.
    const { from, to } = getMonthWindow(new Date())
    const summary = await reconcileAllActiveEnrollments(from, to)
    return NextResponse.json({ window: { from, to }, ...summary })
  } catch (e) {
    Sentry.captureException(e, { tags: { cron: 'monthly-credit-renewal' } })
    return NextResponse.json({ error: 'Cron failed' }, { status: 500 })
  }
}
