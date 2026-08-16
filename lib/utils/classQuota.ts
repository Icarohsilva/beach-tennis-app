// Cota de aulas do plano. Puro, sem I/O — o caller busca os dados.
// Toda data é yyyy-MM-dd em BRT; nada de Date local (ver gridSchedule.ts).
import { addDaysStr } from './gridSchedule'

export type PlanCycle = 'weekly' | 'monthly'

/** Dia da semana (0=domingo) de uma data yyyy-MM-dd, em UTC puro. */
function dowOf(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/**
 * Janela [from, to] do ciclo que contém `dateStr`.
 * Semanal = segunda a domingo. Mensal = mês calendário.
 */
export function cycleWindow(dateStr: string, cycle: PlanCycle): { from: string; to: string } {
  if (cycle === 'weekly') {
    const dow = dowOf(dateStr)
    // Domingo (0) fecha a semana que começou 6 dias antes, não abre uma nova.
    const backToMonday = dow === 0 ? 6 : dow - 1
    const from = addDaysStr(dateStr, -backToMonday)
    return { from, to: addDaysStr(from, 6) }
  }

  const [y, m] = dateStr.split('-').map(Number)
  // Dia 0 do mês seguinte = último dia deste mês.
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(lastDay)}` }
}

/**
 * Semanas seg–dom que COMEÇAM dentro de [from, to] — ou seja, quantas
 * segundas-feiras a janela contém. É a única contagem determinística de
 * "semanas do mês" (4 ou 5). O descasamento de até 1 para alunos com fixa em
 * outro dia da semana é absorvido pelo max() de resolveQuota.
 */
export function countCycleWeeks(from: string, to: string): number {
  let count = 0
  let cursor = from
  while (cursor <= to) {
    if (dowOf(cursor) === 1) count++
    cursor = addDaysStr(cursor, 1)
  }
  return count
}

export interface PlanQuota {
  classesPerWeek: number
  cycle: PlanCycle
  maxClassesPerDay: number
  refundOnLateCancel: boolean
  /**
   * Aula não usada no ciclo vira saldo para o ciclo seguinte.
   *
   * Por plano, não por academia: a arena pode vender um plano em que a sobra
   * acumula e outro em que ela zera todo mês. Não afeta crédito avulso, que
   * segue as regras dele.
   */
  rolloverUnused: boolean
}

export interface QuotaBooking {
  sessionDate: string
  status: 'confirmed' | 'cancelled'
  /** Cancelada fora da janela de cancelamento (creditRules.canCancelWithRefund). */
  cancelledLate: boolean
  /**
   * Professor devolveu a aula ao remover o aluno. Nunca conta na cota, mesmo
   * cancelada em cima da hora — é a forma de "devolver" para quem é de plano ou
   * parceiro, onde não existe crédito a estornar, só contagem a não somar.
   */
  adminWaived: boolean
}

export interface QuotaResult {
  limit: number
  used: number
  remaining: number
}

/**
 * O max() é a peça central: a matrícula fixa NUNCA pode ser bloqueada pela
 * cota. Num mês com 5 ocorrências do dia da turma, o aluno de plano 2x/semana
 * tem 10 sessões fixas contra uma cota de 8 — sem o max() ele seria barrado na
 * própria aula que assinou. O primeiro termo cobre o caso oposto: aluno com
 * plano e nenhuma fixa, que só reserva avulso.
 *
 * `carriedIn` (saldo vindo do ciclo anterior, quando o plano acumula) entra
 * DENTRO do max, somado ao que o plano deu: ele aumenta o que o aluno pode
 * usar, e o piso da matrícula fixa continua valendo por baixo. Somar por fora
 * (`max(...) + carriedIn`) daria saldo em dobro para quem tem mais sessões
 * fixas do que o plano vende — o caso do mês com 5 sábados.
 */
export function resolveQuota(input: {
  plan: PlanQuota
  cycleWeeks: number
  bookings: QuotaBooking[]
  fixedSessionsInCycle: number
  /** Sobra do ciclo anterior. 0 quando o plano não acumula ou é o primeiro ciclo. */
  carriedIn?: number
}): QuotaResult {
  const { plan, cycleWeeks, bookings, fixedSessionsInCycle } = input
  // Defensivo: saldo negativo não existe (carried_out é clampado na origem), e
  // um valor torto vindo do banco não pode reduzir a cota de quem paga.
  const carriedIn = Math.max(0, input.carriedIn ?? 0)

  const limit = Math.max(plan.classesPerWeek * cycleWeeks + carriedIn, fixedSessionsInCycle)

  // A isenção do professor vence a regra de cancelamento tardio: ele viu o
  // caso concreto e decidiu devolver a aula. Só vale para reserva cancelada —
  // aula que o aluno de fato usou continua contando.
  const used = bookings.filter(
    (b) =>
      b.status === 'confirmed' ||
      (b.status === 'cancelled' &&
        b.cancelledLate &&
        !b.adminWaived &&
        !plan.refundOnLateCancel),
  ).length

  return { limit, used, remaining: Math.max(0, limit - used) }
}

/**
 * O saldo que sai do ciclo: o que entrou, mais o que o plano deu, menos o usado.
 *
 * Clampado em 0 na origem — é o que garante que `carriedIn` nunca chegue
 * negativo do banco. Usar mais do que a cota (o admin adiciona o aluno com
 * `force`, a fixa fura o limite pelo max()) não vira dívida para o mês seguinte:
 * o aluno não deve aula à academia.
 */
export function carryOut(input: {
  carriedIn: number
  granted: number
  used: number
}): number {
  return Math.max(0, input.carriedIn + input.granted - input.used)
}

/**
 * A janela do ciclo seguinte a `window`.
 *
 * Serve ao fechamento, que avança ciclo a ciclo do último fechado até o último
 * já encerrado. Deriva de `cycleWindow` sobre o dia seguinte ao fim — assim a
 * regra de fronteira (semana seg–dom, mês calendário) mora num lugar só.
 */
export function nextCycleWindow(
  window: { from: string; to: string },
  cycle: PlanCycle,
): { from: string; to: string } {
  return cycleWindow(addDaysStr(window.to, 1), cycle)
}

/** Reservas confirmadas do aluno numa data — insumo do teto diário. */
export function countOnDate(bookings: QuotaBooking[], dateStr: string): number {
  return bookings.filter((b) => b.status === 'confirmed' && b.sessionDate === dateStr).length
}
