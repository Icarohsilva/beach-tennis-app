// lib/checkin/missedCheckins.ts
// Regras puras da pendência de check-in de parceiro. Todo I/O fica nos callers
// (features/checkin/missedCheckins.ts), no mesmo espírito de lib/utils/accessRules.ts.
import { formatDate } from '@/lib/utils/dateHelpers'
import type { MissedCheckinStatus } from '@/types'

export interface MissedCheckinRow {
  id: string
  sessionDate: string // YYYY-MM-DD
  amount: number // reais
  status: MissedCheckinStatus
}

export interface MissedCheckinSummary {
  openCount: number
  openAmount: number
  /** Datas das pendências abertas, em ordem cronológica. */
  dates: string[]
  blocked: boolean
  /** Quantas pendências ainda cabem antes de bloquear. null = regra desligada. */
  untilBlock: number | null
}

/**
 * O aluno está bloqueado por pendência de check-in?
 *
 * `blockLimit <= 0` significa regra DESLIGADA (é o default de toda academia): a
 * pendência continua sendo registrada e cobrada, mas não barra ninguém. Ligar o
 * bloqueio é decisão explícita do dono em /admin/wellhub.
 */
export function isMissedCheckinBlocked(openCount: number, blockLimit: number): boolean {
  if (blockLimit <= 0) return false
  return openCount >= blockLimit
}

/**
 * Consolida as pendências de um aluno. Só as `open` contam: `paid` e `waived`
 * (perdoada pelo admin) já foram resolvidas e não pesam no bloqueio nem no total.
 */
export function summarizeMissedCheckins(
  rows: MissedCheckinRow[],
  blockLimit: number,
): MissedCheckinSummary {
  const open = rows.filter((r) => r.status === 'open')
  const openCount = open.length
  const openAmount = open.reduce((sum, r) => sum + Math.max(r.amount, 0), 0)
  const dates = open.map((r) => r.sessionDate).sort()

  return {
    openCount,
    openAmount,
    dates,
    blocked: isMissedCheckinBlocked(openCount, blockLimit),
    untilBlock: blockLimit <= 0 ? null : Math.max(blockLimit - openCount, 0),
  }
}

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

export interface MissedCheckinMessageInput {
  studentName: string
  orgName: string
  /** Datas YYYY-MM-DD das pendências abertas. */
  dates: string[]
  /** Total em reais. 0 = academia não configurou valor: cobra o check-in, não o dinheiro. */
  amount: number
  blocked: boolean
  payUrl: string
}

/**
 * Texto único usado tanto no link do wa.me quanto no corpo do notifyUsers — assim a
 * mensagem que o aluno recebe é a mesma pelos dois caminhos.
 *
 * Primeiro nome só: a mensagem é curta e vai por WhatsApp, onde nome completo soa
 * como cobrança automática de robô.
 */
export function buildMissedCheckinMessage(input: MissedCheckinMessageInput): string {
  const { studentName, orgName, dates, amount, blocked, payUrl } = input
  const firstName = studentName.trim().split(/\s+/)[0] || studentName
  const plural = dates.length === 1 ? 'aula' : 'aulas'

  const lines = [
    `Oi, ${firstName}! Aqui é da ${orgName}.`,
    '',
    `Ficou ${dates.length} ${plural} sem o seu check-in do parceiro:`,
    ...dates.map((d) => `• ${formatDate(d)}`),
  ]

  if (amount > 0) {
    lines.push('', `Total a regularizar: ${BRL.format(amount)}.`)
  } else {
    lines.push('', 'Sem o check-in a academia não recebe pela sua aula.')
  }

  if (blocked) {
    lines.push(
      '',
      'Enquanto isso não for resolvido você não consegue agendar novas aulas.',
    )
  }

  lines.push('', `Resolver aqui: ${payUrl}`)

  return lines.join('\n')
}
