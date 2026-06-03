'use server'
// features/aulas/adminActions.ts — admin-only student management server actions

import { revalidatePath } from 'next/cache'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { format } from 'date-fns'
import { buildSessionRows } from './sessionUtils'
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

  // Upsert handles re-enrollment of previously cancelled students
  // (unique constraint on student_id+class_id prevents plain INSERT from working)
  const { error } = await adminClient.from('enrollments').upsert(
    {
      student_id: studentId,
      class_id: classId,
      is_active: true,
      enrolled_at: new Date().toISOString(),
      cancelled_at: null,
    },
    { onConflict: 'student_id,class_id' },
  )

  if (error) return { error: `Erro ao criar matrícula: ${error.message}` }
  revalidatePath(`/admin/alunos/${studentId}`)
  revalidatePath('/admin/alunos')
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

  const { data: enrollmentData } = await adminClient
    .from('enrollments')
    .select('student_id')
    .eq('id', enrollmentId)
    .single()

  const { error } = await adminClient
    .from('enrollments')
    .update({ is_active: false, cancelled_at: now })
    .eq('id', enrollmentId)

  if (error) return { error: 'Erro ao cancelar matrícula.' }
  if (enrollmentData) revalidatePath(`/admin/alunos/${enrollmentData.student_id}`)
  revalidatePath('/admin/alunos')
  return {}
}

// ---------------------------------------------------------------------------
// addDependentSelf — guardian adds their own dependent (no admin required)
// ---------------------------------------------------------------------------

export async function addDependentSelf(
  name: string,
  level: StudentLevel,
): Promise<{ dependentId?: string; error?: string }> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  if (!name.trim()) return { error: 'Nome é obrigatório.' }

  const adminClient = createAdminClient()

  // Verify caller is not a dependent themselves
  const { data: callerProfile } = await adminClient
    .from('profiles')
    .select('id, is_dependent')
    .eq('id', user.id)
    .single()

  if (!callerProfile) return { error: 'Perfil não encontrado.' }
  if (callerProfile.is_dependent) return { error: 'Dependentes não podem adicionar dependentes.' }

  const newId = crypto.randomUUID()

  const { data: newDep, error } = await adminClient
    .from('profiles')
    .insert({
      id: newId,
      full_name: name.trim(),
      level,
      role: 'student',
      is_dependent: true,
      parent_id: user.id,
      payment_type: 'subscriber',
      credits_balance: 0,
      contract_active: false,
    })
    .select('id')
    .single()

  if (error) return { error: 'Erro ao criar dependente.' }

  const { revalidatePath } = await import('next/cache')
  revalidatePath('/perfil')

  return { dependentId: (newDep as { id: string }).id }
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

// ---------------------------------------------------------------------------
// addCreditsManually — admin adds credits to any student (any amount, any reason)
// ---------------------------------------------------------------------------

export async function addCreditsManually(
  studentId: string,
  amount: number,
  reason: string,
): Promise<{ error?: string }> {
  const { error: authErr } = await requireAdmin()
  if (authErr) return { error: authErr }

  if (!Number.isInteger(amount) || amount === 0) {
    return { error: 'Quantidade inválida.' }
  }

  const adminClient = createAdminClient()

  const { data: student } = await adminClient
    .from('profiles')
    .select('credits_balance')
    .eq('id', studentId)
    .single()

  if (!student) return { error: 'Aluno não encontrado.' }

  const newBalance = (student.credits_balance as number) + amount

  const { error: txErr } = await adminClient.from('credit_transactions').insert({
    student_id: studentId,
    type: amount > 0 ? 'renewed' : 'expired',
    amount,
    reason: reason.trim() || (amount > 0 ? 'Créditos adicionados pelo admin' : 'Créditos removidos pelo admin'),
    session_id: null,
    expires_at: null,
  })

  if (txErr) return { error: 'Erro ao registrar transação.' }

  await adminClient
    .from('profiles')
    .update({ credits_balance: newBalance })
    .eq('id', studentId)

  revalidatePath(`/admin/alunos/${studentId}`)
  return {}
}

// ---------------------------------------------------------------------------
// generateSessionsForExistingClass — backfill sessions for next 90 days
// ---------------------------------------------------------------------------

/**
 * Gera sessões para uma turma existente nos próximos 90 dias.
 * Ignora datas que já têm sessão (upsert por class_id+session_date).
 */
export async function generateSessionsForExistingClass(
  classId: string,
): Promise<{ error?: string; count?: number }> {
  const { error: authErr } = await requireAdmin()
  if (authErr) return { error: authErr }

  const adminClient = createAdminClient()

  const { data: cls } = await adminClient
    .from('classes')
    .select('day_of_week, is_active')
    .eq('id', classId)
    .single()

  if (!cls) return { error: 'Turma não encontrada.' }
  if (!cls.is_active) return { error: 'Turma inativa.' }

  const today = new Date()
  const end = new Date()
  end.setDate(today.getDate() + 90)

  const rows = buildSessionRows(
    classId,
    cls.day_of_week,
    format(today, 'yyyy-MM-dd'),
    format(end, 'yyyy-MM-dd'),
  )

  if (rows.length === 0) return { count: 0 }

  // upsert — ignores conflicts on (class_id, session_date)
  const { error } = await adminClient
    .from('class_sessions')
    .upsert(rows, { onConflict: 'class_id,session_date', ignoreDuplicates: true })

  if (error) return { error: error.message }

  revalidatePath('/admin/grade')
  return { count: rows.length }
}
