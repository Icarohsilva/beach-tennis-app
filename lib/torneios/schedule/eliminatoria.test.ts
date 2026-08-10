import { describe, it, expect } from 'vitest'
import { bracketSize, roundsForSize, winnerSlot } from '../bracket'
import type { EntryRef, MatchResultInput, ScoringConfig } from '../types'
import {
  MAX_ELIMINATION_ENTRIES,
  computeEliminationStandings,
  generateEliminationBracket,
} from './eliminatoria'

const SCORING: ScoringConfig = { sets_to_win: 1, games_per_set: 6, tiebreak_games: true }

function solo(n: number): EntryRef[] {
  return Array.from({ length: n }, (_, i) => ({ playerId: `p${i + 1}`, partnerId: null }))
}

function pairs(n: number): EntryRef[] {
  return Array.from({ length: n }, (_, i) => ({ playerId: `a${i + 1}`, partnerId: `b${i + 1}` }))
}

/** Toda partida que existe na chave, achatada. */
function allMatches(plan: ReturnType<typeof generateEliminationBracket>) {
  return plan.flatMap((r) => r.matches.map((m) => ({ ...m, round: r.round })))
}

describe('geração da chave', () => {
  it('recusa gente de menos e gente demais', () => {
    expect(() => generateEliminationBracket(solo(1))).toThrow(/pelo menos 2/)
    expect(() => generateEliminationBracket(solo(MAX_ELIMINATION_ENTRIES + 1))).toThrow(/no máximo/)
  })

  it('chave cheia de 8 tem 4 + 2 + 1 partidas', () => {
    const plan = generateEliminationBracket(solo(8))
    expect(plan.map((r) => r.matches.length)).toEqual([4, 2, 1])
  })

  it('cria a chave inteira já na geração, com a final vazia esperando', () => {
    // É o que permite ver o caminho até a final desde o primeiro dia.
    const plan = generateEliminationBracket(solo(8))
    const final = plan[2].matches[0]
    expect(final.p1).toBeNull()
    expect(final.p2).toBeNull()
    expect(final.matchNo).toBe(1)
  })

  it('todo confronto de primeira rodada opõe seeds complementares', () => {
    const plan = generateEliminationBracket(solo(8))
    expect(plan[0].matches.map((m) => [m.p1, m.p2])).toEqual([
      ['p1', 'p8'],
      ['p4', 'p5'],
      ['p2', 'p7'],
      ['p3', 'p6'],
    ])
  })

  it('os dois cabeças caem em metades opostas', () => {
    // O critério que importa: 1 e 2 só podem se encontrar na final.
    const plan = generateEliminationBracket(solo(8))
    const metadeDoTopo = plan[0].matches.slice(0, 2).flatMap((m) => [m.p1, m.p2])
    expect(metadeDoTopo).toContain('p1')
    expect(metadeDoTopo).not.toContain('p2')
  })

  it('preserva o parceiro da dupla fixa', () => {
    const plan = generateEliminationBracket(pairs(4))
    const first = plan[0].matches[0]
    expect(first.p1).toBe('a1')
    expect(first.partner1).toBe('b1')
    expect(first.p2).toBe('a4')
    expect(first.partner2).toBe('b4')
  })
})

describe('bye', () => {
  it('quem recebe bye já nasce posicionado na rodada seguinte', () => {
    const plan = generateEliminationBracket(solo(5))
    // Chave de 8 com 5 inscritos: p1, p2 e p3 passam direto; só p4 x p5 se joga
    // na 1ª rodada, e o vencedor pega p1 na semi.
    expect(plan[0].matches).toHaveLength(1)
    expect([plan[0].matches[0].p1, plan[0].matches[0].p2]).toEqual(['p4', 'p5'])

    const round2 = plan[1].matches
    expect([round2[0].p1, round2[0].p2]).toEqual(['p1', null])
    expect([round2[1].p1, round2[1].p2]).toEqual(['p2', 'p3'])
  })

  it('não cria partida vazia para o bye', () => {
    // Um "jogo" contra ninguém apareceria na tela do aluno como confronto real.
    const plan = generateEliminationBracket(solo(5))
    for (const m of plan[0].matches) {
      expect(m.p1).not.toBeNull()
      expect(m.p2).not.toBeNull()
    }
  })

  it('o número total de partidas jogáveis é sempre inscritos - 1', () => {
    // Todo mata-mata elimina um por partida: n-1 partidas produzem 1 campeão.
    for (let n = 2; n <= 33; n++) {
      const total = allMatches(generateEliminationBracket(solo(n))).length
      const byes = bracketSize(n) - n
      // As partidas de 1ª rodada que o bye dispensa não são criadas.
      expect(total, `${n} inscritos`).toBe(bracketSize(n) - 1 - byes)
      expect(total, `${n} inscritos`).toBe(n - 1)
    }
  })

  it('o cabeça 1 é sempre um dos que folga quando há bye', () => {
    const plan = generateEliminationBracket(solo(5))
    const jogaNaPrimeira = plan[0].matches.some((m) => m.p1 === 'p1' || m.p2 === 'p1')
    expect(jogaNaPrimeira).toBe(false)
  })
})

describe('integridade estrutural', () => {
  it('cada partida tem matchNo único dentro da rodada', () => {
    for (const n of [2, 5, 8, 12, 16, 31]) {
      const plan = generateEliminationBracket(solo(n))
      for (const round of plan) {
        const nos = round.matches.map((m) => m.matchNo)
        expect(new Set(nos).size, `n=${n} rodada ${round.round}`).toBe(nos.length)
      }
    }
  })

  it('todo vencedor tem para onde subir, menos o da final', () => {
    const n = 12
    const plan = generateEliminationBracket(solo(n))
    const totalRounds = roundsForSize(bracketSize(n))
    const existing = new Set(
      allMatches(plan).map((m) => `${m.round}:${m.matchNo}`),
    )
    for (const m of allMatches(plan)) {
      const dest = winnerSlot(m.round, m.matchNo!, totalRounds)
      if (m.round === totalRounds) {
        expect(dest).toBeNull()
      } else {
        expect(existing.has(`${dest!.round}:${dest!.matchNo}`), `de ${m.round}:${m.matchNo}`).toBe(true)
      }
    }
  })

  it('ninguém aparece duas vezes na primeira rodada', () => {
    const plan = generateEliminationBracket(solo(16))
    const ids = plan[0].matches.flatMap((m) => [m.p1, m.p2])
    expect(new Set(ids).size).toBe(16)
  })

  it('chave de 2 é só a final', () => {
    const plan = generateEliminationBracket(solo(2))
    expect(plan).toHaveLength(1)
    expect(plan[0].matches).toHaveLength(1)
    expect([plan[0].matches[0].p1, plan[0].matches[0].p2]).toEqual(['p1', 'p2'])
  })
})

describe('computeEliminationStandings', () => {
  const entries = solo(4)

  // Chave de 4: p1 x p4 e p3 x p2; final entre os vencedores.
  const played: MatchResultInput[] = [
    { player1_id: 'p1', partner1_id: null, player2_id: 'p4', partner2_id: null, games1: 6, games2: 0, result_status: 'confirmed', round: 1 },
    { player1_id: 'p3', partner1_id: null, player2_id: 'p2', partner2_id: null, games1: 2, games2: 6, result_status: 'confirmed', round: 1 },
    { player1_id: 'p1', partner1_id: null, player2_id: 'p2', partner2_id: null, games1: 4, games2: 6, result_status: 'confirmed', round: 2 },
  ]

  it('campeão em primeiro, vice em segundo', () => {
    const rows = computeEliminationStandings(entries, played, SCORING)
    expect(rows.map((r) => r.playerId).slice(0, 2)).toEqual(['p2', 'p1'])
  })

  it('o vice fica à frente de quem caiu antes, mesmo com saldo pior', () => {
    // p1 perdeu a final por 4x6 (saldo +6 no total); p4 caiu na 1ª levando 0x6.
    // Ordenar por saldo poria o campeão em quarto — por isso a chave tem regra própria.
    const rows = computeEliminationStandings(entries, played, SCORING)
    const pos = (id: string) => rows.findIndex((r) => r.playerId === id)
    expect(pos('p1')).toBeLessThan(pos('p3'))
    expect(pos('p1')).toBeLessThan(pos('p4'))
  })

  it('conta vitórias e games de cada lado', () => {
    const rows = computeEliminationStandings(entries, played, SCORING)
    const champ = rows.find((r) => r.playerId === 'p2')!
    expect(champ.played).toBe(2)
    expect(champ.wins).toBe(2)
    expect(champ.gamesFor).toBe(12)
    expect(champ.gamesAgainst).toBe(6)
  })

  it('placar não confirmado não mexe na classificação', () => {
    const pending: MatchResultInput[] = [
      { ...played[0], result_status: 'pending' },
    ]
    const rows = computeEliminationStandings(entries, pending, SCORING)
    expect(rows.every((r) => r.played === 0)).toBe(true)
  })

  it('inscrito que ainda não jogou aparece com tudo zerado', () => {
    const rows = computeEliminationStandings(entries, [], SCORING)
    expect(rows).toHaveLength(4)
    expect(rows.every((r) => r.played === 0 && r.wins === 0)).toBe(true)
  })

  it('a dupla inteira sobe junto na classificação', () => {
    const duo = pairs(2)
    const rows = computeEliminationStandings(duo, [
      { player1_id: 'a1', partner1_id: 'b1', player2_id: 'a2', partner2_id: 'b2', games1: 6, games2: 3, result_status: 'confirmed', round: 1 },
    ], SCORING)
    expect(rows.slice(0, 2).map((r) => r.playerId).sort()).toEqual(['a1', 'b1'])
  })
})
