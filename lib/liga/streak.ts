// lib/liga/streak.ts
// Sequência de semanas treinando, por esporte (spec §Decisões 10).
//
// date-fns com semana ISO (segunda a domingo), mesma convenção de
// lib/utils/dateHelpers.ts.
import { startOfISOWeek, differenceInCalendarWeeks, parseISO } from 'date-fns'

/**
 * Semanas consecutivas com ao menos uma presença, terminando na semana de `today`.
 *
 * Decisão importante: se o aluno ainda NÃO treinou na semana corrente, a contagem
 * termina na semana anterior em vez de zerar. Do contrário todo aluno abriria o app
 * na segunda-feira com a sequência zerada, o que puniria quem não faltou — ele ainda
 * tem o resto da semana para treinar.
 *
 * `attendanceDates` são datas 'YYYY-MM-DD' de presenças CONFIRMADAS naquele esporte;
 * duplicadas e datas futuras são ignoradas.
 */
export function computeStreakWeeks(attendanceDates: string[], today: Date): number {
  if (attendanceDates.length === 0) return 0

  const currentWeek = startOfISOWeek(today)

  // Distância em semanas entre a semana da presença e a semana corrente.
  const weeksAgo = new Set<number>()
  for (const date of attendanceDates) {
    const diff = differenceInCalendarWeeks(currentWeek, startOfISOWeek(parseISO(date)), {
      weekStartsOn: 1,
    })
    if (diff >= 0) weeksAgo.add(diff)
  }

  const start = weeksAgo.has(0) ? 0 : 1
  if (!weeksAgo.has(start)) return 0

  let count = 0
  while (weeksAgo.has(start + count)) count++
  return count
}
