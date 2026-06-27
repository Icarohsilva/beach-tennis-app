// lib/torneios/formats.ts
import type { FormatEngine } from './types'
import { generateAmericanoSchedule } from './schedule/americano'
import { computeStandings } from './standings'

// Mapa format -> motor. Formatos futuros (round_robin, eliminatoria, ranking)
// entram aqui sem tocar nas actions.
export const FORMATS: Record<string, FormatEngine> = {
  americano: {
    label: 'Americano (Super N)',
    generate: generateAmericanoSchedule,
    computeStandings,
  },
}
