// lib/liga/kudos.ts
// Regras do elogio entre alunos (spec §Fase 3).
//
// Elogio é a única parte fraudável da Liga. As quatro travas do desenho:
//   1. teto semanal de elogios que pontuam       → aqui
//   2. um elogio por colega por semana           → índice único no banco
//   3. recíproco na mesma semana não pontua      → aqui
//   4. quem recebe ganha mais que quem dá        → pesos em features/liga/settings
//
// As travas 1 e 3 são as que precisam de regra pura; as outras duas são estruturais.
import { getISOWeek, getISOWeekYear } from 'date-fns'

export type KudosCategory = 'evoluiu' | 'parceiro' | 'incentiva' | 'dedicado'

export const KUDOS_CATEGORIES: { value: KudosCategory; label: string; hint: string }[] = [
  { value: 'evoluiu', label: 'Evoluiu muito', hint: 'jogou melhor que da última vez' },
  { value: 'parceiro', label: 'Grande parceiro', hint: 'bom de dupla, joga junto' },
  { value: 'incentiva', label: 'Incentiva todo mundo', hint: 'levanta a quadra' },
  { value: 'dedicado', label: 'Não falta uma', hint: 'sempre presente' },
]

export const KUDOS_CATEGORY_LABEL: Record<KudosCategory, string> = KUDOS_CATEGORIES.reduce(
  (acc, c) => ({ ...acc, [c.value]: c.label }),
  {} as Record<KudosCategory, string>,
)

export const MAX_KUDOS_MESSAGE = 240
export const MIN_KUDOS_MESSAGE = 3

export function isKudosCategory(value: string): value is KudosCategory {
  return KUDOS_CATEGORIES.some((c) => c.value === value)
}

/**
 * Chave da semana ISO ('2026-W32'), usada como trava semanal.
 *
 * Contrato de fuso igual ao de `computeStreakWeeks`: quem chama precisa passar uma
 * data que represente o instante corrente em horário de Brasília. Numa madrugada de
 * segunda em UTC o Brasil ainda é domingo, e as duas datas caem em semanas ISO
 * diferentes — o que liberaria um segundo elogio "da semana que vem" no domingo à
 * noite.
 */
export function isoWeekKey(date: Date): string {
  const week = getISOWeek(date)
  return `${getISOWeekYear(date)}-W${String(week).padStart(2, '0')}`
}

export interface KudosContext {
  /** Quantos elogios deste remetente JÁ pontuaram nesta semana. */
  weeklyPaidCount: number
  /** O destinatário já elogiou o remetente nesta mesma semana? */
  reciprocalSameWeek: boolean
  /** Teto semanal configurado pela academia. */
  weeklyCap: number
}

/**
 * Este elogio credita ponto?
 *
 * Quando devolve `false` o elogio é gravado e aparece no mural assim mesmo — ele só
 * não vale ponto. Bloquear o elogio inteiro puniria a intenção certa; o que precisa
 * ser contido é a economia de pontos, não o gesto.
 */
export function kudosEarnsPoints(ctx: KudosContext): boolean {
  if (ctx.weeklyCap <= 0) return false
  if (ctx.weeklyPaidCount >= ctx.weeklyCap) return false
  // Mata o combinado "eu te elogio, você me elogia" dentro da mesma semana.
  if (ctx.reciprocalSameWeek) return false
  return true
}

/** Mensagem limpa, ou null quando não sobra conteúdo suficiente. */
export function sanitizeKudosMessage(raw: string): string | null {
  const text = String(raw).trim().replace(/\s+/g, ' ').slice(0, MAX_KUDOS_MESSAGE)
  return text.length >= MIN_KUDOS_MESSAGE ? text : null
}
