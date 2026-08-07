// lib/aulas/waitlistInvite.ts
// Convite de WhatsApp para chamar quem está na fila de espera. Puro, sem I/O —
// mesmo padrão de lib/checkin/missedCheckins.ts (buildMissedCheckinMessage).
import { formatDate, formatTime } from '@/lib/utils/dateHelpers'

export interface WaitlistInviteInput {
  studentName: string
  orgName: string
  className: string
  /** YYYY-MM-DD */
  sessionDate: string
  /** HH:MM:SS */
  startTime: string
}

/**
 * Mensagem que o professor manda para o aluno da fila.
 *
 * Primeiro nome só: vai por WhatsApp, onde nome completo soa como robô (mesma
 * decisão de buildMissedCheckinMessage). O texto pergunta em vez de afirmar —
 * quem decide se coloca o aluno na aula é o professor, depois da resposta.
 */
export function buildWaitlistInviteMessage(input: WaitlistInviteInput): string {
  const { studentName, orgName, className, sessionDate, startTime } = input
  const firstName = studentName.trim().split(/\s+/)[0] || studentName

  return [
    `Oi, ${firstName}! Aqui é da ${orgName}.`,
    '',
    `Abriu uma vaga na aula de ${className}, ${formatDate(sessionDate)} às ${formatTime(startTime)}.`,
    '',
    'Você está na fila de espera. Quer entrar? Me responde aqui que eu te coloco.',
  ].join('\n')
}

/**
 * Link wa.me com a mensagem pronta. Retorna null quando o aluno não tem
 * telefone cadastrado — sem número não há para onde mandar.
 *
 * Assume DDI 55 quando o número vem só com DDD + telefone, que é como o app
 * coleta (mesma suposição de /admin/wellhub).
 */
export function buildWaitlistInviteUrl(
  phone: string | null,
  message: string,
): string | null {
  const digits = (phone ?? '').replace(/\D/g, '')
  if (digits.length < 10) return null
  const withCountry = digits.startsWith('55') ? digits : `55${digits}`
  return `https://wa.me/${withCountry}?text=${encodeURIComponent(message)}`
}
