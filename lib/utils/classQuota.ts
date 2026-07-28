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
