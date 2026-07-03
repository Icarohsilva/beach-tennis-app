// lib/checkin/ingest.ts
// Núcleo de ingestão de check-in, COMPARTILHADO entre o botão manual do admin
// (features/checkin/actions.ts → recordCheckin) e o webhook do parceiro
// (app/api/webhooks/wellhub/route.ts). Não é 'use server': aceita um client
// injetável (testável) e não exige sessão de admin (o webhook não tem uma).
import { createAdminClient } from '@/lib/supabase/server'
import type { CheckinPartner } from '@/types'
import { validateWellhubCheckin, type WellhubEnvironment } from './wellhubValidate'

type AdminClient = ReturnType<typeof createAdminClient>

/** Sessão agendada na data, de turma com matrícula ativa e reserva confirmada. */
export async function findLinkedSession(
  client: AdminClient,
  studentId: string,
  orgId: string,
  date: string,
): Promise<string | null> {
  const { data: enrolls } = await client
    .from('enrollments')
    .select('class_id')
    .eq('student_id', studentId)
    .eq('organization_id', orgId)
    .eq('is_active', true)
  const classIds = (enrolls ?? []).map((e: { class_id: string }) => e.class_id)
  if (classIds.length === 0) return null

  const { data: sessions } = await client
    .from('class_sessions')
    .select('id')
    .eq('organization_id', orgId)
    .eq('session_date', date)
    .eq('status', 'scheduled')
    .in('class_id', classIds)
  const sessionIds = (sessions ?? []).map((s: { id: string }) => s.id)
  if (sessionIds.length === 0) return null

  const { data: booking } = await client
    .from('session_bookings')
    .select('session_id')
    .eq('student_id', studentId)
    .eq('status', 'confirmed')
    .in('session_id', sessionIds)
    .limit(1)
    .maybeSingle()

  return (booking?.session_id as string | undefined) ?? null
}

export interface RecordResolvedInput {
  orgId: string
  studentId: string
  partner: CheckinPartner
  date: string
  externalRef: string | null
  validation: 'manual' | CheckinPartner
  createdBy?: string | null
}

// Grava um check-in JÁ resolvido (aluno conhecido). Idempotente por external_ref.
// Se a data cai em aula fixa com reserva confirmada, marca presença também.
// `isNew` distingue inserção nova de idempotente (importante para não revalidar resends).
export async function recordResolvedCheckin(
  client: AdminClient,
  input: RecordResolvedInput,
): Promise<{ recorded: boolean; linkedSessionId: string | null; isNew: boolean }> {
  if (input.externalRef) {
    const { data: existing } = await client
      .from('checkins')
      .select('id')
      .eq('organization_id', input.orgId)
      .eq('partner', input.partner)
      .eq('external_ref', input.externalRef)
      .maybeSingle()
    if (existing) return { recorded: true, linkedSessionId: null, isNew: false }
  }

  const linkedSessionId = await findLinkedSession(client, input.studentId, input.orgId, input.date)

  const { error: insertError } = await client.from('checkins').insert({
    organization_id: input.orgId,
    student_id: input.studentId,
    partner: input.partner,
    checkin_date: input.date,
    session_id: linkedSessionId,
    external_ref: input.externalRef,
    validation: input.validation,
    created_by: input.createdBy ?? null,
  })
  if (insertError) {
    // 23505 = violação de índice único. Outra requisição concorrente já gravou
    // este external_ref → check-in idempotente, no-op (não remarca presença).
    if (insertError.code === '23505') return { recorded: true, linkedSessionId: null, isNew: false }
    throw new Error(`Falha ao gravar check-in: ${insertError.message}`)
  }

  if (linkedSessionId) {
    const { error: attendanceError } = await client.from('attendance').upsert(
      {
        organization_id: input.orgId,
        student_id: input.studentId,
        session_id: linkedSessionId,
        status: 'present',
        source: input.partner,
        checked_in_at: new Date().toISOString(),
      },
      { onConflict: 'student_id,session_id' },
    )
    if (attendanceError) {
      throw new Error(`Falha ao marcar presença: ${attendanceError.message}`)
    }
  }

  return { recorded: true, linkedSessionId, isNew: true }
}

export interface IngestPartnerCheckinInput {
  orgId: string
  partner: CheckinPartner
  partnerMemberId: string
  date: string
  externalRef: string | null
  payload: unknown
  createdBy?: string | null
  // Presente só para Wellhub configurado com api_key: dispara o VALIDATE que gera
  // a transação de pagamento. Ausente → grava sem validar (fica p/ reprocessamento).
  validate?: { apiKey: string; gymId: string; environment: WellhubEnvironment }
}

export interface IngestResult {
  recorded: boolean
  pending: boolean
  linkedSessionId?: string | null
}

// Ponto de entrada do webhook: casa o aluno pelo ID do parceiro; sem match → pendente.
export async function ingestPartnerCheckin(
  input: IngestPartnerCheckinInput,
  client: AdminClient = createAdminClient(),
): Promise<IngestResult> {
  const idColumn = input.partner === 'wellhub' ? 'wellhub_id' : 'totalpass_id'

  const { data: membership } = await client
    .from('memberships')
    .select('user_id, monthly_checkin_target')
    .eq('organization_id', input.orgId)
    .eq(idColumn, input.partnerMemberId)
    .maybeSingle()

  if (!membership) {
    const { data: pendingRow, error: pendingError } = await client
      .from('pending_checkins')
      .insert({
        organization_id: input.orgId,
        partner: input.partner,
        partner_member_id: input.partnerMemberId,
        checkin_date: input.date,
        external_ref: input.externalRef,
        payload: input.payload,
        resolved: false,
      })
      .select('id')
      .single()

    if (pendingError) {
      // 23505 = evento reenviado pela Wellhub (mesmo external_ref) → já enfileirado
      // (e já validado, se for o caso) — não repete a chamada ao validate.
      if (pendingError.code !== '23505') {
        throw new Error(`Falha ao enfileirar check-in pendente: ${pendingError.message}`)
      }
      return { recorded: false, pending: true }
    }

    // Valida mesmo sem aluno casado: o validate só precisa de gym_id + gympass_id +
    // api_key (já vêm do webhook). Esperar o vínculo interno deixaria sem validar
    // tanto testes da Wellhub (tokens que nunca vão casar com um aluno nosso) quanto
    // usuários reais ainda não cadastrados — e sem validate não há pagamento.
    if (input.validate) {
      const result = await validateWellhubCheckin({
        environment: input.validate.environment,
        gymId: input.validate.gymId,
        apiKey: input.validate.apiKey,
        gympassId: input.partnerMemberId,
      })
      await client
        .from('pending_checkins')
        .update({
          partner_validated: result.valid,
          partner_validation_error: result.valid ? null : (result.error ?? 'erro desconhecido'),
        })
        .eq('id', (pendingRow as { id: string }).id)
    }

    return { recorded: false, pending: true }
  }

  const { recorded, linkedSessionId, isNew } = await recordResolvedCheckin(client, {
    orgId: input.orgId,
    studentId: membership.user_id as string,
    partner: input.partner,
    date: input.date,
    externalRef: input.externalRef,
    validation: input.partner,
    createdBy: input.createdBy ?? null,
  })

  // Só valida inserções novas: um reenvio (idempotente) não deve revalidar/recobrar.
  // Falha na validação NÃO derruba o registro — fica marcado p/ reprocessamento.
  if (isNew && input.validate && input.externalRef) {
    const result = await validateWellhubCheckin({
      environment: input.validate.environment,
      gymId: input.validate.gymId,
      apiKey: input.validate.apiKey,
      gympassId: input.partnerMemberId,
    })
    await client
      .from('checkins')
      .update({
        partner_validated: result.valid,
        partner_validation_error: result.valid ? null : (result.error ?? 'erro desconhecido'),
      })
      .eq('organization_id', input.orgId)
      .eq('partner', input.partner)
      .eq('external_ref', input.externalRef)
  }

  return { recorded, pending: false, linkedSessionId }
}
