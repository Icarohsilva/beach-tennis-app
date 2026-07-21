'use server'
// features/aulas/adminActions.ts — admin-only student management server actions

import { revalidatePath } from 'next/cache'
import { createClient, createAdminClient, getActiveOrgId } from '@/lib/supabase/server'
import { format, endOfMonth } from 'date-fns'
import type { StudentLevel } from '@/types'
import { reconcileEnrollmentCredits } from './creditReconciliation'
import { hasActiveSubscriptionPlan } from '@/lib/billing/planEligibility'
import { resolveClassAccess } from '@/lib/utils/accessRules'
import { getSingleClassPrice } from '@/features/financeiro/classDebt'
import type { AddStudentReason, CheckinPartner } from '@/types'
import * as Sentry from '@sentry/nextjs'
import { notifyUsers } from '@/lib/notifications/dispatch'
import { requireAdmin } from './authGuards'

// ---------------------------------------------------------------------------
// updateStudentLevel
// ---------------------------------------------------------------------------

export async function updateStudentLevel(
  studentId: string,
  level: StudentLevel,
): Promise<{ error?: string }> {
  const { orgId, error: authErr } = await requireAdmin()
  if (authErr) return { error: authErr }

  const adminClient = createAdminClient()
  // Nível é por-academia: fonte é a membership da academia ativa.
  const { error } = await adminClient
    .from('memberships')
    .update({ level })
    .eq('user_id', studentId)
    .eq('organization_id', orgId)

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
  const { orgId, error: authErr } = await requireAdmin()
  if (authErr) return { error: authErr }

  const adminClient = createAdminClient()

  // Check class exists and is active (escopado pela academia ativa)
  const { data: cls } = await adminClient
    .from('classes')
    .select('id, is_active, max_students')
    .eq('id', classId)
    .eq('organization_id', orgId)
    .single()

  if (!cls || !cls.is_active) return { error: 'Turma não encontrada ou inativa.' }

  // Fixa exige plano ou parceiro (spec §2). Crédito não compra vaga fixa.
  const { data: membership } = await adminClient
    .from('memberships')
    .select('partner')
    .eq('user_id', studentId)
    .eq('organization_id', orgId)
    .maybeSingle()

  if (!membership) return { error: 'Aluno não participa desta academia.' }

  if (!(membership as { partner: string | null }).partner) {
    const hasActivePlan = await hasActiveSubscriptionPlan(adminClient, studentId, orgId)

    if (!hasActivePlan) {
      return {
        error:
          'Aula fixa exige plano ativo ou Wellhub/TotalPass. Para uma aula pontual, adicione o aluno direto na sessão.',
      }
    }
  }

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
  const { error } = await adminClient.from('enrollments').upsert(
    {
      organization_id: orgId,
      student_id: studentId,
      class_id: classId,
      is_active: true,
      enrolled_at: new Date().toISOString(),
      cancelled_at: null,
    },
    { onConflict: 'student_id,class_id' },
  )

  if (error) return { error: `Erro ao criar matrícula: ${error.message}` }

  // Reserva as sessões restantes do mês para esta turma. Não consome crédito:
  // quem chega aqui tem plano ou parceiro (spec §3).
  const today = format(new Date(), 'yyyy-MM-dd')
  const monthEnd = format(endOfMonth(new Date()), 'yyyy-MM-dd')
  await reconcileEnrollmentCredits(studentId, classId, today, monthEnd)

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

  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  const adminClient = createAdminClient()

  // is_dependent é por-academia: verifica via membership da academia ativa.
  const { data: callerMembership } = await adminClient
    .from('memberships')
    .select('is_dependent')
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .single()

  if (!callerMembership) return { error: 'Você não participa desta academia.' }
  if (callerMembership.is_dependent) return { error: 'Dependentes não podem adicionar dependentes.' }

  const newId = crypto.randomUUID()

  // Identidade do dependente (profiles = só identidade). Campos por-academia vão
  // na membership abaixo.
  const { data: newDep, error } = await adminClient
    .from('profiles')
    .insert({
      id: newId,
      full_name: name.trim(),
    })
    .select('id')
    .single()

  if (error) {
    console.error('[addDependentSelf] profiles.insert', error)
    return { error: 'Erro ao criar dependente.' }
  }

  // Membership do dependente na academia ativa (fonte da verdade por-academia).
  const { error: memErr } = await adminClient.from('memberships').insert({
    user_id: newId,
    organization_id: orgId,
    role: 'student',
    level,
    is_dependent: true,
    parent_id: user.id,
    payment_type: 'subscriber',
    credits_balance: 0,
    contract_active: false,
  })

  if (memErr) {
    console.error('[addDependentSelf] memberships.insert', memErr)
    return { error: 'Erro ao criar dependente.' }
  }

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
  const { orgId, error: authErr } = await requireAdmin()
  if (authErr) return { error: authErr }

  if (!fullName.trim()) return { error: 'Nome é obrigatório.' }

  const adminClient = createAdminClient()

  // Responsável precisa ser membro desta academia e não ser dependente (por-academia).
  const { data: parentMembership } = await adminClient
    .from('memberships')
    .select('is_dependent')
    .eq('user_id', parentId)
    .eq('organization_id', orgId)
    .single()

  if (!parentMembership) return { error: 'Responsável não encontrado nesta academia.' }
  if (parentMembership.is_dependent) return { error: 'Dependentes não podem ter dependentes.' }

  const newId = crypto.randomUUID()

  // Identidade do dependente (profiles = só identidade; sem auth user — gerido pelo
  // responsável). Campos por-academia vão na membership abaixo.
  const { error } = await adminClient.from('profiles').insert({
    id: newId,
    full_name: fullName.trim(),
  })

  if (error) {
    console.error('[addDependent] profiles.insert', error)
    return { error: 'Erro ao criar dependente.' }
  }

  // Membership do dependente na academia do admin (fonte da verdade por-academia).
  const { error: memErr } = await adminClient.from('memberships').insert({
    user_id: newId,
    organization_id: orgId,
    role: 'student',
    level,
    is_dependent: true,
    parent_id: parentId,
    payment_type: 'subscriber',
    contract_active: true,
    credits_balance: 0,
  })

  if (memErr) {
    console.error('[addDependent] memberships.insert', memErr)
    return { error: 'Erro ao criar dependente.' }
  }
  return {}
}

// ---------------------------------------------------------------------------
// deleteClass — soft-delete a class and cancel all associated data
// ---------------------------------------------------------------------------

export async function deleteClass(classId: string): Promise<{ error?: string }> {
  const { orgId, error: authErr } = await requireAdmin()
  if (authErr) return { error: authErr }

  const adminClient = createAdminClient()
  const now = new Date().toISOString()
  const today = format(new Date(), 'yyyy-MM-dd')

  // Garante que a turma pertence à academia ativa antes de mutar. Pega o nome
  // para a mensagem da notificação.
  const { data: ownClass } = await adminClient
    .from('classes')
    .select('id, name')
    .eq('id', classId)
    .eq('organization_id', orgId)
    .single()
  if (!ownClass) return { error: 'Turma não encontrada.' }

  // Coleta destinatários afetados ANTES de cancelar — as mutações abaixo mudam
  // os filtros (status='confirmed', is_active=true) que identificam os afetados.
  const { data: futureSessions } = await adminClient
    .from('class_sessions')
    .select('id')
    .eq('class_id', classId)
    .gte('session_date', today)
  const sessionIds = (futureSessions ?? []).map((s: { id: string }) => s.id)

  const affectedIds = new Set<string>()
  if (sessionIds.length > 0) {
    const { data: bookingsRaw } = await adminClient
      .from('session_bookings')
      .select('student_id')
      .in('session_id', sessionIds)
      .eq('status', 'confirmed')
    for (const b of (bookingsRaw ?? []) as { student_id: string }[]) affectedIds.add(b.student_id)
  }
  const { data: enrollmentsRaw } = await adminClient
    .from('enrollments')
    .select('student_id')
    .eq('class_id', classId)
    .eq('is_active', true)
  for (const e of (enrollmentsRaw ?? []) as { student_id: string }[]) affectedIds.add(e.student_id)

  // Cancel all future sessions
  await adminClient
    .from('class_sessions')
    .update({ status: 'cancelled' })
    .eq('class_id', classId)
    .gte('session_date', today)
    .neq('status', 'cancelled')

  // Cancel bookings on those future sessions
  if (sessionIds.length > 0) {
    await adminClient
      .from('session_bookings')
      .update({ status: 'cancelled', cancelled_at: now })
      .in('session_id', sessionIds)
      .eq('status', 'confirmed')
  }

  // Cancel all active enrollments
  await adminClient
    .from('enrollments')
    .update({ is_active: false, cancelled_at: now })
    .eq('class_id', classId)
    .eq('is_active', true)

  // Soft-delete the class
  const { error } = await adminClient
    .from('classes')
    .update({ is_active: false })
    .eq('id', classId)

  if (error) return { error: 'Erro ao excluir turma.' }

  // Best-effort: notificar afetados NUNCA reverte o cancelamento.
  if (affectedIds.size > 0) {
    try {
      const ids = Array.from(affectedIds)
      const { data: emailRows } = await adminClient
        .from('user_emails')
        .select('id, email')
        .in('id', ids)
      const { data: profileRows } = await adminClient
        .from('profiles')
        .select('id, phone')
        .in('id', ids)
      const emailById = new Map(((emailRows ?? []) as { id: string; email: string }[]).map((r) => [r.id, r.email]))
      const phoneById = new Map(((profileRows ?? []) as { id: string; phone: string | null }[]).map((r) => [r.id, r.phone]))

      await notifyUsers(adminClient, {
        orgId,
        recipients: ids.map((id) => ({
          userId: id,
          email: emailById.get(id) ?? null,
          phone: phoneById.get(id) ?? null,
        })),
        type: 'class_cancelled',
        title: 'Aula cancelada',
        body: `A turma "${(ownClass as { name: string }).name}" foi cancelada.`,
        channels: ['inapp', 'email', 'whatsapp', 'push'],
      })
    } catch (err) {
      console.error('[deleteClass] notifyUsers falhou', {
        classId, error: err instanceof Error ? err.message : String(err),
      })
      Sentry.captureException(err, {
        tags: { channel: 'dispatch', notificationType: 'class_cancelled' },
        extra: { classId, orgId },
      })
    }
  }

  revalidatePath('/admin/grade')
  revalidatePath('/admin/alunos')
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

  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  const { error: creditErr } = await adminClient.rpc('adjust_credits', {
    p_student_id: studentId,
    p_org: orgId,
    p_delta: amount,
    p_type: amount > 0 ? 'renewed' : 'expired',
    p_reason: reason.trim() || (amount > 0 ? 'Créditos adicionados pelo admin' : 'Créditos removidos pelo admin'),
  })

  if (creditErr) {
    if (creditErr.message.includes('STUDENT_NOT_FOUND')) return { error: 'Aluno não encontrado.' }
    if (creditErr.message.includes('INSUFFICIENT_CREDITS')) return { error: 'Saldo insuficiente para remover essa quantidade.' }
    return { error: 'Erro ao registrar transação.' }
  }

  revalidatePath(`/admin/alunos/${studentId}`)
  return {}
}

// ---------------------------------------------------------------------------
// addStudentToSession — admin/professor adiciona aluno avulso a uma sessão
// ---------------------------------------------------------------------------

/**
 * Adiciona um aluno a uma sessão, com ou sem crédito, plano ou parceiro.
 *
 * IGNORA o bloqueio por dívida de propósito (spec §1): o admin pode estar
 * adicionando justamente o aluno que está quitando no balcão. Esta é a única
 * porta com essa permissão.
 *
 * `reason` só é considerado quando o aluno não tem plano, parceiro nem crédito;
 * caso contrário o caminho normal decide (parceiro/plano entram de graça,
 * crédito debita).
 */
export async function addStudentToSession(
  sessionId: string,
  studentId: string,
  reason: AddStudentReason,
): Promise<{ error?: string }> {
  const { orgId, error: authErr } = await requireAdmin()
  if (authErr) return { error: authErr }

  const adminClient = createAdminClient()

  const { data: session } = await adminClient
    .from('class_sessions')
    .select('id, status, class:classes(max_students)')
    .eq('id', sessionId)
    .eq('organization_id', orgId)
    .single()

  if (!session) return { error: 'Sessão não encontrada.' }
  if ((session as { status: string }).status !== 'scheduled') {
    return { error: 'Esta sessão não está disponível.' }
  }

  const clsRaw = (session as { class: { max_students: number } | { max_students: number }[] }).class
  const cls = Array.isArray(clsRaw) ? clsRaw[0] : clsRaw

  const { data: membership } = await adminClient
    .from('memberships')
    .select('partner, credits_balance')
    .eq('user_id', studentId)
    .eq('organization_id', orgId)
    .maybeSingle()

  if (!membership) return { error: 'Aluno não participa desta academia.' }
  const mem = membership as { partner: string | null; credits_balance: number }

  const hasActivePlan = await hasActiveSubscriptionPlan(adminClient, studentId, orgId)

  // Note o hasOpenDebt: false — o admin ignora o bloqueio (ver doc acima).
  const decision = resolveClassAccess({
    partner: mem.partner as CheckinPartner | null,
    hasActivePlan,
    creditsBalance: mem.credits_balance,
    hasOpenDebt: false,
  })

  // 'denied' é inalcançável com hasOpenDebt: false, mas o TypeScript não sabe.
  if ('denied' in decision) return { error: 'Não foi possível adicionar o aluno.' }

  const useCredit = decision.grant === 'credit'

  const { error: bookErr } = await adminClient.rpc('book_session_atomic', {
    p_student_id: studentId,
    p_session_id: sessionId,
    p_max_students: cls.max_students,
    p_type: 'extra',
    p_from_enrollment: false,
    p_credit_used: useCredit,
  })

  if (bookErr) {
    if (bookErr.message.includes('SESSION_FULL')) return { error: 'Esta turma está lotada.' }
    if (bookErr.message.includes('ALREADY_BOOKED')) return { error: 'Aluno já está nesta aula.' }
    return { error: 'Erro ao adicionar o aluno.' }
  }

  if (useCredit) {
    const { error: creditErr } = await adminClient.rpc('adjust_credits', {
      p_student_id: studentId,
      p_org: orgId,
      p_delta: -1,
      p_type: 'used',
      p_reason: 'Adicionado à aula pelo admin',
      p_session_id: sessionId,
    })
    if (creditErr) {
      const { error: rollbackErr } = await adminClient
        .from('session_bookings')
        .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
        .eq('student_id', studentId)
        .eq('session_id', sessionId)

      if (rollbackErr) {
        console.error('[addStudentToSession] rollback do booking falhou após erro no débito', {
          studentId,
          sessionId,
          creditErr: creditErr.message,
          rollbackErr: rollbackErr.message,
        })
      }

      return { error: 'Erro ao debitar o crédito. Tente novamente.' }
    }
  }

  // Pré-declaração. Só para quem não tem plano/parceiro/crédito — para os outros
  // a aula já está paga e gravar payments aqui seria cobrança dupla.
  if (decision.grant === 'debt' && reason !== 'open') {
    const price = await getSingleClassPrice(adminClient, orgId)

    const { error: payErr } = await adminClient.from('payments').insert({
      organization_id: orgId,
      student_id: studentId,
      session_id: sessionId,
      amount: reason === 'experimental' ? 0 : price,
      currency: 'BRL',
      status: 'paid',
      type: reason === 'experimental' ? 'trial' : 'per_class',
      gateway: 'manual',
      paid_at: new Date().toISOString(),
      credits_qty: null,
    })

    // 23505 = já havia pendência para este par: a aula já estava registrada.
    // Não é erro — e não derruba a reserva, que é o que o admin pediu.
    if (payErr && payErr.code !== '23505') {
      console.error('[addStudentToSession] pre-declaracao falhou', {
        sessionId, studentId, reason, error: payErr.message,
      })
    }
  }

  revalidatePath(`/admin/grade/${sessionId}`)
  return {}
}
