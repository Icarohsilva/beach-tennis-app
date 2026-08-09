import { describe, it, expect } from 'vitest'
import { projetarEscala, avaliarMaturidade, ALVO_PADRAO } from './projecaoEscala'
import { GB, MB, type CapacityMetrics } from './capacity'

function metrics(over: Partial<CapacityMetrics> = {}): CapacityMetrics {
  return {
    orgs: 2,
    orgs_ativas: 2,
    alunos: 600,
    alunos_ativos: 580,
    mau: 300,
    // 100 MB de dados + 20 MB que não escalam com aluno
    db_bytes: 120 * MB,
    tabelas: {
      attendance: { rows: 60_000, bytes: 70 * MB },
      session_bookings: { rows: 30_000, bytes: 30 * MB },
    },
    ...over,
  }
}

describe('projetarEscala', () => {
  it('escala pelo número de alunos, não pelo de arenas', () => {
    // 600 alunos hoje → 300.000 no alvo = fator 500
    const p = projetarEscala(metrics(), ALVO_PADRAO)
    expect(p.alunosAlvo).toBe(300_000)
    expect(p.fator).toBe(500)
  })

  it('mantém fixa a parcela do banco que não cresce com aluno', () => {
    const p = projetarEscala(metrics(), ALVO_PADRAO)
    // 20 MB fixos + 100 MB de dados × 500
    expect(p.bytesFixos).toBe(20 * MB)
    expect(p.dbBytesProjetado).toBe(20 * MB + 100 * MB * 500)
  })

  it('não multiplica o overhead fixo junto com os dados', () => {
    // Mesma base, mas com overhead fixo gigante: o projetado não pode explodir.
    const comOverhead = projetarEscala(metrics({ db_bytes: 1 * GB }), ALVO_PADRAO)
    const semOverhead = projetarEscala(metrics({ db_bytes: 100 * MB }), ALVO_PADRAO)
    const diferenca = comOverhead.dbBytesProjetado - semOverhead.dbBytesProjetado
    // A diferença é exatamente o overhead, não o overhead vezes 500.
    expect(diferenca).toBe(1 * GB - 100 * MB)
  })

  it('projeta linhas por tabela, da maior para a menor', () => {
    const p = projetarEscala(metrics(), ALVO_PADRAO)
    expect(p.tabelas[0].nome).toBe('attendance')
    expect(p.tabelas[0].projetado).toBe(60_000 * 500)
    expect(p.tabelas[1].nome).toBe('session_bookings')
  })

  it('projeta MAU pela proporção observada, não pelo total de alunos', () => {
    // Metade dos alunos ativos hoje → metade no alvo.
    const p = projetarEscala(metrics(), ALVO_PADRAO)
    expect(p.mauProjetado).toBe(150_000)
  })

  it('avalia os tetos de plano contra o cenário projetado', () => {
    const p = projetarEscala(metrics(), ALVO_PADRAO)
    const disco = p.limites.find((l) => l.id === 'disco_pro')!
    // 50 GB projetados contra 8 GB inclusos.
    expect(disco.severidade).toBe('estourado')
    const mau = p.limites.find((l) => l.id === 'mau_pro')!
    expect(mau.severidade).toBe('estourado')
  })

  it('marca como não confiável quando a base é pequena demais', () => {
    const p = projetarEscala(metrics({ alunos: 40 }), ALVO_PADRAO)
    expect(p.confiavel).toBe(false)
    expect(p.ressalva).toMatch(/base pequena/)
  })

  it('marca como confiável a partir do mínimo', () => {
    expect(projetarEscala(metrics({ alunos: 200 }), ALVO_PADRAO).confiavel).toBe(true)
  })

  it('não divide por zero com a base vazia', () => {
    const p = projetarEscala(metrics({ alunos: 0, mau: 0 }), ALVO_PADRAO)
    expect(p.fator).toBe(0)
    expect(p.confiavel).toBe(false)
    expect(Number.isFinite(p.dbBytesProjetado)).toBe(true)
    expect(p.tabelas).toEqual([])
  })

  it('aceita alvo diferente do padrão', () => {
    const p = projetarEscala(metrics(), { arenas: 10, alunosPorArena: 300 })
    expect(p.alunosAlvo).toBe(3_000)
    expect(p.fator).toBe(5)
  })

  it('lida com a lista de tabelas vazia', () => {
    const p = projetarEscala(metrics({ tabelas: {} }), ALVO_PADRAO)
    expect(p.tabelas).toEqual([])
    // Sem dados rastreados, o banco inteiro vira parcela fixa.
    expect(p.dbBytesProjetado).toBe(120 * MB)
  })
})

describe('avaliarMaturidade', () => {
  const agora = new Date('2026-08-09T12:00:00Z')

  it('trata base de poucos meses como piso, não teto', () => {
    const m = avaliarMaturidade('2026-07-01T00:00:00Z', agora)
    expect(m.nivel).toBe('recente')
    expect(m.dias).toBe(39)
    expect(m.aviso).toMatch(/piso/)
  })

  it('reconhece base entre 6 meses e 1 ano', () => {
    expect(avaliarMaturidade('2025-11-01T00:00:00Z', agora).nivel).toBe('parcial')
  })

  it('reconhece base madura', () => {
    expect(avaliarMaturidade('2024-01-01T00:00:00Z', agora).nivel).toBe('madura')
  })

  it('não quebra sem data nem com data inválida', () => {
    expect(avaliarMaturidade(null, agora).nivel).toBe('recente')
    expect(avaliarMaturidade('nao-e-data', agora).nivel).toBe('recente')
  })
})
