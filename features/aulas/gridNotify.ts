// features/aulas/gridNotify.ts
// Push + in-app por academia ao gerar a grade (spec 2026-07-21 §8). Multi-tenant:
// puxa o nome da org e notifica só os alunos DELA. Best-effort: nunca lança.
import * as Sentry from '@sentry/nextjs'
import { createAdminClient } from '@/lib/supabase/server'
import { notifyUsers } from '@/lib/notifications/dispatch'

type AdminClient = ReturnType<typeof createAdminClient>

const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']

export async function notifyGridGenerated(
  orgId: string,
  scope: { kind: 'week' } | { kind: 'day'; dayOfWeek: number },
  client?: AdminClient,
): Promise<void> {
  try {
    // Resolvido AQUI DENTRO (não como default de parâmetro) — se createAdminClient()
    // lançar (ex.: env var ausente), o catch abaixo precisa ver, senão o "nunca
    // lança" vira mentira justamente no caso comum: chamador sem client próprio.
    const c = client ?? createAdminClient()

    const { data: org } = await c.from('organizations').select('name').eq('id', orgId).single()
    const academia = (org as { name: string } | null)?.name ?? 'sua academia'

    const title =
      scope.kind === 'week'
        ? `Novas aulas na ${academia}`
        : `Aulas de ${DIAS[scope.dayOfWeek] ?? 'sua turma'} na ${academia}`
    const body =
      scope.kind === 'week'
        ? 'A grade da semana já está disponível. Agende sua aula!'
        : 'Já dá pra agendar. Bora treinar!'

    const { data: mems } = await c
      .from('memberships')
      .select('user_id')
      .eq('organization_id', orgId)
      .eq('role', 'student')
      .eq('contract_active', true)
    const recipients = ((mems ?? []) as { user_id: string }[]).map((m) => ({ userId: m.user_id }))
    if (recipients.length === 0) return

    await notifyUsers(c, {
      orgId,
      recipients,
      type: 'grade_disponivel',
      title,
      body,
      channels: ['push', 'inapp'],
    })
  } catch (err) {
    console.error('[notifyGridGenerated] falhou', { orgId, error: err instanceof Error ? err.message : String(err) })
    Sentry.captureException(err, { tags: { feature: 'gridNotify' }, extra: { orgId } })
  }
}
