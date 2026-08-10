// lib/torneios/playerStats.ts
// O retrospecto de um atleta nos torneios da academia.
//
// É o que os aplicativos de torneio chamam de H2H e painel de desempenho: com
// quantos jogou, contra quem costuma perder, com quem rende mais. A informação
// já existe em `tournament_matches` desde o primeiro torneio — só nunca tinha
// sido somada.
//
// Puro: recebe as partidas já resolvidas e devolve números. Quem busca no banco
// é features/torneios/playerStatsQueries.ts.

/** Uma partida confirmada, do ponto de vista de quem joga. */
export interface PlayerMatch {
  id: string
  tournamentId: string
  tournamentName: string
  date: string
  /** Ids do lado 1 (titular + parceiro, quando houver). */
  side1: string[]
  side2: string[]
  games1: number
  games2: number
}

export interface PlayerRecord {
  played: number
  wins: number
  losses: number
  /** 0–100, arredondado. Sem jogo nenhum é 0, não NaN. */
  winRate: number
  gamesFor: number
  gamesAgainst: number
  diff: number
}

const EMPTY_RECORD: PlayerRecord = {
  played: 0, wins: 0, losses: 0, winRate: 0, gamesFor: 0, gamesAgainst: 0, diff: 0,
}

/** Em que lado o atleta estava. null = não jogou esta partida. */
export function sideOf(playerId: string, match: PlayerMatch): 1 | 2 | null {
  if (match.side1.includes(playerId)) return 1
  if (match.side2.includes(playerId)) return 2
  return null
}

/** Ganhou? null quando não jogou ou quando a partida empatou. */
export function wonBy(playerId: string, match: PlayerMatch): boolean | null {
  const side = sideOf(playerId, match)
  if (side === null) return null
  if (match.games1 === match.games2) return null
  const mine = side === 1 ? match.games1 : match.games2
  const theirs = side === 1 ? match.games2 : match.games1
  return mine > theirs
}

export function computeRecord(playerId: string, matches: PlayerMatch[]): PlayerRecord {
  const record = { ...EMPTY_RECORD }
  for (const match of matches) {
    const side = sideOf(playerId, match)
    if (side === null) continue
    const mine = side === 1 ? match.games1 : match.games2
    const theirs = side === 1 ? match.games2 : match.games1

    record.played++
    record.gamesFor += mine
    record.gamesAgainst += theirs
    if (mine > theirs) record.wins++
    else if (theirs > mine) record.losses++
  }
  record.diff = record.gamesFor - record.gamesAgainst
  // Empate não conta como vitória nem derrota, mas contou jogo: o aproveitamento
  // sai sobre os jogos disputados, não sobre vitórias + derrotas.
  record.winRate = record.played > 0 ? Math.round((record.wins / record.played) * 100) : 0
  return record
}

// --- Confronto direto --------------------------------------------------------

export interface HeadToHead {
  opponentId: string
  played: number
  wins: number
  losses: number
}

/**
 * Retrospecto contra cada adversário, do mais enfrentado ao menos.
 *
 * Em dupla, TODOS do outro lado contam como adversário daquele jogo: é assim
 * que o aluno lê ("já joguei 4 vezes contra o Bruno"), mesmo que o parceiro
 * dele tenha mudado.
 */
export function headToHead(playerId: string, matches: PlayerMatch[]): HeadToHead[] {
  const byOpponent = new Map<string, HeadToHead>()

  for (const match of matches) {
    const side = sideOf(playerId, match)
    if (side === null) continue
    const won = wonBy(playerId, match)
    const opponents = side === 1 ? match.side2 : match.side1

    for (const opponentId of opponents) {
      if (opponentId === playerId) continue
      let entry = byOpponent.get(opponentId)
      if (!entry) {
        entry = { opponentId, played: 0, wins: 0, losses: 0 }
        byOpponent.set(opponentId, entry)
      }
      entry.played++
      if (won === true) entry.wins++
      else if (won === false) entry.losses++
    }
  }

  return Array.from(byOpponent.values()).sort(
    (a, b) => b.played - a.played || b.wins - a.wins || a.opponentId.localeCompare(b.opponentId),
  )
}

/** O confronto direto com UM adversário. Nunca é null: sem jogos vem zerado. */
export function headToHeadWith(
  playerId: string,
  opponentId: string,
  matches: PlayerMatch[],
): HeadToHead {
  return (
    headToHead(playerId, matches).find((h) => h.opponentId === opponentId) ?? {
      opponentId, played: 0, wins: 0, losses: 0,
    }
  )
}

// --- Parceria ----------------------------------------------------------------

export interface PartnerRecord {
  partnerId: string
  played: number
  wins: number
  winRate: number
}

/**
 * Com quem o atleta rende mais.
 *
 * Ordena por aproveitamento, mas exige um mínimo de jogos: uma dupla que jogou
 * uma vez e ganhou apareceria com 100% e encabeçaria a lista para sempre.
 */
export function partnerRecords(
  playerId: string,
  matches: PlayerMatch[],
  minMatches = 2,
): PartnerRecord[] {
  const byPartner = new Map<string, { played: number; wins: number }>()

  for (const match of matches) {
    const side = sideOf(playerId, match)
    if (side === null) continue
    const mates = (side === 1 ? match.side1 : match.side2).filter((id) => id !== playerId)
    const won = wonBy(playerId, match) === true

    for (const partnerId of mates) {
      const entry = byPartner.get(partnerId) ?? { played: 0, wins: 0 }
      entry.played++
      if (won) entry.wins++
      byPartner.set(partnerId, entry)
    }
  }

  return Array.from(byPartner.entries())
    .filter(([, v]) => v.played >= minMatches)
    .map(([partnerId, v]) => ({
      partnerId,
      played: v.played,
      wins: v.wins,
      winRate: Math.round((v.wins / v.played) * 100),
    }))
    .sort((a, b) => b.winRate - a.winRate || b.played - a.played || a.partnerId.localeCompare(b.partnerId))
}

// --- Forma -------------------------------------------------------------------

export type FormResult = 'V' | 'D' | 'E'

/**
 * Os últimos resultados, do mais recente para o mais antigo.
 *
 * A ordem de chegada é a cronológica; inverter aqui evita que cada tela que
 * mostra a forma tenha que lembrar disso.
 */
export function recentForm(
  playerId: string,
  matches: PlayerMatch[],
  limit = 5,
): FormResult[] {
  const played = matches.filter((m) => sideOf(playerId, m) !== null)
  return played
    .slice(-limit)
    .reverse()
    .map((m) => {
      const won = wonBy(playerId, m)
      return won === null ? 'E' : won ? 'V' : 'D'
    })
}

export interface Streak {
  kind: 'win' | 'loss' | 'none'
  count: number
}

/** Sequência atual de vitórias ou derrotas, contando do jogo mais recente. */
export function currentStreak(playerId: string, matches: PlayerMatch[]): Streak {
  const played = matches.filter((m) => sideOf(playerId, m) !== null)
  let kind: 'win' | 'loss' | 'none' = 'none'
  let count = 0

  for (let i = played.length - 1; i >= 0; i--) {
    const won = wonBy(playerId, played[i])
    if (won === null) break // empate corta a sequência
    const thisKind = won ? 'win' : 'loss'
    if (kind === 'none') {
      kind = thisKind
      count = 1
      continue
    }
    if (thisKind !== kind) break
    count++
  }

  return { kind, count }
}

// --- Troféus -----------------------------------------------------------------

export interface TrophyCount {
  titles: number
  runnerUps: number
  thirds: number
  podiums: number
}

/** Uma colocação de pódio já gravada no fechamento do torneio. */
export interface PodiumFinish {
  tournamentId: string
  position: 1 | 2 | 3
}

export function countTrophies(finishes: PodiumFinish[]): TrophyCount {
  const titles = finishes.filter((f) => f.position === 1).length
  const runnerUps = finishes.filter((f) => f.position === 2).length
  const thirds = finishes.filter((f) => f.position === 3).length
  return { titles, runnerUps, thirds, podiums: titles + runnerUps + thirds }
}
