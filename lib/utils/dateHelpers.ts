// lib/utils/dateHelpers.ts
import { format, addMonths, startOfMonth, endOfMonth, eachDayOfInterval, getDay } from 'date-fns'
import { ptBR } from 'date-fns/locale'

/** Returns all dates in a month that match a given day_of_week (0=Sun, 6=Sat) */
export function getDatesForDayOfWeekInMonth(
  year: number,
  month: number, // 0-indexed
  dayOfWeek: number,
): Date[] {
  const start = startOfMonth(new Date(year, month))
  const end = endOfMonth(new Date(year, month))
  return eachDayOfInterval({ start, end }).filter((d) => getDay(d) === dayOfWeek)
}

export function formatDate(date: string | Date, fmt = 'dd/MM/yyyy'): string {
  return format(new Date(date), fmt, { locale: ptBR })
}

export function formatTime(time: string): string {
  // time = "HH:MM:SS" or "HH:MM"
  return time.slice(0, 5)
}

export function getFirstDayOfNextMonth(): Date {
  return startOfMonth(addMonths(new Date(), 1))
}
