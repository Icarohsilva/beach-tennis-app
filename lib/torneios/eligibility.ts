// lib/torneios/eligibility.ts
//
// canRegister() (só via gênero de quem clicou, nunca do parceiro) saiu de
// aqui — virou canEnter()/canPairUp()/validateEntry() em pairRules.ts, que
// cobre os dois lados da dupla. Regra de partida (quem pode reportar/confirmar
// placar) continua aqui, sem relação com a régua de gênero.
export interface EligibilityMatch {
  player1_id: string
  partner1_id: string | null
  player2_id: string
  partner2_id: string | null
  reported_by: string | null
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
