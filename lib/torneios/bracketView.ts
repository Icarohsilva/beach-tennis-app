// lib/torneios/bracketView.ts
// Transforma as partidas do banco na grade que a chave desenha.
//
// Duas coisas que a UI não deve ter que descobrir sozinha: o nome da fase
// (que depende do tamanho da chave, não do número da rodada) e os buracos
// deixados pelo bye — a partida que não existe porque alguém passou direto.
// Sem preencher esse buraco, a coluna sobe uma linha e a chave sai torta.
import { roundLabel, winnerSlot } from './bracket'

/** Um lado do confronto, já com nome pronto. */
export interface BracketSide {
  label: string
  ids: string[]
  /** Placar deste lado, quando há resultado. */
  games: number | null
  isWinner: boolean
  /** O aluno logado está deste lado. */
  isMine: boolean
}

export interface BracketNode {
  kind: 'match' | 'bye'
  id: string
  round: number
  matchNo: number
  side1: BracketSide
  side2: BracketSide
  status: 'pending' | 'confirmed' | null
  playedAt: string | null
  /** Passagem direta: quem avançou sem jogar. */
  byeLabel?: string
}

export interface BracketColumn {
  round: number
  label: string
  nodes: BracketNode[]
}

/** A partida como sai do banco, já com os nomes resolvidos. */
export interface BracketMatchInput {
  id: string
  round: number
  match_no: number | null
  player1_id: string | null
  partner1_id: string | null
  player2_id: string | null
  partner2_id: string | null
  games1: number | null
  games2: number | null
  result_status: 'pending' | 'confirmed' | null
  played_at: string | null
}

const TBD = 'A definir'

function sideOf(
  ids: (string | null)[],
  games: number | null,
  isWinner: boolean,
  nameById: Record<string, string>,
  currentUserId: string | null,
): BracketSide {
  const real = ids.filter((x): x is string => !!x)
  return {
    label: real.length > 0 ? real.map((id) => nameById[id] ?? 'Jogador').join(' / ') : TBD,
    ids: real,
    games,
    isWinner,
    isMine: !!currentUserId && real.includes(currentUserId),
  }
}

/**
 * Monta as colunas da chave.
 *
 * `totalRounds` vem da maior rodada existente — é o que define se a rodada 2 é
 * semifinal ou oitavas.
 */
export function buildBracketColumns(
  matches: BracketMatchInput[],
  nameById: Record<string, string>,
  currentUserId: string | null,
): BracketColumn[] {
  if (matches.length === 0) return []
  const totalRounds = Math.max(...matches.map((m) => m.round))

  const byRound = new Map<number, BracketMatchInput[]>()
  for (const m of matches) {
    byRound.set(m.round, [...(byRound.get(m.round) ?? []), m])
  }

  // Quem ocupa cada lado da rodada seguinte — usado para nomear o bye.
  const occupantOf = (round: number, matchNo: number, slot: 1 | 2): string[] => {
    const target = (byRound.get(round) ?? []).find((m) => m.match_no === matchNo)
    if (!target) return []
    const ids = slot === 1 ? [target.player1_id, target.partner1_id] : [target.player2_id, target.partner2_id]
    return ids.filter((x): x is string => !!x)
  }

  const columns: BracketColumn[] = []
  for (let round = 1; round <= totalRounds; round++) {
    const inRound = (byRound.get(round) ?? []).slice().sort(
      (a, b) => (a.match_no ?? 0) - (b.match_no ?? 0),
    )

    const nodes: BracketNode[] = []
    // A rodada 1 é a única que perde partidas para o bye; das seguintes a chave
    // nasce completa.
    const expected =
      round === 1 && inRound.length > 0
        ? Math.max(...inRound.map((m) => m.match_no ?? 0))
        : inRound.length
    const present = new Map(inRound.map((m) => [m.match_no ?? 0, m]))

    for (let matchNo = 1; matchNo <= Math.max(expected, inRound.length); matchNo++) {
      const m = present.get(matchNo)
      if (m) {
        const decided = m.result_status === 'confirmed' && m.games1 !== null && m.games2 !== null
        nodes.push({
          kind: 'match',
          id: m.id,
          round,
          matchNo,
          side1: sideOf([m.player1_id, m.partner1_id], m.games1, decided && m.games1! > m.games2!, nameById, currentUserId),
          side2: sideOf([m.player2_id, m.partner2_id], m.games2, decided && m.games2! > m.games1!, nameById, currentUserId),
          status: m.result_status,
          playedAt: m.played_at,
        })
        continue
      }

      // Buraco na rodada 1: alguém passou direto. Quem foi está no lado que
      // esta partida alimentaria.
      const dest = winnerSlot(round, matchNo, totalRounds)
      const ids = dest ? occupantOf(dest.round, dest.matchNo, dest.slot) : []
      if (ids.length === 0) continue
      const label = ids.map((id) => nameById[id] ?? 'Jogador').join(' / ')
      nodes.push({
        kind: 'bye',
        id: `bye-${round}-${matchNo}`,
        round,
        matchNo,
        side1: { label, ids, games: null, isWinner: true, isMine: !!currentUserId && ids.includes(currentUserId) },
        side2: { label: '—', ids: [], games: null, isWinner: false, isMine: false },
        status: null,
        playedAt: null,
        byeLabel: label,
      })
    }

    if (nodes.length > 0) {
      columns.push({ round, label: roundLabel(round, totalRounds), nodes })
    }
  }

  return columns
}

/** O confronto decisivo, para destacar no topo. */
export function findFinal(columns: BracketColumn[]): BracketNode | null {
  const last = columns[columns.length - 1]
  if (!last || last.nodes.length !== 1) return null
  return last.nodes[0]
}
