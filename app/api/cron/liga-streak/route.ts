// app/api/cron/liga-streak/route.ts
// Recalcula sequências e credita o bônus semanal da Liga. Diário; o bônus é
// idempotente por semana (features/liga/streakSync.ts).
import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { createAdminClient } from '@/lib/supabase/server'
import { verifyCronSecret } from '@/lib/auth/cronAuth'
import { syncLigaStreaks } from '@/features/liga/streakSync'
import { fetchAllPages } from '@/lib/supabase/paginate'

export const maxDuration = 300

/** Margem para responder antes de a plataforma matar a função. */
const TIME_BUDGET_MS = 240_000

export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const admin = createAdminClient()
    const now = new Date()
    const deadline = Date.now() + TIME_BUDGET_MS

    // Paginado: uma linha por academia com a Liga ligada. Passando de 1.000
    // arenas, a lista truncada deixaria as demais sem bônus semanal em silêncio.
    const settingsRows = await fetchAllPages<{ organization_id: string }>(
      (from, to) =>
        admin
          .from('system_settings')
          .select('organization_id')
          .eq('key', 'liga_enabled')
          .eq('value', 'true')
          .order('organization_id', { ascending: true })
          .range(from, to),
      { label: 'cron/liga-streak:settings' },
    )

    const orgIds = Array.from(new Set(settingsRows.map((r) => r.organization_id)))

    let studentsTouched = 0
    let bonusesAwarded = 0
    let medalsGranted = 0
    let failed = 0
    let skipped = 0

    for (const orgId of orgIds) {
      // O bônus é idempotente por semana (weekSourceId), então parar no meio e
      // continuar amanhã não credita duas vezes nem deixa buraco.
      if (Date.now() >= deadline) {
        skipped++
        continue
      }
      try {
        const result = await syncLigaStreaks(admin, orgId, now)
        studentsTouched += result.studentsTouched
        bonusesAwarded += result.bonusesAwarded
        medalsGranted += result.medalsGranted
      } catch (err) {
        failed++
        console.error('[cron/liga-streak] falhou para uma academia', {
          organizationId: orgId,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    if (skipped > 0) {
      Sentry.captureMessage('[cron/liga-streak] varredura incompleta no orçamento de tempo', {
        level: 'warning',
        extra: { orgs: orgIds.length, skipped },
      })
    }

    return NextResponse.json({
      orgs: orgIds.length,
      studentsTouched,
      bonusesAwarded,
      medalsGranted,
      failed,
      skipped,
    })
  } catch (e) {
    Sentry.captureException(e, { tags: { cron: 'liga-streak' } })
    return NextResponse.json({ error: 'Cron failed' }, { status: 500 })
  }
}
