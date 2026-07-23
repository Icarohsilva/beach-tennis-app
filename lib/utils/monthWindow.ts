// lib/utils/monthWindow.ts
// Janelas de data (yyyy-MM-dd) usadas por check-in e pelo relatório de frequência.
import {
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addWeeks, addMonths, parseISO,
} from 'date-fns'

export interface DateWindow {
  from: string // yyyy-MM-dd
  to: string // yyyy-MM-dd
}

export type WindowKind = 'week' | 'month'

/** Primeiro e último dia do mês de `now` (yyyy-MM-dd). */
export function getMonthWindow(now: Date): DateWindow {
  return {
    from: format(startOfMonth(now), 'yyyy-MM-dd'),
    to: format(endOfMonth(now), 'yyyy-MM-dd'),
  }
}

/** Data de `now` até o último dia do mês (yyyy-MM-dd). */
export function getRemainingMonthWindow(now: Date): DateWindow {
  return {
    from: format(now, 'yyyy-MM-dd'),
    to: format(endOfMonth(now), 'yyyy-MM-dd'),
  }
}

/** Domingo a sábado da semana de `now` (yyyy-MM-dd). */
export function getWeekWindow(now: Date): DateWindow {
  return {
    from: format(startOfWeek(now), 'yyyy-MM-dd'),
    to: format(endOfWeek(now), 'yyyy-MM-dd'),
  }
}

/** Move a janela `offset` semanas/meses (negativo = passado). */
export function shiftWindow(window: DateWindow, kind: WindowKind, offset: number): DateWindow {
  const anchor = parseISO(window.from)
  if (kind === 'week') return getWeekWindow(addWeeks(anchor, offset))
  return getMonthWindow(addMonths(anchor, offset))
}
