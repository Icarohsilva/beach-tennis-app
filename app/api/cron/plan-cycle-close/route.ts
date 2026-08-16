// app/api/cron/plan-cycle-close/route.ts
// Fecha os ciclos de cota encerrados e grava o saldo que passa para o seguinte.
//
// Diário e com recuperação de atraso, não "roda no dia 1º": o plano Hobby da
// Vercel só aceita cron 1×/dia, e um dia perdido não pode sumir com o saldo de
// um mês inteiro do aluno. Cada passada fecha TODO ciclo que já terminou e ainda
// não tem linha — mesma escolha de weekly-grid-generation
// (docs/superpowers/specs/2026-07-17-geracao-semanal-grade-design.md:118).
//
// Idempotente pelo unique (student_id, organization_id, cycle_start): rodar duas
// vezes no mesmo dia não dobra saldo de ninguém.
import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { createAdminClient } from '@/lib/supabase/server'
import { verifyCronSecret } from '@/lib/auth/cronAuth'
import { mapWithConcurrency } from '@/lib/utils/concurrency'
import {
  closeStudentCycles,
  listCycleCloseCandidates,
  todayBrt,
} from '@/features/aulas/cycleClose'

export const maxDuration = 300

/** Margem para responder antes de a plataforma matar a função. */
const TIME_BUDGET_MS = 240_000

/** Cada aluno faz algumas consultas curtas; 4 em voo mantém o banco tranquilo. */
const CONCURRENCY = 4

export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const adminClient = createAdminClient()
  const deadline = Date.now() + TIME_BUDGET_MS
  const today = todayBrt()

  try {
    const candidates = await listCycleCloseCandidates(adminClient)
    if (candidates.length === 0) {
      return NextResponse.json({ studentsProcessed: 0, cyclesClosed: 0, failed: 0 })
    }

    let cyclesClosed = 0
    let failed = 0

    const { skipped } = await mapWithConcurrency(
      candidates,
      async (c) => {
        try {
          cyclesClosed += await closeStudentCycles(adminClient, c.studentId, c.orgId, today)
        } catch (e) {
          failed++
          Sentry.captureException(e, {
            tags: { cron: 'plan-cycle-close' },
            extra: { studentId: c.studentId, orgId: c.orgId },
          })
        }
      },
      { concurrency: CONCURRENCY, deadline },
    )

    return NextResponse.json({
      studentsProcessed: candidates.length - skipped,
      cyclesClosed,
      failed,
      // O que sobrou fica para a próxima passada: o fechamento é idempotente e
      // retoma do último ciclo gravado, então nada se perde.
      truncated: skipped > 0,
    })
  } catch (e) {
    Sentry.captureException(e, { tags: { cron: 'plan-cycle-close' } })
    return NextResponse.json({ error: 'Cron failed' }, { status: 500 })
  }
}
