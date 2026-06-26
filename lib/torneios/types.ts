// lib/torneios/types.ts
// Tipos do núcleo puro de torneios. Não importam nada do banco.
import type { ScoringConfig, StandingRow } from '@/types'

export type { ScoringConfig, StandingRow }

// Uma partida planejada pelo gerador (ainda sem placar).
export interface MatchPlan {
  p1: string
  partner1: string | null
  p2: string
  partner2: string | null
}

export interface RoundPlan {
  round: number
  matches: MatchPlan[]
  resting: string[]
}

// Unidade inscrita (player individual; partner usado só em dupla fixa).
export interface EntryRef {
  playerId: string
  partnerId: string | null
}

// Partida com resultado, como entra na classificação.
export interface MatchResultInput {
  player1_id: string
  partner1_id: string | null
  player2_id: string
  partner2_id: string | null
  games1: number
  games2: number
  result_status: 'pending' | 'confirmed' | null
}

export interface FormatEngine {
  label: string
  generate(playerIds: string[]): RoundPlan[]
  computeStandings(
    entries: EntryRef[],
    matches: MatchResultInput[],
    config: ScoringConfig,
  ): StandingRow[]
}
