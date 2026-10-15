// lib/torneios/formats.ts
import type { FormatEngine } from './types'
import { generateAmericanoSchedule } from './schedule/americano'
import { generateMixedAmericanoSchedule } from './schedule/americanoMixed'
import { generateRoundRobinSchedule } from './schedule/roundRobin'
import { computeEliminationStandings, generateEliminationBracket } from './schedule/eliminatoria'
import { computeGroupsStandings, generateGroupStage } from './schedule/grupos'
import { computeStandings } from './standings'

// Mapa format -> motor. As actions não sabem de formato nenhum: pedem o motor
// por chave e chamam generate/computeStandings.
export const FORMATS: Record<string, FormatEngine> = {
  americano: {
    label: 'Super (Super 8, Super 12...)',
    // O americano sorteia parceiro a cada rodada, então só os jogadores importam.
    // Com "sem dupla masculina" o círculo não serve (ele junta todo mundo com
    // todo mundo) e o sorteio passa a ser por busca, rodada a rodada.
    generate: (entries, options) =>
      options?.noMalePairs
        ? generateMixedAmericanoSchedule(
            entries.map((e) => ({ id: e.playerId, gender: options.genders?.[e.playerId] ?? null })),
          )
        : generateAmericanoSchedule(entries.map((e) => e.playerId)),
    computeStandings,
  },
  round_robin: {
    label: 'Todos contra todos',
    generate: generateRoundRobinSchedule,
    computeStandings,
  },
  eliminatoria: {
    label: 'Eliminatória (mata-mata)',
    generate: generateEliminationBracket,
    // Chave se classifica por fase alcançada, não por saldo de games.
    computeStandings: computeEliminationStandings,
  },
  grupos: {
    label: 'Grupos + mata-mata',
    // Só a fase de grupos nasce aqui: quem passa depende do resultado, e o
    // mata-mata é semeado por seedKnockoutFromGroups quando os grupos acabam.
    generate: (entries, options) => generateGroupStage(entries, options?.groupCount ?? DEFAULT_GROUP_COUNT),
    computeStandings: computeGroupsStandings,
  },
}

/** Quantos grupos quando a academia não escolheu. */
export const DEFAULT_GROUP_COUNT = 2
/** Quantos passam de cada grupo quando a academia não escolheu. */
export const DEFAULT_ADVANCE_PER_GROUP = 2

/** Formatos cuja última fase é mata-mata — afeta rótulo de fase e avanço. */
export function isBracketFormat(format: string | null | undefined): boolean {
  return format === 'eliminatoria' || format === 'grupos'
}

/** Formatos com primeira fase de grupos. */
export function hasGroupStage(format: string | null | undefined): boolean {
  return format === 'grupos'
}

/**
 * A tabela de classificação aparece para quem?
 *
 * No Super (americano) o parceiro muda a cada rodada e a ordem só se decide no
 * fim: com a tabela à vista no meio do torneio, quem estava atrás desistia e
 * quem estava na frente "administrava" o placar. A arena pediu que ali a
 * classificação seja só do admin enquanto o torneio corre, e de todos depois que
 * ele ENCERRA. O atleta continua vendo os placares e lançando o do próprio jogo.
 * Nos outros formatos a tabela é o próprio caminho do torneio (quem passa de
 * fase) e segue aberta.
 */
export function standingsVisible(input: {
  format: string | null | undefined
  status: string
  isAdmin: boolean
}): boolean {
  if ((input.format ?? 'americano') !== 'americano') return true
  return input.isAdmin || input.status === 'finished'
}
