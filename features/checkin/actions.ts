'use server'
// features/checkin/actions.ts

import { revalidatePath } from 'next/cache'
import { createClient, createAdminClient, getActiveOrgId } from '@/lib/supabase/server'
import type { CheckinPartner } from '@/types'
import { format } from 'date-fns'
import { getValidator } from '@/lib/checkin/validator'
import { computeProgress, type CheckinProgress } from '@/lib/checkin/progress'
import { getMonthWindow } from '@/lib/utils/monthWindow'

async function requireAdmin(): Promise<{ ok: boolean; orgId: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, orgId: '' }
  const orgId = await getActiveOrgId()
  if (!orgId) return { ok: false, orgId: '' }
  // Papel é por-academia: vem da membership da academia ativa.
  const adminClient = createAdminClient()
  const { data: membership } = await adminClient
    .from('memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .single()
  return { ok: membership?.role === 'admin', orgId }
}

export type StudentType = 'subscriber' | CheckinPartner

/**
 * Define o tipo do aluno numa única ação:
 * - 'subscriber' (Mensalista): payment_type='subscriber', meta zerada.
 * - 'wellhub' / 'totalpass': payment_type do parceiro, grava o ID no campo
 *   correspondente e a meta mensal de check-ins.
 * (Vincular plano/créditos do mensalista continua em adminSubscribeStudentToPlan.)
 */
export async function setStudentType(
  studentId: string,
  input:
    | { type: 'subscriber' }
    | { type: CheckinPartner; partnerId: string; monthlyTarget: number },
): Promise<{ error?: string }> {
  const { ok, orgId } = await requireAdmin()
  if (!ok) return { error: 'Sem permissão de administrador.' }

  const adminClient = createAdminClient()

  if (input.type === 'subscriber') {
    const patch = { payment_type: 'subscriber', monthly_checkin_target: 0, pending_partner: null }
    // Tipo do aluno é por-academia: fonte é a membership da academia ativa.
    const { error } = await adminClient
      .from('memberships')
      .update(patch)
      .eq('user_id', studentId)
      .eq('organization_id', orgId)
    if (error) return { error: 'Erro ao definir tipo do aluno.' }
    // fonte dupla: espelha em profiles enquanto a coluna não é removida (plano 3)
    await adminClient.from('profiles').update(patch).eq('id', studentId)
    revalidatePath(`/admin/alunos/${studentId}`)
    return {}
  }

  if (!Number.isInteger(input.monthlyTarget) || input.monthlyTarget < 0) {
    return { error: 'Meta mensal inválida.' }
  }

  const idColumn = input.type === 'wellhub' ? 'wellhub_id' : 'totalpass_id'
  const patch = {
    payment_type: input.type,
    [idColumn]: input.partnerId.trim() || null,
    monthly_checkin_target: input.monthlyTarget,
    pending_partner: null,
  }
  // Tipo do aluno é por-academia: fonte é a membership da academia ativa.
  const { error } = await adminClient
    .from('memberships')
    .update(patch)
    .eq('user_id', studentId)
    .eq('organization_id', orgId)

  if (error) return { error: 'Erro ao definir tipo do aluno.' }

  // fonte dupla: espelha em profiles enquanto a coluna não é removida (plano 3)
  await adminClient.from('profiles').update(patch).eq('id', studentId)

  revalidatePath(`/admin/alunos/${studentId}`)
  return {}
}

/**
 * Registra um check-in do aluno no parceiro. Valida via getValidator (manual
 * por ora). Se a data cair numa aula fixa do aluno com reserva confirmada,
 * também marca presença. Idempotente por external_ref. Retorna o progresso do mês.
 */
export async function recordCheckin(
  studentId: string,
  partner: CheckinPartner,
  opts?: { date?: string; code?: string; createdBy?: string },
): Promise<{ error?: string; progress?: CheckinProgress; linkedSessionId?: string | null }> {
  const { ok, orgId } = await requireAdmin()
  if (!ok) return { error: 'Sem permissão de administrador.' }

  const adminClient = createAdminClient()
  const date = opts?.date ?? format(new Date(), 'yyyy-MM-dd')

  // Vínculo ao parceiro é por-academia: vem da membership da academia ativa.
  const { data: profile } = await adminClient
    .from('memberships')
    .select('payment_type, wellhub_id, totalpass_id, monthly_checkin_target')
    .eq('user_id', studentId)
    .eq('organization_id', orgId)
    .single()

  if (!profile) return { error: 'Aluno não encontrado.' }
  if (profile.payment_type !== partner) {
    return { error: 'Aluno não está vinculado a este parceiro.' }
  }

  const partnerMemberId = (partner === 'wellhub' ? profile.wellhub_id : profile.totalpass_id) as
    | string
    | null

  // Validação (manual por ora)
  const result = await getValidator(partner).validate({
    partner,
    studentId,
    partnerMemberId,
    code: opts?.code,
  })
  if (!result.valid) return { error: result.error ?? 'Check-in inválido.' }

  // Idempotência por external_ref (por-academia)
  if (result.externalRef) {
    const { data: existing } = await adminClient
      .from('checkins')
      .select('id')
      .eq('organization_id', orgId)
      .eq('partner', partner)
      .eq('external_ref', result.externalRef)
      .maybeSingle()
    if (existing) {
      return { progress: await monthlyProgress(adminClient, studentId, orgId, profile.monthly_checkin_target) }
    }
  }

  // Liga a uma aula fixa do dia, se houver reserva confirmada
  const linkedSessionId = await findLinkedSession(adminClient, studentId, orgId, date)

  const { error: insertErr } = await adminClient.from('checkins').insert({
    organization_id: orgId,
    student_id: studentId,
    partner,
    checkin_date: date,
    session_id: linkedSessionId,
    external_ref: result.externalRef ?? null,
    validation: result.validation,
    created_by: opts?.createdBy ?? null,
  })
  if (insertErr) return { error: 'Erro ao registrar check-in.' }

  if (linkedSessionId) {
    await adminClient.from('attendance').upsert(
      {
        organization_id: orgId,
        student_id: studentId,
        session_id: linkedSessionId,
        status: 'present',
        source: partner,
        checked_in_at: new Date().toISOString(),
      },
      { onConflict: 'student_id,session_id' },
    )
  }

  revalidatePath(`/admin/alunos/${studentId}`)
  return {
    progress: await monthlyProgress(adminClient, studentId, orgId, profile.monthly_checkin_target),
    linkedSessionId,
  }
}

/** Sessão agendada na data, de turma com matrícula ativa e reserva confirmada. */
async function findLinkedSession(
  adminClient: ReturnType<typeof createAdminClient>,
  studentId: string,
  orgId: string,
  date: string,
): Promise<string | null> {
  const { data: enrolls } = await adminClient
    .from('enrollments')
    .select('class_id')
    .eq('student_id', studentId)
    .eq('organization_id', orgId)
    .eq('is_active', true)
  const classIds = (enrolls ?? []).map((e: { class_id: string }) => e.class_id)
  if (classIds.length === 0) return null

  const { data: sessions } = await adminClient
    .from('class_sessions')
    .select('id')
    .eq('organization_id', orgId)
    .eq('session_date', date)
    .eq('status', 'scheduled')
    .in('class_id', classIds)
  const sessionIds = (sessions ?? []).map((s: { id: string }) => s.id)
  if (sessionIds.length === 0) return null

  const { data: booking } = await adminClient
    .from('session_bookings')
    .select('session_id')
    .eq('student_id', studentId)
    .eq('status', 'confirmed')
    .in('session_id', sessionIds)
    .limit(1)
    .maybeSingle()

  return (booking?.session_id as string | undefined) ?? null
}

/** Recusa a solicitação de parceiro autodeclarada: limpa pending_partner. */
export async function clearPendingPartner(studentId: string): Promise<{ error?: string }> {
  const { ok, orgId } = await requireAdmin()
  if (!ok) return { error: 'Sem permissão de administrador.' }

  const adminClient = createAdminClient()
  // pending_partner é por-academia: fonte é a membership da academia ativa.
  const { error } = await adminClient
    .from('memberships')
    .update({ pending_partner: null })
    .eq('user_id', studentId)
    .eq('organization_id', orgId)

  if (error) return { error: 'Erro ao recusar solicitação.' }

  // fonte dupla: espelha em profiles enquanto a coluna não é removida (plano 3)
  await adminClient.from('profiles').update({ pending_partner: null }).eq('id', studentId)

  revalidatePath(`/admin/alunos/${studentId}`)
  return {}
}

/** Conta os check-ins do mês corrente e calcula o progresso. */
async function monthlyProgress(
  adminClient: ReturnType<typeof createAdminClient>,
  studentId: string,
  orgId: string,
  target: number,
): Promise<CheckinProgress> {
  const { from, to } = getMonthWindow(new Date())
  const { count } = await adminClient
    .from('checkins')
    .select('id', { count: 'exact', head: true })
    .eq('student_id', studentId)
    .eq('organization_id', orgId)
    .gte('checkin_date', from)
    .lte('checkin_date', to)
  return computeProgress(target, count ?? 0)
}
