'use server'
// features/checkin/actions.ts

import { revalidatePath } from 'next/cache'
import { createClient, createAdminClient, getActiveOrgId } from '@/lib/supabase/server'
import type { CheckinPartner } from '@/types'
import { todayInBrt } from '@/lib/utils/sessionTime'
import { getValidator } from '@/lib/checkin/validator'
import { computeProgress, type CheckinProgress } from '@/lib/checkin/progress'
import { getMonthWindow } from '@/lib/utils/monthWindow'
import { recordResolvedCheckin } from '@/lib/checkin/ingest'
import { getOrgDefaultCheckinTarget } from '@/lib/checkin/orgCheckinTarget'

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
  const date = opts?.date ?? todayInBrt()

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

  // Idempotência + inserção + presença ficam no núcleo compartilhado (lib/checkin/ingest).
  const { linkedSessionId } = await recordResolvedCheckin(adminClient, {
    orgId,
    studentId,
    partner,
    date,
    externalRef: result.externalRef ?? null,
    validation: result.validation,
    createdBy: opts?.createdBy ?? null,
  })

  revalidatePath(`/admin/alunos/${studentId}`)
  return {
    progress: await monthlyProgress(adminClient, studentId, orgId, profile.monthly_checkin_target),
    linkedSessionId,
  }
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

  revalidatePath(`/admin/alunos/${studentId}`)
  return {}
}

/**
 * Autoatendimento: o próprio aluno define seu vínculo de parceiro (Wellhub/TotalPass)
 * na academia ativa. Vale na hora. TRAVADO se o aluno já for mensalista ativo
 * (assinatura student_subscriptions com status='active'), para não conflitar com o
 * plano pago. NÃO mexe em monthly_checkin_target (a meta segue com o professor).
 */
export async function selfSetPartnerId(
  partner: CheckinPartner,
  partnerId: string,
): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  if (partner !== 'wellhub' && partner !== 'totalpass') {
    return { error: 'Parceiro inválido.' }
  }
  const trimmedId = partnerId.trim()
  if (!trimmedId) return { error: 'Informe o seu ID do parceiro.' }

  const adminClient = createAdminClient()

  // Trava: mensalista ativo não pode virar parceiro sozinho.
  const { data: activeSub } = await adminClient
    .from('student_subscriptions')
    .select('id')
    .eq('student_id', user.id)
    .eq('organization_id', orgId)
    .eq('status', 'active')
    .maybeSingle()
  if (activeSub) {
    return {
      error: 'Você tem um plano mensalista ativo. Fale com o professor para mudar para parceiro.',
    }
  }

  const idColumn = partner === 'wellhub' ? 'wellhub_id' : 'totalpass_id'
  const { error } = await adminClient
    .from('memberships')
    .update({
      payment_type: partner,
      [idColumn]: trimmedId,
      pending_partner: null,
    })
    .eq('user_id', user.id)
    .eq('organization_id', orgId)

  if (error) return { error: 'Erro ao salvar o vínculo de parceiro.' }

  revalidatePath('/perfil')
  return {}
}

/**
 * Conecta/atualiza a integração do parceiro na academia ativa. Admin-only.
 * `apiKey`/`environment` só se aplicam ao Wellhub (validate). apiKey vazio preserva
 * o valor já salvo (o form nunca recebe o segredo de volta, então "vazio" = "não mexer").
 */
export async function connectIntegration(
  partner: CheckinPartner,
  input: { gymId: string; webhookSecret: string; apiKey?: string; environment?: string },
): Promise<{ error?: string }> {
  const { ok, orgId } = await requireAdmin()
  if (!ok) return { error: 'Sem permissão de administrador.' }

  const gymId = input.gymId.trim()
  const webhookSecret = input.webhookSecret.trim()
  if (!gymId || !webhookSecret) return { error: 'Informe o gym_id e o webhook secret.' }

  const apiKey = input.apiKey?.trim() ?? ''
  const environment = input.environment === 'sandbox' ? 'sandbox' : 'production'

  const adminClient = createAdminClient()
  const { error } = await adminClient
    .from('org_integrations')
    .upsert(
      {
        organization_id: orgId,
        partner,
        gym_id: gymId,
        webhook_secret: webhookSecret,
        status: 'connected',
        connected_at: new Date().toISOString(),
        environment,
        // Só sobrescreve a api_key quando o admin digitou uma nova (evita apagar a existente).
        ...(apiKey ? { api_key: apiKey } : {}),
      },
      { onConflict: 'organization_id,partner' },
    )
  if (error) return { error: 'Não foi possível salvar a integração.' }

  revalidatePath('/admin/integracoes')
  return {}
}

/** Marca a integração como desconectada (mantém o registro). Admin-only. */
export async function disconnectIntegration(
  partner: CheckinPartner,
): Promise<{ error?: string }> {
  const { ok, orgId } = await requireAdmin()
  if (!ok) return { error: 'Sem permissão de administrador.' }

  const adminClient = createAdminClient()
  const { error } = await adminClient
    .from('org_integrations')
    .update({ status: 'disconnected' })
    .eq('organization_id', orgId)
    .eq('partner', partner)
  if (error) return { error: 'Não foi possível desconectar.' }

  revalidatePath('/admin/integracoes')
  return {}
}

/** Vincula um check-in pendente a um aluno: grava o check-in real e marca resolvido. */
export async function resolvePendingCheckin(
  pendingId: string,
  studentId: string,
): Promise<{ error?: string }> {
  const { ok, orgId } = await requireAdmin()
  if (!ok) return { error: 'Sem permissão de administrador.' }

  const adminClient = createAdminClient()
  const { data: pending } = await adminClient
    .from('pending_checkins')
    .select(
      'id, partner, partner_member_id, checkin_date, external_ref, resolved, partner_validated',
    )
    .eq('id', pendingId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!pending || pending.resolved) return { error: 'Pendência não encontrada.' }

  const partner = pending.partner as CheckinPartner

  // Garante que o aluno pertence à academia ativa.
  const { data: membership } = await adminClient
    .from('memberships')
    .select('user_id, monthly_checkin_target')
    .eq('user_id', studentId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!membership) return { error: 'Aluno não encontrado nesta academia.' }

  // Vincula o aluno ao parceiro: tipo + o ID que gerou o check-in. Sem isso, o
  // check-in ficaria "solto" (não aparece na aba do parceiro) e o próximo evento
  // do mesmo ID cairia em pendentes de novo. Meta zerada assume o padrão da academia.
  const idColumn = partner === 'wellhub' ? 'wellhub_id' : 'totalpass_id'
  const memberId = (pending.partner_member_id as string | null)?.trim() || null
  const patch: Record<string, unknown> = { payment_type: partner, pending_partner: null }
  if (memberId) patch[idColumn] = memberId
  if (!membership.monthly_checkin_target) {
    patch.monthly_checkin_target = await getOrgDefaultCheckinTarget(adminClient, orgId)
  }
  await adminClient
    .from('memberships')
    .update(patch)
    .eq('user_id', studentId)
    .eq('organization_id', orgId)

  await recordResolvedCheckin(adminClient, {
    orgId,
    studentId,
    partner,
    date: pending.checkin_date as string,
    externalRef: (pending.external_ref as string | null) ?? null,
    validation: partner,
  })

  // O check-in pendente já pode ter sido validado no momento em que chegou (ver
  // ingest.ts). Herda o status pro check-in recém-criado para não mostrar "não
  // validado" em algo que já foi confirmado — e não revalida (evitaria o erro
  // "already validated" do endpoint da Wellhub).
  if (pending.partner_validated && pending.external_ref) {
    await adminClient
      .from('checkins')
      .update({ partner_validated: true })
      .eq('organization_id', orgId)
      .eq('partner', partner)
      .eq('external_ref', pending.external_ref as string)
  }

  await adminClient.from('pending_checkins').update({ resolved: true }).eq('id', pendingId)

  revalidatePath('/admin/integracoes')
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
