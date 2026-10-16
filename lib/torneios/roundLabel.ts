// lib/torneios/roundLabel.ts
import { isBracketFormat } from './formats'
import { roundLabel as bracketRoundLabel } from './bracket'
import { splitPhases } from './schedule/grupos'

/**
 * Nome de cada rodada na lista de confrontos, pela mesma regra das telas do
 * atleta e pública: número na fase de grupos e no Super; FASE no mata-mata,
 * contada a partir de onde os grupos pararam — sem descontar, a final de um
 * torneio com 3 rodadas de grupo sairia como "4ª rodada".
 */
export function roundLabeler(
  format: string | null | undefined,
  matches: { round: number; group_label: string | null }[],
): (round: number, group: string | null) => string {
  const { knockoutMatches, groupRounds } = splitPhases(
    matches.map((m) => ({ round: m.round, group: m.group_label })),
  )
  const knockoutRounds =
    knockoutMatches.length > 0 ? Math.max(...knockoutMatches.map((m) => m.round)) : 0
  const bracket = isBracketFormat(format) && knockoutRounds > 0
  return (round, group) =>
    group || !bracket ? `Rodada ${round}` : bracketRoundLabel(round - groupRounds, knockoutRounds)
}
