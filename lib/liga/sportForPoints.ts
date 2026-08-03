// lib/liga/sportForPoints.ts
// Qual ranking recebe o ponto de uma presença (spec §Decisões 8).

/**
 * Esporte que um ponto de presença credita. `null` = não pontua.
 *
 * `classes.sport` é nullable e informativo (spec de esportes decidiu por zero
 * gating), então a Liga precisa de um fallback. O fallback é deliberadamente
 * conservador: só resolve quando não há ambiguidade nenhuma, isto é, quando a
 * academia oferece exatamente uma modalidade. Chutar entre várias seria pior que
 * não pontuar — o admin veria pontos aparecendo no ranking errado sem entender
 * por quê. Mesma filosofia do backfill em 20260802000000_sports_membership_and_class.sql.
 *
 * A turma sem modalidade em academia multi-modalidade fica visível no admin como
 * "N aulas não estão pontuando", que é o empurrão para preencher o campo.
 */
export function sportForAttendance(
  classSport: string | null | undefined,
  orgSports: string[],
): string | null {
  if (classSport) return classSport
  return orgSports.length === 1 ? orgSports[0] : null
}
