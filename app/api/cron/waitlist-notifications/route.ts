// app/api/cron/waitlist-notifications/route.ts
// Rede de segurança diária da fila de espera.
//
// A vaga não é mais oferecida a uma pessoa por vez: quando alguém cancela,
// notifyWaitlistSpotOpen avisa a fila inteira na hora e a vaga fica com quem
// entrar primeiro (ver features/aulas/waitlistActions.ts). Este cron não tem
// mais oferta vencida para varrer — ele existe para o caso de a vaga ter sido
// liberada por um caminho que não dispara a notificação (ajuste manual do
// professor, remoção de aluno, correção direta no banco): varre as sessões
// futuras que ainda têm gente na fila, e avisa onde de fato sobrou lugar.
import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { createAdminClient } from '@/lib/supabase/server'
import { notifyWaitlistSpotOpen } from '@/features/aulas/waitlistActions'
import { verifyCronSecret } from '@/lib/auth/cronAuth'
import { brtToday } from '@/lib/utils/gridSchedule'

/** Não reavisa a mesma fila com intervalo menor que isto (evita spam diário). */
const RENOTIFY_AFTER_MS = 12 * 60 * 60 * 1000

export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const adminClient = createAdminClient()

  try {
    const { data: waitingRaw, error } = await adminClient
      .from('waitlists')
      .select('session_id, notified_at')
      .eq('status', 'waiting')

    if (error) throw error

    const waiting = (waitingRaw ?? []) as { session_id: string; notified_at: string | null }[]
    if (waiting.length === 0) return NextResponse.json({ notified: 0, checked: 0 })

    // Último aviso por sessão: null (nunca avisada) conta como "pode avisar".
    const lastNotifiedBySession = new Map<string, number | null>()
    for (const w of waiting) {
      const prev = lastNotifiedBySession.get(w.session_id)
      const cur = w.notified_at ? new Date(w.notified_at).getTime() : null
      if (prev === undefined) lastNotifiedBySession.set(w.session_id, cur)
      else if (prev !== null && (cur === null || cur > prev)) {
        lastNotifiedBySession.set(w.session_id, cur)
      }
    }

    const sessionIds = Array.from(lastNotifiedBySession.keys())

    // Só sessões futuras e ainda agendadas — fila de aula que já passou não
    // interessa. `class` traz a capacidade para comparar com as reservas.
    const { data: sessionsRaw } = await adminClient
      .from('class_sessions')
      .select('id, status, session_date, class:classes(max_students)')
      .in('id', sessionIds)
      .eq('status', 'scheduled')
      .gte('session_date', brtToday(new Date()))

    const sessions = (sessionsRaw ?? []) as {
      id: string
      session_date: string
      class: { max_students: number } | { max_students: number }[] | null
    }[]

    const cutoff = Date.now() - RENOTIFY_AFTER_MS
    let notified = 0

    for (const s of sessions) {
      const last = lastNotifiedBySession.get(s.id)
      // Avisada há pouco: a notificação da hora do cancelamento já cobriu.
      if (last !== null && last !== undefined && last > cutoff) continue

      const clsRaw = Array.isArray(s.class) ? s.class[0] : s.class
      const maxStudents = (clsRaw as { max_students: number } | null)?.max_students ?? 0
      if (maxStudents <= 0) continue

      const { count: booked } = await adminClient
        .from('session_bookings')
        .select('id', { count: 'exact', head: true })
        .eq('session_id', s.id)
        .eq('status', 'confirmed')

      if ((booked ?? 0) >= maxStudents) continue // sem vaga, nada a avisar

      try {
        await notifyWaitlistSpotOpen(s.id)
        notified++
      } catch (e) {
        Sentry.captureException(e, {
          tags: { cron: 'waitlist-notifications' },
          extra: { sessionId: s.id },
        })
      }
    }

    return NextResponse.json({ notified, checked: sessions.length })
  } catch (e) {
    Sentry.captureException(e, { tags: { cron: 'waitlist-notifications' } })
    return NextResponse.json({ error: 'Cron failed' }, { status: 500 })
  }
}
