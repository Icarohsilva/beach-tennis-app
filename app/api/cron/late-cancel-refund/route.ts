// app/api/cron/late-cancel-refund/route.ts
// Execução pontual: devolve o crédito de quem foi punido por cancelar em cima da
// hora ANTES de a janela de arrependimento existir.
//
// Contexto: até agora a única regra era a das 5h — cancelou com menos de 5 horas
// para a aula, perdeu o crédito. Quem entrava numa aula que começava em duas
// horas nunca teve chance de cancelar no prazo: a janela já nascia fechada, e
// sair um minuto depois custava o crédito e a falta. A regra nova
// (BOOKING_GRACE_MINUTES em lib/utils/creditRules.ts) dá 1 hora a contar da
// reserva; esta rota aplica a mesma régua ao que já aconteceu.
//
// Não está no vercel.json de propósito: roda uma vez, por curl, com o CRON_SECRET.
// E o padrão é DRY RUN — a lista sai para conferência antes de mexer em saldo de
// ninguém. Para aplicar de verdade: `?apply=1`.
//
//   curl -H "Authorization: Bearer $CRON_SECRET" ".../api/cron/late-cancel-refund"
//   curl -H "Authorization: Bearer $CRON_SECRET" ".../api/cron/late-cancel-refund?apply=1"
//
// Idempotente: quem já tem estorno registrado para aquela sessão é pulado, então
// rodar duas vezes não dobra crédito de ninguém.
import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { createAdminClient } from '@/lib/supabase/server'
import { verifyCronSecret } from '@/lib/auth/cronAuth'
import { fetchAllPages, chunk, IN_CHUNK_SIZE } from '@/lib/supabase/paginate'
import { mapWithConcurrency } from '@/lib/utils/concurrency'
import { withinBookingGrace } from '@/lib/utils/creditRules'
import { sessionStartIso } from '@/lib/utils/sessionTime'

export const maxDuration = 300

/** Margem para responder antes de a plataforma matar a função. */
const TIME_BUDGET_MS = 240_000

/** Estornos em voo ao mesmo tempo. Cada um é uma RPC curta. */
const REFUND_CONCURRENCY = 4

interface CancelledBooking {
  id: string
  organization_id: string
  student_id: string
  session_id: string
  cancelled_at: string
  booked_at: string | null
}

interface SessionInfo {
  id: string
  session_date: string
  start_time: string | null
  classes: { start_time: string } | { start_time: string }[] | null
}

export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const apply = req.nextUrl.searchParams.get('apply') === '1'
  const adminClient = createAdminClient()
  const deadline = Date.now() + TIME_BUDGET_MS

  try {
    // 1. Cancelamentos que consumiram crédito. `credit_used` é o filtro central:
    //    sem crédito gasto não há o que devolver (fixa reconciliada entra com
    //    credit_used = false, e a saída dela já devolve por outro caminho).
    const cancelled = await fetchAllPages<CancelledBooking>(
      (from, to) =>
        adminClient
          .from('session_bookings')
          .select('id, organization_id, student_id, session_id, cancelled_at, booked_at')
          .eq('status', 'cancelled')
          .eq('credit_used', true)
          .not('cancelled_at', 'is', null)
          .not('booked_at', 'is', null)
          .order('id', { ascending: true })
          .range(from, to),
      { label: 'cron/late-cancel:bookings' },
    )

    if (cancelled.length === 0) {
      return NextResponse.json({ dryRun: !apply, scanned: 0, eligible: 0, refunded: 0 })
    }

    // 2. Horário de cada sessão, já respeitando o override da data.
    const sessionIds = Array.from(new Set(cancelled.map((b) => b.session_id)))
    const sessions = (
      await Promise.all(
        chunk(sessionIds, IN_CHUNK_SIZE).map((ids) =>
          fetchAllPages<SessionInfo>(
            (from, to) =>
              adminClient
                .from('class_sessions')
                .select('id, session_date, start_time, classes(start_time)')
                .in('id', ids)
                .order('id', { ascending: true })
                .range(from, to),
            { label: 'cron/late-cancel:sessions' },
          ),
        ),
      )
    ).flat()

    const startById = new Map<string, string>()
    for (const s of sessions) {
      const cls = Array.isArray(s.classes) ? s.classes[0] : s.classes
      const startTime = s.start_time ?? cls?.start_time
      if (startTime) startById.set(s.id, sessionStartIso(s.session_date, startTime))
    }

    // 3. Quem JÁ recebeu estorno naquela sessão. É o que torna a rota idempotente
    //    e o que impede devolver crédito a quem cancelou no prazo e já foi pago.
    const refundedPairs = new Set<string>()
    const txs = (
      await Promise.all(
        chunk(sessionIds, IN_CHUNK_SIZE).map((ids) =>
          fetchAllPages<{ student_id: string; session_id: string }>(
            (from, to) =>
              adminClient
                .from('credit_transactions')
                .select('student_id, session_id')
                .eq('type', 'refunded')
                .in('session_id', ids)
                .order('id', { ascending: true })
                .range(from, to),
            { label: 'cron/late-cancel:refunds' },
          ),
        ),
      )
    ).flat()
    for (const t of txs) refundedPairs.add(`${t.student_id}:${t.session_id}`)

    // 4. Elegíveis: cancelou dentro de 1h da reserva (a regra nova), ainda não
    //    recebeu estorno. Quem cancelou com folga já foi pago pela regra das 5h e
    //    cai fora no passo anterior; quem sumiu de verdade não entra aqui.
    const eligible = cancelled.filter((b) => {
      if (refundedPairs.has(`${b.student_id}:${b.session_id}`)) return false
      if (!startById.has(b.session_id)) return false
      return withinBookingGrace(b.booked_at, b.cancelled_at)
    })

    if (!apply) {
      return NextResponse.json({
        dryRun: true,
        scanned: cancelled.length,
        eligible: eligible.length,
        // Amostra para conferência a olho antes de aplicar.
        sample: eligible.slice(0, 20).map((b) => ({
          bookingId: b.id,
          studentId: b.student_id,
          sessionId: b.session_id,
          bookedAt: b.booked_at,
          cancelledAt: b.cancelled_at,
        })),
      })
    }

    let refunded = 0
    let absencesCleared = 0
    let failed = 0

    const { skipped } = await mapWithConcurrency(
      eligible,
      async (b) => {
        try {
          const { error } = await adminClient.rpc('adjust_credits', {
            p_student_id: b.student_id,
            p_org: b.organization_id,
            p_delta: 1,
            p_type: 'refunded',
            p_reason: 'Estorno retroativo: saída dentro de 1h da reserva',
            p_session_id: b.session_id,
            // Sem expires_at de propósito: devolver um crédito já vencendo seria
            // devolver quase nada a quem foi cobrado por uma regra que mudou.
          })
          if (error) {
            failed++
            return
          }
          refunded++

          // A falta lançada em cima de quem já tinha saído da aula não é falta:
          // o cancelamento é ANTERIOR ao início. Ausência de quem simplesmente
          // não apareceu, sem cancelar, não é tocada — aquela é real.
          const startIso = startById.get(b.session_id)!
          if (new Date(b.cancelled_at) < new Date(startIso)) {
            const { error: attErr } = await adminClient
              .from('attendance')
              .delete()
              .eq('session_id', b.session_id)
              .eq('student_id', b.student_id)
              .eq('status', 'absent')
            if (!attErr) absencesCleared++
          }
        } catch (e) {
          failed++
          Sentry.captureException(e, {
            tags: { cron: 'late-cancel-refund' },
            extra: { bookingId: b.id },
          })
        }
      },
      { concurrency: REFUND_CONCURRENCY, deadline },
    )

    return NextResponse.json({
      dryRun: false,
      scanned: cancelled.length,
      eligible: eligible.length,
      refunded,
      absencesCleared,
      failed,
      // Orçamento de tempo estourado: o que sobrou fica para a próxima chamada,
      // que reencontra os mesmos elegíveis (os já pagos saem pelo passo 3).
      truncated: skipped > 0,
    })
  } catch (e) {
    Sentry.captureException(e, { tags: { cron: 'late-cancel-refund' } })
    return NextResponse.json({ error: 'Cron failed' }, { status: 500 })
  }
}
