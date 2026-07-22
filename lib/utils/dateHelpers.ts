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

/**
 * Converte para Date PRESERVANDO o dia do calendário.
 *
 * `new Date('2026-07-28')` (data pura) é parseado como meia-noite UTC; formatado
 * num fuso negativo (BRT = UTC-3) isso volta 3h e cai em 27/07. Server components
 * mascaravam o bug (Vercel roda em UTC), mas no navegador do aluno toda data pura
 * aparecia um dia antes. Datas puras (YYYY-MM-DD) passam a virar meia-noite LOCAL,
 * então o dia exibido é o mesmo no servidor e no navegador, em qualquer fuso.
 * Strings com hora e objetos Date seguem o parse normal.
 */
function toCalendarDate(date: string | Date): Date {
  if (typeof date === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  }
  return new Date(date)
}

export function formatDate(date: string | Date, fmt = 'dd/MM/yyyy'): string {
  return format(toCalendarDate(date), fmt, { locale: ptBR })
}

export function formatTime(time: string): string {
  // time = "HH:MM:SS" or "HH:MM"
  return time.slice(0, 5)
}

export function getFirstDayOfNextMonth(): Date {
  return startOfMonth(addMonths(new Date(), 1))
}
