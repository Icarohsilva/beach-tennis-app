// lib/dayuse/refundRules.ts
// Quando o cancelamento de um day use gera estorno, de quanto, e em que forma.
// Puro: sem I/O. A coleta de dados fica em features/dayuse/refunds.ts.
//
// A janela é a MESMA regra da aula (canCancelWithRefund, lib/utils/creditRules.ts),
// inclusive a carência de 1h para quem clicou errado. Reimplementar aqui faria a
// arena ter dois conceitos de "cancelei em tempo" — e o aluno descobrir a
// diferença no bolso.
import { canCancelWithRefund, CANCELLATION_WINDOW_HOURS } from '@/lib/utils/creditRules'
import { sessionStartIso } from '@/lib/utils/sessionTime'

export type RefundCause = 'arena_cancelou' | 'aluno_cancelou'
export type RefundMethod = 'pix' | 'credito'
export type RefundStatus = 'pendente' | 'pago' | 'confirmado' | 'creditado'

export interface RefundEligibilityInput {
  /** Data do slot, YYYY-MM-DD. */
  date: string
  /** Início do slot, HH:MM ou HH:MM:SS. */
  start_time: string
  /** Quando a reserva foi feita (carência de arrependimento). */
  bookedAtIso: string | null
  nowIso: string
  /** Centavos que entraram por GATEWAY nesta reserva (payments pagos). */
  gatewayCents: number
  /** Centavos pagos com saldo da carteira nesta reserva. */
  walletCents: number
  cause: RefundCause
  /** Janela da academia, em horas. Default = a da aula (5h). */
  windowHours?: number
}

export interface RefundEligibility {
  /** Abre estorno de dinheiro (PIX/crédito) por este cancelamento? */
  due: boolean
  /** Valor do estorno em centavos — só a parte do gateway. */
  amountCents: number
  /**
   * Quanto voltar para a carteira IMEDIATAMENTE. A parte paga com saldo não
   * gera PIX: devolver crédito interno por PIX transformaria vale em dinheiro,
   * o que a academia não vendeu.
   */
  walletRestoreCents: number
  /** Por que não há estorno, quando não há. Texto para o aluno. */
  denyReason?: string
}

/**
 * Decide o estorno de um cancelamento.
 *
 * Ordem das checagens é a regra:
 *   1. arena cancelando devolve SEMPRE (o aluno não escolheu nada);
 *   2. aluno cancelando devolve só dentro da janela (ou da carência de 1h);
 *   3. nada pago não gera estorno nenhum, mesmo dentro da janela.
 */
export function resolveRefundEligibility(input: RefundEligibilityInput): RefundEligibility {
  const gateway = Math.max(0, Math.round(input.gatewayCents))
  const wallet = Math.max(0, Math.round(input.walletCents))

  if (gateway === 0 && wallet === 0) {
    return {
      due: false,
      amountCents: 0,
      walletRestoreCents: 0,
      denyReason: 'Esta reserva não teve pagamento.',
    }
  }

  if (input.cause === 'aluno_cancelou') {
    const inWindow = canCancelWithRefund(
      sessionStartIso(input.date, normalizeTime(input.start_time)),
      input.nowIso,
      input.windowHours ?? CANCELLATION_WINDOW_HOURS,
      input.bookedAtIso,
    )
    if (!inWindow) {
      return {
        due: false,
        amountCents: 0,
        walletRestoreCents: 0,
        denyReason: `Cancelamento fora do prazo de ${input.windowHours ?? CANCELLATION_WINDOW_HOURS}h: o valor não é devolvido.`,
      }
    }
  }

  return {
    due: gateway > 0,
    amountCents: gateway,
    walletRestoreCents: wallet,
  }
}

/** Trocar PIX por crédito só antes de o dinheiro sair. */
export function canSwitchToCredit(status: RefundStatus): boolean {
  return status === 'pendente'
}

/** O admin ainda tem trabalho a fazer neste estorno? */
export function refundNeedsAdmin(status: RefundStatus): boolean {
  return status === 'pendente'
}

const STATUS_LABEL: Record<RefundStatus, string> = {
  pendente: 'Estorno pendente',
  pago: 'Estorno realizado — confirme o recebimento',
  confirmado: 'Estorno confirmado',
  creditado: 'Convertido em crédito no app',
}

export function refundStatusLabel(status: RefundStatus): string {
  return STATUS_LABEL[status] ?? 'Estorno'
}

/**
 * A promessa que o aluno lê ao PAGAR — não ao cancelar.
 *
 * Ela é verdadeira no código: quando a arena desmarca o horário,
 * `cancelDayUseSlotBookings` abre estorno com `cause: 'arena_cancelou'`, que
 * devolve **sempre** (`resolveRefundEligibility`), sem janela nenhuma. Precisa
 * estar escrita na tela porque quem paga antes de jogar não tem como saber
 * disso — e sem a frase, pagar adiantado se parece com dar dinheiro para um
 * link do WhatsApp.
 */
export const PAYMENT_REFUND_PROMISE =
  'Se o day use não acontecer, o valor é devolvido pelo PIX que você informa na inscrição '
  + '(ou vira crédito no app, se preferir).'

/** Frase que o aluno lê ANTES de cancelar — o prazo tem de vir antes do clique. */
export function cancelNoticeForStudent(input: {
  date: string
  start_time: string
  bookedAtIso: string | null
  nowIso: string
  paidCents: number
  windowHours?: number
}): string {
  if (input.paidCents <= 0) return 'Cancelar libera sua vaga para outra pessoa.'
  const e = resolveRefundEligibility({
    date: input.date,
    start_time: input.start_time,
    bookedAtIso: input.bookedAtIso,
    nowIso: input.nowIso,
    gatewayCents: input.paidCents,
    walletCents: 0,
    cause: 'aluno_cancelou',
    windowHours: input.windowHours,
  })
  return e.due
    ? 'Cancelando agora, o valor pago é devolvido: você escolhe entre PIX e crédito no app.'
    : (e.denyReason ?? 'O valor não é devolvido.')
}

function normalizeTime(t: string): string {
  return t.length === 5 ? `${t}:00` : t
}
