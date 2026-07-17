// features/financeiro/classDebt.ts
// Ponto ÚNICO de criação da pendência de aula. Chamado por markAttendance,
// markAttendanceBulk e recordResolvedCheckin — a dívida nasce na PRESENÇA, não
// na reserva (spec §5): cancelamento e no-show nunca geram dívida, sem precisar
// de regra para apagar.
import { createAdminClient } from '@/lib/supabase/server'
import { isSubscriptionCurrent } from '@/lib/billing/periodicity'

type AdminClient = ReturnType<typeof createAdminClient>

export interface EnsureClassDebtInput {
  orgId: string
  studentId: string
  sessionId: string
}

/**
 * Cria a pendência da aula se o aluno não pagou por ela de nenhuma forma.
 *
 * Não cria quando:
 *  - a reserva consumiu crédito (credit_used = true) — já foi paga;
 *  - o aluno tem parceiro (Wellhub/TotalPass) ou plano vigente — entra de graça;
 *  - já existe payments para o par (aluno, sessão) — garantido pelo índice único
 *    payments_session_student_unique, que é também como a pré-declaração do
 *    admin (experimental / pago na hora) suprime esta dívida.
 *
 * Chame SOMENTE para presença 'present'. Marcar 'absent' não gera dívida.
 */
export async function ensureClassDebt(
  client: AdminClient,
  input: EnsureClassDebtInput,
): Promise<void> {
  const { orgId, studentId, sessionId } = input

  // 1. Reserva paga com crédito → nada a cobrar.
  const { data: booking } = await client
    .from('session_bookings')
    .select('credit_used')
    .eq('student_id', studentId)
    .eq('session_id', sessionId)
    .maybeSingle()

  if ((booking as { credit_used: boolean } | null)?.credit_used) return

  // 2. Parceiro entra de graça. Sem membership, o aluno não é desta academia.
  const { data: membership } = await client
    .from('memberships')
    .select('partner')
    .eq('user_id', studentId)
    .eq('organization_id', orgId)
    .maybeSingle()

  if (!membership) return
  if ((membership as { partner: string | null }).partner) return

  // 3. Plano vigente entra de graça. 'active' com período vencido NÃO conta —
  //    mesmo critério da reconciliação (spec §1).
  const { data: sub } = await client
    .from('student_subscriptions')
    .select('gateway, current_period_end')
    .eq('student_id', studentId)
    .eq('organization_id', orgId)
    .eq('status', 'active')
    .maybeSingle()

  if (sub && isSubscriptionCurrent(sub as { gateway: string; current_period_end: string | null }, new Date())) {
    return
  }

  // 4. Preço da avulsa. Ausente → pendência com amount 0: a academia PRECISA ver
  //    que o aluno entrou sem pagar, mesmo sem preço definido (spec §4).
  //    single_class_sale_enabled gateia a venda online, não o preço da dívida.
  const { data: settingsRaw } = await client
    .from('system_settings')
    .select('key, value')
    .eq('organization_id', orgId)
    .in('key', ['single_class_price'])

  const priceRow = ((settingsRaw ?? []) as { key: string; value: string }[]).find(
    (s) => s.key === 'single_class_price',
  )
  const amount = parseFloat(priceRow?.value ?? '0') || 0

  const { error } = await client.from('payments').insert({
    organization_id: orgId,
    student_id: studentId,
    session_id: sessionId,
    amount,
    currency: 'BRL',
    status: 'pending',
    type: 'per_class',
    gateway: 'manual',
    credits_qty: null,
  })

  // 23505 = índice único: já existe pendência ou pré-declaração do admin para
  // este par. É o caminho feliz da idempotência, não um erro.
  if (error && error.code !== '23505') {
    throw new Error(`Falha ao registrar pendência da aula: ${error.message}`)
  }
}
