'use server'
// features/checkin/actions.ts

import { revalidatePath } from 'next/cache'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import type { CheckinPartner } from '@/types'

async function requireAdmin(): Promise<{ ok: boolean }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false }
  const adminClient = createAdminClient()
  const { data: profile } = await adminClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  return { ok: profile?.role === 'admin' }
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
  const { ok } = await requireAdmin()
  if (!ok) return { error: 'Sem permissão de administrador.' }

  const adminClient = createAdminClient()

  if (input.type === 'subscriber') {
    const { error } = await adminClient
      .from('profiles')
      .update({ payment_type: 'subscriber', monthly_checkin_target: 0 })
      .eq('id', studentId)
    if (error) return { error: 'Erro ao definir tipo do aluno.' }
    revalidatePath(`/admin/alunos/${studentId}`)
    return {}
  }

  if (!Number.isInteger(input.monthlyTarget) || input.monthlyTarget < 0) {
    return { error: 'Meta mensal inválida.' }
  }

  const idColumn = input.type === 'wellhub' ? 'wellhub_id' : 'totalpass_id'
  const { error } = await adminClient
    .from('profiles')
    .update({
      payment_type: input.type,
      [idColumn]: input.partnerId.trim() || null,
      monthly_checkin_target: input.monthlyTarget,
    })
    .eq('id', studentId)

  if (error) return { error: 'Erro ao definir tipo do aluno.' }

  revalidatePath(`/admin/alunos/${studentId}`)
  return {}
}
