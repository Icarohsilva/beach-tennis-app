// features/aulas/quotaSkipNotify.ts
// Avisa aluno + admins quando uma matrícula fixa é pulada por falta de cota na
// geração da grade. Best-effort: nunca lança (mesmo padrão de gridNotify.ts).
import * as Sentry from '@sentry/nextjs'
import { createAdminClient } from '@/lib/supabase/server'
import { notifyUsers } from '@/lib/notifications/dispatch'

type AdminClient = ReturnType<typeof createAdminClient>

export interface QuotaSkip {
  studentId: string
  classId: string
  className: string
  orgId: string
}

export async function notifyQuotaSkips(skips: QuotaSkip[], client?: AdminClient): Promise<void> {
  if (skips.length === 0) return

  try {
    const c = client ?? createAdminClient()

    // Um aluno pode aparecer mais de uma vez (mais de uma fixa pulada);
    // agrupa por academia pra mandar um único aviso resumido aos admins.
    const byOrg = new Map<string, QuotaSkip[]>()
    for (const s of skips) {
      byOrg.set(s.orgId, [...(byOrg.get(s.orgId) ?? []), s])
    }

    for (const [orgId, orgSkips] of byOrg) {
      for (const s of orgSkips) {
        await notifyUsers(c, {
          orgId,
          recipients: [{ userId: s.studentId }],
          type: 'fixa_sem_cota',
          title: 'Sem cota disponível',
          body: `Você não foi vinculado à aula de ${s.className} esta semana — sua cota mensal já foi usada.`,
          channels: ['push', 'inapp'],
        })
      }

      const { data: admins } = await c
        .from('memberships')
        .select('user_id')
        .eq('organization_id', orgId)
        .eq('role', 'admin')
      const adminRecipients = ((admins ?? []) as { user_id: string }[]).map((m) => ({ userId: m.user_id }))
      if (adminRecipients.length === 0) continue

      const { data: students } = await c
        .from('profiles')
        .select('id, full_name')
        .in('id', orgSkips.map((s) => s.studentId))
      const nameById = new Map(
        ((students ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name]),
      )
      const lista = orgSkips
        .map((s) => `${nameById.get(s.studentId) ?? 'Aluno'} (${s.className})`)
        .join(', ')

      await notifyUsers(c, {
        orgId,
        recipients: adminRecipients,
        type: 'fixa_sem_cota_admin',
        title: 'Aluno sem cota',
        body: `${orgSkips.length} matrícula(s) fixa(s) não foram vinculadas nesta geração por falta de cota: ${lista}.`,
        channels: ['inapp'],
      })
    }
  } catch (err) {
    console.error('[notifyQuotaSkips] falhou', { error: err instanceof Error ? err.message : String(err) })
    Sentry.captureException(err, { tags: { feature: 'quotaSkipNotify' } })
  }
}
