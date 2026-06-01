import { eachDayOfInterval, getDay, format, parseISO } from 'date-fns'

/** Pure helper — returns session rows to insert for a class */
export function buildSessionRows(
  classId: string,
  dayOfWeek: number,
  fromDateStr: string,
  toDateStr: string,
): Array<{ class_id: string; session_date: string; status: string; notes: null }> {
  const from = parseISO(fromDateStr)
  const to = parseISO(toDateStr)
  return eachDayOfInterval({ start: from, end: to })
    .filter((d) => getDay(d) === dayOfWeek)
    .map((d) => ({
      class_id: classId,
      session_date: format(d, 'yyyy-MM-dd'),
      status: 'scheduled',
      notes: null,
    }))
}
