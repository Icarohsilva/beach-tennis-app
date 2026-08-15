// lib/arenas/sessions.ts
// Lista as sessões dos próximos 30 dias de UMA academia, abertas para aula
// experimental: status 'scheduled', turma ativa, adulto (type != 'kids'), com vaga.
// TODA query é escopada por organization_id (service role ignora RLS).

import { createAdminClient } from '@/lib/supabase/server'
import type { ClassSession, Class } from '@/types'
import { brtToday, addDaysStr } from '@/lib/utils/gridSchedule'
import { resolveSession } from '@/lib/aulas/sessionOverride'

export interface TrialSessionOption {
  id: string
  session_date: string
  class_name: string
  start_time: string
  end_time: string
  level: string
  spots_left: number
}

export async function getOpenTrialSessions(orgId: string): Promise<TrialSessionOption[]> {
  const admin = createAdminClient()

  // BRT: com o UTC cru, as sessões de hoje saíam da vitrine da arena depois das 21h.
  const today = brtToday(new Date())
  const in30 = addDaysStr(today, 30)

  const { data: sessions } = await admin
    .from('class_sessions')
    .select(
      'id, session_date, status, start_time, end_time, court, max_students, class:classes(id, name, level, type, start_time, end_time, max_students, court, is_active)',
    )
    .eq('organization_id', orgId)
    .eq('status', 'scheduled')
    .gte('session_date', today)
    .lte('session_date', in30)
    .order('session_date', { ascending: true })
    .order('class(start_time)', { ascending: true })

  type RawSession = ClassSession & { class: Class | Class[] }
  const rawSessions = (sessions ?? []) as RawSession[]
  const sessionIds = rawSessions.map((s) => s.id)
  if (sessionIds.length === 0) return []

  const { data: bookingCountsRaw } = await admin
    .from('session_bookings')
    .select('session_id')
    .eq('organization_id', orgId)
    .in('session_id', sessionIds)
    .eq('status', 'confirmed')

  const bookingCountMap = new Map<string, number>()
  for (const b of (bookingCountsRaw ?? []) as { session_id: string }[]) {
    bookingCountMap.set(b.session_id, (bookingCountMap.get(b.session_id) ?? 0) + 1)
  }

  const { data: trialCountsRaw } = await admin
    .from('trial_bookings')
    .select('session_id')
    .eq('organization_id', orgId)
    .in('session_id', sessionIds)
    .in('status', ['pending', 'attended'])

  const trialCountMap = new Map<string, number>()
  for (const t of (trialCountsRaw ?? []) as { session_id: string }[]) {
    trialCountMap.set(t.session_id, (trialCountMap.get(t.session_id) ?? 0) + 1)
  }

  const options: TrialSessionOption[] = []
  for (const s of rawSessions) {
    const cls = Array.isArray(s.class) ? s.class[0] : s.class
    if (!cls || !cls.is_active || cls.type === 'kids') continue
    const occupied = (bookingCountMap.get(s.id) ?? 0) + (trialCountMap.get(s.id) ?? 0)
    // Horário e vagas DESTA data: a vitrine da arena é o que o visitante usa
    // para escolher a aula experimental — o horário errado aqui é o visitante
    // aparecendo na hora errada.
    const horario = resolveSession(s, cls)
    const spotsLeft = horario.maxStudents - occupied
    if (spotsLeft <= 0) continue
    options.push({
      id: s.id,
      session_date: s.session_date,
      class_name: cls.name,
      start_time: horario.startTime,
      end_time: horario.endTime,
      level: cls.level,
      spots_left: spotsLeft,
    })
  }
  return options
}
