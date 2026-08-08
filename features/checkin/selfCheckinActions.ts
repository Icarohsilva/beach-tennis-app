'use server'
// features/checkin/selfCheckinActions.ts
// Confirmação de presença pelo próprio aluno, conferida contra o ponto da academia.
//
// Nada do que vem do cliente é confiado como autorização: janela, elegibilidade e
// estado da sessão são recalculados aqui. As coordenadas em si vêm do browser e
// PODEM ser forjadas — por isso o geofence só decide entre "vale agora" e
// "pendente de revisão", nunca substitui o professor.

import { revalidatePath } from 'next/cache'
import * as Sentry from '@sentry/nextjs'
import { awardLigaExtra } from '@/features/liga/extraPoints'
import { createClient, createAdminClient, getActiveOrgId } from '@/lib/supabase/server'
import { ensureClassDebt } from '@/features/financeiro/classDebt'
import { isStudentExpectedInSession } from '@/features/aulas/sessionUtils'
import { sessionStartIso } from '@/lib/utils/sessionTime'
import {
  resolveSelfCheckinStatus,
  selfCheckinWindow,
  isWithinSelfCheckinWindow,
  DEFAULT_CHECKIN_RADIUS_M,
  type DeviceReading,
} from '@/lib/checkin/selfCheckin'
import type { SelfCheckinGeoError } from '@/types'

type AdminClient = ReturnType<typeof createAdminClient>

/** Motivos de falha do GPS que o cliente pode reportar. */
export type ClientGeoError = Extract<
  SelfCheckinGeoError,
  'denied' | 'unavailable' | 'timeout' | 'unsupported'
>

export interface ConfirmSelfAttendanceInput {
  sessionId: string
  latitude?: number
  longitude?: number
  accuracyM?: number
  geoError?: ClientGeoError
}

export interface ConfirmSelfAttendanceResult {
  error?: string
  status?: 'validated' | 'pending'
  /** Distância medida, em metros — o app mostra ao aluno quando ficou pendente. */
  distanceM?: number | null
}

const CLIENT_GEO_ERRORS: ClientGeoError[] = ['denied', 'unavailable', 'timeout', 'unsupported']

/**
 * Traduz o que o browser mandou numa leitura confiável de tipo.
 * Coordenada fora de faixa é tratada como ausência de leitura, não como erro
 * do aluno: a confirmação continua valendo, só cai em pendente.
 */
function readDevice(input: ConfirmSelfAttendanceInput): DeviceReading {
  if (input.geoError && CLIENT_GEO_ERRORS.includes(input.geoError)) {
    return { geoError: input.geoError }
  }

  const { latitude, longitude, accuracyM } = input
  const valid =
    typeof latitude === 'number' &&
    Number.isFinite(latitude) &&
    Math.abs(latitude) <= 90 &&
    typeof longitude === 'number' &&
    Number.isFinite(longitude) &&
    Math.abs(longitude) <= 180

  if (!valid) return { geoError: 'unavailable' }

  return {
    latitude: latitude as number,
    longitude: longitude as number,
    accuracyM:
      typeof accuracyM === 'number' && Number.isFinite(accuracyM) && accuracyM >= 0
        ? accuracyM
        : null,
  }
}

/**
 * Marca presença a partir de uma confirmação validada.
 *
 * `ignoreDuplicates` pela mesma razão de recordResolvedCheckin
 * (lib/checkin/ingest.ts): a confirmação do aluno JAMAIS pode sobrescrever o que
 * o professor já marcou na chamada. A dívida da avulsa é best-effort — nunca
 * derruba o registro da presença.
 */
async function applyPresence(
  client: AdminClient,
  input: { orgId: string; studentId: string; sessionId: string },
): Promise<void> {
  const { orgId, studentId, sessionId } = input

  const { error } = await client.from('attendance').upsert(
    {
      organization_id: orgId,
      student_id: studentId,
      session_id: sessionId,
      status: 'present',
      source: 'self',
      checked_in_at: new Date().toISOString(),
    },
    { onConflict: 'student_id,session_id', ignoreDuplicates: true },
  )
  if (error) throw new Error(`Falha ao marcar presença: ${error.message}`)

  // ignoreDuplicates não devolve a linha final — relê para saber o status real.
  // Pode estar 'absent' se o professor já marcou assim, e aí não há dívida.
  const { data: final } = await client
    .from('attendance')
    .select('status')
    .eq('student_id', studentId)
    .eq('session_id', sessionId)
    .maybeSingle()

  if ((final as { status: string } | null)?.status !== 'present') return

  try {
    await ensureClassDebt(client, { orgId, studentId, sessionId })
  } catch (err) {
    console.error('[selfCheckin] ensureClassDebt falhou', {
      sessionId,
      studentId,
      error: err instanceof Error ? err.message : String(err),
    })
    Sentry.captureException(err, {
      tags: { feature: 'classDebt' },
      extra: { sessionId, studentId, orgId },
    })
  }
}

// ---------------------------------------------------------------------------
// confirmSelfAttendance (aluno)
// ---------------------------------------------------------------------------

export async function confirmSelfAttendance(
  input: ConfirmSelfAttendanceInput,
): Promise<ConfirmSelfAttendanceResult> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  const adminClient = createAdminClient()

  // 1. A academia habilitou o recurso e onde fica a quadra.
  const { data: orgRow } = await adminClient
    .from('organizations')
    .select('self_checkin_enabled, latitude, longitude, checkin_radius_m')
    .eq('id', orgId)
    .single()

  const org = orgRow as {
    self_checkin_enabled: boolean
    latitude: number | null
    longitude: number | null
    checkin_radius_m: number | null
  } | null

  if (!org?.self_checkin_enabled) {
    return { error: 'Sua academia não habilitou a confirmação de presença pelo app.' }
  }

  // 2. Sessão + turma.
  const { data: sessionRow } = await adminClient
    .from('class_sessions')
    .select('id, class_id, session_date, status, classes(start_time, end_time)')
    .eq('id', input.sessionId)
    .eq('organization_id', orgId)
    .maybeSingle()

  const session = sessionRow as {
    id: string
    class_id: string
    session_date: string
    status: string
    classes:
      | { start_time: string; end_time: string }
      | { start_time: string; end_time: string }[]
      | null
  } | null

  if (!session) return { error: 'Aula não encontrada.' }

  const cls = Array.isArray(session.classes) ? session.classes[0] : session.classes
  if (!cls) return { error: 'Aula não encontrada.' }

  if (session.status === 'cancelled') return { error: 'Esta aula foi cancelada.' }
  // Depois do "encerrar aula" a lista está fechada — o professor já deu a palavra final.
  if (session.status !== 'scheduled') {
    return { error: 'A chamada desta aula já foi encerrada. Fale com o professor.' }
  }

  // 3. O aluno é esperado nesta aula?
  const expected = await isStudentExpectedInSession(adminClient, {
    orgId,
    studentId: user.id,
    sessionId: session.id,
    classId: session.class_id,
  })
  if (!expected) return { error: 'Você não está nesta aula. Entre na aula antes de confirmar.' }

  // 4. Janela, pelo relógio do servidor.
  const window = selfCheckinWindow(
    sessionStartIso(session.session_date, cls.start_time),
    sessionStartIso(session.session_date, cls.end_time),
  )
  if (!isWithinSelfCheckinWindow(window, new Date())) {
    return { error: 'Fora da janela de confirmação desta aula.' }
  }

  // 5. Aluno de parceiro com check-in do dia já registrado: a catraca vale, o app
  //    não duplica. Sem check-in, a confirmação segue como plano B.
  const { data: membership } = await adminClient
    .from('memberships')
    .select('partner')
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .maybeSingle()

  if ((membership as { partner: string | null } | null)?.partner) {
    const { data: partnerCheckin } = await adminClient
      .from('checkins')
      .select('id')
      .eq('organization_id', orgId)
      .eq('student_id', user.id)
      .eq('checkin_date', session.session_date)
      .limit(1)
      .maybeSingle()

    if (partnerCheckin) {
      return { error: 'Sua presença já está confirmada pelo check-in do parceiro.' }
    }
  }

  // 6. Veredito da localização.
  const device = readDevice(input)
  const verdict = resolveSelfCheckinStatus({
    device,
    org:
      org.latitude !== null && org.longitude !== null
        ? { latitude: Number(org.latitude), longitude: Number(org.longitude) }
        : null,
    radiusM: Number(org.checkin_radius_m) || DEFAULT_CHECKIN_RADIUS_M,
  })

  // 7. Grava a evidência. Uma nova tentativa pode SUBIR de pendente para válida
  //    (o aluno chegou na quadra e tentou de novo), mas nunca rebaixa uma
  //    confirmação já válida nem reabre uma recusada pelo professor.
  const { data: existingRow } = await adminClient
    .from('self_checkins')
    .select('id, status')
    .eq('student_id', user.id)
    .eq('session_id', session.id)
    .maybeSingle()

  const existing = existingRow as { id: string; status: string } | null

  if (existing?.status === 'validated') {
    return { status: 'validated', distanceM: null }
  }
  if (existing?.status === 'rejected') {
    return { error: 'O professor recusou esta confirmação. Fale com ele.' }
  }

  const row = {
    organization_id: orgId,
    student_id: user.id,
    session_id: session.id,
    status: verdict.status,
    latitude: 'latitude' in device ? device.latitude : null,
    longitude: 'longitude' in device ? device.longitude : null,
    accuracy_m: 'accuracyM' in device ? device.accuracyM : null,
    distance_m: verdict.distanceM,
    geo_error: verdict.geoError,
    reviewed_by: null,
    reviewed_at: null,
  }

  const { error: upsertErr } = await adminClient
    .from('self_checkins')
    .upsert(row, { onConflict: 'student_id,session_id' })

  if (upsertErr) {
    Sentry.captureException(upsertErr, {
      tags: { feature: 'selfCheckin' },
      extra: { sessionId: session.id, studentId: user.id, orgId },
    })
    return { error: 'Não foi possível registrar sua presença. Tente de novo.' }
  }

  // 8. Só a confirmação validada vira presença na hora. A pendente é evidência —
  //    o professor aprova na chamada.
  if (verdict.status === 'validated') {
    try {
      await applyPresence(adminClient, { orgId, studentId: user.id, sessionId: session.id })
    } catch (err) {
      Sentry.captureException(err, {
        tags: { feature: 'selfCheckin' },
        extra: { sessionId: session.id, studentId: user.id, orgId },
      })
      return { error: 'Não foi possível registrar sua presença. Tente de novo.' }
    }

    // Liga: bônus por confirmar sozinho. Só a validada: a pendente ainda depende do
    // professor, e premiar antes da aprovação seria pagar por um GPS fora do raio.
    await awardLigaExtra(adminClient, {
      orgId,
      studentId: user.id,
      reason: 'self_checkin',
      sourceId: session.id,
    })
  }

  revalidatePath('/home')
  revalidatePath(`/admin/grade/${session.id}`)

  return { status: verdict.status, distanceM: verdict.distanceM }
}

// ---------------------------------------------------------------------------
// reviewSelfCheckin (admin)
// ---------------------------------------------------------------------------

/**
 * Professor decide sobre uma confirmação pendente. Aprovar marca presença;
 * recusar só arquiva a evidência, sem mexer em `attendance` (o professor
 * continua livre para marcar presente ou faltou na chamada).
 */
export async function reviewSelfCheckin(
  selfCheckinId: string,
  approve: boolean,
): Promise<{ error?: string }> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  const adminClient = createAdminClient()

  const { data: callerMembership } = await adminClient
    .from('memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .single()
  if (callerMembership?.role !== 'admin') return { error: 'Sem permissão.' }

  const { data: row } = await adminClient
    .from('self_checkins')
    .select('id, student_id, session_id, status')
    .eq('id', selfCheckinId)
    .eq('organization_id', orgId)
    .maybeSingle()

  const selfCheckin = row as {
    id: string
    student_id: string
    session_id: string
    status: string
  } | null

  if (!selfCheckin) return { error: 'Confirmação não encontrada.' }

  const { error: updateErr } = await adminClient
    .from('self_checkins')
    .update({
      status: approve ? 'validated' : 'rejected',
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', selfCheckin.id)
    .eq('organization_id', orgId)

  if (updateErr) return { error: 'Erro ao revisar a confirmação.' }

  if (approve) {
    try {
      await applyPresence(adminClient, {
        orgId,
        studentId: selfCheckin.student_id,
        sessionId: selfCheckin.session_id,
      })
    } catch (err) {
      Sentry.captureException(err, {
        tags: { feature: 'selfCheckin' },
        extra: { selfCheckinId, orgId },
      })
      return { error: 'Confirmação aprovada, mas a presença não pôde ser marcada.' }
    }
  }

  revalidatePath(`/admin/grade/${selfCheckin.session_id}`)
  return {}
}
