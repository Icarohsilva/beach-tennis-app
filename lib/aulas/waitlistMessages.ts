// lib/aulas/waitlistMessages.ts
// Textos das notificações da fila de espera. Puro, sem I/O — mesmo padrão de
// lib/aulas/waitlistInvite.ts e lib/liga/seasonCloseNotice.ts.
//
// Ficam aqui, e não soltos na action, porque a mensagem de entrada automática é
// a mais consequente do sistema de aulas: quem não a lê perde a aula. Texto que
// muda sem teste é texto que uma refatoração apaga sem ninguém notar.
import { formatDate, formatTime } from '@/lib/utils/dateHelpers'
import { BOOKING_GRACE_MINUTES } from '@/lib/utils/creditRules'
import type { AccessDenial } from '@/lib/utils/accessRules'

export interface WaitlistSessionRef {
  className: string
  /** YYYY-MM-DD */
  sessionDate: string
  /** HH:MM ou HH:MM:SS */
  startTime: string
}

export interface WaitlistNotice {
  title: string
  body: string
}

function quando({ className, sessionDate, startTime }: WaitlistSessionRef): string {
  return `${className}, ${formatDate(sessionDate)} às ${formatTime(startTime)}`
}

/**
 * Entrou automaticamente porque era o primeiro da fila.
 *
 * O aviso tem de dizer as duas coisas, e nesta ordem: que ele ESTÁ na aula, e
 * que sair depois da janela custa. A reserva foi feita sem ele pedir, então
 * omitir o prazo transformaria uma cortesia em cobrança surpresa.
 */
export function buildAutoEnteredNotice(ref: WaitlistSessionRef): WaitlistNotice {
  return {
    title: 'Você entrou na aula',
    body:
      `Abriu uma vaga em ${quando(ref)} e você era o primeiro da lista de espera — ` +
      'sua presença já está confirmada.\n\n' +
      `Não vai poder ir? Remova seu nome em até ${BOOKING_GRACE_MINUTES} minutos ` +
      'para não perder o crédito nem levar falta. Depois disso vale a regra normal ' +
      'de cancelamento.',
  }
}

/**
 * Virou o primeiro da fila. Só quem vira primeiro recebe — avisar a fila inteira
 * a cada movimentação é o ruído que o modelo antigo produzia.
 */
export function buildNowFirstNotice(ref: WaitlistSessionRef): WaitlistNotice {
  return {
    title: 'Você é o primeiro da lista de espera',
    body:
      `Em ${quando(ref)}. Se alguém cancelar, você entra na aula automaticamente ` +
      'e a gente te avisa na hora.',
  }
}

/** Por que o aluno não pôde entrar, na voz de quem lê. */
function motivo(denial: AccessDenial, debtTotal: number): string {
  switch (denial) {
    case 'blocked_by_debt':
      return `você tem R$ ${debtTotal.toFixed(2).replace('.', ',')} em aberto`
    case 'blocked_by_missed_checkins':
      return 'você tem check-ins do parceiro em aberto'
    case 'archived':
      return 'seu cadastro nesta academia está inativo'
    case 'on_vacation':
      return 'você está com férias aprovadas nesta data'
    case 'quota_exhausted':
      return 'as aulas do seu plano neste ciclo já foram usadas'
    case 'daily_cap':
      return 'você já atingiu o limite de aulas para esse dia'
    default:
      return 'não foi possível confirmar sua vaga'
  }
}

/**
 * Saiu da fila porque a vaga chegou e ele não podia entrar.
 *
 * Existe porque remoção silenciosa é pior que ser pulado em silêncio: quem é
 * pulado mantém o lugar, quem é removido esperaria para sempre por uma vaga que
 * nunca vem. O texto diz o motivo e o caminho de volta.
 */
export function buildRemovedFromWaitlistNotice(
  ref: WaitlistSessionRef,
  denial: AccessDenial,
  debtTotal = 0,
): WaitlistNotice {
  return {
    title: 'Você saiu da lista de espera',
    body:
      `Abriu uma vaga em ${quando(ref)}, mas ${motivo(denial, debtTotal)}. ` +
      'Por isso a vaga foi para a próxima pessoa da fila e você saiu da lista.\n\n' +
      'Resolvendo isso, você pode entrar na fila de novo pela ficha da aula.',
  }
}
