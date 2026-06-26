// lib/torneios/eligibility.ts
import type { Gender, TournamentCategory } from '@/types'

export interface EligibilityMatch {
  player1_id: string
  partner1_id: string | null
  player2_id: string
  partner2_id: string | null
  reported_by: string | null
}

export function canRegister(
  playerGender: Gender | null,
  category: TournamentCategory,
): { ok: boolean; reason?: string } {
  if (category === 'misto' || category === 'livre') return { ok: true }

  const required: Gender = category === 'masculino' ? 'M' : 'F'
  if (playerGender === null) {
    return {
      ok: false,
      reason: 'Complete seu gênero no perfil para se inscrever nesta categoria.',
    }
  }
  if (playerGender !== required) {
    return {
      ok: false,
      reason: `Este torneio é exclusivo para ${
        category === 'masculino' ? 'masculino' : 'feminino'
      }.`,
    }
  }
  return { ok: true }
}

function sideOf(userId: string, m: EligibilityMatch): 1 | 2 | null {
  if (userId === m.player1_id || userId === m.partner1_id) return 1
  if (userId === m.player2_id || userId === m.partner2_id) return 2
  return null
}

export function canReportResult(userId: string, m: EligibilityMatch): boolean {
  return sideOf(userId, m) !== null
}

export function canConfirmResult(
  userId: string,
  m: EligibilityMatch,
  isAdmin: boolean,
): boolean {
  if (isAdmin) return true
  if (!m.reported_by) return false
  const reporterSide = sideOf(m.reported_by, m)
  const userSide = sideOf(userId, m)
  if (reporterSide === null || userSide === null) return false
  // Só a dupla adversária à de quem reportou pode confirmar.
  return userSide !== reporterSide
}
