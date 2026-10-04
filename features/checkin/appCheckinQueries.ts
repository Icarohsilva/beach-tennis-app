// features/checkin/appCheckinQueries.ts
// Leituras do check-in Wellhub pelo app (lib/checkin/appCheckin.ts tem a regra).
import type { createAdminClient } from '@/lib/supabase/server'
import { APP_CHECKIN_PARTNER, APP_CHECKIN_SETTING, resolveAppCheckin } from '@/lib/checkin/appCheckin'
import type { CheckinPartner } from '@/types'

type AdminClient = ReturnType<typeof createAdminClient>

export async function isAppCheckinEnabled(client: AdminClient, orgId: string): Promise<boolean> {
  const { data } = await client
    .from('system_settings')
    .select('value')
    .eq('organization_id', orgId)
    .eq('key', APP_CHECKIN_SETTING)
    .maybeSingle()
  return (data as { value: string } | null)?.value === 'true'
}

/** A arena conectou a integração do Wellhub (o check-in chega pelo webhook)? */
export async function isWellhubIntegrationConnected(client: AdminClient, orgId: string): Promise<boolean> {
  const { data } = await client
    .from('org_integrations')
    .select('status')
    .eq('organization_id', orgId)
    .eq('partner', APP_CHECKIN_PARTNER)
    .maybeSingle()
  return (data as { status: string } | null)?.status === 'connected'
}

export interface AppCheckinState {
  /** O aluno pode registrar check-in pelo app nesta arena. */
  available: boolean
  /** Check-in de HOJE já registrado (por qualquer caminho), se houver. */
  today: { at: string; viaApp: boolean; receiptStatus: 'validated' | 'review' | null } | null
}

/**
 * O que o card da home precisa: se o check-in pelo app vale para este aluno e se
 * o de hoje já foi feito. Qualquer check-in do dia conta — inclusive o que o
 * admin registrou na mão —, porque a regra é um check-in por dia.
 */
export async function getAppCheckinState(
  client: AdminClient,
  input: { orgId: string; studentId: string; partner: CheckinPartner | null; today: string },
): Promise<AppCheckinState> {
  if (input.partner !== APP_CHECKIN_PARTNER) return { available: false, today: null }

  const [enabled, integrationConnected] = await Promise.all([
    isAppCheckinEnabled(client, input.orgId),
    isWellhubIntegrationConnected(client, input.orgId),
  ])
  const rule = resolveAppCheckin({ enabled, integrationConnected, partner: input.partner })
  if (!rule.available) return { available: false, today: null }

  const { data } = await client
    .from('checkins')
    .select('created_at, validation, receipt_status')
    .eq('organization_id', input.orgId)
    .eq('student_id', input.studentId)
    .eq('checkin_date', input.today)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  const row = data as {
    created_at: string
    validation: string
    receipt_status: 'validated' | 'review' | null
  } | null

  return {
    available: true,
    today: row
      ? { at: row.created_at, viaApp: row.validation === 'app', receiptStatus: row.receipt_status }
      : null,
  }
}

export interface AppCheckinReviewRow {
  id: string
  studentId: string
  studentName: string
  checkinDate: string
  createdAt: string
  /** Aula em que o check-in marcou presença, quando casou com uma reserva. */
  sessionId: string | null
  receiptSignedUrl: string | null
  /** Resultado da leitura automática do print. */
  receiptStatus: 'validated' | 'review' | null
  /** Data e hora lidas no print. */
  receiptTakenAt: string | null
  /** Por que pede conferência (academia diferente, leitura indisponível). */
  receiptNote: string | null
}

/**
 * Check-ins feitos pelo app desde `sinceDate`, com o print por URL assinada —
 * é a fila que o admin confere. Teto natural: um por aluno por dia, numa janela
 * curta (o padrão é 30 dias), então `.select()` direto.
 */
export async function getAppCheckinsForReview(
  client: AdminClient,
  input: { orgId: string; sinceDate: string },
): Promise<AppCheckinReviewRow[]> {
  const { data } = await client
    .from('checkins')
    .select('id, student_id, checkin_date, created_at, session_id, receipt_url, receipt_status, receipt_taken_at, receipt_note, profiles!checkins_student_id_fkey(full_name)')
    .eq('organization_id', input.orgId)
    .eq('validation', 'app')
    .gte('checkin_date', input.sinceDate)
    .order('created_at', { ascending: false })
    .limit(200)

  type Row = {
    id: string
    student_id: string
    checkin_date: string
    created_at: string
    session_id: string | null
    receipt_url: string | null
    receipt_status: 'validated' | 'review' | null
    receipt_taken_at: string | null
    receipt_note: string | null
    profiles: { full_name: string } | { full_name: string }[] | null
  }
  const rows = (data ?? []) as unknown as Row[]

  const list = await Promise.all(
    rows.map(async (r) => {
      const prof = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles
      let receiptSignedUrl: string | null = null
      if (r.receipt_url) {
        const { data: signed } = await client.storage
          .from('checkin-receipts')
          .createSignedUrl(r.receipt_url, 60 * 30)
        receiptSignedUrl = signed?.signedUrl ?? null
      }
      return {
        id: r.id,
        studentId: r.student_id,
        studentName: prof?.full_name ?? 'Aluno',
        checkinDate: r.checkin_date,
        createdAt: r.created_at,
        sessionId: r.session_id,
        receiptSignedUrl,
        receiptStatus: r.receipt_status,
        receiptTakenAt: r.receipt_taken_at,
        receiptNote: r.receipt_note,
      }
    }),
  )
  // O que pede conferência vem primeiro: é a única parte da fila que exige o
  // olho do admin — o validado pela leitura já está resolvido.
  return list.sort((a, b) => Number(b.receiptStatus !== 'validated') - Number(a.receiptStatus !== 'validated'))
}
