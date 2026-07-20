'use server'

import { createAdminClient, getCurrentOrgId } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { generateGrid } from './gridGeneration'
import { brtToday, addDaysStr } from '@/lib/utils/gridSchedule'
import type { ClassType } from '@/types'

export interface ClassFormData {
  name: string
  description: string
  type: ClassType
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

  const adminClient = createAdminClient()
  const { data: newClass, error } = await adminClient
    .from('classes')
    .insert({ ...data, level: 'iniciante', is_active: true, organization_id: orgId })
    .select('id')
    .single()
  if (error) return { error: error.message }

  // Gera só a próxima semana da turma (7 datas). O regime de 90 dias foi
  // substituído pela geração semanal (spec 2026-07-17).
  const from = brtToday(new Date())
  await generateGrid(orgId, from, addDaysStr(from, 6), { classId: newClass.id })

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
  // Guarda de isolamento: só edita turma da academia ativa.
  const { error } = await adminClient
    .from('classes')
    .update(data)
    .eq('id', classId)
    .eq('organization_id', orgId)
  if (error) return { error: error.message }
  revalidatePath('/admin/grade')
  revalidatePath(`/admin/grade/${classId}/editar`, 'page')
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
