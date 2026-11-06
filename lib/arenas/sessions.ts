// lib/arenas/sessions.ts
// A grade da aula experimental de UMA academia: as sessões já geradas para os
// próximos dias, com a ocupação de cada uma. A regra (o que entra, ordem, vaga ou
// lotado) é pura e mora em lib/arenas/trialSchedule.ts.
// TODA query é escopada por organization_id (service role ignora RLS).

import { createAdminClient } from '@/lib/supabase/server'
import { brtToday, addDaysStr } from '@/lib/utils/gridSchedule'
import { chunk, fetchAllPages, IN_CHUNK_SIZE } from '@/lib/supabase/paginate'
import { buildTrialSchedule, type TrialDay, type TrialSessionRow } from './trialSchedule'

/**
 * Janela mostrada. A grade é gerada por semana, então duas semanas cobrem a
 * semana corrente e a próxima já gerada, sem virar uma lista sem fim no celular.
 */
export const TRIAL_WINDOW_DAYS = 14

export async function getTrialSchedule(orgId: string, now: Date = new Date()): Promise<TrialDay[]> {
  const admin = createAdminClient()

  // BRT: com o UTC cru, as sessões de hoje saíam da vitrine da arena depois das 21h.
  const today = brtToday(now)
  const until = addDaysStr(today, TRIAL_WINDOW_DAYS - 1)

  const rows = await fetchAllPages<TrialSessionRow>(
    (from, to) =>
      admin
        .from('class_sessions')
        .select(
          'id, session_date, status, start_time, end_time, court, max_students, class:classes(name, level, type, start_time, end_time, max_students, court, is_active, gender_restriction)',
        )
        .eq('organization_id', orgId)
        .eq('status', 'scheduled')
        .gte('session_date', today)
        .lte('session_date', until)
        .order('id')
        .range(from, to) as unknown as PromiseLike<{ data: TrialSessionRow[] | null; error: { message: string } | null }>,
    { label: 'arenas/trialSchedule' },
  )
  // O embed volta como objeto ou como lista de um, conforme o PostgREST infere a FK.
  const sessions = rows.map((s) => ({
    ...s,
    class: Array.isArray(s.class) ? (s.class[0] ?? null) : s.class,
  }))
  if (sessions.length === 0) return []

  const occupied = new Map<string, number>()
  const add = (id: string) => occupied.set(id, (occupied.get(id) ?? 0) + 1)

  for (const ids of chunk(sessions.map((s) => s.id), IN_CHUNK_SIZE)) {
    const bookings = await fetchAllPages<{ id: string; session_id: string }>(
      (from, to) =>
        admin
          .from('session_bookings')
          .select('id, session_id')
          .eq('organization_id', orgId)
          .in('session_id', ids)
          .eq('status', 'confirmed')
          .order('id')
          .range(from, to),
      { label: 'arenas/trialSchedule/bookings' },
    )
    bookings.forEach((b) => add(b.session_id))

    // Experimental antiga não tem reserva (era só nome, e-mail e telefone), então
    // ocupa a vaga por aqui. A nova já é uma reserva e contaria duas vezes.
    const { data: legacy } = await admin
      .from('trial_bookings')
      .select('session_id')
      .eq('organization_id', orgId)
      .in('session_id', ids)
      .is('student_id', null)
      .in('status', ['pending', 'attended'])
    for (const t of (legacy ?? []) as { session_id: string }[]) add(t.session_id)
  }

  return buildTrialSchedule(sessions, occupied, now)
}
