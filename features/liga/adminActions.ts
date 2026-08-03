'use server'
// features/liga/adminActions.ts
// Bônus manual: o que faz o ranking ser "da academia dele" (spec §Fase 1).
import { revalidatePath } from 'next/cache'
import { createClient, createAdminClient, getActiveOrgId } from '@/lib/supabase/server'
import { getOrgSports } from '@/lib/arenas/orgSports'
import { normalizeSportForOrg } from '@/lib/arenas/sports'
import { getLigaSettings } from './settings'
import { getOrCreateActiveSeason } from './season'

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

  // Chama a RPC direto, sem passar por awardLigaPoints: aquele wrapper é best-effort
  // de propósito, pensado pra callers onde creditar ponto é efeito colateral de outra
  // operação (presença, torneio) que não pode falhar por causa da Liga. Aqui é o
  // contrário — dar o bônus É a operação inteira. Se a RPC falhar, o professor precisa
  // saber, senão ele acha que o bônus foi dado e o aluno nunca vê o ponto no extrato.
  //
  // sourceId aleatório: bônus manual não tem evento de origem, e vários bônus na
  // mesma temporada precisam coexistir (o índice único inclui source_id).
  const { error: rpcError } = await adminClient.rpc('liga_award_points', {
    p_org: orgId,
    p_season: season.id,
    p_student: input.studentId,
    p_sport: sport,
    p_points: input.points,
    p_reason: 'manual',
    p_source_id: crypto.randomUUID(),
    p_note: note,
    p_awarded_by: user.id,
  })
  if (rpcError) return { error: 'Erro ao lançar o bônus. Tente novamente.' }

  revalidatePath('/admin/liga')
  return {}
}
