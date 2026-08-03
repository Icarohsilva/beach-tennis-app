// lib/checkin/ingest.ts
// Núcleo de ingestão de check-in, COMPARTILHADO entre o botão manual do admin
// (features/checkin/actions.ts → recordCheckin) e o webhook do parceiro
// (app/api/webhooks/wellhub/route.ts). Não é 'use server': aceita um client
// injetável (testável) e não exige sessão de admin (o webhook não tem uma).
import { createAdminClient } from '@/lib/supabase/server'
import type { CheckinPartner } from '@/types'
import { validateWellhubCheckin, type WellhubEnvironment } from './wellhubValidate'
import { normalizePartnerId } from './partnerId'
import { findSessionInWindow } from './sessionWindow'
import { sessionStartIso } from '@/lib/utils/sessionTime'
import { ensureClassDebt } from '@/features/financeiro/classDebt'
import { resolveOpenMissedCheckinByExtraVisit } from '@/features/checkin/missedCheckins'
import * as Sentry from '@sentry/nextjs'

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * Sessão com reserva confirmada do aluno cujo horário de início está a até 1h
 * do check-in (antes ou depois).
 *
 * Casa por RESERVA, não por matrícula fixa: antes só olhava turmas com
 * enrollment ativa, então uma reserva avulsa nunca marcava presença — a regra
 * é "a aula onde o aluno está vinculado" (spec §7).
 */
export async function findLinkedSession(
  client: AdminClient,
  studentId: string,
  orgId: string,
  checkinAt: string,
): Promise<string | null> {
  // Janela de ±1h pode atravessar a meia-noite: busca o dia do check-in e os
  // vizinhos, e deixa a comparação de instante para findSessionInWindow.
  const day = checkinAt.slice(0, 10)
  const dayBefore = new Date(new Date(day).getTime() - 86400000).toISOString().slice(0, 10)
  const dayAfter = new Date(new Date(day).getTime() + 86400000).toISOString().slice(0, 10)

  const { data: sessionsRaw } = await client
    .from('class_sessions')
    .select('id, session_date, class:classes(start_time)')
    .eq('organization_id', orgId)
    .eq('status', 'scheduled')
    .in('session_date', [dayBefore, day, dayAfter])

  type Row = {
    id: string
    session_date: string
    class: { start_time: string } | { start_time: string }[] | null
  }
  const rows = (sessionsRaw ?? []) as unknown as Row[]
  if (rows.length === 0) return null

  // Só sessões em que o aluno tem reserva confirmada.
  const { data: bookingsRaw } = await client
    .from('session_bookings')
    .select('session_id')
    .eq('student_id', studentId)
    .eq('status', 'confirmed')
    .in('session_id', rows.map((r) => r.id))

  const booked = new Set(
    (bookingsRaw ?? []).map((b: { session_id: string }) => b.session_id),
  )
  if (booked.size === 0) return null

  const candidates = rows
    .filter((r) => booked.has(r.id))
    .map((r) => {
      const cls = Array.isArray(r.class) ? r.class[0] : r.class
      if (!cls?.start_time) return null
      // sessionStartIso ancora em -03:00. Sem isso a janela erra por 3h.
      return { id: r.id, startsAt: sessionStartIso(r.session_date, cls.start_time) }
    })
    .filter((c): c is { id: string; startsAt: string } => c !== null)

  return findSessionInWindow(candidates, checkinAt)
}

export interface RecordResolvedInput {
  orgId: string
  studentId: string
  partner: CheckinPartner
  /** YYYY-MM-DD — grava em checkins.checkin_date. */
  date: string
  /** Instante ISO do check-in. Usado para casar a sessão na janela de ±1h. */
  checkinAt: string
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

  const linkedSessionId = await findLinkedSession(
    client,
    input.studentId,
    input.orgId,
    input.checkinAt,
  )

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
    // ignoreDuplicates: "exceto quando o processo já realizou" (spec §7). Um
    // check-in reenviado NÃO pode reescrever uma presença que o professor já
    // ajustou na mão — antes o upsert sobrescrevia.
    const { error: attendanceError } = await client.from('attendance').upsert(
      {
        organization_id: input.orgId,
        student_id: input.studentId,
        session_id: linkedSessionId,
        status: 'present',
        source: input.partner,
        checked_in_at: new Date().toISOString(),
      },
      { onConflict: 'student_id,session_id', ignoreDuplicates: true },
    )
    if (attendanceError) {
      throw new Error(`Falha ao marcar presença: ${attendanceError.message}`)
    }

    // ignoreDuplicates não devolve a linha final em caso de conflito — relê pra
    // saber o status real. Pode ter ficado 'absent' se o professor já tinha
    // marcado assim; só presença 'present' de fato gera pendência (spec §5,
    // classDebt.ts: "Chame SOMENTE para presença 'present'").
    const { data: finalAttendance } = await client
      .from('attendance')
      .select('status')
      .eq('student_id', input.studentId)
      .eq('session_id', linkedSessionId)
      .maybeSingle()

    if ((finalAttendance as { status: string } | null)?.status === 'present') {
      // Aluno de parceiro nunca gera pendência — o ensureClassDebt confere
      // isso —, mas a chamada fica aqui porque um check-in manual do admin
      // pode ser de aluno sem parceiro.
      try {
        await ensureClassDebt(client, {
          orgId: input.orgId,
          studentId: input.studentId,
          sessionId: linkedSessionId,
        })
      } catch (err) {
        console.error('[recordResolvedCheckin] ensureClassDebt falhou', {
          sessionId: linkedSessionId,
          studentId: input.studentId,
          error: err instanceof Error ? err.message : String(err),
        })
        Sentry.captureException(err, {
          tags: { feature: 'classDebt' },
          extra: { sessionId: linkedSessionId, studentId: input.studentId, orgId: input.orgId },
        })
      }
    }
  } else {
    // Check-in sem aula vinculada: visita avulsa fora da agenda. Vale como
    // baixa de UMA pendência em aberto (a mais antiga), se o aluno tiver
    // alguma. Best-effort: nunca pode derrubar o registro do check-in em si.
    try {
      await resolveOpenMissedCheckinByExtraVisit(client, {
        orgId: input.orgId,
        studentId: input.studentId,
        partner: input.partner,
        checkinDate: input.date,
      })
    } catch (err) {
      console.error('[recordResolvedCheckin] baixa automática falhou', {
        studentId: input.studentId,
        error: err instanceof Error ? err.message : String(err),
      })
      Sentry.captureException(err, {
        tags: { feature: 'missedCheckins' },
        extra: { studentId: input.studentId, orgId: input.orgId },
      })
    }
  }

  return { recorded: true, linkedSessionId, isNew: true }
}

export interface IngestPartnerCheckinInput {
  orgId: string
  partner: CheckinPartner
  partnerMemberId: string
  date: string
  /** Instante ISO do check-in. Usado para casar a sessão na janela de ±1h. */
  checkinAt: string
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

  // Defesa em profundidade contra um token PADDED chegando do parceiro — e só isso.
  // NÃO conserta ID gravado com espaço do nosso lado: quem compara é o Postgres,
  // contra o valor da COLUNA. Espaço no que está gravado se resolve normalizando na
  // escrita (features/checkin/actions.ts) + o backfill da 20260716000000.
  // external_ref segue com o valor CRU: mudá-lo trocaria a chave de dedupe e
  // reingeriria eventos já gravados.
  // (?? input.partnerMemberId: token só-espaços normaliza p/ null, e .eq(col, null)
  // seria um filtro inválido — cai no valor cru, que simplesmente não casa → pendente.)
  const lookupId = normalizePartnerId(input.partnerMemberId) ?? input.partnerMemberId

  const { data: membership } = await client
    .from('memberships')
    .select('user_id, monthly_checkin_target')
    .eq('organization_id', input.orgId)
    .eq(idColumn, lookupId)
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
    checkinAt: input.checkinAt,
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
