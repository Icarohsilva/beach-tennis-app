// lib/torneios/types.ts
// Tipos do núcleo puro de torneios. Não importam nada do banco.
import type { ScoringConfig, StandingRow } from '@/types'

export type { ScoringConfig, StandingRow }

// Uma partida planejada pelo gerador (ainda sem placar).
//
// Os lados são anuláveis por causa da eliminatória: a chave inteira nasce no
// momento em que é gerada — com semifinal e final já existindo — e os
// confrontos das rodadas seguintes só ganham nome quando alguém vence. É isso
// que permite ver o caminho até a final desde o primeiro dia.
export interface MatchPlan {
  p1: string | null
  partner1: string | null
  p2: string | null
  partner2: string | null
  /**
   * Posição da partida dentro da rodada (1-based). Na eliminatória ela É a
   * coordenada da chave — quem vence a (rodada 1, partida 3) sobe para a
   * (rodada 2, partida 2). Formatos sem chave podem omitir: cai no índice.
   */
  matchNo?: number
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
  player1_id: string | null
  partner1_id: string | null
  player2_id: string | null
  partner2_id: string | null
  games1: number
  games2: number
  result_status: 'pending' | 'confirmed' | null
  /** Necessário só onde a classificação depende da fase (eliminatória). */
  round?: number
}

export interface FormatEngine {
  label: string
  /**
   * Recebe as inscrições, não uma lista de ids: em dupla fixa o parceiro faz
   * parte da unidade que entra na chave e se perderia no caminho.
   */
  generate(entries: EntryRef[]): RoundPlan[]
  computeStandings(
    entries: EntryRef[],
    matches: MatchResultInput[],
    config: ScoringConfig,
  ): StandingRow[]
}
