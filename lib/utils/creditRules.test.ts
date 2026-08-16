// lib/utils/creditRules.test.ts
import { describe, it, expect } from 'vitest'
import { canCancelWithRefund, getMakeupCreditExpiry, withinBookingGrace } from './creditRules'

describe('canCancelWithRefund', () => {
  it('allows cancellation 6 hours before', () => {
    expect(
      canCancelWithRefund('2026-06-11T18:00:00-03:00', '2026-06-11T12:00:00-03:00'),
    ).toBe(true)
  })

  it('blocks cancellation 4 hours before', () => {
    expect(
      canCancelWithRefund('2026-06-11T18:00:00-03:00', '2026-06-11T14:00:00-03:00'),
    ).toBe(false)
  })

  it('allows cancellation exactly at window limit (>= 5h)', () => {
    expect(
      canCancelWithRefund('2026-06-11T18:00:00-03:00', '2026-06-11T13:00:00-03:00'),
    ).toBe(true)
  })

  it('blocks cancellation just inside the window', () => {
    expect(
      canCancelWithRefund('2026-06-11T18:00:00-03:00', '2026-06-11T13:00:01-03:00'),
    ).toBe(false)
  })
})

// Janela de arrependimento: 1h a contar da RESERVA. É o que separa desistir
// (entrou por engano, saiu na hora) de furar (some em cima do horário).
describe('canCancelWithRefund — janela de arrependimento', () => {
  // Aula às 18h, aluno reserva às 16h: a regra das 5h já nasce fechada para ele.
  const aula = '2026-06-11T18:00:00-03:00'
  const reservou = '2026-06-11T16:00:00-03:00'

  it('devolve crédito quando o aluno sai logo depois de entrar', () => {
    expect(canCancelWithRefund(aula, '2026-06-11T16:05:00-03:00', undefined, reservou)).toBe(true)
  })

  it('devolve crédito no limite exato de 60 minutos', () => {
    expect(canCancelWithRefund(aula, '2026-06-11T17:00:00-03:00', undefined, reservou)).toBe(true)
  })

  it('volta a penalizar passado 1 minuto do limite', () => {
    expect(canCancelWithRefund(aula, '2026-06-11T17:01:00-03:00', undefined, reservou)).toBe(false)
  })

  it('sem booked_at, só a regra das 5h vale (comportamento histórico)', () => {
    expect(canCancelWithRefund(aula, '2026-06-11T16:05:00-03:00')).toBe(false)
    expect(canCancelWithRefund(aula, '2026-06-11T16:05:00-03:00', undefined, null)).toBe(false)
  })

  it('as duas regras são um OU: reserva antiga cancelada com folga segue valendo', () => {
    expect(
      canCancelWithRefund(aula, '2026-06-11T09:00:00-03:00', undefined, '2026-06-01T10:00:00-03:00'),
    ).toBe(true)
  })
})

describe('withinBookingGrace', () => {
  it('data inválida não concede a graça', () => {
    expect(withinBookingGrace('nao-e-data', '2026-06-11T16:05:00-03:00')).toBe(false)
  })

  it('reserva no futuro (relógio torto) conta como recém-feita', () => {
    expect(
      withinBookingGrace('2026-06-11T17:00:00-03:00', '2026-06-11T16:00:00-03:00'),
    ).toBe(true)
  })
})

describe('getMakeupCreditExpiry', () => {
  it('returns a date 30 days from now by default', () => {
    const now = new Date('2026-06-01T10:00:00Z')
    const expiry = getMakeupCreditExpiry(now, 30)
    expect(expiry.toISOString().startsWith('2026-07-01')).toBe(true)
  })

  it('respects custom expiry days', () => {
    const now = new Date('2026-06-01T10:00:00Z')
    const expiry = getMakeupCreditExpiry(now, 15)
    expect(expiry.toISOString().startsWith('2026-06-16')).toBe(true)
  })
})

// A janela é configurável por academia (system_settings.cancellation_window_hours).
// Até 2026-08 ela existia na tela do admin e NENHUM caminho a passava — o default
// de 5h sempre vencia, e quem gravou 3h achou por meses que tinha mudado a regra.
describe('canCancelWithRefund — janela configurada pela academia', () => {
  const aula = '2026-06-11T18:00:00-03:00'

  it('janela de 3h: cancelar com 4h de antecedência devolve', () => {
    expect(canCancelWithRefund(aula, '2026-06-11T14:00:00-03:00', 3)).toBe(true)
    // Com o default de 5h isto seria false — é exatamente o furo consertado.
  })

  it('janela de 8h: cancelar com 6h de antecedência NÃO devolve', () => {
    expect(canCancelWithRefund(aula, '2026-06-11T12:00:00-03:00', 8)).toBe(false)
  })

  it('a borda exata da janela configurada devolve', () => {
    expect(canCancelWithRefund(aula, '2026-06-11T15:00:00-03:00', 3)).toBe(true)
    expect(canCancelWithRefund(aula, '2026-06-11T15:00:01-03:00', 3)).toBe(false)
  })

  // As duas janelas convivem: a de arrependimento não depende da configurada.
  it('o arrependimento de 1h vale mesmo com janela longa', () => {
    expect(
      canCancelWithRefund(aula, '2026-06-11T17:30:00-03:00', 8, '2026-06-11T17:00:00-03:00'),
    ).toBe(true)
  })
})
