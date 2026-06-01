'use server'
// features/aulas/adminActions.ts — admin-only student management server actions

import { createClient, createAdminClient } from '@/lib/supabase/server'
import type { StudentLevel } from '@/types'

async function requireAdmin(): Promise<{ userId: string; error?: string }> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { userId: '', error: 'Não autenticado.' }

  const adminClient = createAdminClient()
  const { data: profile } = await adminClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin') return { userId: user.id, error: 'Sem permissão de administrador.' }
  return { userId: user.id }
}

// ---------------------------------------------------------------------------
// updateStudentLevel
// ---------------------------------------------------------------------------

export async function updateStudentLevel(
  studentId: string,
  level: StudentLevel,
): Promise<{ error?: string }> {
  const { error: authErr } = await requireAdmin()
  if (authErr) return { error: authErr }

  const adminClient = createAdminClient()
  const { error } = await adminClient
    .from('profiles')
    .update({ level })
    .eq('id', studentId)

  if (error) return { error: 'Erro ao atualizar nível.' }
  return {}
}

// ---------------------------------------------------------------------------
// enrollStudentInClass  (fixed weekly enrollment)
// ---------------------------------------------------------------------------

export async function enrollStudentInClass(
  studentId: string,
  classId: string,
): Promise<{ error?: string }> {
  const { error: authErr } = await requireAdmin()
  if (authErr) return { error: authErr }

  const adminClient = createAdminClient()

  // Check class exists and is active
  const { data: cls } = await adminClient
    .from('classes')
    .select('id, is_active, max_students')
    .eq('id', classId)
    .single()

  if (!cls || !cls.is_active) return { error: 'Turma não encontrada ou inativa.' }

  // Check for existing active enrollment
  const { count: existing } = await adminClient
    .from('enrollments')
    .select('id', { count: 'exact', head: true })
    .eq('student_id', studentId)
    .eq('class_id', classId)
    .eq('is_active', true)

  if ((existing ?? 0) > 0) return { error: 'Aluno já está matriculado nesta turma.' }

  // Check capacity
  const { count: enrolled } = await adminClient
    .from('enrollments')
    .select('id', { count: 'exact', head: true })
    .eq('class_id', classId)
    .eq('is_active', true)

  if ((enrolled ?? 0) >= cls.max_students) return { error: 'Turma lotada.' }

  const { error } = await adminClient.from('enrollments').insert({
    student_id: studentId,
    class_id: classId,
    is_active: true,
  })

  if (error) return { error: 'Erro ao criar matrícula.' }
  return {}
}

// ---------------------------------------------------------------------------
// cancelEnrollment
// ---------------------------------------------------------------------------

export async function cancelEnrollment(enrollmentId: string): Promise<{ error?: string }> {
  const { error: authErr } = await requireAdmin()
  if (authErr) return { error: authErr }

  const adminClient = createAdminClient()
  const now = new Date().toISOString()

  const { error } = await adminClient
    .from('enrollments')
    .update({ is_active: false, cancelled_at: now })
    .eq('id', enrollmentId)

  if (error) return { error: 'Erro ao cancelar matrícula.' }
  return {}
}

// ---------------------------------------------------------------------------
// addDependent — creates a new student profile linked to this parent
// ---------------------------------------------------------------------------

export async function addDependent(
  parentId: string,
  fullName: string,
  level: StudentLevel,
): Promise<{ error?: string }> {
  const { error: authErr } = await requireAdmin()
  if (authErr) return { error: authErr }

  if (!fullName.trim()) return { error: 'Nome é obrigatório.' }

  const adminClient = createAdminClient()

  // Verify parent exists and is not a dependent themselves
  const { data: parent } = await adminClient
    .from('profiles')
    .select('id, is_dependent')
    .eq('id', parentId)
    .single()

  if (!parent) return { error: 'Responsável não encontrado.' }
  if (parent.is_dependent) return { error: 'Dependentes não podem ter dependentes.' }

  // Create the dependent profile (no auth user — managed by parent)
  const { error } = await adminClient.from('profiles').insert({
    id: crypto.randomUUID(),
    full_name: fullName.trim(),
    level,
    role: 'student',
    is_dependent: true,
    parent_id: parentId,
    payment_type: 'subscriber',
    contract_active: true,
    credits_balance: 0,
  })

  if (error) return { error: 'Erro ao criar dependente.' }
  return {}
}
