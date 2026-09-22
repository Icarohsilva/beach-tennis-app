// lib/torneios/entryCharge.ts
// A inscrição de torneio é cobrada? E por onde? Puro, sem I/O.
//
// Existe porque a resposta estava implícita numa linha só —
// `(entryPriceCents ?? 0) > 0 && !!pixKey` — e essa linha entregava torneio DE
// GRAÇA para a arena que tem Mercado Pago conectado e não cadastrou chave PIX.
// O admin definia R$ 60, o Checkout Pro estava ligado, e toda inscrição nascia
// `free`. É o mesmo defeito que o day use teve com `dayUseChargeCents`, pela
// mesma causa: confundir "tem preço" com "tem ESTA forma de receber".
//
// Aqui a separação é explícita. **O preço é o preço**: havendo valor, a
// inscrição é cobrada. O que varia é o MÉTODO — e nenhum deles é "grátis".

/** Por onde esta inscrição é paga. */
export type EntryChargeMethod =
  /** Sem preço: entrada gratuita de verdade. */
  | 'free'
  /** Checkout Pro do Mercado Pago, confirmado por webhook. */
  | 'mercadopago'
  /** PIX na chave do torneio, com comprovante conferido por gente. */
  | 'pix_manual'
  /**
   * Tem preço e a arena não recebe online. A inscrição nasce pendente e o admin
   * dá baixa (`confirmEntryPayment`) quando o atleta acerta na quadra.
   *
   * Este caso era justamente o que virava `free`, e "grátis" é a única leitura
   * que não dá para consertar depois: o atleta já entrou sem pagar.
   */
  | 'on_site'

export interface EntryChargeInput {
  /** `tournaments.entry_price_cents`. */
  entryPriceCents: number | null
  /** `tournaments.pix_key`. */
  pixKey: string | null
  /** A academia tem conta do Mercado Pago conectada? */
  hasMpToken: boolean
}

export interface EntryCharge {
  /** A inscrição gera cobrança (`payment_status: 'pending'`)? */
  charged: boolean
  method: EntryChargeMethod
}

/**
 * A ordem é a regra: o gateway vence porque confirma sozinho; sem ele, a chave
 * PIX do torneio ainda cobra; sem nenhum dos dois, cobra-se na arena.
 */
export function resolveEntryCharge(input: EntryChargeInput): EntryCharge {
  if ((input.entryPriceCents ?? 0) <= 0) return { charged: false, method: 'free' }
  if (input.hasMpToken) return { charged: true, method: 'mercadopago' }
  if (input.pixKey?.trim()) return { charged: true, method: 'pix_manual' }
  return { charged: true, method: 'on_site' }
}

/** Atalho para quem só precisa do sim/não. */
export function isEntryCharged(input: EntryChargeInput): boolean {
  return resolveEntryCharge(input).charged
}

/**
 * O que o ADMIN lê ao definir o valor, antes de criar o torneio.
 *
 * Escrito como consequência ("vai acontecer isto"), e não como requisito
 * ("preencha aquilo"): o texto anterior dizia que os dois campos precisavam ser
 * preenchidos para cobrar, o que é falso com Mercado Pago conectado e foi o que
 * levou a arena a achar que precisava de chave PIX.
 */
export function entryChargeHint(input: EntryChargeInput): string {
  const charge = resolveEntryCharge(input)
  switch (charge.method) {
    case 'free':
      return 'Sem valor, a inscrição é gratuita.'
    case 'mercadopago':
      return 'Mercado Pago conectado: o atleta paga por PIX ou cartão no link da inscrição. '
        + 'A chave PIX abaixo não é necessária.'
    case 'pix_manual':
      return 'O atleta paga na chave PIX do torneio e anexa o comprovante; a academia confere.'
    case 'on_site':
      return 'Sem Mercado Pago conectado e sem chave PIX, a inscrição fica pendente e o valor '
        + 'é acertado na arena — você dá baixa na lista de inscritos.'
  }
}

/** O que o ATLETA lê na tela de pagamento quando não há caminho online. */
export const PAY_ON_SITE_NOTICE =
  'A arena ainda não recebe pagamento pelo app. Combine o pagamento diretamente com ela — '
  + 'sua inscrição fica pendente até a academia dar baixa.'
