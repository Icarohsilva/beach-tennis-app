// app/api/cron/weekly-grid-generation/route.ts
// Auto-geração semanal da grade. Rodava de hora em hora, mas o plano Hobby da
// Vercel só permite crons diários (deploy falha com schedule mais frequente
// que 1x/dia) — vercel.json roda isto 1x/dia (schedule "0 17 * * *" = 14h BRT,
// fuso fixo −03:00 sem horário de verão desde 2019). Para cada academia com
// grid_auto_enabled, decide via shouldRunGridNow (catch-up com marca d'água)
// se gera agora; a lógica de catch-up já tolera qualquer atraso entre
// checagens, então rodar 1x/dia só alarga a janela de atraso (até ~24h) sem
// quebrar a garantia de que a semana acaba sendo gerada.
//
// 14h e não outro horário: é depois do alvo default por academia
// (grid_auto_hour = '6', abaixo), então quem não personalizou é alcançado no
// MESMO dia — sem isso o cron rodando antes das 6h fazia o alvo de segunda só
// ser atingido na terça de madrugada.
//
// Se o plano virar Pro, trocar o schedule de volta para "0 * * * *".
import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { createAdminClient } from '@/lib/supabase/server'
import { verifyCronSecret } from '@/lib/auth/cronAuth'
import { generateGrid } from '@/features/aulas/gridGeneration'
import { notifyGridGenerated } from '@/features/aulas/gridNotify'
import { brtToday, shouldRunGridNow, autoGridWindow } from '@/lib/utils/gridSchedule'
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

    // Todas as chaves de grade de todas as academias. Paginado: são 4 linhas por
    // academia, então o teto de 1.000 do PostgREST começava a cortar academias
    // fora da varredura já em ~250 arenas — sem erro, sem log, só arena sem grade.
    const rowsRaw = await fetchAllPages<{ organization_id: string; key: string; value: string }>(
      (from, to) =>
        admin
          .from('system_settings')
          .select('organization_id, key, value')
          .in('key', ['grid_auto_enabled', 'grid_auto_day', 'grid_auto_hour', 'grid_auto_last_run'])
          .order('organization_id', { ascending: true })
          .order('key', { ascending: true })
          .range(from, to),
      { label: 'cron/weekly-grid:settings' },
    )

    // Agrupa por academia.
    const byOrg = new Map<string, Record<string, string>>()
    for (const r of rowsRaw) {
      const m = byOrg.get(r.organization_id) ?? {}
      m[r.key] = r.value
      byOrg.set(r.organization_id, m)
    }

    let orgsProcessed = 0
    let sessionsCreated = 0
    let sessionsReopened = 0
    let failed = 0
    let skipped = 0

    for (const [orgId, s] of Array.from(byOrg.entries())) {
      // Orçamento de tempo: a marca d'água (grid_auto_last_run) só avança para
      // quem foi gerado, então o catch-up da passada seguinte pega o resto.
      if (Date.now() >= deadline) {
        skipped++
        continue
      }
      if (s.grid_auto_enabled !== 'true') continue

      const day = Number(s.grid_auto_day ?? '1')
      const hour = Number(s.grid_auto_hour ?? '6')
      const lastRun = s.grid_auto_last_run ?? null
      if (!shouldRunGridNow(day, hour, lastRun, now)) continue

      try {
        // Amanhã..+7, não hoje..+6: com a janela começando hoje, o dia escolhido
        // para gerar nunca alcançava a própria próxima ocorrência (sábado dava
        // sábado→sexta, cujo único sábado era o de hoje, já em andamento às 14h).
        // Ver autoGridWindow.
        const { from, to } = autoGridWindow(brtToday(now))
        const r = await generateGrid(orgId, from, to)
        if (r.error) {
          // generateGrid não lançou (erro de upsert é engolido lá), mas não
          // podemos tratar como sucesso: nem soma contador de sucesso nem
          // avança a marca d'água, senão o catch-up nunca tenta de novo.
          failed++
          console.error('[cron/weekly-grid-generation] falhou para uma academia', {
            organizationId: orgId,
            error: r.error,
          })
          // Vai ao Sentry: sem isto a academia fica semanas sem grade em
          // silêncio. A marca d'água não avança, então nada na tela denuncia —
          // foi exatamente assim que uma falha passou 5 dias sem ser vista.
          Sentry.captureMessage('[cron/weekly-grid-generation] geração falhou para uma academia', {
            level: 'error',
            tags: { cron: 'weekly-grid-generation' },
            extra: { organizationId: orgId, error: r.error },
          })
          continue
        }
        sessionsCreated += r.sessionsCreated
        // Aula que estava cancelada e voltou. Vai no corpo da resposta porque é
        // a métrica que explica reclamação de aluno ("a aula tinha sido
        // cancelada e voltou") sem precisar abrir o banco.
        sessionsReopened += r.sessionsReopened
        orgsProcessed++

        // Marca d'água: grava DEPOIS de gerar, para o catch-up funcionar.
        await admin
          .from('system_settings')
          .upsert(
            { organization_id: orgId, key: 'grid_auto_last_run', value: now.toISOString() },
            { onConflict: 'organization_id,key' },
          )

        // Push/in-app só quando gerou sessões NOVAS de verdade (r.sessionsCreated
        // conta inserções reais, Task 2) — regeração idempotente numa checagem
        // seguinte cria 0 e não re-notifica. Passa o admin client já criado.
        if (r.sessionsCreated > 0) {
          await notifyGridGenerated(orgId, { kind: 'week' }, admin)
        }
      } catch (err) {
        failed++
        console.error('[cron/weekly-grid-generation] falhou para uma academia', {
          organizationId: orgId,
          error: err instanceof Error ? err.message : String(err),
        })
        Sentry.captureException(err, {
          tags: { cron: 'weekly-grid-generation' },
          extra: { organizationId: orgId },
        })
      }
    }

    if (skipped > 0) {
      Sentry.captureMessage('[cron/weekly-grid-generation] varredura incompleta no orçamento de tempo', {
        level: 'warning',
        extra: { orgs: byOrg.size, orgsProcessed, skipped },
      })
    }

    return NextResponse.json({ orgs: byOrg.size, orgsProcessed, sessionsCreated, sessionsReopened, failed, skipped })
  } catch (e) {
    Sentry.captureException(e, { tags: { cron: 'weekly-grid-generation' } })
    return NextResponse.json({ error: 'Cron failed' }, { status: 500 })
  }
}
