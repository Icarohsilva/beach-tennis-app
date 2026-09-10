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
}): DayUsePaymentMethod {
  if (input.gatewayCents <= 0) return input.walletCents > 0 ? 'wallet' : 'free'
  if (input.hasMpToken) return 'mercadopago'
  if (input.hasPixKey) return 'pix_manual'
  // Sem cobrança online: paga na arena. Antes isto devolvia 'free', e era daí
  // que saía o "Gratuito" num day use com preço definido.
  return 'on_site'
}
