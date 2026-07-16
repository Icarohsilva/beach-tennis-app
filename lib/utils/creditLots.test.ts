import { describe, it, expect } from 'vitest'
import { replayCredits } from './creditLots'

const NOW = new Date('2026-07-16T12:00:00Z')

function tx(amount: number, createdAt: string, expiresAt: string | null = null) {
  return { amount, created_at: createdAt, expires_at: expiresAt }
}

describe('replayCredits', () => {
  it('extrato vazio devolve zero', () => {
    expect(replayCredits([], NOW)).toEqual({ validBalance: 0, expiredAmount: 0 })
  })

  it('lote vigente conta no saldo', () => {
    const txs = [tx(3, '2026-07-01T00:00:00Z', '2026-08-01T00:00:00Z')]
    expect(replayCredits(txs, NOW)).toEqual({ validBalance: 3, expiredAmount: 0 })
  })

  it('lote sem expires_at nunca expira', () => {
    const txs = [tx(2, '2020-01-01T00:00:00Z', null)]
    expect(replayCredits(txs, NOW)).toEqual({ validBalance: 2, expiredAmount: 0 })
  })

  it('lote vencido e não consumido expira', () => {
    const txs = [tx(2, '2026-05-01T00:00:00Z', '2026-06-01T00:00:00Z')]
    expect(replayCredits(txs, NOW)).toEqual({ validBalance: 0, expiredAmount: 2 })
  })

  it('FIFO: o débito consome o lote mais antigo primeiro', () => {
    const txs = [
      tx(1, '2026-05-01T00:00:00Z', '2026-06-01T00:00:00Z'), // vence antes de NOW
      tx(1, '2026-07-01T00:00:00Z', '2026-08-01T00:00:00Z'), // vigente
      tx(-1, '2026-05-10T00:00:00Z'), // consome o antigo
    ]
    // O antigo foi consumido → não expira. Sobra o vigente.
    expect(replayCredits(txs, NOW)).toEqual({ validBalance: 1, expiredAmount: 0 })
  })

  it('lote vencido já consumido não expira duas vezes', () => {
    const txs = [
      tx(2, '2026-05-01T00:00:00Z', '2026-06-01T00:00:00Z'),
      tx(-2, '2026-05-15T00:00:00Z'),
    ]
    expect(replayCredits(txs, NOW)).toEqual({ validBalance: 0, expiredAmount: 0 })
  })

  it('consumo parcial: só o resto do lote vencido expira', () => {
    const txs = [
      tx(3, '2026-05-01T00:00:00Z', '2026-06-01T00:00:00Z'),
      tx(-1, '2026-05-15T00:00:00Z'),
    ]
    expect(replayCredits(txs, NOW)).toEqual({ validBalance: 0, expiredAmount: 2 })
  })

  it('débito atravessa lotes quando o primeiro não cobre', () => {
    const txs = [
      tx(1, '2026-07-01T00:00:00Z', '2026-08-01T00:00:00Z'),
      tx(2, '2026-07-02T00:00:00Z', '2026-08-01T00:00:00Z'),
      tx(-3, '2026-07-03T00:00:00Z'),
    ]
    expect(replayCredits(txs, NOW)).toEqual({ validBalance: 0, expiredAmount: 0 })
  })

  it('processa em ordem cronológica, não na ordem da lista', () => {
    const txs = [
      tx(-1, '2026-07-03T00:00:00Z'),
      tx(1, '2026-07-01T00:00:00Z', '2026-08-01T00:00:00Z'),
    ]
    expect(replayCredits(txs, NOW)).toEqual({ validBalance: 0, expiredAmount: 0 })
  })

  it('mistura: vencido não consumido expira, vigente sobrevive', () => {
    const txs = [
      tx(2, '2026-05-01T00:00:00Z', '2026-06-01T00:00:00Z'), // vencido
      tx(5, '2026-07-01T00:00:00Z', '2026-08-01T00:00:00Z'), // vigente
      tx(-1, '2026-05-02T00:00:00Z'), // consome 1 do vencido
    ]
    // Do lote vencido sobrou 1 → expira. Vigente intacto.
    expect(replayCredits(txs, NOW)).toEqual({ validBalance: 5, expiredAmount: 1 })
  })
})
