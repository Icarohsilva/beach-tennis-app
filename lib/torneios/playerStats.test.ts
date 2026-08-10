import { describe, it, expect } from 'vitest'
import {
  computeRecord,
  countTrophies,
  currentStreak,
  headToHead,
  headToHeadWith,
  partnerRecords,
  recentForm,
  sideOf,
  wonBy,
  type PlayerMatch,
} from './playerStats'

let seq = 0
function match(
  side1: string[],
  side2: string[],
  games1: number,
  games2: number,
  over: Partial<PlayerMatch> = {},
): PlayerMatch {
  seq++
  return {
    id: `m${seq}`,
    tournamentId: 't1',
    tournamentName: 'Copa',
    date: '2026-08-01',
    side1,
    side2,
    games1,
    games2,
    ...over,
  }
}

describe('sideOf e wonBy', () => {
  const m = match(['ana', 'bia'], ['caio'], 6, 3)

  it('acha o lado do atleta, inclusive como parceiro', () => {
    expect(sideOf('ana', m)).toBe(1)
    expect(sideOf('bia', m)).toBe(1)
    expect(sideOf('caio', m)).toBe(2)
    expect(sideOf('duda', m)).toBeNull()
  })

  it('diz quem ganhou pelo lado certo', () => {
    expect(wonBy('bia', m)).toBe(true)
    expect(wonBy('caio', m)).toBe(false)
    expect(wonBy('duda', m)).toBeNull()
  })

  it('empate não é vitória nem derrota', () => {
    expect(wonBy('ana', match(['ana'], ['caio'], 5, 5))).toBeNull()
  })
})

describe('computeRecord', () => {
  const matches = [
    match(['ana'], ['caio'], 6, 3),
    match(['bia'], ['ana'], 2, 6),
    match(['ana'], ['duda'], 4, 6),
  ]

  it('soma jogos, vitórias e games dos dois lados', () => {
    const r = computeRecord('ana', matches)
    expect(r.played).toBe(3)
    expect(r.wins).toBe(2)
    expect(r.losses).toBe(1)
    expect(r.gamesFor).toBe(16) // 6 + 6 + 4
    expect(r.gamesAgainst).toBe(11) // 3 + 2 + 6
    expect(r.diff).toBe(5)
  })

  it('aproveitamento em percentual inteiro', () => {
    expect(computeRecord('ana', matches).winRate).toBe(67)
  })

  it('sem jogo nenhum devolve zeros, não NaN', () => {
    const r = computeRecord('ninguem', matches)
    expect(r.played).toBe(0)
    expect(r.winRate).toBe(0)
    expect(Number.isNaN(r.winRate)).toBe(false)
  })

  it('ignora partida em que o atleta não entrou', () => {
    expect(computeRecord('caio', matches).played).toBe(1)
  })

  it('empate conta jogo mas não vitória nem derrota', () => {
    const r = computeRecord('ana', [match(['ana'], ['caio'], 5, 5)])
    expect(r.played).toBe(1)
    expect(r.wins).toBe(0)
    expect(r.losses).toBe(0)
    expect(r.winRate).toBe(0)
  })

  it('conta a partida do parceiro como partida dele também', () => {
    const r = computeRecord('bia', [match(['ana', 'bia'], ['caio', 'duda'], 6, 1)])
    expect(r.played).toBe(1)
    expect(r.wins).toBe(1)
  })
})

describe('headToHead', () => {
  const matches = [
    match(['ana'], ['caio'], 6, 3),
    match(['caio'], ['ana'], 6, 2),
    match(['ana'], ['caio'], 6, 4),
    match(['ana'], ['duda'], 3, 6),
  ]

  it('ordena do mais enfrentado ao menos', () => {
    const h = headToHead('ana', matches)
    expect(h.map((x) => x.opponentId)).toEqual(['caio', 'duda'])
    expect(h[0].played).toBe(3)
  })

  it('conta vitórias e derrotas do ponto de vista do atleta', () => {
    const vsCaio = headToHeadWith('ana', 'caio', matches)
    expect(vsCaio).toEqual({ opponentId: 'caio', played: 3, wins: 2, losses: 1 })
  })

  it('funciona igual quando o atleta é o lado 2', () => {
    const vsAna = headToHeadWith('caio', 'ana', matches)
    expect(vsAna).toEqual({ opponentId: 'ana', played: 3, wins: 1, losses: 2 })
  })

  it('em dupla, os dois adversários contam o mesmo jogo', () => {
    const h = headToHead('ana', [match(['ana', 'bia'], ['caio', 'duda'], 6, 1)])
    expect(h.map((x) => x.opponentId).sort()).toEqual(['caio', 'duda'])
    expect(h.every((x) => x.played === 1 && x.wins === 1)).toBe(true)
  })

  it('o parceiro nunca vira adversário', () => {
    const h = headToHead('ana', [match(['ana', 'bia'], ['caio'], 6, 1)])
    expect(h.map((x) => x.opponentId)).not.toContain('bia')
  })

  it('adversário nunca enfrentado vem zerado em vez de nulo', () => {
    expect(headToHeadWith('ana', 'zeca', matches)).toEqual({
      opponentId: 'zeca', played: 0, wins: 0, losses: 0,
    })
  })
})

describe('partnerRecords', () => {
  const matches = [
    match(['ana', 'bia'], ['caio', 'duda'], 6, 1),
    match(['ana', 'bia'], ['caio', 'elis'], 6, 2),
    match(['ana', 'caio'], ['bia', 'duda'], 3, 6),
    match(['ana', 'caio'], ['elis', 'duda'], 6, 4),
  ]

  it('agrupa por parceiro com aproveitamento', () => {
    const p = partnerRecords('ana', matches)
    expect(p.map((x) => x.partnerId)).toEqual(['bia', 'caio'])
    expect(p[0]).toEqual({ partnerId: 'bia', played: 2, wins: 2, winRate: 100 })
    expect(p[1]).toEqual({ partnerId: 'caio', played: 2, wins: 1, winRate: 50 })
  })

  it('exige um mínimo de jogos para não coroar dupla de uma partida só', () => {
    const comAvulso = [...matches, match(['ana', 'zeca'], ['caio'], 6, 0)]
    expect(partnerRecords('ana', comAvulso).map((x) => x.partnerId)).not.toContain('zeca')
    expect(partnerRecords('ana', comAvulso, 1).map((x) => x.partnerId)).toContain('zeca')
  })

  it('o adversário nunca vira parceiro', () => {
    const p = partnerRecords('ana', [match(['ana'], ['caio'], 6, 1)], 1)
    expect(p).toEqual([])
  })

  it('individual não gera parceria nenhuma', () => {
    expect(partnerRecords('ana', [match(['ana'], ['caio'], 6, 1), match(['ana'], ['duda'], 6, 1)])).toEqual([])
  })
})

describe('recentForm', () => {
  const matches = [
    match(['ana'], ['caio'], 6, 0), // V
    match(['ana'], ['caio'], 0, 6), // D
    match(['ana'], ['caio'], 6, 0), // V
    match(['ana'], ['caio'], 6, 0), // V
  ]

  it('devolve do mais recente para o mais antigo', () => {
    expect(recentForm('ana', matches)).toEqual(['V', 'V', 'D', 'V'])
  })

  it('respeita o limite', () => {
    expect(recentForm('ana', matches, 2)).toEqual(['V', 'V'])
  })

  it('marca empate', () => {
    expect(recentForm('ana', [match(['ana'], ['caio'], 5, 5)])).toEqual(['E'])
  })

  it('sem jogos devolve lista vazia', () => {
    expect(recentForm('zeca', matches)).toEqual([])
  })
})

describe('currentStreak', () => {
  it('conta a sequência de vitórias mais recente', () => {
    const s = currentStreak('ana', [
      match(['ana'], ['caio'], 0, 6),
      match(['ana'], ['caio'], 6, 0),
      match(['ana'], ['caio'], 6, 0),
    ])
    expect(s).toEqual({ kind: 'win', count: 2 })
  })

  it('conta sequência de derrotas', () => {
    const s = currentStreak('ana', [
      match(['ana'], ['caio'], 6, 0),
      match(['ana'], ['caio'], 0, 6),
    ])
    expect(s).toEqual({ kind: 'loss', count: 1 })
  })

  it('sem jogos não há sequência', () => {
    expect(currentStreak('ana', [])).toEqual({ kind: 'none', count: 0 })
  })

  it('empate corta a sequência', () => {
    const s = currentStreak('ana', [
      match(['ana'], ['caio'], 6, 0),
      match(['ana'], ['caio'], 5, 5),
    ])
    expect(s).toEqual({ kind: 'none', count: 0 })
  })

  it('a sequência é a do fim da lista, não a maior de todas', () => {
    const s = currentStreak('ana', [
      match(['ana'], ['caio'], 6, 0),
      match(['ana'], ['caio'], 6, 0),
      match(['ana'], ['caio'], 6, 0),
      match(['ana'], ['caio'], 0, 6),
    ])
    expect(s).toEqual({ kind: 'loss', count: 1 })
  })
})

describe('countTrophies', () => {
  it('separa título, vice e terceiro', () => {
    expect(
      countTrophies([
        { tournamentId: 'a', position: 1 },
        { tournamentId: 'b', position: 1 },
        { tournamentId: 'c', position: 2 },
        { tournamentId: 'd', position: 3 },
      ]),
    ).toEqual({ titles: 2, runnerUps: 1, thirds: 1, podiums: 4 })
  })

  it('sem pódio nenhum é tudo zero', () => {
    expect(countTrophies([])).toEqual({ titles: 0, runnerUps: 0, thirds: 0, podiums: 0 })
  })
})
