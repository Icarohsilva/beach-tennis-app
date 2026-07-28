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
}

export interface QuotaBooking {
  sessionDate: string
  status: 'confirmed' | 'cancelled'
  /** Cancelada fora da janela de cancelamento (creditRules.canCancelWithRefund). */
  cancelledLate: boolean
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
 */
export function resolveQuota(input: {
  plan: PlanQuota
  cycleWeeks: number
  bookings: QuotaBooking[]
  fixedSessionsInCycle: number
}): QuotaResult {
  const { plan, cycleWeeks, bookings, fixedSessionsInCycle } = input

  const limit = Math.max(plan.classesPerWeek * cycleWeeks, fixedSessionsInCycle)

  const used = bookings.filter(
    (b) =>
      b.status === 'confirmed' ||
      (b.status === 'cancelled' && b.cancelledLate && !plan.refundOnLateCancel),
  ).length

  return { limit, used, remaining: Math.max(0, limit - used) }
}

/** Reservas confirmadas do aluno numa data — insumo do teto diário. */
export function countOnDate(bookings: QuotaBooking[], dateStr: string): number {
  return bookings.filter((b) => b.status === 'confirmed' && b.sessionDate === dateStr).length
}
