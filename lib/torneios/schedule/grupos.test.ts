import { describe, it, expect } from 'vitest'
import type { EntryRef, MatchResultInput, ScoringConfig } from '../types'
import {
  MAX_GROUPS,
  computeGroupStandings,
  computeGroupTables,
  computeGroupsStandings,
  distributeIntoGroups,
  generateGroupStage,
  generateKnockoutFromGroups,
  groupLabel,
  isGroupStageComplete,
  rankQualifiers,
  splitPhases,
} from './grupos'

const SCORING: ScoringConfig = { sets_to_win: 1, games_per_set: 6, tiebreak_games: true }

function solo(n: number): EntryRef[] {
  return Array.from({ length: n }, (_, i) => ({ playerId: `p${i + 1}`, partnerId: null }))
}

/** Vitória simples de `winner` sobre `loser` naquele grupo. */
function win(
  winner: string,
  loser: string,
  group: string | null,
  round = 1,
): MatchResultInput {
  return {
    player1_id: winner, partner1_id: null, player2_id: loser, partner2_id: null,
    games1: 6, games2: 2, result_status: 'confirmed', round, group,
  }
}

describe('distributeIntoGroups', () => {
  it('serpenteia: a segunda linha volta ao contrário', () => {
    const groups = distributeIntoGroups([1, 2, 3, 4, 5, 6], 3)
    expect(groups).toEqual([[1, 6], [2, 5], [3, 4]])
  })

  it('reparte o mais igualmente possível quando não divide exato', () => {
    const groups = distributeIntoGroups(solo(7), 3).map((g) => g.length)
    expect(groups.sort()).toEqual([2, 2, 3])
  })

  it('não perde nem duplica ninguém', () => {
    const entries = solo(11)
    const flat = distributeIntoGroups(entries, 4).flat()
    expect(flat).toHaveLength(11)
    expect(new Set(flat.map((e) => e.playerId)).size).toBe(11)
  })

  it('espalha os favoritos: os quatro primeiros caem em grupos diferentes', () => {
    // Em blocos, os 4 melhores cairiam todos no grupo A e metade do torneio
    // morreria na primeira fase.
    const groups = distributeIntoGroups(solo(16), 4)
    const grupoDe = (id: string) => groups.findIndex((g) => g.some((e) => e.playerId === id))
    expect(new Set(['p1', 'p2', 'p3', 'p4'].map(grupoDe)).size).toBe(4)
  })
})

describe('groupLabel', () => {
  it('numera por letra', () => {
    expect([0, 1, 2].map(groupLabel)).toEqual(['A', 'B', 'C'])
  })
})

describe('generateGroupStage', () => {
  it('recusa configuração impossível', () => {
    expect(() => generateGroupStage(solo(8), 1)).toThrow(/pelo menos 2 grupos/)
    expect(() => generateGroupStage(solo(40), MAX_GROUPS + 1)).toThrow(/No máximo/)
    expect(() => generateGroupStage(solo(3), 2)).toThrow(/ao menos 4 inscritos/)
  })

  it('todos os grupos jogam em paralelo na mesma rodada', () => {
    const plan = generateGroupStage(solo(8), 2)
    // Dois grupos de 4: 3 rodadas, e cada rodada tem as 2 partidas de A mais as
    // 2 de B.
    expect(plan).toHaveLength(3)
    for (const round of plan) {
      expect(round.matches).toHaveLength(4)
      expect(new Set(round.matches.map((m) => m.group))).toEqual(new Set(['A', 'B']))
    }
  })

  it('marca o grupo em toda partida da primeira fase', () => {
    const plan = generateGroupStage(solo(8), 2)
    expect(plan.every((r) => r.matches.every((m) => !!m.group))).toBe(true)
  })

  it('numera as partidas dentro da rodada inteira, não dentro do grupo', () => {
    // A coordenada (torneio, rodada, match_no) é única no banco: repetir o
    // número em grupos diferentes derrubaria o insert.
    const plan = generateGroupStage(solo(12), 3)
    for (const round of plan) {
      const nos = round.matches.map((m) => m.matchNo)
      expect(new Set(nos).size).toBe(nos.length)
    }
  })

  it('dentro do grupo cada par se enfrenta uma vez só', () => {
    const plan = generateGroupStage(solo(12), 3)
    const seen = new Map<string, number>()
    for (const round of plan) {
      for (const m of round.matches) {
        const key = `${m.group}:${[m.p1, m.p2].sort().join('|')}`
        seen.set(key, (seen.get(key) ?? 0) + 1)
      }
    }
    // 3 grupos de 4 → 6 confrontos por grupo.
    expect(seen.size).toBe(18)
    expect(Array.from(seen.values()).every((c) => c === 1)).toBe(true)
  })

  it('ninguém enfrenta gente de outro grupo', () => {
    const plan = generateGroupStage(solo(12), 3)
    const groups = distributeIntoGroups(solo(12), 3)
    const grupoDe = new Map<string, string>()
    groups.forEach((g, i) => g.forEach((e) => grupoDe.set(e.playerId, groupLabel(i))))
    for (const round of plan) {
      for (const m of round.matches) {
        expect(grupoDe.get(m.p1!)).toBe(m.group)
        expect(grupoDe.get(m.p2!)).toBe(m.group)
      }
    }
  })

  it('grupo menor acaba antes sem furar a rodada dos outros', () => {
    // 7 em 3 grupos → tamanhos 3, 2, 2. O grupo de 3 joga 3 rodadas.
    const plan = generateGroupStage(solo(7), 3)
    expect(plan.length).toBe(3)
    expect(plan[0].matches.length).toBeGreaterThan(plan[2].matches.length)
  })
})

/**
 * Roda uma fase de grupos inteira, com vitória de quem entrou primeiro na
 * partida. Deriva tudo do próprio gerador — cravar os grupos à mão no teste
 * fabrica confronto entre gente que nunca esteve no mesmo grupo.
 */
function jogarGrupos(total: number, groupCount: number) {
  const entries = solo(total)
  const stage = generateGroupStage(entries, groupCount)
  const results: MatchResultInput[] = stage.flatMap((r) =>
    r.matches.map((m) => win(m.p1!, m.p2!, m.group ?? null, r.round)),
  )
  const tables = computeGroupTables(entries, results, groupCount, SCORING)
  const grupoDe = new Map<string, string>()
  for (const t of tables) for (const e of t.entries) grupoDe.set(e.playerId, t.label)
  return { entries, stage, results, tables, grupoDe }
}

describe('computeGroupStandings', () => {
  const entries = solo(3)

  it('quem venceu mais fica na frente, mesmo com saldo pior', () => {
    // p1 vence 2 jogos apertados; p2 vence 1 goleando. Pelo critério do
    // americano (saldo primeiro) p2 lideraria o grupo e passaria no lugar de
    // quem ganhou mais jogos.
    const rows = computeGroupStandings(
      entries,
      [
        { player1_id: 'p1', partner1_id: null, player2_id: 'p2', partner2_id: null, games1: 6, games2: 5, result_status: 'confirmed', group: 'A' },
        { player1_id: 'p1', partner1_id: null, player2_id: 'p3', partner2_id: null, games1: 6, games2: 5, result_status: 'confirmed', group: 'A' },
        { player1_id: 'p2', partner1_id: null, player2_id: 'p3', partner2_id: null, games1: 6, games2: 0, result_status: 'confirmed', group: 'A' },
      ],
      SCORING,
    )
    expect(rows.map((r) => r.playerId)).toEqual(['p1', 'p2', 'p3'])
    expect(rows[0].wins).toBe(2)
    expect(rows[0].diff).toBe(2)
    expect(rows[1].wins).toBe(1)
    expect(rows[1].diff).toBe(5)
  })

  it('empate em vitórias desempata pelo saldo', () => {
    const rows = computeGroupStandings(
      solo(2),
      [
        { player1_id: 'p1', partner1_id: null, player2_id: 'p2', partner2_id: null, games1: 6, games2: 1, result_status: 'confirmed', group: 'A' },
      ],
      SCORING,
    )
    expect(rows[0].playerId).toBe('p1')
  })
})

describe('rankQualifiers', () => {
  const { tables } = jogarGrupos(8, 2)

  it('primeiro os líderes de cada grupo, depois os vices', () => {
    const q = rankQualifiers(tables, 2)
    const lider = (label: string) => tables.find((t) => t.label === label)!
    // Os dois primeiros seeds são os líderes de A e B, nessa ordem.
    expect(q[0].playerId).toBe(lider('A').rows[0].playerId)
    expect(q[1].playerId).toBe(lider('B').rows[0].playerId)
  })

  it('leva só quantos a academia definiu', () => {
    expect(rankQualifiers(tables, 1)).toHaveLength(2)
    expect(rankQualifiers(tables, 2)).toHaveLength(4)
  })

  it('classificado nenhum não vira chave', () => {
    expect(rankQualifiers([], 2)).toEqual([])
  })
})

describe('generateKnockoutFromGroups', () => {
  const { tables, grupoDe } = jogarGrupos(8, 2)

  it('desloca as rodadas para depois da fase de grupos', () => {
    // Sem o deslocamento as duas fases colidiriam na coordenada do banco.
    const plan = generateKnockoutFromGroups(tables, 2, 3)
    expect(plan.map((r) => r.round)).toEqual([4, 5])
  })

  it('nenhuma partida do mata-mata carrega grupo', () => {
    const plan = generateKnockoutFromGroups(tables, 2, 3)
    expect(plan.every((r) => r.matches.every((m) => m.group === null))).toBe(true)
  })

  it('ninguém estreia contra quem já enfrentou no grupo', () => {
    // É o motivo de existir a ordem "líderes primeiro, vices depois".
    const plan = generateKnockoutFromGroups(tables, 2, 3)
    for (const m of plan[0].matches) {
      expect(grupoDe.get(m.p1!), `${m.p1} x ${m.p2}`).not.toBe(grupoDe.get(m.p2!))
    }
  })

  it('a semifinal é a rodada seguinte à estreia', () => {
    const plan = generateKnockoutFromGroups(tables, 2, 3)
    expect(plan[0].matches).toHaveLength(2)
    expect(plan[1].matches).toHaveLength(1)
  })

  it('classificado de menos não gera chave nenhuma', () => {
    expect(generateKnockoutFromGroups([], 2, 3)).toEqual([])
  })
})

describe('estreia sem revanche em várias configurações', () => {
  // A propriedade precisa valer também quando os classificados NÃO enchem a
  // chave: 3 grupos × 2 = 6 numa chave de 8, e os byes deslocam os pares.
  // Foi exatamente esse caso que quebrou a primeira versão da semeadura.
  for (const groupCount of [2, 3, 4, 5, 6, 8]) {
    for (const advance of [1, 2]) {
      it(`${groupCount} grupos, ${advance} passa(m)`, () => {
        const { stage, tables, grupoDe } = jogarGrupos(groupCount * 4, groupCount)
        const plan = generateKnockoutFromGroups(tables, advance, stage.length)
        if (plan.length === 0) return

        for (const m of plan[0].matches) {
          expect(
            grupoDe.get(m.p1!),
            `${groupCount} grupos / passam ${advance}: ${m.p1} x ${m.p2}`,
          ).not.toBe(grupoDe.get(m.p2!))
        }
      })
    }
  }

  it('todo classificado entra na chave exatamente uma vez', () => {
    const { stage, tables } = jogarGrupos(12, 3)
    const plan = generateKnockoutFromGroups(tables, 2, stage.length)
    const naChave = plan[0].matches.flatMap((m) => [m.p1, m.p2]).filter(Boolean)
    const prePosicionados = plan
      .slice(1)
      .flatMap((r) => r.matches.flatMap((m) => [m.p1, m.p2]))
      .filter(Boolean)
    const todos = [...naChave, ...prePosicionados]
    expect(todos).toHaveLength(6)
    expect(new Set(todos).size).toBe(6)
  })
})

describe('isGroupStageComplete', () => {
  it('falso enquanto faltar placar confirmado', () => {
    expect(
      isGroupStageComplete([win('p1', 'p2', 'A'), { ...win('p3', 'p4', 'A'), result_status: 'pending' }]),
    ).toBe(false)
  })

  it('verdadeiro quando todos os jogos de grupo saíram', () => {
    expect(isGroupStageComplete([win('p1', 'p2', 'A'), win('p3', 'p4', 'B')])).toBe(true)
  })

  it('torneio sem fase de grupos não conta como completa', () => {
    expect(isGroupStageComplete([win('p1', 'p2', null)])).toBe(false)
  })

  it('o mata-mata pendente não impede o fecho dos grupos', () => {
    expect(
      isGroupStageComplete([
        win('p1', 'p2', 'A'),
        { ...win('p1', 'p3', null, 4), result_status: null },
      ]),
    ).toBe(true)
  })
})

describe('splitPhases', () => {
  const matches = [
    { id: 'g1', round: 1, group: 'A' },
    { id: 'g2', round: 2, group: 'A' },
    { id: 'g3', round: 3, group: 'B' },
    { id: 'k1', round: 4, group: null },
    { id: 'k2', round: 5, group: null },
  ]

  it('separa as duas fases', () => {
    const { groupMatches, knockoutMatches } = splitPhases(matches)
    expect(groupMatches.map((m) => m.id)).toEqual(['g1', 'g2', 'g3'])
    expect(knockoutMatches.map((m) => m.id)).toEqual(['k1', 'k2'])
  })

  it('renumera o mata-mata a partir de 1', () => {
    // Sem isso a chave leria a rodada 4 como a quinta fase e chamaria a final
    // de outra coisa.
    const { knockoutMatches, groupRounds } = splitPhases(matches)
    expect(groupRounds).toBe(3)
    expect(knockoutMatches.map((m) => m.round)).toEqual([1, 2])
  })

  it('torneio sem grupos não desloca nada', () => {
    const { knockoutMatches, groupRounds } = splitPhases([{ id: 'a', round: 1, group: null }])
    expect(groupRounds).toBe(0)
    expect(knockoutMatches[0].round).toBe(1)
  })
})

describe('computeGroupsStandings', () => {
  const entries = solo(4)
  const groupPhase = [win('p1', 'p3', 'A'), win('p2', 'p4', 'B')]

  it('durante os grupos, ordena pela campanha do grupo', () => {
    const rows = computeGroupsStandings(entries, groupPhase, SCORING)
    expect(rows.slice(0, 2).map((r) => r.playerId).sort()).toEqual(['p1', 'p2'])
  })

  it('o campeão do mata-mata assume o topo', () => {
    const comFinal = [...groupPhase, win('p2', 'p1', null, 4)]
    const rows = computeGroupsStandings(entries, comFinal, SCORING)
    expect(rows[0].playerId).toBe('p2')
    expect(rows[1].playerId).toBe('p1')
  })

  it('quem chegou ao mata-mata fica acima de quem parou nos grupos', () => {
    // Mesmo que o eliminado tivesse saldo melhor na primeira fase.
    const comFinal = [...groupPhase, win('p2', 'p1', null, 4)]
    const rows = computeGroupsStandings(entries, comFinal, SCORING)
    const pos = (id: string) => rows.findIndex((r) => r.playerId === id)
    expect(pos('p1')).toBeLessThan(pos('p3'))
    expect(pos('p1')).toBeLessThan(pos('p4'))
  })

  it('os números somam as duas fases', () => {
    const comFinal = [...groupPhase, win('p2', 'p1', null, 4)]
    const rows = computeGroupsStandings(entries, comFinal, SCORING)
    const champ = rows.find((r) => r.playerId === 'p2')!
    expect(champ.played).toBe(2)
    expect(champ.wins).toBe(2)
  })

  it('todo inscrito aparece, mesmo sem ter jogado', () => {
    const rows = computeGroupsStandings(entries, [], SCORING)
    expect(rows).toHaveLength(4)
  })
})
