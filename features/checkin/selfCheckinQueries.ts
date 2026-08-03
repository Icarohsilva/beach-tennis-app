// features/checkin/selfCheckinQueries.ts
// Monta, para a agenda do aluno, o retrato da confirmação de presença de cada
// sessão da semana. Server-side: uma consulta para as confirmações do aluno e,
// só quando ele é de parceiro, uma para os check-ins da catraca.

import { createAdminClient } from '@/lib/supabase/server'
import { sessionStartIso } from '@/lib/utils/sessionTime'
import { selfCheckinWindow } from '@/lib/checkin/selfCheckin'
import type { CheckinPartner, SelfCheckinStatus } from '@/types'

type AdminClient = ReturnType<typeof createAdminClient>

export interface SelfCheckinView {
  /** Confirmação já feita pelo aluno nesta sessão. */
  mine: { status: SelfCheckinStatus } | null
  /** Check-in do parceiro cobre esta data — o botão do app não aparece. */
  partnerCovered: boolean
  /** Instantes ISO da janela. O cliente decide a abertura pelo relógio dele. */
  opensAt: string
  closesAt: string
}

export interface SelfCheckinSessionRef {
  id: string
  /** YYYY-MM-DD */
  date: string
  /** HH:MM[:SS] */
  start: string
  end: string
}

/**
 * Retrato por sessão. Devolve mapa vazio quando a academia não habilitou o
 * recurso — quem chama trata a ausência como "não mostrar nada".
 */
export async function getSelfCheckinViews(
  client: AdminClient,
  input: {
    orgId: string
    studentId: string
    partner: CheckinPartner | null
    sessions: SelfCheckinSessionRef[]
    enabled: boolean
  },
): Promise<Map<string, SelfCheckinView>> {
  const { orgId, studentId, partner, sessions, enabled } = input
  const views = new Map<string, SelfCheckinView>()
  if (!enabled || sessions.length === 0) return views

  const sessionIds = sessions.map((s) => s.id)

  const { data: mineRaw } = await client
    .from('self_checkins')
    .select('session_id, status')
    .eq('organization_id', orgId)
    .eq('student_id', studentId)
    .in('session_id', sessionIds)

  const mineBySession = new Map(
    ((mineRaw ?? []) as { session_id: string; status: SelfCheckinStatus }[]).map((r) => [
      r.session_id,
      { status: r.status },
    ]),
  )

  // Datas com check-in do parceiro. Só faz sentido consultar para quem é de parceiro.
  let partnerDates = new Set<string>()
  if (partner) {
    const dates = Array.from(new Set(sessions.map((s) => s.date)))
    const { data: checkinsRaw } = await client
      .from('checkins')
      .select('checkin_date')
      .eq('organization_id', orgId)
      .eq('student_id', studentId)
      .in('checkin_date', dates)

    partnerDates = new Set(
      ((checkinsRaw ?? []) as { checkin_date: string }[]).map((c) => c.checkin_date),
    )
  }

  for (const s of sessions) {
    const window = selfCheckinWindow(
      sessionStartIso(s.date, s.start),
      sessionStartIso(s.date, s.end),
    )
    views.set(s.id, {
      mine: mineBySession.get(s.id) ?? null,
      partnerCovered: partnerDates.has(s.date),
      opensAt: window.opensAt,
      closesAt: window.closesAt,
    })
  }

  return views
}
