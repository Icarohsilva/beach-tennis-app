// lib/torneios/formats.ts
import type { FormatEngine } from './types'
import { generateAmericanoSchedule } from './schedule/americano'
import { generateRoundRobinSchedule } from './schedule/roundRobin'
import { computeEliminationStandings, generateEliminationBracket } from './schedule/eliminatoria'
import { computeGroupsStandings, generateGroupStage } from './schedule/grupos'
import { computeStandings } from './standings'

// Mapa format -> motor. As actions não sabem de formato nenhum: pedem o motor
// por chave e chamam generate/computeStandings.
export const FORMATS: Record<string, FormatEngine> = {
  americano: {
    label: 'Americano (Super N)',
    // O americano sorteia parceiro a cada rodada, então só os jogadores importam.
    generate: (entries) => generateAmericanoSchedule(entries.map((e) => e.playerId)),
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
