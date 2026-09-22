// lib/torneios/matchScore.ts
// COMO um placar de partida é válido. Puro, sem I/O.
//
// Existem dois jeitos incompatíveis de contar uma partida, e tratá-los como um
// só era o que impedia o Super de 5 games de existir:
//
//   'set'         — tênis clássico. `games` é o ALVO: ganha quem chega a 6, e a
//                   soma dos dois lados é livre (6x0, 6x4, 7x5...).
//   'fixed_games' — o formato que o beach tennis chama de Super/Americano. A
//                   partida tem um número FIXO de games, todos são jogados, e
//                   vence quem fizer a maioria. A soma é sempre a mesma.
//
// A diferença não é cosmética: em 'fixed_games' toda partida entrega o mesmo
// total de games, e é isso que torna "games ganhos" um critério de desempate
// justo na classificação. Parar a partida em 3x0 num formato de 5 daria a quem
// venceu cedo menos games do que a quem venceu apertado — o oposto do que a
// tabela quer medir.

// O tipo mora em types/index.ts junto do schema (mesmo arranjo de ScoringConfig
// em lib/torneios/types.ts); a REGRA mora aqui.
import type { ScoringMode } from '@/types'

export type { ScoringMode }

export const SCORING_MODES: readonly ScoringMode[] = ['set', 'fixed_games']

/** A regra de placar de um torneio, já lida da configuração dele. */
export interface MatchScoreRule {
  mode: ScoringMode
  /** Em 'fixed_games', o total de games da partida. Em 'set', o alvo do set. */
  games: number
  /** Só faz sentido em 'set' — 'fixed_games' não tem empate para desempatar. */
  tiebreak: boolean
}

/**
 * Lê a regra da configuração do torneio (a linha de `tournaments`).
 *
 * Um lugar só porque servidor e tela precisam da MESMA leitura: a validação que
 * recusa o placar e a dica que ensina a digitá-lo não podem discordar. Torneio
 * anterior à coluna `scoring_mode` cai em 'set', que é o que ele sempre foi.
 */
export function scoreRuleFrom(config: {
  games_per_set?: number | null
  tiebreak_games?: boolean | null
  scoring_mode?: ScoringMode | null
}): MatchScoreRule {
  return {
    mode: config.scoring_mode ?? 'set',
    games: config.games_per_set ?? 6,
    tiebreak: config.tiebreak_games ?? true,
  }
}

/**
 * Quantos games ganham a partida em 'fixed_games': a maioria simples.
 *
 * Com 5 games são 3. É o número que o aluno ouve na quadra ("quem fizer 3
 * leva"), e por isso ele é derivado do total em vez de configurado à parte —
 * dois campos que precisam concordar acabam discordando.
 */
export function gamesToWin(rule: MatchScoreRule): number {
  if (rule.mode !== 'fixed_games') return rule.games
  return Math.floor(rule.games / 2) + 1
}

export interface ScoreValidation {
  ok: boolean
  /** Mensagem pronta para a tela quando `ok` é falso. */
  error?: string
}

/**
 * O placar cabe nesta regra?
 *
 * Em 'fixed_games' a soma é a trava central: `3x1` num formato de 5 não é um
 * placar apertado, é uma partida que não terminou de ser jogada — e aceitá-la
 * corromperia a contagem de games de TODOS os jogadores daquela partida.
 *
 * Em 'set' a validação segue frouxa de propósito: torneio antigo já tem placar
 * gravado com todo tipo de contagem, e apertar a regra agora recusaria a
 * correção de um resultado que já está na tabela.
 */
export function validateMatchScore(
  games1: number,
  games2: number,
  rule: MatchScoreRule,
): ScoreValidation {
  if (!Number.isInteger(games1) || !Number.isInteger(games2) || games1 < 0 || games2 < 0) {
    return { ok: false, error: 'Informe um placar válido (games por lado).' }
  }
  if (rule.mode !== 'fixed_games') return { ok: true }

  const total = games1 + games2
  if (total !== rule.games) {
    return {
      ok: false,
      error:
        `Esta partida tem ${rule.games} games e todos são jogados — a soma dos dois `
        + `lados precisa dar ${rule.games}. Você lançou ${games1} + ${games2} = ${total}.`,
    }
  }
  return { ok: true }
}

/**
 * O outro lado do placar, quando ele é dedutível.
 *
 * Em 'fixed_games' o total é fixo, então digitar um número já define o outro.
 * A tela preenche sozinha: na beira da quadra, com o celular na mão, cada campo
 * a menos é um erro de digitação a menos.
 */
export function completeScore(side: number, rule: MatchScoreRule): number | null {
  if (rule.mode !== 'fixed_games') return null
  if (!Number.isInteger(side) || side < 0 || side > rule.games) return null
  return rule.games - side
}

/** Frase que o admin e o jogador leem antes de digitar o placar. */
export function scoreHint(rule: MatchScoreRule): string {
  if (rule.mode !== 'fixed_games') {
    return `Set até ${rule.games} games${rule.tiebreak ? ', com tiebreak' : ', sem tiebreak'}.`
  }
  return (
    `Os ${rule.games} games são jogados até o fim. Vence quem fizer ${gamesToWin(rule)}, `
    + 'e os games do perdedor continuam valendo na classificação.'
  )
}

/** Rótulo curto do formato de placar, para o cabeçalho do torneio. */
export function scoringLabel(rule: MatchScoreRule): string {
  if (rule.mode !== 'fixed_games') {
    return `${rule.games} games por set${rule.tiebreak ? ' com tiebreak' : ''}`
  }
  return `${rule.games} games corridos · vence com ${gamesToWin(rule)}`
}
