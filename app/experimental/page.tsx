// app/experimental/page.tsx
export const dynamic = 'force-dynamic'

import { createAdminClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { formatDate, formatTime } from '@/lib/utils/dateHelpers'
import { TrialBookingForm } from './TrialBookingForm'
import type { ClassSession, Class } from '@/types'

type SessionOption = {
  id: string
  session_date: string
  class_name: string
  start_time: string
  end_time: string
  level: string
  spots_left: number
}

export default async function ExperimentalPage() {
  const adminClient = createAdminClient()

  // Fetch upcoming scheduled sessions in the next 30 days
  const today = new Date().toISOString().slice(0, 10)
  const in30 = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const { data: sessions } = await adminClient
    .from('class_sessions')
    .select('id, session_date, status, class:classes(id, name, level, type, start_time, end_time, max_students, is_active)')
    .eq('status', 'scheduled')
    .gte('session_date', today)
    .lte('session_date', in30)
    .order('session_date', { ascending: true })
    .order('class(start_time)', { ascending: true })

  type RawSession = ClassSession & {
    class: Class | Class[]
  }

  const rawSessions = (sessions ?? []) as RawSession[]

  // Get booking counts for those sessions
  const sessionIds = rawSessions.map((s) => s.id)
  const { data: bookingCountsRaw } =
    sessionIds.length > 0
      ? await adminClient
          .from('session_bookings')
          .select('session_id')
          .in('session_id', sessionIds)
          .eq('status', 'confirmed')
      : { data: [] }

  const bookingCountMap = new Map<string, number>()
  for (const b of (bookingCountsRaw ?? []) as { session_id: string }[]) {
    bookingCountMap.set(b.session_id, (bookingCountMap.get(b.session_id) ?? 0) + 1)
  }

  // Get trial bookings for those sessions
  const { data: trialCountsRaw } =
    sessionIds.length > 0
      ? await adminClient
          .from('trial_bookings')
          .select('session_id')
          .in('session_id', sessionIds)
          .in('status', ['pending', 'attended'])
      : { data: [] }

  const trialCountMap = new Map<string, number>()
  for (const t of (trialCountsRaw ?? []) as { session_id: string }[]) {
    trialCountMap.set(t.session_id, (trialCountMap.get(t.session_id) ?? 0) + 1)
  }

  // Build session options filtering adult classes only with spots available
  const sessionOptions: SessionOption[] = []
  for (const s of rawSessions) {
    const cls = Array.isArray(s.class) ? s.class[0] : s.class
    if (!cls || !cls.is_active || cls.type === 'kids') continue
    const occupied = (bookingCountMap.get(s.id) ?? 0) + (trialCountMap.get(s.id) ?? 0)
    const spotsLeft = cls.max_students - occupied
    if (spotsLeft <= 0) continue

    sessionOptions.push({
      id: s.id,
      session_date: s.session_date,
      class_name: cls.name,
      start_time: cls.start_time,
      end_time: cls.end_time,
      level: cls.level,
      spots_left: spotsLeft,
    })
  }

  return (
    <div className="min-h-screen bg-surface text-white flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-white mb-2">Aula Experimental</h1>
          <p className="text-slate-400 text-sm">
            Gratuita na primeira vez. Sem precisar criar conta.
          </p>
        </div>

        <Card>
          {sessionOptions.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-slate-400 text-sm mb-2">
                Nenhuma sessão disponível nos próximos 30 dias.
              </p>
              <p className="text-slate-500 text-xs">
                Entre em contato conosco para mais informações.
              </p>
            </div>
          ) : (
            <TrialBookingForm sessions={sessionOptions} />
          )}
        </Card>
      </div>
    </div>
  )
}
