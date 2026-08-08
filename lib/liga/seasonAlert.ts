// lib/liga/seasonAlert.ts
// Aviso da reta final da temporada.
//
// A spec descartou notificar cada ultrapassagem: viraria ruído e o aluno desliga o
// push. A reta final é outra coisa — é o único momento em que a informação muda o
// comportamento, porque ainda dá tempo de treinar mais uma vez.

/** Só avisa neste dia. Um único disparo por temporada, não três dias de insistência. */
export const ALERT_DAYS_LEFT = 2

/** Acima disso a subida não é alcançável em uma ou duas aulas, e o aviso vira frustração. */
export const MAX_POINTS_TO_ALERT = 40

export type SeasonAlertKind = 'promocao' | 'rebaixamento'

export interface SeasonAlertInput {
  daysLeft: number
  /** Pontos que faltam para entrar na zona de promoção. null = já está nela, ou é Diamante. */
  pointsToPromote: number | null
  inRelegationZone: boolean
  /** Pontos do aluno na temporada. */
  points: number
}

/**
 * Qual aviso mandar, se algum.
 *
 * Quem tem zero ponto não recebe nada: avisar "faltam 40 pontos" a quem nunca apareceu
 * não é lembrete, é cobrança — e cobrança por push é o caminho mais curto para o aluno
 * desativar as notificações.
 */
export function seasonAlertKind(input: SeasonAlertInput): SeasonAlertKind | null {
  if (input.daysLeft !== ALERT_DAYS_LEFT) return null
  if (input.points <= 0) return null

  if (input.pointsToPromote !== null && input.pointsToPromote <= MAX_POINTS_TO_ALERT) {
    return 'promocao'
  }
  if (input.inRelegationZone) return 'rebaixamento'
  return null
}

export interface SeasonAlertText {
  title: string
  body: string
}

export function seasonAlertText(
  kind: SeasonAlertKind,
  params: { pointsToPromote: number | null; sportLabel: string; divisionLabel: string },
): SeasonAlertText {
  if (kind === 'promocao') {
    const faltam = params.pointsToPromote ?? 0
    return {
      title: `Faltam ${faltam} ${faltam === 1 ? 'ponto' : 'pontos'} para subir de divisão`,
      body: `A temporada de ${params.sportLabel} acaba em ${ALERT_DAYS_LEFT} dias e você está perto de sair da ${params.divisionLabel}. Dá tempo com mais uma aula.`,
    }
  }
  return {
    title: 'Você está na zona de rebaixamento',
    body: `A temporada de ${params.sportLabel} acaba em ${ALERT_DAYS_LEFT} dias e você está entre os últimos da ${params.divisionLabel}. Uma presença já muda isso.`,
  }
}
