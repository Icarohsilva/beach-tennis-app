// app/api/cron/liga-season-close/route.ts
// Fecha a temporada da Liga e abre a próxima. Mensal, dia 1º.
import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { createAdminClient } from '@/lib/supabase/server'
import { verifyCronSecret } from '@/lib/auth/cronAuth'
import { closeLigaSeason } from '@/features/liga/seasonClose'

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

    let closed = 0
    let promoted = 0
    let demoted = 0
    let prizes = 0
    let failed = 0

    for (const orgId of orgIds) {
      try {
        const result = await closeLigaSeason(admin, orgId, now)
        if (result.closed) closed++
        promoted += result.promoted
        demoted += result.demoted
        prizes += result.prizes
      } catch (err) {
        // Uma academia com problema não pode impedir o fechamento das outras.
        failed++
        console.error('[cron/liga-season-close] falhou para uma academia', {
          organizationId: orgId,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    return NextResponse.json({ orgs: orgIds.length, closed, promoted, demoted, prizes, failed })
  } catch (e) {
    Sentry.captureException(e, { tags: { cron: 'liga-season-close' } })
    return NextResponse.json({ error: 'Cron failed' }, { status: 500 })
  }
}
