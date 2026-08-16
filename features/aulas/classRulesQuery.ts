// features/aulas/classRulesQuery.ts
// Junta a configuração real da academia e monta as regras do modal do aluno
// (lib/aulas/classRules.ts). Só busca o que a home ainda não tem em mãos —
// `plan`, `quotaEnforced` e `isPartner` já saem calculados em
// app/(dashboard)/home/page.tsx e chegam prontos, para não repetir consulta.
import type { createAdminClient } from '@/lib/supabase/server'
import { buildClassRules, type RuleSection } from '@/lib/aulas/classRules'
import type { PlanQuota } from '@/lib/utils/classQuota'
import { getOrgClassSettings } from './orgClassSettings'
import { getOrgMaxClassesPerDay } from './quotaSettings'
import { listGuardianDependents } from './guardianQueries'

type AdminClient = ReturnType<typeof createAdminClient>

export interface ClassRulesContext {
  orgId: string
  plan: PlanQuota | null
  quotaEnforced: boolean
  isPartner: boolean
  selfCheckinEnabled: boolean
}

export async function getClassRules(
  client: AdminClient,
  ctx: ClassRulesContext,
): Promise<RuleSection[]> {
  const [{ cancellationWindowHours, creditExpiryDays }, orgMaxClassesPerDay, dependents, ligaRow] =
    await Promise.all([
      getOrgClassSettings(client, ctx.orgId),
      getOrgMaxClassesPerDay(client, ctx.orgId),
      listGuardianDependents(),
      client
        .from('system_settings')
        .select('value')
        .eq('organization_id', ctx.orgId)
        .eq('key', 'liga_enabled')
        .maybeSingle(),
    ])

  const ligaEnabled = (ligaRow.data as { value: string } | null)?.value === 'true'

  return buildClassRules({
    cancellationWindowHours,
    creditExpiryDays,
    quotaEnforced: ctx.quotaEnforced,
    plan: ctx.plan
      ? {
          classesPerWeek: ctx.plan.classesPerWeek,
          cycle: ctx.plan.cycle,
          maxClassesPerDay: ctx.plan.maxClassesPerDay,
          rolloverUnused: ctx.plan.rolloverUnused,
        }
      : null,
    orgMaxClassesPerDay,
    isPartner: ctx.isPartner,
    selfCheckinEnabled: ctx.selfCheckinEnabled,
    ligaEnabled,
    hasDependents: dependents.length > 0,
  })
}
