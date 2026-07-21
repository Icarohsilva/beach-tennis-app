// app/api/cron/weekly-grid-generation/route.ts
// Auto-geração semanal da grade. Rodava de hora em hora, mas o plano Hobby da
// Vercel só permite crons diários (deploy falha com schedule mais frequente
// que 1x/dia) — vercel.json roda isto 1x/dia (schedule "0 5 * * *"). Para
// cada academia com grid_auto_enabled, decide via shouldRunGridNow (catch-up
// com marca d'água) se gera agora; a lógica de catch-up já tolera qualquer
// atraso entre checagens, então rodar 1x/dia só alarga a janela de atraso
// (até ~24h) sem quebrar a garantia de que a semana acaba sendo gerada.
// Se o plano virar Pro, trocar o schedule de volta para "0 * * * *".
import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { createAdminClient } from '@/lib/supabase/server'
import { verifyCronSecret } from '@/lib/auth/cronAuth'
import { generateGrid } from '@/features/aulas/gridGeneration'
import { brtToday, addDaysStr, shouldRunGridNow } from '@/lib/utils/gridSchedule'

export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const admin = createAdminClient()
    const now = new Date()

    // Todas as chaves de grade de todas as academias, numa query.
    const { data: rowsRaw, error: readErr } = await admin
      .from('system_settings')
      .select('organization_id, key, value')
      .in('key', ['grid_auto_enabled', 'grid_auto_day', 'grid_auto_hour', 'grid_auto_last_run'])

    if (readErr) throw new Error(readErr.message)

    // Agrupa por academia.
    const byOrg = new Map<string, Record<string, string>>()
    for (const r of (rowsRaw ?? []) as { organization_id: string; key: string; value: string }[]) {
      const m = byOrg.get(r.organization_id) ?? {}
      m[r.key] = r.value
      byOrg.set(r.organization_id, m)
    }

    let orgsProcessed = 0
    let sessionsCreated = 0
    let failed = 0

    for (const [orgId, s] of Array.from(byOrg.entries())) {
      if (s.grid_auto_enabled !== 'true') continue

      const day = Number(s.grid_auto_day ?? '1')
      const hour = Number(s.grid_auto_hour ?? '6')
      const lastRun = s.grid_auto_last_run ?? null
      if (!shouldRunGridNow(day, hour, lastRun, now)) continue

      try {
        const from = brtToday(now)
        const r = await generateGrid(orgId, from, addDaysStr(from, 6))
        if (r.error) {
          // generateGrid não lançou (erro de upsert é engolido lá), mas não
          // podemos tratar como sucesso: nem soma contador de sucesso nem
          // avança a marca d'água, senão o catch-up nunca tenta de novo.
          failed++
          console.error('[cron/weekly-grid-generation] falhou para uma academia', {
            organizationId: orgId,
            error: r.error,
          })
          continue
        }
        sessionsCreated += r.sessionsCreated
        orgsProcessed++

        // Marca d'água: grava DEPOIS de gerar, para o catch-up funcionar.
        await admin
          .from('system_settings')
          .upsert(
            { organization_id: orgId, key: 'grid_auto_last_run', value: now.toISOString() },
            { onConflict: 'organization_id,key' },
          )
      } catch (err) {
        failed++
        console.error('[cron/weekly-grid-generation] falhou para uma academia', {
          organizationId: orgId,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    return NextResponse.json({ orgsProcessed, sessionsCreated, failed })
  } catch (e) {
    Sentry.captureException(e, { tags: { cron: 'weekly-grid-generation' } })
    return NextResponse.json({ error: 'Cron failed' }, { status: 500 })
  }
}
