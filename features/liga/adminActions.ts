'use server'
// features/liga/adminActions.ts
// Bônus manual: o que faz o ranking ser "da academia dele" (spec §Fase 1).
import { revalidatePath } from 'next/cache'
import { createClient, createAdminClient, getActiveOrgId } from '@/lib/supabase/server'
import { getOrgSports } from '@/lib/arenas/orgSports'
import { normalizeSportForOrg } from '@/lib/arenas/sports'
import { getLigaSettings } from './settings'
import { getOrCreateActiveSeason } from './season'
import { awardLigaPoints } from './awardPoints'

const MAX_MANUAL_POINTS = 500

export interface AwardBonusInput {
  studentId: string
  sport: string
  points: number
  note: string
}

/**
 * Dá pontos na mão para um aluno. Admin da academia ativa apenas.
 *
 * `note` é obrigatório porque é o que aparece no extrato do aluno como
 * "+20 · Destaque da aula de quinta". Sem motivo, o ponto manual viraria uma
 * caixa-preta que o professor não consegue justificar quando questionado.
 */
export async function awardLigaBonus(input: AwardBonusInput): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const adminClient = createAdminClient()
  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  const { data: callerMembership } = await adminClient
    .from('memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .single()
  if (callerMembership?.role !== 'admin') return { error: 'Sem permissão.' }

  const note = input.note.trim()
  if (!note) return { error: 'Descreva o motivo do bônus.' }

  if (!Number.isInteger(input.points) || input.points === 0) {
    return { error: 'Pontos devem ser um número inteiro diferente de zero.' }
  }
  if (Math.abs(input.points) > MAX_MANUAL_POINTS) {
    return { error: `Máximo de ${MAX_MANUAL_POINTS} pontos por bônus.` }
  }

  const orgSports = await getOrgSports(orgId)
  const sport = normalizeSportForOrg(input.sport, orgSports)
  if (!sport) return { error: 'Escolha uma modalidade válida.' }

  // O aluno precisa ser da academia.
  const { data: target } = await adminClient
    .from('memberships')
    .select('user_id')
    .eq('user_id', input.studentId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!target) return { error: 'Aluno não encontrado nesta academia.' }

  const settings = await getLigaSettings(orgId)
  if (!settings.enabled) return { error: 'A Liga está desligada nas configurações.' }

  const season = await getOrCreateActiveSeason(orgId)
  if (!season) return { error: 'Não foi possível abrir a temporada.' }

  // sourceId aleatório: bônus manual não tem evento de origem, e vários bônus na
  // mesma temporada precisam coexistir (o índice único inclui source_id).
  await awardLigaPoints(adminClient, {
    orgId,
    seasonId: season.id,
    studentId: input.studentId,
    sport,
    points: input.points,
    reason: 'manual',
    sourceId: crypto.randomUUID(),
    note,
    awardedBy: user.id,
  })

  revalidatePath('/admin/liga')
  return {}
}
