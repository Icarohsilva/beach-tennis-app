import { describe, it, expect } from 'vitest'
import {
  mrrMovement,
  measuringSince,
  centsToBRL,
  type SubscriptionEvent,
} from './mrrMovement'

const NOW = new Date('2026-08-15T12:00:00Z')
const PRICE = 4990

function ev(over: Partial<SubscriptionEvent> & { organizationId: string; occurredAt: string }): SubscriptionEvent {
  return {
    toStatus: 'active',
    mrrCents: PRICE,
    source: 'webhook',
    ...over,
  }
}

describe('mrrMovement', () => {
  it('conta a primeira conversão como novo MRR', () => {
    const rows = mrrMovement([ev({ organizationId: 'a', occurredAt: '2026-08-03T00:00:00Z' })], 2, NOW)
    const agosto = rows[1]
    expect(agosto.month).toBe('2026-08')
    expect(agosto.novoCents).toBe(PRICE)
    expect(agosto.liquidoCents).toBe(PRICE)
    expect(agosto.mrrFinalCents).toBe(PRICE)
  })

  it('cancelamento vira churn negativo e zera o MRR de fechamento', () => {
    const rows = mrrMovement(
      [
        ev({ organizationId: 'a', occurredAt: '2026-07-05T00:00:00Z' }),
        ev({ organizationId: 'a', occurredAt: '2026-08-10T00:00:00Z', toStatus: 'canceled', mrrCents: 0 }),
      ],
      2,
      NOW,
    )
    expect(rows[0].novoCents).toBe(PRICE)
    expect(rows[0].mrrFinalCents).toBe(PRICE)
    expect(rows[1].churnCents).toBe(-PRICE)
    expect(rows[1].liquidoCents).toBe(-PRICE)
    expect(rows[1].mrrFinalCents).toBe(0)
  })

  it('separa reativação de novo MRR', () => {
    const rows = mrrMovement(
      [
        ev({ organizationId: 'a', occurredAt: '2026-06-01T00:00:00Z' }),
        ev({ organizationId: 'a', occurredAt: '2026-06-20T00:00:00Z', toStatus: 'canceled', mrrCents: 0 }),
        ev({ organizationId: 'a', occurredAt: '2026-08-02T00:00:00Z' }),
      ],
      3,
      NOW,
    )
    expect(rows[0].novoCents).toBe(PRICE)
    expect(rows[2].reativacaoCents).toBe(PRICE)
    expect(rows[2].novoCents).toBe(0)
  })

  it('mede expansão e contração quando o valor muda sem zerar', () => {
    const rows = mrrMovement(
      [
        ev({ organizationId: 'a', occurredAt: '2026-07-01T00:00:00Z', mrrCents: 4990 }),
        ev({ organizationId: 'a', occurredAt: '2026-07-20T00:00:00Z', mrrCents: 9990 }),
        ev({ organizationId: 'a', occurredAt: '2026-08-05T00:00:00Z', mrrCents: 6990 }),
      ],
      2,
      NOW,
    )
    expect(rows[0].expansaoCents).toBe(5000)
    expect(rows[1].contracaoCents).toBe(-3000)
    expect(rows[1].mrrFinalCents).toBe(6990)
  })

  it('ignora seed como movimento mas usa como linha de base', () => {
    const rows = mrrMovement(
      [
        ev({ organizationId: 'a', occurredAt: '2026-07-01T00:00:00Z', source: 'seed' }),
        ev({ organizationId: 'a', occurredAt: '2026-08-04T00:00:00Z', toStatus: 'canceled', mrrCents: 0 }),
      ],
      2,
      NOW,
    )
    // O seed não conta como venda...
    expect(rows[0].novoCents).toBe(0)
    // ...mas define o MRR da conta, então o cancelamento seguinte é churn real.
    expect(rows[0].mrrFinalCents).toBe(PRICE)
    expect(rows[1].churnCents).toBe(-PRICE)
  })

  it('trial não gera movimento algum', () => {
    const rows = mrrMovement(
      [ev({ organizationId: 'a', occurredAt: '2026-08-01T00:00:00Z', toStatus: 'trialing', mrrCents: 0 })],
      1,
      NOW,
    )
    expect(rows[0].liquidoCents).toBe(0)
    expect(rows[0].mrrFinalCents).toBe(0)
  })

  it('past_due tira a conta do MRR como churn', () => {
    const rows = mrrMovement(
      [
        ev({ organizationId: 'a', occurredAt: '2026-07-02T00:00:00Z' }),
        ev({ organizationId: 'a', occurredAt: '2026-08-02T00:00:00Z', toStatus: 'past_due', mrrCents: 0 }),
      ],
      2,
      NOW,
    )
    expect(rows[1].churnCents).toBe(-PRICE)
  })

  it('carrega o MRR para os meses seguintes sem evento', () => {
    const rows = mrrMovement(
      [ev({ organizationId: 'a', occurredAt: '2026-06-10T00:00:00Z' })],
      3,
      NOW,
    )
    expect(rows.map((r) => r.mrrFinalCents)).toEqual([PRICE, PRICE, PRICE])
    expect(rows[1].liquidoCents).toBe(0)
  })

  it('soma várias academias no mesmo mês', () => {
    const rows = mrrMovement(
      [
        ev({ organizationId: 'a', occurredAt: '2026-08-01T00:00:00Z' }),
        ev({ organizationId: 'b', occurredAt: '2026-08-02T00:00:00Z' }),
        ev({ organizationId: 'c', occurredAt: '2026-08-03T00:00:00Z', toStatus: 'canceled', mrrCents: 0 }),
      ],
      1,
      NOW,
    )
    expect(rows[0].novoCents).toBe(PRICE * 2)
    // 'c' nunca pagou nesta janela, então sair não é churn de receita.
    expect(rows[0].churnCents).toBe(0)
    expect(rows[0].mrrFinalCents).toBe(PRICE * 2)
  })

  it('não depende da ordem de entrada dos eventos', () => {
    const desordenado = [
      ev({ organizationId: 'a', occurredAt: '2026-08-10T00:00:00Z', toStatus: 'canceled', mrrCents: 0 }),
      ev({ organizationId: 'a', occurredAt: '2026-07-05T00:00:00Z' }),
    ]
    const rows = mrrMovement(desordenado, 2, NOW)
    expect(rows[0].novoCents).toBe(PRICE)
    expect(rows[1].churnCents).toBe(-PRICE)
  })

  it('evento anterior à janela define a base sem virar movimento', () => {
    const rows = mrrMovement(
      [ev({ organizationId: 'a', occurredAt: '2025-01-01T00:00:00Z' })],
      2,
      NOW,
    )
    expect(rows[0].novoCents).toBe(0)
    expect(rows[0].mrrFinalCents).toBe(PRICE)
  })

  it('sem eventos devolve a janela zerada', () => {
    const rows = mrrMovement([], 3, NOW)
    expect(rows).toHaveLength(3)
    expect(rows.every((r) => r.liquidoCents === 0 && r.mrrFinalCents === 0)).toBe(true)
    expect(rows.map((r) => r.label)).toEqual(['06/26', '07/26', '08/26'])
  })
})

describe('measuringSince', () => {
  it('devolve o evento mais antigo', () => {
    expect(
      measuringSince([
        ev({ organizationId: 'a', occurredAt: '2026-08-01T00:00:00Z' }),
        ev({ organizationId: 'b', occurredAt: '2026-06-01T00:00:00Z' }),
      ]),
    ).toBe('2026-06-01T00:00:00Z')
  })

  it('null quando não há histórico', () => {
    expect(measuringSince([])).toBeNull()
  })
})

describe('centsToBRL', () => {
  it('converte centavos em reais', () => {
    expect(centsToBRL(4990)).toBe(49.9)
    expect(centsToBRL(-4990)).toBe(-49.9)
    expect(centsToBRL(0)).toBe(0)
  })
})
