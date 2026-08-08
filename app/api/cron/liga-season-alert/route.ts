// app/api/cron/liga-season-alert/route.ts
// Aviso da reta final da temporada da Liga. Roda todo dia; só dispara no dia certo
// (a regra de quando está em lib/liga/seasonAlert.ts).
import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { createAdminClient } from '@/lib/supabase/server'
import { verifyCronSecret } from '@/lib/auth/cronAuth'
import { sendSeasonEndAlerts } from '@/features/liga/seasonAlerts'

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

    const orgIds = Array.from(
      new Set((settingsRows ?? []).map((r: { organization_id: string }) => r.organization_id)),
    )

    let notified = 0
    let failed = 0

    for (const orgId of orgIds) {
      try {
        const result = await sendSeasonEndAlerts(admin, orgId, now)
        notified += result.notified
      } catch (err) {
        failed++
        console.error('[cron/liga-season-alert] falhou para uma academia', {
          organizationId: orgId,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    return NextResponse.json({ orgs: orgIds.length, notified, failed })
  } catch (e) {
    Sentry.captureException(e, { tags: { cron: 'liga-season-alert' } })
    return NextResponse.json({ error: 'Cron failed' }, { status: 500 })
  }
}
