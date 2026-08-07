import { describe, it, expect } from 'vitest'
import { cycleWindow, countCycleWeeks, resolveQuota, countOnDate } from './classQuota'
import type { PlanQuota, QuotaBooking } from './classQuota'

describe('cycleWindow', () => {
  it('semanal: quarta-feira devolve a segunda e o domingo da mesma semana', () => {
    // 2026-07-29 é uma quarta-feira.
    expect(cycleWindow('2026-07-29', 'weekly')).toEqual({
      from: '2026-07-27',
      to: '2026-08-02',
    })
  })

  it('semanal: a própria segunda é o início da janela', () => {
    expect(cycleWindow('2026-07-27', 'weekly')).toEqual({
      from: '2026-07-27',
      to: '2026-08-02',
    })
  })

  it('semanal: domingo fecha a semana que começou na segunda anterior', () => {
    // 2026-08-02 é domingo. Não pode abrir uma semana nova.
    expect(cycleWindow('2026-08-02', 'weekly')).toEqual({
      from: '2026-07-27',
      to: '2026-08-02',
    })
  })

  it('mensal: devolve o primeiro e o último dia do mês', () => {
    expect(cycleWindow('2026-07-28', 'monthly')).toEqual({
      from: '2026-07-01',
      to: '2026-07-31',
    })
  })

  it('mensal: fevereiro não-bissexto termina no dia 28', () => {
    expect(cycleWindow('2026-02-10', 'monthly')).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    })
  })
})

describe('countCycleWeeks', () => {
  it('janela semanal tem exatamente 1 semana', () => {
    expect(countCycleWeeks('2026-07-27', '2026-08-02')).toBe(1)
  })

  it('julho/2026 tem 4 segundas-feiras', () => {
    // Segundas: 06, 13, 20, 27.
    expect(countCycleWeeks('2026-07-01', '2026-07-31')).toBe(4)
  })

  it('junho/2026 tem 5 segundas-feiras', () => {
    // Segundas: 01, 08, 15, 22, 29.
    expect(countCycleWeeks('2026-06-01', '2026-06-30')).toBe(5)
  })

  it('janela de um dia que não é segunda conta zero', () => {
    expect(countCycleWeeks('2026-07-28', '2026-07-28')).toBe(0)
  })
})

const PLANO_2X: PlanQuota = {
  classesPerWeek: 2,
  cycle: 'monthly',
  maxClassesPerDay: 2,
  refundOnLateCancel: true,
}

function confirmada(sessionDate: string): QuotaBooking {
  return { sessionDate, status: 'confirmed', cancelledLate: false, adminWaived: false }
}

describe('resolveQuota', () => {
  it('limite = aulas por semana × semanas do ciclo', () => {
    const r = resolveQuota({
      plan: PLANO_2X, cycleWeeks: 4, bookings: [], fixedSessionsInCycle: 0,
    })
    expect(r).toEqual({ limit: 8, used: 0, remaining: 8 })
  })

  it('conta as reservas confirmadas como usadas', () => {
    const r = resolveQuota({
      plan: PLANO_2X,
      cycleWeeks: 4,
      bookings: [confirmada('2026-07-07'), confirmada('2026-07-09')],
      fixedSessionsInCycle: 0,
    })
    expect(r).toEqual({ limit: 8, used: 2, remaining: 6 })
  })

  it('as fixas do aluno elevam o limite quando passam do que o plano vende', () => {
    // Mês com 5 ocorrências do dia da fixa: 10 sessões contra cota de 8.
    // Sem o max(), o aluno seria barrado na própria aula que assinou.
    const r = resolveQuota({
      plan: PLANO_2X, cycleWeeks: 4, bookings: [], fixedSessionsInCycle: 10,
    })
    expect(r.limit).toBe(10)
  })

  it('as fixas NÃO reduzem o limite quando são menos que o plano vende', () => {
    const r = resolveQuota({
      plan: PLANO_2X, cycleWeeks: 4, bookings: [], fixedSessionsInCycle: 3,
    })
    expect(r.limit).toBe(8)
  })

  it('cancelamento tardio queima a vaga quando o plano não reembolsa', () => {
    const plano = { ...PLANO_2X, refundOnLateCancel: false }
    const r = resolveQuota({
      plan: plano,
      cycleWeeks: 4,
      bookings: [{ sessionDate: '2026-07-07', status: 'cancelled', cancelledLate: true, adminWaived: false }],
      fixedSessionsInCycle: 0,
    })
    expect(r.used).toBe(1)
  })

  it('cancelamento tardio devolve a vaga quando o plano reembolsa', () => {
    const r = resolveQuota({
      plan: PLANO_2X,
      cycleWeeks: 4,
      bookings: [{ sessionDate: '2026-07-07', status: 'cancelled', cancelledLate: true, adminWaived: false }],
      fixedSessionsInCycle: 0,
    })
    expect(r.used).toBe(0)
  })

  it('cancelamento dentro da janela nunca queima a vaga', () => {
    const plano = { ...PLANO_2X, refundOnLateCancel: false }
    const r = resolveQuota({
      plan: plano,
      cycleWeeks: 4,
      bookings: [{ sessionDate: '2026-07-07', status: 'cancelled', cancelledLate: false, adminWaived: false }],
      fixedSessionsInCycle: 0,
    })
    expect(r.used).toBe(0)
  })

  it('aula devolvida pelo professor não conta, mesmo cancelada em cima da hora', () => {
    // O caso que motivou a flag: aluno de plano removido da aula pelo professor
    // perto do horário. Sem a isenção isso queimaria a aula do ciclo dele.
    const plano = { ...PLANO_2X, refundOnLateCancel: false }
    const r = resolveQuota({
      plan: plano,
      cycleWeeks: 4,
      bookings: [{ sessionDate: '2026-07-07', status: 'cancelled', cancelledLate: true, adminWaived: true }],
      fixedSessionsInCycle: 0,
    })
    expect(r.used).toBe(0)
    expect(r.remaining).toBe(8)
  })

  it('a isenção não ressuscita vaga de aula que o aluno usou', () => {
    // adminWaived só vale para reserva cancelada. Presença é aula consumida.
    const r = resolveQuota({
      plan: PLANO_2X,
      cycleWeeks: 4,
      bookings: [{ sessionDate: '2026-07-07', status: 'confirmed', cancelledLate: false, adminWaived: true }],
      fixedSessionsInCycle: 0,
    })
    expect(r.used).toBe(1)
  })

  it('remaining nunca fica negativo', () => {
    const r = resolveQuota({
      plan: { ...PLANO_2X, classesPerWeek: 1 },
      cycleWeeks: 1,
      bookings: [confirmada('2026-07-07'), confirmada('2026-07-08'), confirmada('2026-07-09')],
      fixedSessionsInCycle: 0,
    })
    expect(r.remaining).toBe(0)
  })
})

describe('countOnDate', () => {
  it('conta só as confirmadas da data pedida', () => {
    const bookings: QuotaBooking[] = [
      confirmada('2026-07-28'),
      confirmada('2026-07-28'),
      confirmada('2026-07-29'),
      { sessionDate: '2026-07-28', status: 'cancelled', cancelledLate: false, adminWaived: false },
    ]
    expect(countOnDate(bookings, '2026-07-28')).toBe(2)
  })
})
