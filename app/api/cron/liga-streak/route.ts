// app/api/cron/liga-streak/route.ts
// Recalcula sequências e credita o bônus semanal da Liga. Diário; o bônus é
// idempotente por semana (features/liga/streakSync.ts).
import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { createAdminClient } from '@/lib/supabase/server'
import { verifyCronSecret } from '@/lib/auth/cronAuth'
import { syncLigaStreaks } from '@/features/liga/streakSync'

export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const admin = createAdminClient()
    const now = new Date()

    const { data: settingsRows, error: settingsErr } = await admin
      .from('system_settings')
      .select('organization_id')
      .eq('key', 'liga_enabled')
      .eq('value', 'true')

    if (settingsErr) throw new Error(settingsErr.message)

    const orgIds = Array.from(new Set((settingsRows ?? []).map((r: { organization_id: string }) => r.organization_id)))

    let studentsTouched = 0
    let bonusesAwarded = 0
    let failed = 0

    for (const orgId of orgIds) {
      try {
        const result = await syncLigaStreaks(admin, orgId, now)
        studentsTouched += result.studentsTouched
        bonusesAwarded += result.bonusesAwarded
      } catch (err) {
        failed++
        console.error('[cron/liga-streak] falhou para uma academia', {
          organizationId: orgId,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    return NextResponse.json({ orgs: orgIds.length, studentsTouched, bonusesAwarded, failed })
  } catch (e) {
    Sentry.captureException(e, { tags: { cron: 'liga-streak' } })
    return NextResponse.json({ error: 'Cron failed' }, { status: 500 })
  }
}
