// lib/utils/monthWindow.ts
// Janelas de data (yyyy-MM-dd) usadas por check-in e pelo relatório de frequência.
//
// Tudo aqui é calculado em BRT, não no fuso do processo. Antes usávamos
// `startOfMonth`/`endOfMonth`/`format` do date-fns direto sobre `now`, o que lê o
// fuso de quem está rodando: a Vercel roda em UTC, então das 21h à meia-noite BRT
// do último dia do mês o relógio UTC já tinha virado o mês seguinte e a janela
// pulava junto — o "Check-ins do mês" do aluno zerava 3h adiantado, e o relatório
// de frequência trocava de mês antes da hora.
//
// Mesmo raciocínio (e mesmo remédio, `brtToday`) de `features/liga/season.ts`
// e `lib/liga/streak.ts`. Fuso fixo −03:00: Brasília não tem DST desde 2019.
import { brtToday, addDaysStr } from './gridSchedule'

export interface DateWindow {
  from: string // yyyy-MM-dd
  to: string // yyyy-MM-dd
}

export type WindowKind = 'week' | 'month'

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** Último dia do mês de uma data yyyy-MM-dd (puro, sem fuso). */
function lastDayOfMonth(dateStr: string): number {
  const [y, m] = dateStr.split('-').map(Number)
  // Dia 0 do mês seguinte = último dia deste mês. Date.UTC evita o fuso local.
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** Dia da semana (0=domingo) de uma data yyyy-MM-dd (puro, sem fuso). */
function dayOfWeek(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

/** Primeiro e último dia do mês de `now` em BRT (yyyy-MM-dd). */
export function getMonthWindow(now: Date): DateWindow {
  const today = brtToday(now)
  const [y, m] = today.split('-')
  return {
    from: `${y}-${m}-01`,
    to: `${y}-${m}-${pad(lastDayOfMonth(today))}`,
  }
}

/** Data de hoje em BRT até o último dia do mês (yyyy-MM-dd). */
export function getRemainingMonthWindow(now: Date): DateWindow {
  const today = brtToday(now)
  return { from: today, to: getMonthWindow(now).to }
}

/** Domingo a sábado da semana de `now` em BRT (yyyy-MM-dd). */
export function getWeekWindow(now: Date): DateWindow {
  const today = brtToday(now)
  const from = addDaysStr(today, -dayOfWeek(today))
  return { from, to: addDaysStr(from, 6) }
}

/** Move a janela `offset` semanas/meses (negativo = passado). */
export function shiftWindow(window: DateWindow, kind: WindowKind, offset: number): DateWindow {
  if (kind === 'week') {
    const from = addDaysStr(window.from, offset * 7)
    return { from, to: addDaysStr(from, 6) }
  }

  // Aritmética de mês em string: somar dias erraria em fevereiro e em meses de 31.
  const [y, m] = window.from.split('-').map(Number)
  const total = y * 12 + (m - 1) + offset
  const targetY = Math.floor(total / 12)
  const targetM = total % 12
  const from = `${targetY}-${pad(targetM + 1)}-01`
  return { from, to: `${targetY}-${pad(targetM + 1)}-${pad(lastDayOfMonth(from))}` }
}
