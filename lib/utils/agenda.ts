// lib/utils/agenda.ts
// Lógica pura da agenda do dashboard: saudação, contagem regressiva, janela da
// semana e nível de ocupação. Sem React e sem I/O, para poder ser testada direto.

export function greetingFor(hour: number): string {
  if (hour < 12) return 'Bom dia'
  if (hour < 18) return 'Boa tarde'
  return 'Boa noite'
}

/**
 * Texto da contagem até a aula. `endMs` permite distinguir "vai começar" de
 * "está acontecendo"; sem ele, qualquer instante após o início é "Já começou".
 */
export function countdownLabel(startMs: number, endMs: number | null, nowMs: number): string {
  if (endMs !== null && nowMs >= startMs && nowMs < endMs) return 'Acontecendo agora'
  if (nowMs >= startMs) return 'Já começou'

  const totalMin = Math.ceil((startMs - nowMs) / 60_000)
  if (totalMin < 1) return 'Começa em instantes'
  if (totalMin < 60) return `Começa em ${totalMin} min`

  const hours = Math.floor(totalMin / 60)
  const minutes = totalMin % 60
  if (hours < 24) return minutes > 0 ? `Faltam ${hours}h ${minutes}min` : `Faltam ${hours}h`

  const days = Math.round(hours / 24)
  return days === 1 ? 'Amanhã' : `Em ${days} dias`
}

/** Soma dias a uma data 'YYYY-MM-DD' sem depender do fuso do processo. */
export function addDaysISO(dateISO: string, days: number): string {
  const [y, m, d] = dateISO.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/**
 * Distribui os itens numa janela de `days` dias a partir de `startISO`. Cada dia
 * sai na lista mesmo sem itens — a faixa da agenda precisa dos dias vazios para
 * manter a semana inteira visível.
 */
export function buildWeekDays<T extends { date: string }>(
  startISO: string,
  days: number,
  items: T[],
): { date: string; items: T[] }[] {
  const window = Array.from({ length: days }, (_, i) => ({
    date: addDaysISO(startISO, i),
    items: [] as T[],
  }))
  const byDate = new Map(window.map((d) => [d.date, d]))

  for (const item of items) {
    byDate.get(item.date)?.items.push(item)
  }

  return window
}

export type OccupancyLevel = 'low' | 'mid' | 'high'

/** Faixa de preenchimento da turma — define o degrau do matiz da marca na barra. */
export function occupancyLevel(booked: number, capacity: number): OccupancyLevel {
  if (capacity <= 0) return 'low'
  const pct = (booked / capacity) * 100
  if (pct >= 75) return 'high'
  if (pct >= 40) return 'mid'
  return 'low'
}
