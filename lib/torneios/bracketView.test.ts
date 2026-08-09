import { describe, it, expect } from 'vitest'
import { buildBracketColumns, findFinal, type BracketMatchInput } from './bracketView'

const NAMES: Record<string, string> = {
  p1: 'Ana', p2: 'Bruno', p3: 'Caio', p4: 'Duda', p5: 'Elis',
  b1: 'Bia', b4: 'Dani',
}

function m(over: Partial<BracketMatchInput> & { round: number; match_no: number }): BracketMatchInput {
  return {
    id: `m${over.round}-${over.match_no}`,
    player1_id: null, partner1_id: null, player2_id: null, partner2_id: null,
    games1: null, games2: null, result_status: null, played_at: null,
    ...over,
  }
}

describe('buildBracketColumns', () => {
  it('sem partidas não há chave', () => {
    expect(buildBracketColumns([], NAMES, null)).toEqual([])
  })

  it('nomeia as fases pela distância até a final', () => {
    const cols = buildBracketColumns(
      [
        m({ round: 1, match_no: 1, player1_id: 'p1', player2_id: 'p2' }),
        m({ round: 1, match_no: 2, player1_id: 'p3', player2_id: 'p4' }),
        m({ round: 2, match_no: 1 }),
      ],
      NAMES,
      null,
    )
    expect(cols.map((c) => c.label)).toEqual(['Semifinal', 'Final'])
  })

  it('resolve os nomes e mostra "A definir" onde ainda não há ninguém', () => {
    const cols = buildBracketColumns(
      [m({ round: 1, match_no: 1, player1_id: 'p1', player2_id: null })],
      NAMES,
      null,
    )
    expect(cols[0].nodes[0].side1.label).toBe('Ana')
    expect(cols[0].nodes[0].side2.label).toBe('A definir')
  })

  it('junta a dupla num rótulo só', () => {
    const cols = buildBracketColumns(
      [m({ round: 1, match_no: 1, player1_id: 'p1', partner1_id: 'b1', player2_id: 'p4', partner2_id: 'b4' })],
      NAMES,
      null,
    )
    expect(cols[0].nodes[0].side1.label).toBe('Ana / Bia')
    expect(cols[0].nodes[0].side2.label).toBe('Duda / Dani')
  })

  it('marca o vencedor só quando o placar está confirmado', () => {
    const confirmado = buildBracketColumns(
      [m({ round: 1, match_no: 1, player1_id: 'p1', player2_id: 'p2', games1: 6, games2: 3, result_status: 'confirmed' })],
      NAMES, null,
    )
    expect(confirmado[0].nodes[0].side1.isWinner).toBe(true)
    expect(confirmado[0].nodes[0].side2.isWinner).toBe(false)

    const pendente = buildBracketColumns(
      [m({ round: 1, match_no: 1, player1_id: 'p1', player2_id: 'p2', games1: 6, games2: 3, result_status: 'pending' })],
      NAMES, null,
    )
    // Placar lançado mas não confirmado ainda não coroa ninguém na chave.
    expect(pendente[0].nodes[0].side1.isWinner).toBe(false)
  })

  it('marca o lado do aluno logado', () => {
    const cols = buildBracketColumns(
      [m({ round: 1, match_no: 1, player1_id: 'p1', partner1_id: 'b1', player2_id: 'p2' })],
      NAMES,
      'b1',
    )
    expect(cols[0].nodes[0].side1.isMine).toBe(true)
    expect(cols[0].nodes[0].side2.isMine).toBe(false)
  })

  it('ordena as partidas pela posição na chave, não pela ordem de chegada', () => {
    const cols = buildBracketColumns(
      [
        m({ round: 1, match_no: 3, player1_id: 'p1', player2_id: 'p2' }),
        m({ round: 1, match_no: 1, player1_id: 'p3', player2_id: 'p4' }),
        m({ round: 1, match_no: 2, player1_id: 'p5', player2_id: 'p1' }),
        m({ round: 1, match_no: 4, player1_id: 'p2', player2_id: 'p3' }),
      ],
      NAMES, null,
    )
    expect(cols[0].nodes.map((n) => n.matchNo)).toEqual([1, 2, 3, 4])
  })
})

describe('bye', () => {
  // Chave de 4 com 3 inscritos: p1 passa direto, p2 x p3 jogam a semi.
  const comBye: BracketMatchInput[] = [
    m({ round: 1, match_no: 2, player1_id: 'p2', player2_id: 'p3' }),
    m({ round: 2, match_no: 1, player1_id: 'p1' }),
  ]

  it('preenche o buraco da rodada 1 com quem passou direto', () => {
    const cols = buildBracketColumns(comBye, NAMES, null)
    expect(cols[0].nodes).toHaveLength(2)
    expect(cols[0].nodes[0].kind).toBe('bye')
    expect(cols[0].nodes[0].byeLabel).toBe('Ana')
    expect(cols[0].nodes[1].kind).toBe('match')
  })

  it('o bye ocupa a posição certa, mantendo a coluna alinhada', () => {
    // Sem o preenchimento, p2 x p3 subiria para a linha 1 e a chave sairia torta.
    const cols = buildBracketColumns(comBye, NAMES, null)
    expect(cols[0].nodes.map((n) => n.matchNo)).toEqual([1, 2])
  })

  it('reconhece o bye do próprio aluno', () => {
    const cols = buildBracketColumns(comBye, NAMES, 'p1')
    expect(cols[0].nodes[0].side1.isMine).toBe(true)
  })

  it('não inventa bye quando a rodada seguinte ainda está vazia', () => {
    // Buraco sem ninguém do outro lado não é passagem direta — é chave incompleta.
    const cols = buildBracketColumns(
      [m({ round: 1, match_no: 2, player1_id: 'p2', player2_id: 'p3' }), m({ round: 2, match_no: 1 })],
      NAMES, null,
    )
    expect(cols[0].nodes.every((n) => n.kind === 'match')).toBe(true)
    expect(cols[0].nodes).toHaveLength(1)
  })
})

describe('findFinal', () => {
  it('devolve a única partida da última coluna', () => {
    const cols = buildBracketColumns(
      [
        m({ round: 1, match_no: 1, player1_id: 'p1', player2_id: 'p2' }),
        m({ round: 1, match_no: 2, player1_id: 'p3', player2_id: 'p4' }),
        m({ round: 2, match_no: 1, player1_id: 'p1', player2_id: 'p3' }),
      ],
      NAMES, null,
    )
    expect(findFinal(cols)?.round).toBe(2)
  })

  it('formato sem chave (rodadas com várias partidas) não tem final', () => {
    const cols = buildBracketColumns(
      [
        m({ round: 1, match_no: 1, player1_id: 'p1', player2_id: 'p2' }),
        m({ round: 1, match_no: 2, player1_id: 'p3', player2_id: 'p4' }),
      ],
      NAMES, null,
    )
    expect(findFinal(cols)).toBeNull()
  })
})
