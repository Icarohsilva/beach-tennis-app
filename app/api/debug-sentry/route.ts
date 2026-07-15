// app/api/debug-sentry/route.ts
// ROTA TEMPORÁRIA DE TESTE — remover depois de validar o Sentry em produção.
// Dispara uma exceção de propósito e a captura explicitamente (não depende do
// onRequestError, que o Next 14.2 não invoca). Gateada por Bearer CRON_SECRET
// para não poluir a quota do Sentry — secret vai no header, nunca na URL.
import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { verifyCronSecret } from '@/lib/auth/cronAuth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const dsnConfigured = !!process.env.NEXT_PUBLIC_SENTRY_DSN

  const eventId = Sentry.captureException(
    new Error(`[debug-sentry] teste manual de captura — ${new Date().toISOString()}`),
    { tags: { debug: 'sentry-manual-test' } },
  )

  // flush garante que o evento saiu antes da resposta (serverless pode congelar).
  const flushed = await Sentry.flush(3000)

  return NextResponse.json({
    ok: true,
    dsnConfigured,
    eventId,
    flushed,
    env: process.env.NODE_ENV,
  })
}
