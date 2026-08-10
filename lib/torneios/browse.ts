// lib/torneios/browse.ts
// Regras puras da vitrine de torneios: busca, filtro, vagas e agrupamento.
//
// Tudo aqui é função de dados para dados — sem Supabase, sem React — para que a
// ordenação e o corte das seções tenham teste. A página só desenha o que estas
// funções decidem.
import type { StudentLevel, TournamentCategory, TournamentFormat, TournamentStatus } from '@/types'
import { LEVEL_ORDER, isKnownSport, levelLabel, sportChip } from './sportProfile'

/** O torneio como a vitrine precisa dele: linha do banco + números derivados. */
export interface BrowseTournament {
  id: string
  name: string
  date: string // 'YYYY-MM-DD'
  sport: string
  status: TournamentStatus
  level: StudentLevel
  category: TournamentCategory
  participant_type: 'individual' | 'dupla_fixa' | 'dupla_revezando'
  format: TournamentFormat
  cover_image_url: string | null
  entry_price_cents: number | null
  max_players: number | null
  /** Inscritos confirmados (não conta lista de espera). */
  occupiedCount: number
  /** Quantos aguardam vaga. */
  waitlistCount: number
  /** O aluno logado está inscrito (como titular ou parceiro). */
  isMine: boolean
}

// --- Vagas ------------------------------------------------------------------

export interface Spots {
  taken: number
  total: number | null
  /** null quando o torneio não tem teto declarado. */
  remaining: number | null
  /** 0–100. Sem teto, mede nada e vem 0. */
  pct: number
  isFull: boolean
  /** Sobrou pouco: acende o aviso de urgência no card. */
  isLastCall: boolean
}

/** Abaixo disto o card passa a avisar que está acabando. */
export const LAST_CALL_THRESHOLD = 3

export function spotsOf(t: Pick<BrowseTournament, 'occupiedCount' | 'max_players'>): Spots {
  const taken = Math.max(0, t.occupiedCount)
  const total = t.max_players && t.max_players > 0 ? t.max_players : null
  if (total === null) {
    return { taken, total: null, remaining: null, pct: 0, isFull: false, isLastCall: false }
  }
  const remaining = Math.max(0, total - taken)
  return {
    taken,
    total,
    remaining,
    pct: Math.min(100, Math.round((taken / total) * 100)),
    isFull: remaining === 0,
    isLastCall: remaining > 0 && remaining <= LAST_CALL_THRESHOLD,
  }
}

// --- Busca ------------------------------------------------------------------

/** Minúsculas e sem acento, para "Verao" achar "Verão". */
export function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

/** Casa o termo contra nome do torneio e nome da modalidade. */
export function matchesQuery(t: BrowseTournament, query: string): boolean {
  const q = normalizeText(query)
  if (!q) return true
  const haystack = normalizeText(`${t.name} ${sportChip(t.sport).label}`)
  // Termos separados por espaço somam (busca "beach verao" acha "Verão · Beach Tennis").
  return q.split(/\s+/).every((term) => haystack.includes(term))
}

// --- Filtros ----------------------------------------------------------------

export interface BrowseFilters {
  q?: string
  sport?: string
  level?: string
  /** 'todos' | 'live' | 'open' | 'past' | 'meus' */
  phase?: string
}

export function filterTournaments(
  items: BrowseTournament[],
  filters: BrowseFilters,
  today: string,
): BrowseTournament[] {
  return items.filter((t) => {
    if (filters.sport && t.sport !== filters.sport) return false
    if (filters.level && t.level !== filters.level) return false
    if (filters.q && !matchesQuery(t, filters.q)) return false
    const phase = filters.phase
    if (phase && phase !== 'todos') {
      if (phase === 'meus') return t.isMine
      if (phaseOf(t, today) !== phase) return false
    }
    return true
  })
}

// --- Fases ------------------------------------------------------------------

export type Phase = 'live' | 'open' | 'past'

/**
 * Em que momento da vida o torneio está.
 *
 * `status` sozinho não basta: torneio que ficou 'open' e cuja data já passou não
 * está com inscrição aberta coisa nenhuma — o admin só não encerrou. Ele desce
 * para "já aconteceram" em vez de ocupar o topo da lista de abertos, mas não é
 * chamado de "encerrado", porque formalmente não foi.
 */
export function phaseOf(
  t: Pick<BrowseTournament, 'status' | 'date'>,
  today: string,
): Phase {
  if (t.status === 'in_progress') return 'live'
  if (t.status === 'finished') return 'past'
  return t.date >= today ? 'open' : 'past'
}

export interface PhaseSection {
  phase: Phase
  items: BrowseTournament[]
}

/**
 * Agrupa e ordena.
 *
 * A ordem muda por seção porque a pergunta do aluno muda: no que está por vir
 * ele quer o mais próximo primeiro; no que já passou, o mais recente. A lista
 * antiga ordenava tudo por data crescente, então torneio de 2024 encerrado
 * aparecia acima do da semana que vem.
 */
export function groupByPhase(items: BrowseTournament[], today: string): PhaseSection[] {
  const buckets: Record<Phase, BrowseTournament[]> = { live: [], open: [], past: [] }
  for (const t of items) buckets[phaseOf(t, today)].push(t)

  const byDateAsc = (a: BrowseTournament, b: BrowseTournament) =>
    a.date.localeCompare(b.date) || a.name.localeCompare(b.name, 'pt-BR')
  const byDateDesc = (a: BrowseTournament, b: BrowseTournament) =>
    b.date.localeCompare(a.date) || a.name.localeCompare(b.name, 'pt-BR')

  buckets.live.sort(byDateAsc)
  buckets.open.sort(byDateAsc)
  buckets.past.sort(byDateDesc)

  return (['live', 'open', 'past'] as Phase[])
    .map((phase) => ({ phase, items: buckets[phase] }))
    .filter((s) => s.items.length > 0)
}

// --- Facetas ----------------------------------------------------------------

export interface Facet {
  value: string
  label: string
  count: number
}

/**
 * Modalidades que realmente têm torneio, com quantos.
 *
 * A aba nasce do dado, não de uma lista fixa: academia só de padel não ganha
 * aba de beach tennis vazia, e academia que amanhã criar torneio de futevôlei
 * ganha a aba sozinha, sem deploy.
 */
export function sportFacets(items: BrowseTournament[]): Facet[] {
  const counts = new Map<string, number>()
  for (const t of items) {
    if (!t.sport || !isKnownSport(t.sport)) continue
    counts.set(t.sport, (counts.get(t.sport) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .map(([value, count]) => ({ value, label: sportChip(value).label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'pt-BR'))
}

/**
 * Níveis presentes no recorte atual, do mais aberto ao mais forte. O rótulo sai
 * do esporte filtrado — "Nível B" numa academia de raquete, "Avançado" numa de
 * crossfit.
 */
export function levelFacets(items: BrowseTournament[], sport?: string): Facet[] {
  const counts = new Map<StudentLevel, number>()
  for (const t of items) {
    if (!t.level) continue
    counts.set(t.level, (counts.get(t.level) ?? 0) + 1)
  }
  return LEVEL_ORDER.filter((lvl) => counts.has(lvl)).map((lvl) => ({
    value: lvl,
    label: levelLabel(lvl, sport ?? null),
    count: counts.get(lvl) ?? 0,
  }))
}

/** Contagem por fase, para os chips de estado mostrarem número. */
export function phaseCounts(
  items: BrowseTournament[],
  today: string,
): Record<Phase | 'meus' | 'todos', number> {
  const out = { live: 0, open: 0, past: 0, meus: 0, todos: items.length }
  for (const t of items) {
    out[phaseOf(t, today)]++
    if (t.isMine) out.meus++
  }
  return out
}

// --- Resumo do topo ---------------------------------------------------------

export interface BrowseSummary {
  live: number
  open: number
  mine: number
  /** Vagas ainda abertas somando os torneios com inscrição aberta e teto. */
  openSpots: number
  /** Modalidades distintas com torneio. */
  sports: number
}

export function summarize(items: BrowseTournament[], today: string): BrowseSummary {
  let live = 0
  let open = 0
  let mine = 0
  let openSpots = 0
  for (const t of items) {
    const phase = phaseOf(t, today)
    if (phase === 'live') live++
    if (phase === 'open') {
      open++
      openSpots += spotsOf(t).remaining ?? 0
    }
    if (t.isMine && phase !== 'past') mine++
  }
  return { live, open, mine, openSpots, sports: sportFacets(items).length }
}

// --- Preço ------------------------------------------------------------------

/** Centavos em "R$ 40" / "R$ 39,90". Sem preço (ou zero) é torneio gratuito. */
export function priceLabel(cents: number | null | undefined): string {
  if (!cents || cents <= 0) return 'Gratuito'
  const value = cents / 100
  return value.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
  })
}
