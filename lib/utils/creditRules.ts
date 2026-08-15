// lib/utils/creditRules.ts

export const CANCELLATION_WINDOW_HOURS = 5

/**
 * Janela de arrependimento: quanto tempo depois de entrar na aula o aluno ainda
 * pode sair sem penalidade nenhuma.
 *
 * Existe porque a regra das 5h sozinha pune o engano. Quem entra numa aula que
 * começa em duas horas — inclusive quem toca no botão errado — não tem como
 * cancelar no prazo: a janela já nasceu fechada, e sair um minuto depois custa o
 * crédito e a falta. Uma hora a contar da RESERVA (não do início da aula) separa
 * desistir de furar: quem some em cima da hora continua pagando, quem se
 * arrependeu na hora não.
 */
export const BOOKING_GRACE_MINUTES = 60

/**
 * O cancelamento devolve crédito e não gera falta?
 *
 * Verdadeiro em dois casos, avaliados como um OU:
 *   1. faltam ao menos `windowHours` para a aula (a regra de sempre);
 *   2. a reserva foi feita há menos de `BOOKING_GRACE_MINUTES` (arrependimento).
 *
 * `bookedAtIso` é opcional: sem ele só a regra 1 vale, que é o comportamento
 * histórico. Os callers que não têm a reserva em mãos (a cota, ao classificar
 * cancelamentos antigos) continuam corretos sem mudar nada.
 */
export function canCancelWithRefund(
  sessionStartIso: string,
  nowIso: string,
  windowHours = CANCELLATION_WINDOW_HOURS,
  bookedAtIso?: string | null,
): boolean {
  const sessionStart = new Date(sessionStartIso)
  const now = new Date(nowIso)
  const diffHours = (sessionStart.getTime() - now.getTime()) / (1000 * 60 * 60)
  if (diffHours >= windowHours) return true

  return withinBookingGrace(bookedAtIso, nowIso)
}

/** A reserva ainda está dentro da janela de arrependimento? */
export function withinBookingGrace(
  bookedAtIso: string | null | undefined,
  nowIso: string,
): boolean {
  if (!bookedAtIso) return false
  const bookedAt = new Date(bookedAtIso).getTime()
  if (Number.isNaN(bookedAt)) return false
  const elapsedMinutes = (new Date(nowIso).getTime() - bookedAt) / (1000 * 60)
  // Negativo = reserva no futuro (relógio torto). Trata como recém-feita: o erro
  // seria cobrar penalidade de quem não teve tempo nenhum de desistir.
  return elapsedMinutes <= BOOKING_GRACE_MINUTES
}

/**
 * Returns the expiry date for a makeup credit.
 * Default: 30 days. Configurable via system_settings.credit_expiry_days.
 */
export function getMakeupCreditExpiry(from: Date, expiryDays: number): Date {
  const expiry = new Date(from)
  expiry.setDate(expiry.getDate() + expiryDays)
  return expiry
}

