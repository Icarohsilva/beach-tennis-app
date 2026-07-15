// features/aulas/creditNotifications.ts
// Aviso de "credito baixo": chamado depois de qualquer debito via adjust_credits.
// NUNCA lança — uma falha aqui nao pode reverter o debito nem quebrar o fluxo
// que chamou (bookSession, reconcileEnrollmentCredits).
import * as Sentry from '@sentry/nextjs'
import type { createAdminClient } from '@/lib/supabase/server'
import { notifyUsers } from '@/lib/notifications/dispatch'
import { shouldNotifyLowCredit } from '@/lib/notifications/lowCredit'

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * Verifica se o debito que acabou de rodar cruzou o saldo de >1 para 1 e, se
 * sim, dispara o aviso de credito baixo. `delta` é o valor (negativo) que o
 * caller já aplicou na chamada de adjust_credits (ex.: -1). O saldo NOVO é lido
 * de memberships.credits_balance (atualizado pela RPC); o saldo ANTERIOR é
 * newBalance - delta.
 */
export async function checkLowCreditThreshold(
  client: AdminClient,
  studentId: string,
  orgId: string,
  delta: number,
): Promise<void> {
  try {
    const { data: membership } = await client
      .from('memberships')
      .select('credits_balance')
      .eq('user_id', studentId)
      .eq('organization_id', orgId)
      .single()
    if (!membership) return

    const newBalance = (membership as { credits_balance: number }).credits_balance
    const oldBalance = newBalance - delta
    if (!shouldNotifyLowCredit(oldBalance, newBalance)) return

    const { data: profile } = await client
      .from('profiles')
      .select('phone')
      .eq('id', studentId)
      .single()

    const { data: emailRow } = await client
      .from('user_emails')
      .select('email')
      .eq('id', studentId)
      .maybeSingle()

    await notifyUsers(client, {
      orgId,
      recipients: [{
        userId: studentId,
        email: (emailRow as { email: string } | null)?.email ?? null,
        phone: (profile as { phone: string | null } | null)?.phone ?? null,
      }],
      type: 'low_credits',
      title: 'Seu credito esta acabando',
      body: 'Voce tem apenas 1 credito restante. Renove seu plano para continuar agendando aulas.',
      channels: ['inapp', 'email', 'whatsapp'],
    })
  } catch (err) {
    console.error('[checkLowCreditThreshold] falhou', {
      studentId, orgId, error: err instanceof Error ? err.message : String(err),
    })
    Sentry.captureException(err, {
      tags: { channel: 'dispatch', notificationType: 'low_credits' },
      extra: { studentId, orgId },
    })
  }
}
