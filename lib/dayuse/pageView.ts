// lib/dayuse/pageView.ts
// O que a página de day use (/dayuse/[slug]) mostra de cada data. Puro.
//
// A página agrupa as datas de um mesmo day use (dayuse_pages). Cada data segue
// reservando pela página dela (/d/[id]) — aqui só se decide a ordem, o
// agrupamento por dia e o que o card diz antes do clique: "3 vagas" e "Lotado"
// são a diferença entre a pessoa clicar e não clicar.
import { sessionStartIso } from '@/lib/utils/sessionTime'

export interface PageSlotInput {
  id: string
  date: string
  /** HH:MM ou HH:MM:SS. */
  start_time: string
  end_time: string
  capacity: number
  /** Reservas que ocupam vaga (confirmadas + pendentes no prazo). */
  occupied: number
}

export interface PageSlotView<T extends PageSlotInput> {
  slot: T
  left: number
  full: boolean
  /** "3 vagas", "Última vaga", "Lotado". */
  vacancyLabel: string
}

export interface PageDateGroup<T extends PageSlotInput> {
  date: string
  items: PageSlotView<T>[]
}

function normalizeTime(t: string): string {
  return t.length === 5 ? `${t}:00` : t
}

export function vacancyLabel(left: number): string {
  if (left <= 0) return 'Lotado'
  return left === 1 ? 'Última vaga' : `${left} vagas`
}

/**
 * Datas por dia, na ordem do calendário. Data que já TERMINOU sai (a página é
 * divulgada semanas a fio, e "encerrado" no topo empurra a próxima data para
 * baixo); a que está acontecendo fica, porque day use livre no período ainda
 * recebe gente.
 */
export function groupPageSlots<T extends PageSlotInput>(slots: T[], now: Date): PageDateGroup<T>[] {
  const upcoming = slots
    .filter((s) => new Date(sessionStartIso(s.date, normalizeTime(s.end_time))) > now)
    .sort((a, b) => (a.date + a.start_time).localeCompare(b.date + b.start_time))

  const groups: PageDateGroup<T>[] = []
  for (const slot of upcoming) {
    const left = Math.max(0, slot.capacity - slot.occupied)
    const view = { slot, left, full: left === 0, vacancyLabel: vacancyLabel(left) }
    const last = groups[groups.length - 1]
    if (last && last.date === slot.date) last.items.push(view)
    else groups.push({ date: slot.date, items: [view] })
  }
  return groups
}
