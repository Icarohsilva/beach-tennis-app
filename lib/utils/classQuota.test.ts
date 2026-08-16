import { describe, it, expect } from 'vitest'
import {
  cycleWindow,
  countCycleWeeks,
  resolveQuota,
  countOnDate,
  carryOut,
  nextCycleWindow,
} from './classQuota'
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
  rolloverUnused: false,
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

// Acúmulo de aulas não usadas. O ponto de atenção é ONDE o saldo entra: dentro
// do max(), somado ao que o plano deu. Somar por fora daria saldo em dobro para
// quem tem mais sessões fixas do que o plano vende (o mês com 5 sábados).
describe('resolveQuota — saldo do ciclo anterior', () => {
  it('sem carriedIn, o comportamento é o de sempre', () => {
    const semSaldo = resolveQuota({
      plan: PLANO_2X, cycleWeeks: 4, bookings: [], fixedSessionsInCycle: 0,
    })
    const comZero = resolveQuota({
      plan: PLANO_2X, cycleWeeks: 4, bookings: [], fixedSessionsInCycle: 0, carriedIn: 0,
    })
    expect(semSaldo).toEqual({ limit: 8, used: 0, remaining: 8 })
    expect(comZero).toEqual(semSaldo)
  })

  it('saldo soma ao que o plano deu', () => {
    expect(
      resolveQuota({
        plan: PLANO_2X, cycleWeeks: 4, bookings: [], fixedSessionsInCycle: 0, carriedIn: 5,
      }),
    ).toEqual({ limit: 13, used: 0, remaining: 13 })
  })

  it('saldo desconta o que já foi usado no ciclo novo', () => {
    expect(
      resolveQuota({
        plan: PLANO_2X,
        cycleWeeks: 4,
        bookings: [confirmada('2026-08-03'), confirmada('2026-08-05')],
        fixedSessionsInCycle: 0,
        carriedIn: 5,
      }),
    ).toEqual({ limit: 13, used: 2, remaining: 11 })
  })

  // O piso da fixa continua por baixo, mas não SOMA com o saldo: 10 fixas com
  // 5 de saldo dá 13 (8+5), não 15. O aluno tem direito ao que o plano vende
  // mais o que guardou — não ao número de sessões que o calendário produziu.
  it('o piso da matrícula fixa continua valendo, sem dobrar o saldo', () => {
    expect(
      resolveQuota({
        plan: PLANO_2X, cycleWeeks: 4, bookings: [], fixedSessionsInCycle: 10, carriedIn: 5,
      }).limit,
    ).toBe(13)
    // Sem saldo suficiente para passar do piso, o piso vence.
    expect(
      resolveQuota({
        plan: PLANO_2X, cycleWeeks: 4, bookings: [], fixedSessionsInCycle: 10, carriedIn: 1,
      }).limit,
    ).toBe(10)
  })

  it('saldo negativo (dado torto) é tratado como zero, nunca reduz a cota', () => {
    expect(
      resolveQuota({
        plan: PLANO_2X, cycleWeeks: 4, bookings: [], fixedSessionsInCycle: 0, carriedIn: -3,
      }).limit,
    ).toBe(8)
  })
})

describe('carryOut', () => {
  it('o que sobrou vira saldo', () => {
    expect(carryOut({ carriedIn: 0, granted: 8, used: 3 })).toBe(5)
  })

  it('o saldo que entrou também sobra quando não é usado', () => {
    expect(carryOut({ carriedIn: 5, granted: 8, used: 3 })).toBe(10)
  })

  // Usar mais do que a cota acontece de verdade: o admin adiciona com `force` e
  // a matrícula fixa fura o limite pelo max(). Isso não pode virar dívida.
  it('usar mais do que tinha não gera saldo negativo', () => {
    expect(carryOut({ carriedIn: 0, granted: 8, used: 12 })).toBe(0)
    expect(carryOut({ carriedIn: 2, granted: 8, used: 30 })).toBe(0)
  })

  it('ciclo sem uso nenhum (férias) devolve tudo', () => {
    expect(carryOut({ carriedIn: 4, granted: 8, used: 0 })).toBe(12)
  })
})

describe('nextCycleWindow', () => {
  it('mensal avança para o mês seguinte', () => {
    expect(nextCycleWindow({ from: '2026-08-01', to: '2026-08-31' }, 'monthly')).toEqual({
      from: '2026-09-01',
      to: '2026-09-30',
    })
  })

  it('mensal atravessa a virada do ano', () => {
    expect(nextCycleWindow({ from: '2026-12-01', to: '2026-12-31' }, 'monthly')).toEqual({
      from: '2027-01-01',
      to: '2027-01-31',
    })
  })

  it('semanal avança para a segunda seguinte', () => {
    expect(nextCycleWindow({ from: '2026-08-10', to: '2026-08-16' }, 'weekly')).toEqual({
      from: '2026-08-17',
      to: '2026-08-23',
    })
  })
})
