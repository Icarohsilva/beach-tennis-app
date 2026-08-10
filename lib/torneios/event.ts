// lib/torneios/event.ts
// Regras puras do evento de torneio (a capa que agrupa vários torneios).
//
// Duas coisas que a página não deve calcular sozinha: como escrever um intervalo
// de datas em português e em que momento da vida o evento está. As duas dependem
// de `ends_on` poder ser nulo (evento de um dia), e errar isso produz "13 de
// agosto a 13 de agosto" ou um evento "encerrado" no meio do sábado.
import { formatDate } from '@/lib/utils/dateHelpers'

export type EventPhase = 'upcoming' | 'running' | 'past'

export interface EventDates {
  starts_on: string
  ends_on: string | null
}

/** O último dia do evento. Sem `ends_on`, é o próprio dia de início. */
export function lastDay(event: EventDates): string {
  return event.ends_on ?? event.starts_on
}

/**
 * Em que momento o evento está.
 *
 * Compara por DIA, não por instante: o evento de sábado é "acontecendo" durante
 * o sábado inteiro, e não passa a "encerrado" à meia-noite e um minuto.
 */
export function eventPhase(event: EventDates, today: string): EventPhase {
  if (today < event.starts_on) return 'upcoming'
  if (today > lastDay(event)) return 'past'
  return 'running'
}

/**
 * O intervalo escrito como se fala.
 *
 * Um dia: "sábado, 22 de agosto".
 * Mesmo mês: "22 a 24 de agosto".
 * Meses diferentes: "30 de agosto a 1 de setembro".
 * Anos diferentes: inclui o ano nas duas pontas.
 */
export function formatEventRange(event: EventDates): string {
  const end = event.ends_on
  if (!end || end === event.starts_on) {
    return formatDate(event.starts_on, "EEEE, dd 'de' MMMM")
  }

  const sameYear = event.starts_on.slice(0, 4) === end.slice(0, 4)
  const sameMonth = sameYear && event.starts_on.slice(0, 7) === end.slice(0, 7)

  if (sameMonth) {
    return `${formatDate(event.starts_on, 'dd')} a ${formatDate(end, "dd 'de' MMMM")}`
  }
  if (sameYear) {
    return `${formatDate(event.starts_on, "dd 'de' MMMM")} a ${formatDate(end, "dd 'de' MMMM")}`
  }
  return `${formatDate(event.starts_on, "dd 'de' MMM 'de' yyyy")} a ${formatDate(end, "dd 'de' MMM 'de' yyyy")}`
}

/** Rótulo curto do estado, para a pastilha da capa. */
export function eventPhaseLabel(phase: EventPhase): string {
  if (phase === 'running') return 'Acontecendo agora'
  if (phase === 'past') return 'Encerrado'
  return 'Em breve'
}

// --- Agrupamento dos torneios do evento -------------------------------------

/** O torneio como a página do evento precisa dele. */
export interface EventTournament {
  id: string
  name: string
  date: string
  sport: string
  category: string
  level: string
  participant_type: 'individual' | 'dupla_fixa' | 'dupla_revezando'
  format: string
  status: 'draft' | 'open' | 'in_progress' | 'finished'
  entry_price_cents: number | null
  max_players: number | null
  occupiedCount: number
}

/**
 * Ordena os torneios do evento pelo que o visitante procura.
 *
 * Primeiro o que ainda aceita inscrição (é a ação da página), depois o que está
 * rolando, e por último o que já acabou. Dentro de cada faixa, por data e nome —
 * "Feminino B" e "Feminino C" ficam lado a lado.
 */
export function sortEventTournaments(items: EventTournament[]): EventTournament[] {
  const rank = (t: EventTournament) =>
    t.status === 'open' ? 0 : t.status === 'in_progress' ? 1 : 2
  return items
    .slice()
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        a.date.localeCompare(b.date) ||
        a.name.localeCompare(b.name, 'pt-BR'),
    )
}

export interface EventSummary {
  total: number
  open: number
  /** Inscritos somados em todos os torneios do evento. */
  entrants: number
  /** Modalidades distintas disputadas. */
  sports: number
}

export function summarizeEvent(items: EventTournament[]): EventSummary {
  return {
    total: items.length,
    open: items.filter((t) => t.status === 'open').length,
    entrants: items.reduce((sum, t) => sum + Math.max(0, t.occupiedCount), 0),
    sports: new Set(items.map((t) => t.sport).filter(Boolean)).size,
  }
}
