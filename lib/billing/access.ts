// lib/billing/access.ts
import { createAdminClient } from '@/lib/supabase/server'
import {
  computePlatformAccess,
  type PlatformStatus,
} from './platformAccess'

export interface PlatformAccessResult {
  allowed: boolean
  status: PlatformStatus | 'none'
  trialEndsAt: string | null
  currentPeriodEnd: string | null
  daysLeft: number
}

// Lê a assinatura da plataforma da org e calcula o acesso ao painel admin.
// Service role (ignora RLS); a tabela não é exposta ao cliente.
export async function getPlatformAccess(orgId: string): Promise<PlatformAccessResult> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('platform_subscriptions')
    .select('status, trial_ends_at, current_period_end')
    .eq('organization_id', orgId)
    .maybeSingle()

  if (!data) {
    // Sem assinatura (org sem backfill/insert) → bloqueia por segurança.
    return { allowed: false, status: 'none', trialEndsAt: null, currentPeriodEnd: null, daysLeft: 0 }
  }

  const state = {
    status: data.status as PlatformStatus,
    trialEndsAt: data.trial_ends_at as string | null,
    currentPeriodEnd: data.current_period_end as string | null,
  }
  const { allowed, daysLeft } = computePlatformAccess(state, new Date())
  return {
    allowed,
    status: state.status,
    trialEndsAt: state.trialEndsAt,
    currentPeriodEnd: state.currentPeriodEnd,
    daysLeft,
  }
}
