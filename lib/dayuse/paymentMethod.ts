// lib/dayuse/paymentMethod.ts
// Como uma reserva de day use foi paga, e por quanto tempo ela SEGURA a vaga.
// Puro, sem I/O.
//
// A janela existe porque day use tem capacidade: reserva pendente de pagamento
// ocupa vaga, e ocupar para sempre esvazia a quadra no papel. Só que os dois
// caminhos de pagamento têm ritmos muito diferentes — o Checkout Pro confirma
// em segundos, e o PIX manual depende de a pessoa pagar, subir o comprovante e
// alguém da arena conferir. Com uma janela só (os 30 min que existiam), o PIX
// manual perdia a vaga antes de qualquer humano olhar para ele.

/**
 * Quando o day use é pago. Escolha da ACADEMIA, por horário — não dedução da
 * configuração dela, que errava nas duas direções: a arena com PIX cadastrado
 * mas que cobra na porta prendia o aluno num pagamento indesejado, e a que quer
 * receber antes não tinha como exigir.
 */
export type DayUsePaymentTiming =
  /** Paga ao reservar: Checkout Pro, PIX na chave da arena ou crédito no app. */
  | 'on_booking'
  /** Reserva confirma na hora; o dinheiro é acertado na quadra. */
  | 'on_site'

export const DAY_USE_PAYMENT_TIMINGS: readonly DayUsePaymentTiming[] = ['on_booking', 'on_site']

export const DAY_USE_TIMING_LABEL: Record<DayUsePaymentTiming, string> = {
  on_booking: 'Pagar na inscrição',
  on_site: 'Pagar na arena',
}

/** O que cada escolha promete ao aluno — frase, não rótulo. */
export function timingHint(timing: DayUsePaymentTiming): string {
  return timing === 'on_booking'
    ? 'O aluno paga ao reservar e a vaga só é garantida com o pagamento.'
    : 'O aluno reserva pelo app e paga na quadra, na hora.'
}

/**
 * Como o aluno lê a escolha da academia. Rótulo próprio, e não o do admin:
 * "Pagar na inscrição" é instrução para quem cria o day use; para quem vai
 * jogar, o fato é onde ele vai passar o dinheiro.
 */
export const DAY_USE_TIMING_STUDENT_LABEL: Record<DayUsePaymentTiming, string> = {
  on_booking: 'Pagamento na reserva',
  on_site: 'Pagamento na arena',
}

/** A frase que o aluno lê antes de reservar. */
export function timingNoticeForStudent(timing: DayUsePaymentTiming): string {
  return timing === 'on_booking'
    ? 'O pagamento é feito aqui, ao reservar — a vaga é confirmada quando a academia conferir.'
    : 'Você reserva pelo app e paga na arena, na hora. Nada é cobrado agora.'
}

export type DayUsePaymentMethod =
  /** Gratuito: nada a pagar. */
  | 'free'
  /** Abatido inteiro do crédito em dinheiro. */
  | 'wallet'
  /** Checkout Pro (PIX/cartão), confirmado por webhook. */
  | 'mercadopago'
  /** PIX na chave da arena, com comprovante conferido por gente. */
  | 'pix_manual'
  /**
   * Paga na arena, na hora. A reserva confirma na hora (não há pagamento online
   * a esperar) e o `payments` pendente guarda a dívida para o admin dar baixa.
   *
   * É o caso mais comum de todos, e era o que o app tratava como GRATUITO —
   * anunciando "Gratuito" um day use de R$ 20 e deixando a arena sem onde
   * marcar quem pagou.
   */
  | 'on_site'

export const DAY_USE_PAYMENT_METHODS: readonly DayUsePaymentMethod[] = [
  'free', 'wallet', 'mercadopago', 'pix_manual', 'on_site',
]

/** Minutos que a reserva segura a vaga esperando confirmação. */
const HOLD_MINUTES: Record<DayUsePaymentMethod, number> = {
  // Confirmados na hora: não há espera a segurar. Mantidos no mapa para o tipo
  // ficar exaustivo — método novo não compila sem decidir a janela dele.
  free: 0,
  wallet: 0,
  // Confirma na hora: quem paga na porta não tem prazo online a cumprir, e um
  // prazo aqui derrubaria a reserva de quem já está indo para a quadra.
  on_site: 0,
  // Checkout Pro: o webhook chega em segundos; 30 min é folga para o aluno
  // terminar de digitar o cartão. Era o único valor que existia, cravado dentro
  // da RPC.
  mercadopago: 30,
  // PIX manual: 24h porque o gargalo é humano. A arena confere comprovante
  // quando abre o painel, não em 30 minutos.
  pix_manual: 24 * 60,
}

export function holdMinutesFor(method: DayUsePaymentMethod): number {
  return HOLD_MINUTES[method] ?? HOLD_MINUTES.mercadopago
}

/**
 * Até quando esta reserva segura a vaga. `null` para quem já está confirmado —
 * confirmado não tem prazo, e uma data no passado ali derrubaria a reserva.
 */
export function holdUntilIso(
  method: DayUsePaymentMethod,
  fromIso: string = new Date().toISOString(),
): string | null {
  const minutes = holdMinutesFor(method)
  if (minutes <= 0) return null
  return new Date(new Date(fromIso).getTime() + minutes * 60 * 1000).toISOString()
}

/** O pagamento deste método é confirmado por gente da arena? */
export function needsManualConfirmation(method: DayUsePaymentMethod): boolean {
  return method === 'pix_manual' || method === 'on_site'
}

const LABEL: Record<DayUsePaymentMethod, string> = {
  free: 'Gratuito',
  wallet: 'Crédito no app',
  mercadopago: 'Cartão ou PIX (Mercado Pago)',
  pix_manual: 'PIX na chave da arena',
  on_site: 'Pagar na arena',
}

export function paymentMethodLabel(method: DayUsePaymentMethod): string {
  return LABEL[method] ?? 'Pagamento'
}

/**
 * Qual caminho de pagamento usar para este day use.
 *
 * A ordem é a regra: crédito cobrindo tudo dispensa cobrança; havendo gateway
 * conectado ele vence (confirma sozinho); sem gateway, a chave PIX da arena
 * ainda permite cobrar — e é aí que estava o furo, porque antes disso day use
 * pago em arena sem Mercado Pago saía DE GRAÇA.
 */
export function resolveDayUsePaymentMethod(input: {
  gatewayCents: number
  walletCents: number
  hasMpToken: boolean
  hasPixKey: boolean
  /** Escolha da academia. Ausente = 'on_site', o default da coluna. */
  timing?: DayUsePaymentTiming
}): DayUsePaymentMethod {
  if (input.gatewayCents <= 0) return input.walletCents > 0 ? 'wallet' : 'free'

  // A escolha da academia vem primeiro: mesmo com gateway conectado, day use
  // marcado para pagar na arena NÃO abre cobrança online.
  if ((input.timing ?? 'on_site') === 'on_site') return 'on_site'

  if (input.hasMpToken) return 'mercadopago'
  if (input.hasPixKey) return 'pix_manual'
  // Marcado para pagar na inscrição, mas a academia não tem como receber
  // online. Cai na arena em vez de barrar a reserva — e a tela do admin avisa
  // que falta configurar.
  return 'on_site'
}
