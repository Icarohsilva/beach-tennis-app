// app/api/cron/capacity-snapshot/route.ts
// Retrato diário do tamanho da operação. Barato (uma RPC + um insert) e o único
// jeito de responder "quando preciso subir de plano?" com data em vez de palpite:
// o valor de hoje sozinho não diz nada, a série de 30 dias dá o ritmo.
import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { createAdminClient } from '@/lib/supabase/server'
import { verifyCronSecret } from '@/lib/auth/cronAuth'
import { takeCapacitySnapshot } from '@/features/plataforma/capacityQuery'
import { avaliarLimites } from '@/lib/plataforma/capacity'

export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const metrics = await takeCapacitySnapshot(createAdminClient())
    const limites = avaliarLimites(metrics)
    const criticos = limites.filter((l) => l.severidade !== 'ok')

    // Teto cruzado não pode depender de alguém abrir o painel para descobrir.
    if (criticos.length > 0) {
      Sentry.captureMessage('[capacidade] limite de plano em atenção ou estourado', {
        level: criticos.some((l) => l.severidade === 'estourado') ? 'error' : 'warning',
        extra: {
          limites: criticos.map((l) => ({ id: l.id, uso: Number(l.uso.toFixed(2)) })),
          orgs: metrics.orgs,
          alunos: metrics.alunos,
        },
      })
    }

    return NextResponse.json({
      orgs: metrics.orgs,
      alunos: metrics.alunos,
      mau: metrics.mau,
      dbBytes: metrics.db_bytes,
      alertas: criticos.map((l) => l.id),
    })
  } catch (e) {
    Sentry.captureException(e, { tags: { cron: 'capacity-snapshot' } })
    return NextResponse.json({ error: 'Cron failed' }, { status: 500 })
  }
}
