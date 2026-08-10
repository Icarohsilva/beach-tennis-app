// lib/torneios/schedule/grupos.ts
// Grupos + mata-mata: o formato que o beach tennis brasileiro chama de
// "Super 8/12/24" na versão completa — todos jogam bastante na primeira fase e
// os melhores decidem no mata-mata.
//
// As duas fases dividem a mesma tabela `tournament_matches` e se distinguem por
// `group_label`: preenchido na fase de grupos, nulo no mata-mata. O `round` do
// mata-mata continua a numeração de onde os grupos pararam, então a chave
// precisa descontar esse deslocamento para saber que a "rodada 4" é, na
// verdade, a primeira do mata-mata. `splitPhases` faz essa conta num lugar só.
import type {
  EntryRef,
  MatchPlan,
  MatchResultInput,
  RoundPlan,
  ScoringConfig,
  StandingRow,
} from '../types'
import { circleSchedule } from './roundRobin'
import { computeEliminationStandings, generateEliminationBracket } from './eliminatoria'
import { bracketSize, seedOrder } from '../bracket'
import { computeStandings } from '../standings'

export const MAX_GROUPS = 8
export const MIN_GROUP_SIZE = 2

/** 0 → 'A', 1 → 'B'. Acima de 26 grupos o formato já não faz sentido. */
export function groupLabel(index: number): string {
  return String.fromCharCode(65 + index)
}

/**
 * Distribui em serpentina: 1º→A, 2º→B, 3º→C, e a linha seguinte volta ao
 * contrário (4º→C, 5º→B, 6º→A).
 *
 * Distribuir em blocos ("os 4 primeiros no grupo A") juntaria todos os
 * favoritos num grupo só e faria metade do torneio morrer na primeira fase.
 */
export function distributeIntoGroups<T>(entries: T[], groupCount: number): T[][] {
  const groups: T[][] = Array.from({ length: groupCount }, () => [])
  entries.forEach((entry, i) => {
    const row = Math.floor(i / groupCount)
    const col = i % groupCount
    groups[row % 2 === 0 ? col : groupCount - 1 - col].push(entry)
  })
  return groups
}

/**
 * Fase de grupos: todos contra todos dentro de cada grupo, com os grupos
 * jogando em paralelo — a rodada 1 é a rodada 1 de todo mundo.
 *
 * O mata-mata NÃO nasce aqui: quem passa depende do resultado, e desenhar uma
 * chave inteira de "a definir" durante a fase de grupos não informa nada. Ele é
 * semeado por `generateKnockoutFromGroups` quando os grupos acabam.
 */
export function generateGroupStage(
  entries: EntryRef[],
  groupCount: number,
): RoundPlan[] {
  if (groupCount < 2) throw new Error('A fase de grupos precisa de pelo menos 2 grupos.')
  if (groupCount > MAX_GROUPS) throw new Error(`No máximo ${MAX_GROUPS} grupos.`)
  if (entries.length < groupCount * MIN_GROUP_SIZE) {
    throw new Error(
      `São necessários ao menos ${groupCount * MIN_GROUP_SIZE} inscritos para ${groupCount} grupos.`,
    )
  }

  const groups = distributeIntoGroups(entries, groupCount)
  const perGroup = groups.map((group) => circleSchedule(group))
  const roundCount = Math.max(...perGroup.map((p) => p.length))

  const plan: RoundPlan[] = []
  for (let r = 0; r < roundCount; r++) {
    const matches: MatchPlan[] = []
    const resting: string[] = []

    perGroup.forEach((groupPlan, groupIndex) => {
      // Grupo menor acaba antes e simplesmente não tem partida nesta rodada.
      const roundPlan = groupPlan[r]
      if (!roundPlan) return
      for (const match of roundPlan.matches) {
        // match_no é único dentro da rodada INTEIRA, não dentro do grupo: é ele
        // que forma a coordenada única no banco.
        matches.push({ ...match, group: groupLabel(groupIndex), matchNo: matches.length + 1 })
      }
      resting.push(...roundPlan.resting)
    })

    plan.push({ round: r + 1, matches, resting })
  }

  return plan
}

// --- Tabelas de grupo --------------------------------------------------------

export interface GroupTable {
  label: string
  entries: EntryRef[]
  rows: StandingRow[]
}

/**
 * Classificação de UM grupo: vitórias primeiro, saldo de games como desempate.
 *
 * O americano ordena por saldo de games, e faz sentido lá: todo mundo joga com
 * todo mundo trocando de parceiro, e a vitória isolada diz pouco. Numa fase de
 * grupos a conta é outra — a tabela decide quem passa, e quem venceu dois jogos
 * não pode ficar atrás de quem venceu um e perdeu apertado. Por isso o critério
 * é próprio daqui, e `computeStandings` segue intocado para o americano.
 */
export function computeGroupStandings(
  entries: EntryRef[],
  matches: MatchResultInput[],
  config: ScoringConfig,
): StandingRow[] {
  return computeStandings(entries, matches, config)
    .slice()
    .sort(
      (a, b) =>
        b.wins - a.wins ||
        b.diff - a.diff ||
        b.gamesFor - a.gamesFor ||
        a.playerId.localeCompare(b.playerId),
    )
}

/** Tabela de cada grupo, já ordenada pelo critério da fase de grupos. */
export function computeGroupTables(
  entries: EntryRef[],
  matches: MatchResultInput[],
  groupCount: number,
  config: ScoringConfig,
): GroupTable[] {
  const groups = distributeIntoGroups(entries, groupCount)
  return groups.map((groupEntries, index) => {
    const label = groupLabel(index)
    const groupMatches = matches.filter((m) => m.group === label)
    return {
      label,
      entries: groupEntries,
      rows: computeGroupStandings(groupEntries, groupMatches, config),
    }
  })
}

/** Ficou faltando jogo em algum grupo? Então o mata-mata ainda não pode sair. */
export function isGroupStageComplete(matches: MatchResultInput[]): boolean {
  const groupMatches = matches.filter((m) => !!m.group)
  return groupMatches.length > 0 && groupMatches.every((m) => m.result_status === 'confirmed')
}

/**
 * Os classificados, na ordem em que entram na chave.
 *
 * A ordem não é decorativa: o chaveamento opõe o seed 1 ao último, o 2 ao
 * penúltimo. Pondo os líderes de grupo no topo e os vices embaixo, cada 1º
 * estreia contra um 2º de OUTRO grupo — quem se enfrentou na primeira fase não
 * se reencontra logo na estreia.
 *
 * Só que isso sozinho não basta. Quando o número de classificados não enche a
 * chave (3 grupos × 2 = 6 numa chave de 8), os byes deslocam os pares e o 1º e
 * o 2º do mesmo grupo podem cair um contra o outro na estreia — jogo que
 * acabou de acontecer na fase de grupos. Por isso cada faixa de colocação é
 * ROTACIONADA até não sobrar confronto interno: com 3 grupos os vices entram
 * como B-C-A, com 4 como C-D-A-B. A rotação é escolhida por busca porque a
 * fórmula fechada depende de tamanho da chave, número de grupos e quantidade
 * de byes ao mesmo tempo.
 */
export function rankQualifiers(tables: GroupTable[], advancePerGroup: number): EntryRef[] {
  const groupCount = tables.length
  if (groupCount === 0) return []

  const byEntryId = new Map<string, EntryRef>()
  const groupOfEntry = new Map<string, string>()
  for (const table of tables) {
    for (const entry of table.entries) {
      byEntryId.set(entry.playerId, entry)
      groupOfEntry.set(entry.playerId, table.label)
    }
  }

  // tiers[posição][grupo] = quem terminou naquela posição naquele grupo.
  const tiers: (EntryRef | null)[][] = []
  for (let position = 0; position < advancePerGroup; position++) {
    tiers.push(
      tables.map((table) => {
        // A linha é do jogador; em dupla fixa o parceiro entra pela inscrição,
        // então só os titulares contam para a colocação.
        const row = table.rows.filter((r) => byEntryId.has(r.playerId))[position]
        return row ? byEntryId.get(row.playerId) ?? null : null
      }),
    )
  }

  const total = tiers.flat().filter((e): e is EntryRef => !!e).length
  if (total < 2) return []

  // Quem enfrenta quem na estreia, por número de seed.
  const size = bracketSize(total)
  const order = seedOrder(size)
  const opponentOf = new Map<number, number>()
  for (let k = 0; k * 2 + 1 < size; k++) {
    opponentOf.set(order[k * 2], order[k * 2 + 1])
    opponentOf.set(order[k * 2 + 1], order[k * 2])
  }

  const placed: EntryRef[] = []
  const groupAtSeed = new Map<number, string>()

  const clashesAt = (tier: (EntryRef | null)[], rotation: number): boolean => {
    const tentative = new Map(groupAtSeed)
    // Conta o seed do mesmo jeito que a colocação real: grupo sem classificado
    // nessa posição não consome seed nenhum.
    let seed = placed.length
    // Coloca a faixa inteira antes de conferir: dois da mesma faixa também
    // podem cair um contra o outro.
    tier.forEach((_, j) => {
      const entry = tier[(j + rotation) % groupCount]
      if (!entry) return
      seed++
      tentative.set(seed, groupOfEntry.get(entry.playerId) ?? '')
    })
    for (const [seed, group] of Array.from(tentative)) {
      const rival = opponentOf.get(seed)
      if (rival && tentative.get(rival) === group) return true
    }
    return false
  }

  tiers.forEach((tier, index) => {
    let rotation = 0
    if (index > 0) {
      // A faixa dos líderes fica onde está: seed alto é mérito da primeira fase.
      for (let r = 0; r < groupCount; r++) {
        if (!clashesAt(tier, r)) {
          rotation = r
          break
        }
      }
    }
    tier.forEach((_, j) => {
      const entry = tier[(j + rotation) % groupCount]
      if (!entry) return
      placed.push(entry)
      groupAtSeed.set(placed.length, groupOfEntry.get(entry.playerId) ?? '')
    })
  })

  return placed
}

/**
 * Mata-mata a partir das tabelas de grupo, já deslocado para depois das rodadas
 * da primeira fase (senão as duas fases colidiriam na coordenada do banco).
 */
export function generateKnockoutFromGroups(
  tables: GroupTable[],
  advancePerGroup: number,
  groupRounds: number,
): RoundPlan[] {
  const qualifiers = rankQualifiers(tables, advancePerGroup)
  if (qualifiers.length < 2) return []
  return generateEliminationBracket(qualifiers).map((rp) => ({
    ...rp,
    round: rp.round + groupRounds,
    matches: rp.matches.map((m) => ({ ...m, group: null })),
  }))
}

// --- Leitura das duas fases --------------------------------------------------

export interface PhaseSplit<T> {
  groupMatches: T[]
  /** Partidas de mata-mata com `round` já renumerado a partir de 1. */
  knockoutMatches: T[]
  /** Quantas rodadas a fase de grupos ocupou — o deslocamento aplicado. */
  groupRounds: number
}

/**
 * Separa as duas fases e devolve o mata-mata com a numeração própria.
 *
 * A chave desenha "Semifinal" e "Final" a partir da distância até a última
 * rodada; sem descontar o deslocamento dos grupos, uma chave de 4 que começa na
 * rodada 4 seria lida como um mata-mata de 5 fases.
 */
export function splitPhases<T extends { round: number; group?: string | null }>(
  matches: T[],
): PhaseSplit<T> {
  const groupMatches = matches.filter((m) => !!m.group)
  const rest = matches.filter((m) => !m.group)
  const groupRounds = groupMatches.length > 0 ? Math.max(...groupMatches.map((m) => m.round)) : 0
  return {
    groupMatches,
    knockoutMatches: rest.map((m) => ({ ...m, round: m.round - groupRounds })),
    groupRounds,
  }
}

// --- Classificação geral -----------------------------------------------------

/**
 * Classificação do torneio inteiro.
 *
 * Quem chegou ao mata-mata é ordenado por até onde foi; quem parou nos grupos
 * vem depois, pela campanha do grupo. Ordenar tudo por saldo poria um vencedor
 * de grupo que caiu na estreia acima do campeão do torneio.
 *
 * Os números (jogos, vitórias, games) somam as duas fases: é a campanha do
 * atleta no torneio, não em uma fase dele.
 */
export function computeGroupsStandings(
  entries: EntryRef[],
  matches: MatchResultInput[],
  config: ScoringConfig,
): StandingRow[] {
  const knockoutMatches = matches.filter((m) => !m.group)
  const groupMatches = matches.filter((m) => !!m.group)

  const combined = computeStandings(entries, matches, config)
  const byId = new Map(combined.map((r) => [r.playerId, r]))

  const knockoutOrder = computeEliminationStandings(entries, knockoutMatches, config)
  const playedKnockout = new Set(
    knockoutMatches
      .filter((m) => m.result_status === 'confirmed')
      .flatMap((m) => [m.player1_id, m.partner1_id, m.player2_id, m.partner2_id])
      .filter((x): x is string => !!x),
  )

  const top = knockoutOrder
    .filter((r) => playedKnockout.has(r.playerId))
    .map((r) => byId.get(r.playerId))
    .filter((r): r is StandingRow => !!r)

  const placed = new Set(top.map((r) => r.playerId))
  const rest = computeStandings(entries, groupMatches, config)
    .filter((r) => !placed.has(r.playerId))
    .map((r) => byId.get(r.playerId))
    .filter((r): r is StandingRow => !!r)

  return [...top, ...rest]
}
