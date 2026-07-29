import { describe, it, expect, vi } from 'vitest'
import { getQuotaSnapshot } from './quotaUsage'
import type { PlanQuota } from '@/lib/utils/classQuota'

const PLANO: PlanQuota = {
  classesPerWeek: 2,
  cycle: 'monthly',
  maxClassesPerDay: 2,
  refundOnLateCancel: true,
}

/**
 * Stub escopado ao que getQuotaSnapshot consulta: reservas do aluno na janela
 * (com a data da sessão embutida) e matrículas fixas ativas com o dia da turma.
 * Mesma técnica de features/aulas/gridGeneration.test.ts.
 */
function makeClient(opts: {
  bookings?: {
    status: string
    cancelled_at: string | null
    class_sessions: { session_date: string; classes: { start_time: string } }
  }[]
  enrollments?: { classes: { day_of_week: number }; enrolled_at?: string }[]
}) {
  const from = vi.fn((table: string) => {
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      gte: () => builder,
      lte: () => builder,
      in: () => builder,
      order: () => builder,
      then: (resolve: (v: { data: unknown }) => void) => {
        const data =
          table === 'session_bookings' ? opts.bookings ?? [] : opts.enrollments ?? []
        return Promise.resolve({ data }).then(resolve)
      },
    }
    return builder
  })
  return { from } as never
}

describe('getQuotaSnapshot', () => {
  it('conta as reservas confirmadas do ciclo contra o limite do plano', async () => {
    const client = makeClient({
      bookings: [
        {
          status: 'confirmed',
          cancelled_at: null,
          class_sessions: { session_date: '2026-07-07', classes: { start_time: '18:00:00' } },
        },
        {
          status: 'confirmed',
          cancelled_at: null,
          class_sessions: { session_date: '2026-07-09', classes: { start_time: '18:00:00' } },
        },
      ],
      enrollments: [],
    })

    const snap = await getQuotaSnapshot(client, 'stu-1', 'org-1', PLANO, '2026-07-28')

    // Julho/2026 tem 4 segundas → limite 2×4 = 8.
    expect(snap.limit).toBe(8)
    expect(snap.used).toBe(2)
    expect(snap.remaining).toBe(6)
  })

  it('conta as reservas do aluno na data pedida para o teto diário', async () => {
    const client = makeClient({
      bookings: [
        {
          status: 'confirmed',
          cancelled_at: null,
          class_sessions: { session_date: '2026-07-28', classes: { start_time: '18:00:00' } },
        },
        {
          status: 'confirmed',
          cancelled_at: null,
          class_sessions: { session_date: '2026-07-28', classes: { start_time: '18:00:00' } },
        },
        {
          status: 'confirmed',
          cancelled_at: null,
          class_sessions: { session_date: '2026-07-29', classes: { start_time: '18:00:00' } },
        },
      ],
      enrollments: [],
    })

    const snap = await getQuotaSnapshot(client, 'stu-1', 'org-1', PLANO, '2026-07-28')

    expect(snap.bookingsOnDate).toBe(2)
  })

  it('as fixas elevam o limite quando o mês tem mais ocorrências que a cota', async () => {
    // 2 turmas fixas na quarta-feira; julho/2026 tem 5 quartas (01,08,15,22,29).
    const client = makeClient({
      bookings: [],
      enrollments: [{ classes: { day_of_week: 3 } }, { classes: { day_of_week: 3 } }],
    })

    const snap = await getQuotaSnapshot(client, 'stu-1', 'org-1', PLANO, '2026-07-28')

    // 2 fixas × 5 quartas = 10 > 8 do plano.
    expect(snap.limit).toBe(10)
  })

  it('ignora as canceladas quando o plano reembolsa', async () => {
    const client = makeClient({
      bookings: [
        {
          status: 'cancelled',
          cancelled_at: '2026-07-07T10:00:00Z',
          class_sessions: { session_date: '2026-07-07', classes: { start_time: '18:00:00' } },
        },
      ],
      enrollments: [],
    })

    const snap = await getQuotaSnapshot(client, 'stu-1', 'org-1', PLANO, '2026-07-28')

    expect(snap.used).toBe(0)
  })

  it('cancelamento tardio queima a vaga quando o plano não reembolsa', async () => {
    const planoSemReembolso: PlanQuota = { ...PLANO, refundOnLateCancel: false }
    const client = makeClient({
      // Aula 2026-07-07 às 18:00 BRT = 21:00Z. Cancelou 20:00Z = 1h antes.
      bookings: [
        {
          status: 'cancelled',
          cancelled_at: '2026-07-07T20:00:00Z',
          class_sessions: { session_date: '2026-07-07', classes: { start_time: '18:00:00' } },
        },
      ],
      enrollments: [],
    })

    const snap = await getQuotaSnapshot(client, 'stu-1', 'org-1', planoSemReembolso, '2026-07-28')

    expect(snap.used).toBe(1)
  })

  it('cancelamento dentro da janela não queima a vaga', async () => {
    const planoSemReembolso: PlanQuota = { ...PLANO, refundOnLateCancel: false }
    const client = makeClient({
      // Cancelou 2 dias antes — muito além das 5h.
      bookings: [
        {
          status: 'cancelled',
          cancelled_at: '2026-07-05T12:00:00Z',
          class_sessions: { session_date: '2026-07-07', classes: { start_time: '18:00:00' } },
        },
      ],
      enrollments: [],
    })

    const snap = await getQuotaSnapshot(client, 'stu-1', 'org-1', planoSemReembolso, '2026-07-28')

    expect(snap.used).toBe(0)
  })

  it('conta só as matrículas mais antigas até o limite do plano atual', async () => {
    // Plano foi reduzido pra 1x/semana, mas o aluno ainda tem 2 matrículas
    // ativas de quando o plano permitia mais. Só a mais antiga (enrolled_at
    // menor) conta pro limite — a mais nova é excedente.
    const planoReduzido: PlanQuota = { ...PLANO, classesPerWeek: 1 }
    const client = makeClient({
      bookings: [],
      enrollments: [
        { classes: { day_of_week: 3 }, enrolled_at: '2026-06-01T00:00:00Z' }, // quarta, mais antiga
        { classes: { day_of_week: 5 }, enrolled_at: '2026-07-15T00:00:00Z' }, // sexta, mais nova (excedente)
      ],
    })

    const snap = await getQuotaSnapshot(client, 'stu-1', 'org-1', planoReduzido, '2026-07-28')

    // Julho/2026 tem 5 quartas (01,08,15,22,29). Só a matrícula de quarta conta.
    // A de sexta (excedente) soma 0. max(1×4, 5) = 5.
    expect(snap.limit).toBe(5)
  })
})
