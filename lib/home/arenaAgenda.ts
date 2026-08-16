// lib/home/arenaAgenda.ts
// A agenda da arena como uma coisa só: aula, torneio e day use no mesmo eixo.
//
// Antes cada um tinha seu bloco na home — "Sua semana" só com aula, "Day Use
// hoje" separado, torneio em outra aba. O aluno que abre o app quer saber o que
// acontece na arena nesta semana, e isso não é três listas: é uma agenda.
//
// Tudo aqui é puro. A data é sempre 'YYYY-MM-DD' manipulada em UTC — usar o
// relógio local faria a virada do mês depender do fuso do processo, e no Brasil
// (UTC-3) o dia 1º viraria dia 30 do mês anterior.

export type ArenaEventKind = 'aula' | 'torneio' | 'dayuse'

export interface ArenaEvent {
  id: string
  kind: ArenaEventKind
  /** 'YYYY-MM-DD' */
  date: string
  /** 'HH:MM:SS'. Nulo em torneio sem horário marcado — o dia é o que importa. */
  start: string | null
  end: string | null
  title: string
  /** Linha de apoio (nível, quadra, formato). */
  subtitle: string | null
  /** Slug da modalidade, quando há. */
  sport: string | null
  /** É do aluno: aula dele, torneio em que se inscreveu, day use reservado. */
  mine: boolean
  /** Para onde o toque leva. Nulo = o item abre no próprio modal (aula). */
  href: string | null
  /**
   * O item foi cancelado pela academia. Continua na agenda, marcado — sumir sem
   * deixar rastro é o que faz o aluno descobrir na quadra.
   */
  cancelled?: boolean
  booked: number | null
  capacity: number | null
}

/** Ordem de exibição dentro de um dia quando o horário empata (ou falta). */
const KIND_ORDER: Record<ArenaEventKind, number> = { aula: 0, dayuse: 1, torneio: 2 }

export const KIND_LABEL: Record<ArenaEventKind, string> = {
  aula: 'Aula',
  torneio: 'Torneio',
  dayuse: 'Day use',
}

/**
 * Ordena a agenda como ela é lida: por dia, depois por hora.
 *
 * Item sem hora vai para o FIM do dia, não para o começo: um torneio marcado
 * só por data não deve empurrar para baixo a aula das 7h que tem hora certa.
 */
export function sortArenaEvents<T extends ArenaEvent>(events: T[]): T[] {
  return events.slice().sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date)
    // '' ordena antes de qualquer hora, então o sem-hora recebe um sentinela alto.
    const sa = a.start ?? '99:99:99'
    const sb = b.start ?? '99:99:99'
    if (sa !== sb) return sa.localeCompare(sb)
    if (a.kind !== b.kind) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
    return a.title.localeCompare(b.title, 'pt-BR')
  })
}

/**
 * Agrupa por dia, já ordenado dentro de cada um.
 *
 * Genérico para o painel do admin poder passar o mesmo evento com os campos a
 * mais dele (link de edição, ocupação) sem perdê-los no tipo de retorno.
 */
export function groupByDate<T extends ArenaEvent>(events: T[]): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const e of sortArenaEvents(events)) {
    const list = out.get(e.date)
    if (list) list.push(e)
    else out.set(e.date, [e])
  }
  return out
}

export interface KindCount {
  aula: number
  torneio: number
  dayuse: number
  /** Quantos são do aluno — é o que pinta o dia de destaque no calendário. */
  mine: number
}

export function countByKind(events: Pick<ArenaEvent, 'kind' | 'mine'>[]): KindCount {
  const out: KindCount = { aula: 0, torneio: 0, dayuse: 0, mine: 0 }
  for (const e of events) {
    out[e.kind] += 1
    if (e.mine) out.mine += 1
  }
  return out
}

// --- Datas -------------------------------------------------------------------

/** Soma dias a 'YYYY-MM-DD' em UTC. */
export function addDays(dateISO: string, days: number): string {
  const [y, m, d] = dateISO.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** Dia da semana, 0 = domingo. */
export function dayOfWeek(dateISO: string): number {
  const [y, m, d] = dateISO.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

/** 'YYYY-MM-DD' → 'YYYY-MM'. */
export function monthOf(dateISO: string): string {
  return dateISO.slice(0, 7)
}

/** Avança (ou volta) meses, sem estourar para dia inválido. */
export function shiftMonth(monthISO: string, delta: number): string {
  const [y, m] = monthISO.split('-').map(Number)
  // Índice absoluto de mês evita o clássico "31 de março - 1 mês = 3 de março".
  const total = y * 12 + (m - 1) + delta
  const year = Math.floor(total / 12)
  const month = total - year * 12 + 1
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`
}

export function daysInMonth(monthISO: string): number {
  const [y, m] = monthISO.split('-').map(Number)
  // Dia 0 do mês seguinte = último dia deste.
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

export interface MonthCell {
  date: string
  /** Pertence ao mês exibido (falso nas bordas herdadas do mês vizinho). */
  inMonth: boolean
  isToday: boolean
}

/**
 * A grade do mês em semanas de domingo a sábado.
 *
 * As bordas trazem os dias do mês vizinho em vez de células vazias: a semana que
 * cruza a virada do mês continua legível, e o aluno vê que a aula de segunda
 * existe mesmo que segunda seja dia 31 do mês passado.
 */
export function buildMonthGrid(monthISO: string, todayISO: string): MonthCell[][] {
  const first = `${monthISO}-01`
  const lead = dayOfWeek(first)
  const total = daysInMonth(monthISO)
  const weeks = Math.ceil((lead + total) / 7)
  const start = addDays(first, -lead)

  return Array.from({ length: weeks }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => {
      const date = addDays(start, w * 7 + d)
      return { date, inMonth: monthOf(date) === monthISO, isToday: date === todayISO }
    }),
  )
}

/** Primeiro e último dia que a grade do mês exibe — é a janela a buscar no banco. */
export function gridBounds(monthISO: string): { from: string; to: string } {
  const grid = buildMonthGrid(monthISO, '')
  return { from: grid[0][0].date, to: grid[grid.length - 1][6].date }
}
