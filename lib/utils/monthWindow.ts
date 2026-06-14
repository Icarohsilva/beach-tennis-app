import { format, startOfMonth, endOfMonth } from 'date-fns'

export interface DateWindow {
  from: string // yyyy-MM-dd
  to: string // yyyy-MM-dd
}

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
