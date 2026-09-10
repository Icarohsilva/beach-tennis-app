import { describe, it, expect } from 'vitest'
import {
  resolveRefundEligibility,
  canSwitchToCredit,
  refundStatusLabel,
  cancelNoticeForStudent,
} from './refundRules'

// Slot 27/09/2026 09:00 BRT = 12:00Z.
const SLOT = { date: '2026-09-27', start_time: '09:00' }
/** 26/09 às 10h BRT — 23h antes do slot, bem dentro da janela de 5h. */
const LONGE = '2026-09-26T13:00:00Z'
/** 27/09 às 07h BRT — 2h antes do slot, FORA da janela de 5h. */
const PERTO = '2026-09-27T10:00:00Z'

describe('resolveRefundEligibility', () => {
  it('arena cancelando devolve sempre, inclusive em cima da hora', () => {
    const e = resolveRefundEligibility({
      ...SLOT, bookedAtIso: '2026-09-01T12:00:00Z', nowIso: PERTO,
      gatewayCents: 4000, walletCents: 0, cause: 'arena_cancelou',
    })
    expect(e).toEqual({ due: true, amountCents: 4000, walletRestoreCents: 0 })
  })

  it('aluno cancelando dentro da janela devolve', () => {
    const e = resolveRefundEligibility({
      ...SLOT, bookedAtIso: '2026-09-01T12:00:00Z', nowIso: LONGE,
      gatewayCents: 4000, walletCents: 0, cause: 'aluno_cancelou',
    })
    expect(e.due).toBe(true)
    expect(e.amountCents).toBe(4000)
  })

  it('aluno cancelando FORA da janela não devolve, e diz o prazo', () => {
    const e = resolveRefundEligibility({
      ...SLOT, bookedAtIso: '2026-09-01T12:00:00Z', nowIso: PERTO,
      gatewayCents: 4000, walletCents: 0, cause: 'aluno_cancelou',
    })
    expect(e.due).toBe(false)
    expect(e.amountCents).toBe(0)
    expect(e.denyReason).toContain('5h')
  })

  it('carência de arrependimento vale para day use também', () => {
    // Reservou há 10 minutos uma vaga que começa em 2h: fora da janela de 5h,
    // mas dentro da carência de 1h de BOOKING_GRACE_MINUTES. Punir aqui seria
    // punir o clique errado.
    const e = resolveRefundEligibility({
      ...SLOT, bookedAtIso: '2026-09-27T09:50:00Z', nowIso: PERTO,
      gatewayCents: 4000, walletCents: 0, cause: 'aluno_cancelou',
    })
    expect(e.due).toBe(true)
  })

  it('respeita a janela configurada pela academia', () => {
    // Com janela de 1h, o cancelamento a 2h do início passa a caber.
    const e = resolveRefundEligibility({
      ...SLOT, bookedAtIso: '2026-09-01T12:00:00Z', nowIso: PERTO,
      gatewayCents: 4000, walletCents: 0, cause: 'aluno_cancelou', windowHours: 1,
    })
    expect(e.due).toBe(true)
  })

  it('reserva paga com carteira volta para a carteira, sem PIX', () => {
    // Devolver crédito interno por PIX transformaria vale em dinheiro.
    const e = resolveRefundEligibility({
      ...SLOT, bookedAtIso: null, nowIso: LONGE,
      gatewayCents: 0, walletCents: 4000, cause: 'arena_cancelou',
    })
    expect(e).toEqual({ due: false, amountCents: 0, walletRestoreCents: 4000 })
  })

  it('pagamento misto divide por origem', () => {
    const e = resolveRefundEligibility({
      ...SLOT, bookedAtIso: null, nowIso: LONGE,
      gatewayCents: 2500, walletCents: 1500, cause: 'arena_cancelou',
    })
    expect(e).toEqual({ due: true, amountCents: 2500, walletRestoreCents: 1500 })
  })

  it('reserva gratuita não gera estorno nenhum', () => {
    const e = resolveRefundEligibility({
      ...SLOT, bookedAtIso: null, nowIso: LONGE,
      gatewayCents: 0, walletCents: 0, cause: 'arena_cancelou',
    })
    expect(e.due).toBe(false)
    expect(e.denyReason).toContain('não teve pagamento')
  })

  it('aceita HH:MM:SS do banco', () => {
    const e = resolveRefundEligibility({
      date: '2026-09-27', start_time: '09:00:00', bookedAtIso: null, nowIso: PERTO,
      gatewayCents: 4000, walletCents: 0, cause: 'aluno_cancelou',
    })
    expect(e.due).toBe(false)
  })
})

describe('canSwitchToCredit', () => {
  it('só enquanto pendente: depois de pago o dinheiro já saiu', () => {
    expect(canSwitchToCredit('pendente')).toBe(true)
    expect(canSwitchToCredit('pago')).toBe(false)
    expect(canSwitchToCredit('confirmado')).toBe(false)
    expect(canSwitchToCredit('creditado')).toBe(false)
  })
})

describe('refundStatusLabel', () => {
  it('fala com o aluno, não com o banco', () => {
    expect(refundStatusLabel('pago')).toContain('confirme')
    expect(refundStatusLabel('creditado')).toContain('crédito')
  })
})

describe('cancelNoticeForStudent', () => {
  it('avisa ANTES do clique que não haverá devolução', () => {
    const msg = cancelNoticeForStudent({
      ...SLOT, bookedAtIso: '2026-09-01T12:00:00Z', nowIso: PERTO, paidCents: 4000,
    })
    expect(msg).toContain('não é devolvido')
  })

  it('promete a devolução quando ela existe', () => {
    const msg = cancelNoticeForStudent({
      ...SLOT, bookedAtIso: '2026-09-01T12:00:00Z', nowIso: LONGE, paidCents: 4000,
    })
    expect(msg).toContain('devolvido')
    expect(msg).toContain('PIX')
  })

  it('reserva gratuita fala de vaga, não de dinheiro', () => {
    const msg = cancelNoticeForStudent({
      ...SLOT, bookedAtIso: null, nowIso: LONGE, paidCents: 0,
    })
    expect(msg).toContain('vaga')
  })
})
