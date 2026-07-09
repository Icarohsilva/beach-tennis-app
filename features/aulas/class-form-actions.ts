'use server'

import { createAdminClient, getCurrentOrgId } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { format } from 'date-fns'
import { buildSessionRows } from './sessionUtils'
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

  // Auto-generate sessions for the next 90 days
  const today = new Date()
  const end = new Date()
  end.setDate(today.getDate() + 90)
  const rows = buildSessionRows(
    newClass.id,
    data.day_of_week,
    format(today, 'yyyy-MM-dd'),
    format(end, 'yyyy-MM-dd'),
  )
  if (rows.length > 0) {
    await adminClient.from('class_sessions').insert(rows)
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
