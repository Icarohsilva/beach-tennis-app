// Puro: datas em BRT e a decisão do cron de auto-geração. Fuso fixo −03:00
// (Brasília sem DST desde 2019, igual lib/utils/sessionTime.ts). Sem I/O.

const BRT_OFFSET_MS = 3 * 60 * 60 * 1000

/** Partes de "parede" em BRT de um instante UTC. */
function brtParts(now: Date): { year: number; month: number; day: number; dow: number; hour: number } {
  const b = new Date(now.getTime() - BRT_OFFSET_MS)
  return {
    year: b.getUTCFullYear(),
    month: b.getUTCMonth(), // 0-11
    day: b.getUTCDate(),
    dow: b.getUTCDay(), // 0=domingo
    hour: b.getUTCHours(),
  }
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** Data de hoje em BRT como yyyy-MM-dd. */
export function brtToday(now: Date): string {
  const p = brtParts(now)
  return `${p.year}-${pad(p.month + 1)}-${pad(p.day)}`
}

/** Soma dias a uma data yyyy-MM-dd (puro, sem fuso — opera em UTC). */
export function addDaysStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const base = new Date(Date.UTC(y, m - 1, d))
  base.setUTCDate(base.getUTCDate() + days)
  return `${base.getUTCFullYear()}-${pad(base.getUTCMonth() + 1)}-${pad(base.getUTCDate())}`
}

/** Primeira data >= fromStr cujo dia-da-semana é dayOfWeek (0=domingo). */
export function nextDateForDayOfWeek(fromStr: string, dayOfWeek: number): string {
  const [y, m, d] = fromStr.split('-').map(Number)
  const from = new Date(Date.UTC(y, m - 1, d))
  const offset = (dayOfWeek - from.getUTCDay() + 7) % 7
  return addDaysStr(fromStr, offset)
}

/**
 * Instante UTC do alvo mais recente (<= now) em que ocorreu targetDay + targetHour
 * no horário de parede BRT.
 */
function mostRecentTargetUtc(targetDay: number, targetHour: number, now: Date): Date {
  const p = brtParts(now)
  // Instante BRT-de-parede de hoje na hora-alvo, expresso em UTC.
  let target = new Date(Date.UTC(p.year, p.month, p.day, targetHour, 0, 0) + BRT_OFFSET_MS)
  // Recua até bater o dia-da-semana e não passar de `now`.
  const targetDow = new Date(target.getTime() - BRT_OFFSET_MS).getUTCDay()
  let back = (targetDow - targetDay + 7) % 7
  target = new Date(target.getTime() - back * 24 * 60 * 60 * 1000)
  if (target.getTime() > now.getTime()) {
    target = new Date(target.getTime() - 7 * 24 * 60 * 60 * 1000)
  }
  return target
}

/**
 * Decide se a auto-geração deve rodar agora para uma academia.
 * Roda quando `now` já passou do alvo mais recente E a marca d'água (última
 * execução) é anterior a esse alvo. Assim, se o cron perdeu a hora exata, a
 * próxima execução ainda pega o alvo pendente (catch-up).
 */
export function shouldRunGridNow(
  targetDay: number,
  targetHour: number,
  lastRunIso: string | null,
  now: Date,
): boolean {
  const target = mostRecentTargetUtc(targetDay, targetHour, now)
  if (now.getTime() < target.getTime()) return false
  if (!lastRunIso) return true
  return new Date(lastRunIso).getTime() < target.getTime()
}
