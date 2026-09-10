// lib/dayuse/publicPage.ts
// O estado da página pública de um day use: o que o botão diz e se dá para
// clicar. Puro para poder ser testado — é a tela que estranho sem conta abre
// vindo do WhatsApp, então "lotado", "encerrado" e "já reservei" não podem ser
// deduzidos de novo em cada lugar que mostra a mesma coisa.
import { sessionStartIso } from '@/lib/utils/sessionTime'
import { formatDayUsePrice } from './dayUseKind'
import type { DayUseKind } from '@/types'
import { DAY_USE_TIMING_STUDENT_LABEL } from './paymentMethod'
import type { DayUsePaymentMethod, DayUsePaymentTiming } from './paymentMethod'

export type DayUseCtaState =
  /** Dá para reservar agora. */
  | 'open'
  /** Sem vaga. */
  | 'full'
  /** O horário já passou. */
  | 'ended'
  /** Quem está vendo já tem reserva confirmada. */
  | 'booked'
  /** Reserva feita, esperando o pagamento confirmar. */
  | 'pending'

export interface DayUseCta {
  state: DayUseCtaState
  /** Texto do botão (ou do aviso, quando não há ação). */
  label: string
  /** Linha de apoio abaixo do botão. Vazia quando não há nada a dizer. */
  note: string
  /** Há ação a oferecer? 'ended'/'full' e reserva existente não têm. */
  actionable: boolean
}

export interface DayUseCtaInput {
  date: string
  /** HH:MM ou HH:MM:SS. */
  end_time: string
  capacity: number
  /** Reservas que ocupam vaga (confirmadas + pendentes frescas). */
  occupied: number
  /** Reserva de quem está vendo a página, se houver. */
  myStatus?: 'confirmed' | 'pending_payment' | null
  /**
   * Como essa reserva está sendo paga. Muda o prazo que a tela promete: o
   * Checkout Pro segura 30 min, o PIX manual 24h — dizer 30 min para quem vai
   * pagar na chave da arena é prometer que a vaga cai antes de a arena olhar.
   */
  myPaymentMethod?: DayUsePaymentMethod | null
  /**
   * Onde o pagamento acontece. Entra no `note` porque é a primeira pergunta de
   * quem vê um preço num link do WhatsApp: pago agora ou na quadra? Ausente =
   * 'on_site', o default da coluna.
   */
  paymentTiming?: DayUsePaymentTiming | null
  /** Está logado? Muda só o texto: quem não está passa pela conta rápida. */
  signedIn: boolean
  /** Preço já resolvido (dayUseChargeCents). 0 = gratuito. */
  priceCents: number
  now: Date
}

/**
 * A ordem das checagens é a regra, não detalhe: "encerrado" vem antes de
 * "lotado" (day use de ontem lotado não é convite para nada) e a reserva de
 * quem está vendo vem antes de "lotado" — senão quem JÁ reservou via "Lotado"
 * e achava que tinha perdido a vaga.
 */
export function resolveDayUseCta(input: DayUseCtaInput): DayUseCta {
  const ended = new Date(sessionStartIso(input.date, normalizeTime(input.end_time))) <= input.now

  if (ended) {
    return {
      state: 'ended',
      label: 'Encerrado',
      note: 'Este horário já passou. Veja os próximos na página da arena.',
      actionable: false,
    }
  }

  if (input.myStatus === 'pending_payment') {
    const manual = input.myPaymentMethod === 'pix_manual'
    return {
      state: 'pending',
      label: manual ? 'Aguardando o PIX' : 'Aguardando pagamento',
      note: manual
        ? 'Sua vaga fica reservada por 24 horas até a academia conferir o comprovante.'
        : 'Sua vaga fica reservada por 30 minutos até o pagamento ser confirmado.',
      actionable: false,
    }
  }

  if (input.myStatus === 'confirmed') {
    return {
      state: 'booked',
      label: 'Você está nesta lista',
      note: 'Chegue com alguns minutos de antecedência.',
      actionable: false,
    }
  }

  if (input.occupied >= input.capacity) {
    return {
      state: 'full',
      label: 'Lotado',
      note: 'Fale com a arena no WhatsApp para entrar caso alguém desista.',
      actionable: false,
    }
  }

  const left = input.capacity - input.occupied
  const timing = input.paymentTiming ?? 'on_site'
  return {
    state: 'open',
    label: input.signedIn ? 'Reservar minha vaga' : 'Criar conta e reservar',
    note:
      input.priceCents > 0
        ? `${formatDayUsePrice(input.priceCents)} por pessoa · `
          + `${DAY_USE_TIMING_STUDENT_LABEL[timing].toLowerCase()} · ${vagasLabel(left)}`
        : `Gratuito · ${vagasLabel(left)}`,
    actionable: true,
  }
}

function vagasLabel(left: number): string {
  return left === 1 ? 'última vaga' : `${left} vagas`
}

function normalizeTime(t: string): string {
  return t.length === 5 ? `${t}:00` : t
}

/**
 * A mensagem que vai no WhatsApp junto do link.
 *
 * Escrita como a arena divulga de fato ("Day use de beach tennis domingo, 9h,
 * R$ 40"): um link nu no grupo não diz o que é, e quem recebe não abre.
 */
export function dayUseShareMessage(input: {
  orgName: string
  sportLabel?: string | null
  kind: DayUseKind
  dateLabel: string
  startLabel: string
  endLabel: string
  priceCents: number
  /** Onde se paga — vai na mensagem porque é o que decide se a pessoa clica. */
  paymentTiming?: DayUsePaymentTiming | null
  url: string
}): string {
  const what = input.sportLabel ? `Day use de ${input.sportLabel}` : 'Day use'
  const how = input.kind === 'open' ? ' (livre no período)' : ''
  const onde =
    (input.paymentTiming ?? 'on_site') === 'on_site' ? ' (pago na arena)' : ' (pago na reserva)'
  const price =
    input.priceCents > 0
      ? `${formatDayUsePrice(input.priceCents)} por pessoa${onde}`
      : 'Entrada gratuita'
  return [
    `${what}${how} na ${input.orgName}`,
    `${input.dateLabel}, das ${input.startLabel} às ${input.endLabel}`,
    price,
    '',
    `Reserve sua vaga: ${input.url}`,
  ].join('\n')
}
