import { describe, it, expect } from 'vitest'
import {
  avaliarLimites,
  projetar,
  maiorTabela,
  formatarBytes,
  GB,
  MB,
  type CapacityMetrics,
} from './capacity'

function metrics(over: Partial<CapacityMetrics> = {}): CapacityMetrics {
  return {
    orgs: 3,
    orgs_ativas: 3,
    alunos: 400,
    alunos_ativos: 380,
    mau: 250,
    db_bytes: 120 * MB,
    tabelas: {
      attendance: { rows: 50_000, bytes: 20 * MB },
      session_bookings: { rows: 40_000, bytes: 15 * MB },
      profiles: { rows: 400, bytes: 1 * MB },
    },
    ...over,
  }
}

describe('avaliarLimites', () => {
  it('marca ok quando está longe do teto', () => {
    const dbFree = avaliarLimites(metrics()).find((l) => l.id === 'db_free')!
    expect(dbFree.severidade).toBe('ok')
    expect(dbFree.uso).toBeCloseTo(120 / 500, 3)
  })

  it('marca atencao a partir de 70% do teto', () => {
    const l = avaliarLimites(metrics({ db_bytes: 360 * MB })).find((x) => x.id === 'db_free')!
    expect(l.severidade).toBe('atencao')
  })

  it('marca estourado quando passa do teto', () => {
    const l = avaliarLimites(metrics({ db_bytes: 600 * MB })).find((x) => x.id === 'db_free')!
    expect(l.severidade).toBe('estourado')
    expect(l.uso).toBeGreaterThan(1)
  })

  it('cobre disco do Pro e MAU separadamente do Free', () => {
    const ls = avaliarLimites(metrics({ db_bytes: 9 * GB, mau: 120_000 }))
    expect(ls.find((l) => l.id === 'disco_pro')!.severidade).toBe('estourado')
    expect(ls.find((l) => l.id === 'mau_pro')!.severidade).toBe('estourado')
  })

  it('usa a maior tabela no limite de volume', () => {
    const l = avaliarLimites(
      metrics({ tabelas: { attendance: { rows: 60_000_000, bytes: 20 * GB } } }),
    ).find((x) => x.id === 'maior_tabela')!
    expect(l.atual).toBe(60_000_000)
    expect(l.severidade).toBe('estourado')
  })

  it('não quebra com a lista de tabelas vazia', () => {
    const l = avaliarLimites(metrics({ tabelas: {} })).find((x) => x.id === 'maior_tabela')!
    expect(l.atual).toBe(0)
    expect(l.severidade).toBe('ok')
  })
})

describe('maiorTabela', () => {
  it('escolhe pela contagem de linhas, não por bytes', () => {
    const m = metrics({
      tabelas: {
        fotos: { rows: 100, bytes: 900 * MB },
        attendance: { rows: 900_000, bytes: 10 * MB },
      },
    })
    expect(maiorTabela(m)!.nome).toBe('attendance')
  })

  it('devolve null sem tabelas', () => {
    expect(maiorTabela(metrics({ tabelas: {} }))).toBeNull()
  })
})

describe('projetar', () => {
  const dia = (n: number) => new Date(Date.UTC(2026, 0, n)).toISOString()

  it('projeta a data em que o teto é cruzado a partir do ritmo', () => {
    // 10 unidades por dia, começando em 100. Teto 200 → faltam 10 dias.
    const pontos = Array.from({ length: 5 }, (_, i) => ({
      capturedAt: dia(i + 1),
      valor: 100 + i * 10,
    }))
    const agora = new Date(Date.UTC(2026, 0, 5))
    const p = projetar(pontos, 200, agora)

    expect(p.porDia).toBeCloseTo(10, 6)
    expect(p.diasAteTeto).toBeCloseTo(6, 6) // último valor é 140
    expect(p.dataEstimada).toBe('2026-01-11')
  })

  it('resiste a um dia atípico em vez de seguir a reta de dois pontos', () => {
    // Cresce ~10/dia, com um pico isolado no meio.
    const pontos = [
      { capturedAt: dia(1), valor: 100 },
      { capturedAt: dia(2), valor: 110 },
      { capturedAt: dia(3), valor: 400 }, // importação pontual
      { capturedAt: dia(4), valor: 130 },
      { capturedAt: dia(5), valor: 140 },
    ]
    const p = projetar(pontos, 1000, new Date(Date.UTC(2026, 0, 5)))
    // A regressão suaviza: fica bem abaixo dos 145/dia que dois pontos dariam.
    expect(p.porDia).toBeLessThan(60)
    expect(p.porDia).toBeGreaterThan(0)
  })

  it('não projeta com menos de dois retratos', () => {
    expect(projetar([{ capturedAt: dia(1), valor: 10 }], 100).diasAteTeto).toBeNull()
    expect(projetar([], 100).diasAteTeto).toBeNull()
  })

  it('não projeta quando não está crescendo', () => {
    const pontos = [
      { capturedAt: dia(1), valor: 100 },
      { capturedAt: dia(2), valor: 100 },
      { capturedAt: dia(3), valor: 90 },
    ]
    const p = projetar(pontos, 200)
    expect(p.diasAteTeto).toBeNull()
    expect(p.porDia).toBeLessThanOrEqual(0)
  })

  it('não projeta quando todos os retratos são do mesmo instante', () => {
    const pontos = [
      { capturedAt: dia(1), valor: 100 },
      { capturedAt: dia(1), valor: 200 },
    ]
    expect(projetar(pontos, 500).diasAteTeto).toBeNull()
  })

  it('devolve zero dias quando o teto já foi cruzado', () => {
    const pontos = [
      { capturedAt: dia(1), valor: 100 },
      { capturedAt: dia(2), valor: 300 },
    ]
    const p = projetar(pontos, 200, new Date(Date.UTC(2026, 0, 2)))
    expect(p.diasAteTeto).toBe(0)
    expect(p.dataEstimada).toBe('2026-01-02')
  })

  it('ignora retrato com data inválida em vez de devolver NaN', () => {
    const pontos = [
      { capturedAt: 'nao-e-data', valor: 100 },
      { capturedAt: dia(2), valor: 200 },
    ]
    expect(projetar(pontos, 500).diasAteTeto).toBeNull()
  })
})

describe('formatarBytes', () => {
  it('escolhe a unidade pela ordem de grandeza', () => {
    expect(formatarBytes(2.5 * GB)).toBe('2.50 GB')
    expect(formatarBytes(300 * MB)).toBe('300.0 MB')
    expect(formatarBytes(4096)).toBe('4 KB')
  })
})
