// lib/utils/weekHelpers.ts

/**
 * Retorna início (segunda 00:00 BRT) e fim (domingo 23:59:59.999 BRT) da semana
 * ISO que contém `date`, como objetos Date em UTC.
 * BRT = UTC-3 (não ajusta horário de verão — aceitável para agendamento de torneios).
 */
export function getWeekBounds(date: Date): { start: Date; end: Date } {
  const BRT_OFFSET_MS = 3 * 60 * 60 * 1000 // 3h em ms

  // Converte para BRT subtraindo o offset
  const brtDate = new Date(date.getTime() - BRT_OFFSET_MS)

  // getUTCDay() em brtDate já reflete o dia BRT (0=Dom, 1=Seg, ..., 6=Sáb)
  const dayOfWeek = brtDate.getUTCDay()
  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1

  // Segunda-feira 00:00:00 BRT
  const mondayBRT = new Date(brtDate)
  mondayBRT.setUTCDate(mondayBRT.getUTCDate() - daysFromMonday)
  mondayBRT.setUTCHours(0, 0, 0, 0)

  // Converte de volta para UTC somando o offset
  const start = new Date(mondayBRT.getTime() + BRT_OFFSET_MS)

  // Domingo 23:59:59.999 BRT = start + 7 dias - 1ms
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000 - 1)

  return { start, end }
}
