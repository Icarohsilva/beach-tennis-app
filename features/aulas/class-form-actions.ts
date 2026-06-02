'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { StudentLevel, ClassType } from '@/types'

export interface ClassFormData {
  name: string
  description: string
  level: StudentLevel
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

  const adminClient = createAdminClient()
  const { error } = await adminClient.from('classes').insert({ ...data, is_active: true })
  if (error) return { error: error.message }
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
  const adminClient = createAdminClient()
  const { error } = await adminClient.from('classes').update(data).eq('id', classId)
  if (error) return { error: error.message }
  revalidatePath('/admin/grade')
  revalidatePath(`/admin/grade/${classId}/editar`, 'page')
  return {}
}

export async function deactivateClass(classId: string): Promise<{ error?: string }> {
  const adminClient = createAdminClient()
  const { error } = await adminClient
    .from('classes')
    .update({ is_active: false })
    .eq('id', classId)
  if (error) return { error: error.message }
  revalidatePath('/admin/grade')
  return {}
}
