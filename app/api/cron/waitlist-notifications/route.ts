// app/api/cron/waitlist-notifications/route.ts
// Rede de segurança diária da fila de espera.
//
// Quando alguém cancela, `promoteFromWaitlist` coloca o primeiro da fila na aula
// na hora (ver features/aulas/waitlistActions.ts). Este cron existe para a vaga
// liberada por um caminho que NÃO dispara a promoção — ajuste manual do
// professor, remoção de aluno, correção direta no banco: varre as sessões
// futuras que ainda têm gente na fila e promove onde de fato sobrou lugar.
//
// Não há anti-spam aqui, e não precisa: promover é idempotente (promoveu, não há
// mais vaga; e o aviso de "virou o primeiro" é travado por
// waitlists.first_notified_at). O modelo anterior avisava a fila inteira a cada
// passada, e por isso precisava de uma janela de silêncio.
import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { createAdminClient } from '@/lib/supabase/server'
import { promoteFromWaitlist } from '@/features/aulas/waitlistActions'
import { verifyCronSecret } from '@/lib/auth/cronAuth'
import { brtToday } from '@/lib/utils/gridSchedule'
import { fetchAllPages, chunk, IN_CHUNK_SIZE } from '@/lib/supabase/paginate'
import { mapWithConcurrency } from '@/lib/utils/concurrency'

export const maxDuration = 300

/** Margem para responder antes de a plataforma matar a função. */
const TIME_BUDGET_MS = 240_000

/** Promoções em voo ao mesmo tempo (cada uma reserva e avisa). */
const NOTIFY_CONCURRENCY = 4

export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const adminClient = createAdminClient()
  const deadline = Date.now() + TIME_BUDGET_MS

  try {
    const waiting = await fetchAllPages<{ session_id: string }>(
      (from, to) =>
        adminClient
          .from('waitlists')
          .select('session_id')
          .eq('status', 'waiting')
          .order('id', { ascending: true })
          .range(from, to),
      { label: 'cron/waitlist:waiting' },
    )
    if (waiting.length === 0) return NextResponse.json({ notified: 0, checked: 0 })

    const sessoesComFila = new Set(waiting.map((w) => w.session_id))

    const sessionIds = Array.from(sessoesComFila)

    // Só sessões futuras e ainda agendadas — fila de aula que já passou não
    // interessa. `class` traz a capacidade para comparar com as reservas.
    type SessionRow = {
      id: string
      session_date: string
      class: { max_students: number } | { max_students: number }[] | null
    }
    const sessions = (
      await Promise.all(
        chunk(sessionIds, IN_CHUNK_SIZE).map((ids) =>
          fetchAllPages<SessionRow>(
            (from, to) =>
              adminClient
                .from('class_sessions')
                .select('id, status, session_date, class:classes(max_students)')
                .in('id', ids)
                .eq('status', 'scheduled')
                .gte('session_date', brtToday(new Date()))
                .order('id', { ascending: true })
                .range(from, to),
            { label: 'cron/waitlist:sessions' },
          ),
        ),
      )
    ).flat()

    // Candidatas: turma com capacidade declarada. O corte de 1h antes do início
    // e a checagem de acesso de cada aluno ficam em promoteFromWaitlist, que é a
    // dona da regra — repetir aqui criaria duas versões dela.
    const candidates = sessions
      .map((s) => {
        const clsRaw = Array.isArray(s.class) ? s.class[0] : s.class
        return { id: s.id, maxStudents: (clsRaw as { max_students: number } | null)?.max_students ?? 0 }
      })
      .filter((s) => s.maxStudents > 0)

    // Ocupação de todas as candidatas de uma vez. Antes era um count por sessão,
    // em série — com milhares de filas abertas o cron não terminava.
    const bookings = (
      await Promise.all(
        chunk(candidates.map((c) => c.id), IN_CHUNK_SIZE).map((ids) =>
          fetchAllPages<{ session_id: string }>(
            (from, to) =>
              adminClient
                .from('session_bookings')
                .select('session_id')
                .in('session_id', ids)
                .eq('status', 'confirmed')
                .order('id', { ascending: true })
                .range(from, to),
            { label: 'cron/waitlist:bookings' },
          ),
        ),
      )
    ).flat()

    const bookedBySession = new Map<string, number>()
    for (const b of bookings) {
      bookedBySession.set(b.session_id, (bookedBySession.get(b.session_id) ?? 0) + 1)
    }

    const withSpot = candidates.filter((c) => (bookedBySession.get(c.id) ?? 0) < c.maxStudents)

    let notified = 0
    await mapWithConcurrency(
      withSpot,
      async (s) => {
        try {
          await promoteFromWaitlist(s.id)
          notified++
        } catch (e) {
          Sentry.captureException(e, {
            tags: { cron: 'waitlist-notifications' },
            extra: { sessionId: s.id },
          })
        }
      },
      { concurrency: NOTIFY_CONCURRENCY, deadline },
    )

    return NextResponse.json({ notified, checked: sessions.length, candidates: candidates.length })
  } catch (e) {
    Sentry.captureException(e, { tags: { cron: 'waitlist-notifications' } })
    return NextResponse.json({ error: 'Cron failed' }, { status: 500 })
  }
}
