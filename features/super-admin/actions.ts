'use server'
// features/super-admin/actions.ts
// Painel de PLATAFORMA. Todas as actions re-checam is_platform_admin (defesa em
// profundidade — não confiam só no gate do layout) e usam service role. Leitura
// CROSS-ORG é intencional aqui (é o ponto do painel); seguro porque gateado.
import { revalidatePath } from 'next/cache'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import {
  recordSubscriptionEvent,
  currentSubscriptionState,
} from '@/lib/billing/subscriptionEvents'
import type { PlatformStatus } from '@/lib/billing/platformAccess'

// Lê o usuário logado + is_platform_admin. Retorna { userId } ou { error }.
export async function requirePlatformAdmin(): Promise<{ userId: string } | { error: string }> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('is_platform_admin')
    .eq('id', user.id)
    .single()
  if (profile?.is_platform_admin !== true) return { error: 'Acesso negado.' }
  return { userId: user.id }
}

// ---------------------------------------------------------------------------
// Trilha de auditoria — toda ação do super-admin sobre uma academia é gravada.
// Ver migration 20260806000000_platform_admin_audit_log.sql.
// ---------------------------------------------------------------------------

export type PlatformAuditAction =
  | 'suspend_org'
  | 'reactivate_org'
  | 'extend_trial'
  | 'grant_comp'
  | 'revoke_comp'

// A auditoria NUNCA derruba a ação: se o insert falhar, a operação já foi feita
// e reverter seria pior. Falha vai para o log do servidor.
async function recordAudit(
  actorId: string,
  orgId: string,
  action: PlatformAuditAction,
  details: Record<string, unknown> = {},
  note?: string,
): Promise<void> {
  try {
    const admin = createAdminClient()
    await admin.from('platform_admin_audit_log').insert({
      actor_id: actorId,
      organization_id: orgId,
      action,
      details,
      note: note?.trim() || null,
    })
  } catch (e) {
    console.error('[super-admin] falha ao gravar auditoria', action, orgId, e)
  }
}

export interface AuditEntry {
  id: string
  action: PlatformAuditAction
  details: Record<string, unknown>
  note: string | null
  created_at: string
  actor_name: string | null
  organization_id: string | null
  organization_name: string | null
}

// Lê a trilha (toda a plataforma ou de uma academia). Tolerante: se a migration
// ainda não foi aplicada, devolve lista vazia em vez de derrubar a página.
export async function listAuditLog(
  orgId?: string,
  limit = 50,
): Promise<{ entries: AuditEntry[]; error?: string }> {
  const gate = await requirePlatformAdmin()
  if ('error' in gate) return { entries: [], error: gate.error }
  const admin = createAdminClient()

  let query = admin
    .from('platform_admin_audit_log')
    .select('id, action, details, note, created_at, actor_id, organization_id')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (orgId) query = query.eq('organization_id', orgId)

  const { data, error } = await query
  if (error) {
    console.error('[super-admin] trilha de auditoria indisponível', error)
    return { entries: [] }
  }

  const rows = (data ?? []) as Array<{
    id: string
    action: PlatformAuditAction
    details: Record<string, unknown> | null
    note: string | null
    created_at: string
    actor_id: string
    organization_id: string | null
  }>

  const actorIds = Array.from(new Set(rows.map((r) => r.actor_id)))
  const orgIds = Array.from(new Set(rows.map((r) => r.organization_id).filter(Boolean))) as string[]
  const [actors, orgs] = await Promise.all([
    actorIds.length
      ? admin.from('profiles').select('id, full_name').in('id', actorIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string | null }[] }),
    orgIds.length
      ? admin.from('organizations').select('id, name').in('id', orgIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ])
  const actorName = new Map(
    ((actors.data ?? []) as { id: string; full_name: string | null }[]).map((p) => [p.id, p.full_name]),
  )
  const orgName = new Map(
    ((orgs.data ?? []) as { id: string; name: string }[]).map((o) => [o.id, o.name]),
  )

  return {
    entries: rows.map((r) => ({
      id: r.id,
      action: r.action,
      details: r.details ?? {},
      note: r.note,
      created_at: r.created_at,
      actor_name: actorName.get(r.actor_id) ?? null,
      organization_id: r.organization_id,
      organization_name: r.organization_id ? orgName.get(r.organization_id) ?? null : null,
    })),
  }
}

// Revalida as rotas que mostram o estado de uma academia.
function revalidateOrg(orgId: string): void {
  revalidatePath('/super-admin')
  revalidatePath('/super-admin/academias')
  revalidatePath('/super-admin/auditoria')
  revalidatePath(`/super-admin/${orgId}`)
}

export async function suspendOrganization(orgId: string, note?: string): Promise<{ error?: string }> {
  const gate = await requirePlatformAdmin()
  if ('error' in gate) return { error: gate.error }
  const admin = createAdminClient()
  const { error } = await admin.from('organizations').update({ status: 'suspended' }).eq('id', orgId)
  if (error) return { error: 'Não foi possível suspender a academia.' }
  await recordAudit(gate.userId, orgId, 'suspend_org', { status: 'suspended' }, note)
  revalidateOrg(orgId)
  return {}
}

export async function reactivateOrganization(orgId: string, note?: string): Promise<{ error?: string }> {
  const gate = await requirePlatformAdmin()
  if ('error' in gate) return { error: gate.error }
  const admin = createAdminClient()
  const { error } = await admin.from('organizations').update({ status: 'active' }).eq('id', orgId)
  if (error) return { error: 'Não foi possível reativar a academia.' }
  await recordAudit(gate.userId, orgId, 'reactivate_org', { status: 'active' }, note)
  revalidateOrg(orgId)
  return {}
}

/**
 * Estende o trial em N dias. Conta a partir do fim do trial atual quando ele
 * ainda está no futuro (senão o cliente perderia os dias restantes) e a partir
 * de hoje quando já venceu. Volta o status para 'trialing' para reabrir o
 * acesso ao painel de quem já tinha caído no paywall.
 */
export async function extendTrial(
  orgId: string,
  days: number,
  note?: string,
): Promise<{ error?: string; newTrialEndsAt?: string }> {
  const gate = await requirePlatformAdmin()
  if ('error' in gate) return { error: gate.error }
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    return { error: 'Informe de 1 a 365 dias.' }
  }
  const admin = createAdminClient()

  const { data: sub } = await admin
    .from('platform_subscriptions')
    .select('status, trial_ends_at')
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!sub) return { error: 'Academia sem assinatura registrada.' }
  if (sub.status === 'active') {
    return { error: 'Assinatura já está ativa — estender trial não se aplica.' }
  }

  const now = new Date()
  const current = sub.trial_ends_at ? new Date(sub.trial_ends_at) : null
  const base = current && current > now ? current : now
  const newTrialEndsAt = new Date(base.getTime() + days * 86_400_000).toISOString()

  const { error } = await admin
    .from('platform_subscriptions')
    .update({ status: 'trialing', trial_ends_at: newTrialEndsAt, updated_at: now.toISOString() })
    .eq('organization_id', orgId)
  if (error) return { error: 'Não foi possível estender o trial.' }

  await recordAudit(
    gate.userId,
    orgId,
    'extend_trial',
    { days, from: sub.trial_ends_at, to: newTrialEndsAt },
    note,
  )
  // Só vira linha no histórico se o status mudou de fato (ex.: past_due que
  // volta a trialing). Estender um trial que já era trial não move o MRR.
  await recordSubscriptionEvent({
    organizationId: orgId,
    fromStatus: sub.status as PlatformStatus,
    toStatus: 'trialing',
    source: 'platform_admin',
    actorId: gate.userId,
    details: { days, to: newTrialEndsAt },
  })
  revalidateOrg(orgId)
  return { newTrialEndsAt }
}

/**
 * Liga/desliga a cortesia. Cortesia = acesso liberado sem cobrança; a academia
 * some do MRR (não pagou) mas continua contando como conta ativa. Ao conceder,
 * a assinatura vira 'active' com período longo; ao revogar, volta para trial de
 * 7 dias para o cliente ter tempo de assinar em vez de perder o acesso na hora.
 */
export async function setCompedStatus(
  orgId: string,
  comped: boolean,
  note?: string,
): Promise<{ error?: string }> {
  const gate = await requirePlatformAdmin()
  if ('error' in gate) return { error: gate.error }
  const admin = createAdminClient()

  const before = await currentSubscriptionState(orgId)

  const now = new Date()
  const patch = comped
    ? {
        is_comped: true,
        status: 'active',
        current_period_end: new Date(now.getTime() + 3650 * 86_400_000).toISOString(),
        updated_at: now.toISOString(),
      }
    : {
        is_comped: false,
        status: 'trialing',
        trial_ends_at: new Date(now.getTime() + 7 * 86_400_000).toISOString(),
        current_period_end: null,
        updated_at: now.toISOString(),
      }

  const { error } = await admin
    .from('platform_subscriptions')
    .update(patch)
    .eq('organization_id', orgId)
  if (error) return { error: 'Não foi possível atualizar a cortesia.' }

  await recordAudit(gate.userId, orgId, comped ? 'grant_comp' : 'revoke_comp', patch, note)
  // Conceder cortesia leva a conta a 'active' com MRR zero (isComped) — é assim
  // que ela ganha acesso sem inflar a receita. Revogar devolve para trial.
  await recordSubscriptionEvent({
    organizationId: orgId,
    fromStatus: before?.status ?? null,
    toStatus: comped ? 'active' : 'trialing',
    isComped: comped,
    source: 'platform_admin',
    actorId: gate.userId,
    details: { comped },
  })
  revalidateOrg(orgId)
  return {}
}

// ---------------------------------------------------------------------------
// Solicitações de exclusão de conta e de reembolso — fluxos de REGISTRO (ver
// migration 20260724100000_legal_foundation.sql). A execução (anonimizar dados,
// devolver dinheiro) continua manual/deliberada; aqui só se marca o status.
// ---------------------------------------------------------------------------

export type AccountDeletionStatus = 'pendente' | 'em_andamento' | 'concluida' | 'cancelada'
export type PlatformRefundStatus = 'pendente' | 'aprovada' | 'recusada' | 'reembolsada'

export async function setAccountDeletionStatus(
  id: string,
  status: AccountDeletionStatus,
): Promise<{ error?: string }> {
  const gate = await requirePlatformAdmin()
  if ('error' in gate) return { error: gate.error }
  const admin = createAdminClient()
  const isTerminal = status === 'concluida' || status === 'cancelada'
  const { error } = await admin
    .from('account_deletion_requests')
    .update({ status, resolved_at: isTerminal ? new Date().toISOString() : null })
    .eq('id', id)
  if (error) return { error: 'Não foi possível atualizar a solicitação.' }
  revalidatePath('/super-admin/exclusoes')
  return {}
}

export async function setPlatformRefundStatus(
  id: string,
  status: PlatformRefundStatus,
): Promise<{ error?: string }> {
  const gate = await requirePlatformAdmin()
  if ('error' in gate) return { error: gate.error }
  const admin = createAdminClient()
  const isTerminal = status === 'recusada' || status === 'reembolsada'
  const { error } = await admin
    .from('platform_refund_requests')
    .update({ status, resolved_at: isTerminal ? new Date().toISOString() : null, resolved_by: gate.userId })
    .eq('id', id)
  if (error) return { error: 'Não foi possível atualizar a solicitação.' }
  revalidatePath('/super-admin/reembolsos')
  return {}
}
