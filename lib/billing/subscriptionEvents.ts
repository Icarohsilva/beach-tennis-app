// lib/billing/subscriptionEvents.ts
// Escrita do histórico de assinatura da plataforma. Ponto ÚNICO de gravação:
// webhook do MP, cadastro de academia, cancelamento pelo dono e ações do
// super-admin passam todos por aqui, para não existir mudança de status que
// escape do histórico.
//
// Ver migration 20260807000000_platform_subscription_events.sql.
import { createAdminClient } from '@/lib/supabase/server'
import { PLATFORM_PLAN } from './platformPlan'
import type { PlatformStatus } from './platformAccess'

export type EventSource = 'signup' | 'webhook' | 'owner' | 'platform_admin' | 'seed'

/** MRR em centavos que uma conta passa a valer num dado estado. */
export function mrrCentsFor(status: PlatformStatus, isComped: boolean): number {
  if (isComped) return 0
  return status === 'active' ? Math.round(PLATFORM_PLAN.priceMonthly * 100) : 0
}

export interface RecordEventInput {
  organizationId: string
  /** Status anterior; omitir quando a org não tinha assinatura. */
  fromStatus?: PlatformStatus | null
  toStatus: PlatformStatus
  isComped?: boolean
  source: EventSource
  actorId?: string | null
  details?: Record<string, unknown>
}

/**
 * Grava uma transição de estado. NUNCA lança: o histórico é observabilidade, e
 * derrubar uma cobrança ou um cadastro porque o log falhou seria trocar um
 * problema pequeno por um grande. Falha vai para o log do servidor.
 *
 * Também é no-op quando o status não mudou — reprocessar o mesmo webhook do
 * MercadoPago não deve gerar uma segunda linha idêntica na série.
 */
export async function recordSubscriptionEvent(input: RecordEventInput): Promise<void> {
  if (input.fromStatus && input.fromStatus === input.toStatus) return

  try {
    const admin = createAdminClient()
    await admin.from('platform_subscription_events').insert({
      organization_id: input.organizationId,
      from_status: input.fromStatus ?? null,
      to_status: input.toStatus,
      mrr_cents: mrrCentsFor(input.toStatus, input.isComped ?? false),
      source: input.source,
      actor_id: input.actorId ?? null,
      details: input.details ?? {},
    })
  } catch (e) {
    console.error(
      '[subscription-events] falha ao registrar transição',
      input.organizationId,
      input.toStatus,
      e,
    )
  }
}

/**
 * Lê o status atual da assinatura para servir de `fromStatus`. Devolve null
 * quando a org não tem linha — o primeiro evento dela nasce sem origem.
 */
export async function currentSubscriptionState(
  organizationId: string,
): Promise<{ status: PlatformStatus; isComped: boolean } | null> {
  try {
    const admin = createAdminClient()
    const { data } = await admin
      .from('platform_subscriptions')
      .select('status, is_comped')
      .eq('organization_id', organizationId)
      .maybeSingle()
    if (!data) return null
    return {
      status: data.status as PlatformStatus,
      isComped: (data as { is_comped?: boolean }).is_comped ?? false,
    }
  } catch {
    return null
  }
}
