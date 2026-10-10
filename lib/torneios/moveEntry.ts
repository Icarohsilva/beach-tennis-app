// lib/torneios/moveEntry.ts
// Regras para o admin passar uma inscrição de um torneio (categoria) para outro.
// Puro.
//
// O caso real: o atleta se inscreveu na categoria errada, ou a arena juntou ou
// separou categorias depois de abrir as inscrições. Antes disso a única saída
// era editar `tournament_entries.tournament_id` direto no banco, o que pulava
// todas as travas abaixo, ou apagar e inscrever de novo, o que perdia o
// pagamento, o comprovante e o lugar na fila.
//
// A inscrição é a MESMA linha que muda de torneio, e não uma cópia: pagamento,
// comprovante, camisa e link de pagamento continuam sendo dela.
import type { Gender, PairGenders, ParticipantType } from '@/types'
import { canEnter, canPairUp, canonicalizePairGenders } from './pairRules'
import { availableSlots } from './waitlist'
import { applyDiscount } from './entryDiscount'

/** Depois que a chave é sorteada, a inscrição está gravada nas partidas. */
export const MOVABLE_STATUSES = ['draft', 'open'] as const

export interface MoveTournament {
  id: string
  name: string
  status: string
  participant_type: ParticipantType
  allowed_pair_genders: PairGenders[] | null
  max_players: number | null
}

export interface MoveEntry {
  entryStatus: 'confirmed' | 'waitlist' | 'offered'
  playerGender: Gender | null
  /** undefined = inscrição sem parceiro (individual ou dupla incompleta). */
  partnerGender?: Gender | null
}

export type MoveVerdict = { ok: true } | { ok: false; reason: string }

function isMovable(status: string): boolean {
  return (MOVABLE_STATUSES as readonly string[]).includes(status)
}

export function checkEntryMove(input: {
  entry: MoveEntry
  source: MoveTournament
  target: MoveTournament
  /** Inscrições do destino que ocupam vaga (confirmed + offered). */
  targetOccupied: number
  /** Nome de quem desta inscrição já está no destino, se alguém estiver. */
  clashName: string | null
}): MoveVerdict {
  const { entry, source, target } = input

  if (source.id === target.id) return { ok: false, reason: 'Escolha um torneio diferente do atual.' }
  if (!isMovable(source.status)) {
    return {
      ok: false,
      reason: 'A chave deste torneio já foi gerada. Mudar a inscrição agora deixaria partidas sem a dupla.',
    }
  }
  if (!isMovable(target.status)) {
    return { ok: false, reason: `A chave de "${target.name}" já foi gerada. Não dá para entrar nela agora.` }
  }
  if (source.participant_type !== target.participant_type) {
    return {
      ok: false,
      reason: `"${target.name}" tem outro formato de inscrição. Só dá para mover entre torneios do mesmo formato.`,
    }
  }
  if (entry.entryStatus === 'offered') {
    return {
      ok: false,
      reason: 'Esta inscrição está com uma vaga oferecida. Espere a resposta (ou o prazo vencer) antes de mover.',
    }
  }

  // A regra de gênero da categoria de DESTINO, a mesma da inscrição normal.
  const allowed = canonicalizePairGenders(target.allowed_pair_genders ?? [])
  const verdict =
    entry.partnerGender === undefined
      ? canEnter(entry.playerGender, allowed)
      : canPairUp(entry.playerGender, entry.partnerGender, allowed)
  if (!verdict.ok) {
    return { ok: false, reason: `Não cabe em "${target.name}": ${verdict.reason ?? 'regra de gênero da categoria.'}` }
  }

  if (input.clashName) {
    return { ok: false, reason: `${input.clashName} já está inscrito(a) em "${target.name}".` }
  }

  // Na fila de espera ela entra na fila do destino, sem ocupar vaga.
  if (entry.entryStatus === 'confirmed' && availableSlots(input.targetOccupied, target.max_players) < 1) {
    return {
      ok: false,
      reason: `"${target.name}" está lotado (${input.targetOccupied}/${target.max_players}). Aumente as vagas dele antes de mover.`,
    }
  }

  return { ok: true }
}

export interface SidePayment {
  status: 'free' | 'pending' | 'paid'
  discountPct: number
  finalPriceCents: number
}

/**
 * Cobrança de um lado da inscrição no torneio de destino.
 *
 * Pago fica pago: o dinheiro já entrou, e reabrir a cobrança mandaria o atleta
 * pagar de novo. Pendente ou grátis passa a valer o preço do destino com o
 * MESMO desconto que a inscrição já tinha. Recalcular o desconto do zero
 * contaria a própria inscrição como "outro torneio da semana" e daria o
 * desconto do 2º torneio a quem só está em um.
 */
export function repriceSide(
  side: SidePayment,
  target: { charged: boolean; priceCents: number | null },
): SidePayment {
  if (side.status === 'paid') return side
  if (!target.charged || !target.priceCents) return { status: 'free', discountPct: 0, finalPriceCents: 0 }
  return {
    status: 'pending',
    discountPct: side.discountPct,
    finalPriceCents: applyDiscount(target.priceCents, side.discountPct),
  }
}

function brl(cents: number): string {
  return `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`
}

/**
 * Aviso para o admin quando quem já pagou foi para uma categoria de outro
 * preço. A diferença não é cobrada nem devolvida sozinha: o app não sabe se a
 * arena quer acertar, e o pagamento registrado continua sendo o que entrou.
 */
export function paidDifferenceNotice(
  name: string,
  side: SidePayment,
  target: { charged: boolean; priceCents: number | null },
): string | null {
  if (side.status !== 'paid') return null
  const expected = target.charged && target.priceCents ? applyDiscount(target.priceCents, side.discountPct) : 0
  if (expected === side.finalPriceCents) return null
  return `${name} já pagou ${brl(side.finalPriceCents)} e o valor na nova categoria é ${brl(expected)}. Acerte a diferença com o atleta.`
}
