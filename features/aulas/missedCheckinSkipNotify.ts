// features/aulas/missedCheckinSkipNotify.ts
// Avisa aluno + admins quando uma matrícula fixa é pulada na geração da grade
// porque o aluno está bloqueado por pendência de check-in. Best-effort: nunca
// lança (mesmo padrão de quotaSkipNotify.ts).
import * as Sentry from '@sentry/nextjs'
import { createAdminClient } from '@/lib/supabase/server'
import { notifyUsers } from '@/lib/notifications/dispatch'

type AdminClient = ReturnType<typeof createAdminClient>

export interface MissedCheckinSkip {
  studentId: string
  orgId: string
  /** Pendências em aberto no momento da geração. */
  openCount: number
  /** Turmas fixas que ficaram sem reserva nesta rodada. */
  classNames: string[]
}

export async function notifyMissedCheckinSkips(
  skips: MissedCheckinSkip[],
  client?: AdminClient,
): Promise<void> {
  if (skips.length === 0) return

  try {
    const c = client ?? createAdminClient()

    const byOrg = new Map<string, MissedCheckinSkip[]>()
    for (const s of skips) {
      byOrg.set(s.orgId, [...(byOrg.get(s.orgId) ?? []), s])
    }

    for (const [orgId, orgSkips] of Array.from(byOrg.entries())) {
      for (const s of orgSkips) {
        await notifyUsers(c, {
          orgId,
          recipients: [{ userId: s.studentId }],
          type: 'fixa_pendencia_checkin',
          title: 'Aula fixa não reservada',
          body:
            `Você não foi vinculado a ${s.classNames.join(', ')} porque tem ` +
            `${s.openCount} check-in(s) do parceiro em aberto. ` +
            'Regularize em Financeiro para voltar a ter sua vaga.',
          channels: ['push', 'inapp'],
        })
      }

      const { data: admins } = await c
        .from('memberships')
        .select('user_id')
        .eq('organization_id', orgId)
        .eq('role', 'admin')
      const adminRecipients = ((admins ?? []) as { user_id: string }[]).map((m) => ({
        userId: m.user_id,
      }))
      if (adminRecipients.length === 0) continue

      const { data: students } = await c
        .from('profiles')
        .select('id, full_name')
        .in('id', orgSkips.map((s) => s.studentId))
      const nameById = new Map(
        ((students ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name]),
      )
      const lista = orgSkips
        .map((s) => `${nameById.get(s.studentId) ?? 'Aluno'} (${s.openCount})`)
        .join(', ')

      await notifyUsers(c, {
        orgId,
        recipients: adminRecipients,
        type: 'fixa_pendencia_checkin_admin',
        title: 'Aluno bloqueado na geração da grade',
        body:
          `${orgSkips.length} aluno(s) não foram reservados por pendência de check-in: ${lista}. ` +
          'Resolva em Controle Wellhub.',
        channels: ['inapp'],
      })
    }
  } catch (err) {
    console.error('[notifyMissedCheckinSkips] falhou', {
      error: err instanceof Error ? err.message : String(err),
    })
    Sentry.captureException(err, { tags: { feature: 'missedCheckins' } })
  }
}
