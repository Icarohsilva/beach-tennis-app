'use server'

import { createAdminClient, getCurrentOrgId } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { generateGrid } from './gridGeneration'
import { brtToday, addDaysStr } from '@/lib/utils/gridSchedule'
import { getOrgSports } from '@/lib/arenas/orgSports'
import { normalizeSportForOrg } from '@/lib/arenas/sports'
import type { ClassType } from '@/types'

export interface ClassFormData {
  name: string
  description: string
  type: ClassType
  /**
   * Modalidade da turma (slug de lib/arenas/sports.ts). null = sem modalidade.
   * É rótulo, não regra: NENHUM ponto de reserva (bookSession, joinWaitlist,
   * enrollStudentInClass, /agendar) olha para este campo. Aluno de beach tennis
   * continua podendo entrar numa turma de futevôlei.
   */
  sport: string | null
  day_of_week: number
  start_time: string
  end_time: string
  max_students: number
  court: number
}

export async function createClass(data: ClassFormData): Promise<{ error?: string }> {
  if (!data.name.trim()) return { error: 'Nome é obrigatório' }
  if (data.start_time >= data.end_time) return { error: 'Horário de fim deve ser depois do início' }

  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'Academia não encontrada.' }

  const sport = normalizeSportForOrg(data.sport, await getOrgSports(orgId))

  const adminClient = createAdminClient()
  const { data: newClass, error } = await adminClient
    .from('classes')
    .insert({ ...data, sport, level: 'iniciante', is_active: true, organization_id: orgId })
    .select('id')
    .single()
  if (error) return { error: error.message }

  // Gera só a próxima semana da turma (7 datas). O regime de 90 dias foi
  // substituído pela geração semanal (spec 2026-07-17). Nota: generateGrid
  // também reconcilia os fixos da ORG INTEIRA nesse intervalo (não só desta
  // turma) — idempotente e seguro, mas não é grátis; aceito porque criar
  // turma é uma operação rara para o admin.
  const from = brtToday(new Date())
  const result = await generateGrid(orgId, from, addDaysStr(from, 6), { classId: newClass.id })
  if (result.sessionsCreated === 0) {
    console.error('[createClass] generateGrid nao criou a sessao esperada', {
      classId: newClass.id, orgId, from,
    })
  }

  revalidatePath('/admin/grade')
  return {}
}

export async function updateClass(
  classId: string,
  data: Partial<ClassFormData>,
): Promise<{ error?: string }> {
  if (data.name !== undefined && !data.name.trim()) return { error: 'Nome é obrigatório' }
  if (data.start_time && data.end_time && data.start_time >= data.end_time) {
    return { error: 'Horário de fim deve ser depois do início' }
  }
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'Academia não encontrada.' }

  const adminClient = createAdminClient()

  let payload: Partial<ClassFormData> = data
  if (data.sport !== undefined) {
    // A modalidade já gravada continua válida mesmo se a academia parou de
    // oferecê-la — reeditar a turma por outro motivo não pode zerar o campo.
    const { data: current } = await adminClient
      .from('classes')
      .select('sport')
      .eq('id', classId)
      .eq('organization_id', orgId)
      .maybeSingle()
    const allowed = await getOrgSports(orgId)
    if (current?.sport && !allowed.includes(current.sport)) allowed.push(current.sport)
    payload = { ...data, sport: normalizeSportForOrg(data.sport, allowed) }
  }

  // Guarda de isolamento: só edita turma da academia ativa.
  const { error } = await adminClient
    .from('classes')
    .update(payload)
    .eq('id', classId)
    .eq('organization_id', orgId)
  if (error) return { error: error.message }
  revalidatePath('/admin/grade')
  revalidatePath(`/admin/grade/turma/${classId}/editar`, 'page')
  return {}
}

export async function deactivateClass(classId: string): Promise<{ error?: string }> {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'Academia não encontrada.' }
  const adminClient = createAdminClient()
  // Guarda de isolamento: só desativa turma da academia ativa.
  const { error } = await adminClient
    .from('classes')
    .update({ is_active: false })
    .eq('id', classId)
    .eq('organization_id', orgId)
  if (error) return { error: error.message }
  revalidatePath('/admin/grade')
  return {}
}
