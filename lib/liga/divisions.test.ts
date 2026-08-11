// lib/liga/divisions.test.ts
import { describe, it, expect } from 'vitest'
import {
  computeDivisionMoves,
  firstDemotedPosition,
  promoteLimit,
  type DivisionCut,
  type DivisionCuts,
  type StandingRow,
} from './divisions'

function row(studentId: string, points: number, division: StandingRow['division']): StandingRow {
  return { studentId, points, division }
}

/** Corte igual em todas as divisões — o comportamento antigo, de um número só. */
function flat(promote: number, demote: number): DivisionCuts {
  const cut: DivisionCut = { promote, demoteMode: 'ultimos', demote }
  return { bronze: { ...cut }, prata: { ...cut }, ouro: { ...cut }, diamante: { ...cut } }
}

describe('computeDivisionMoves', () => {
  it('promove os N primeiros e rebaixa os M últimos da divisão', () => {
    const rows = [
      row('a', 100, 'prata'),
      row('b', 90, 'prata'),
      row('c', 80, 'prata'),
      row('d', 70, 'prata'),
      row('e', 60, 'prata'),
      row('f', 50, 'prata'),
    ]
    const moves = computeDivisionMoves(rows, flat(2, 2))
    expect(moves).toEqual([
      { studentId: 'a', from: 'prata', to: 'ouro' },
      { studentId: 'b', from: 'prata', to: 'ouro' },
      { studentId: 'e', from: 'prata', to: 'bronze' },
      { studentId: 'f', from: 'prata', to: 'bronze' },
    ])
  })

  it('diamante não promove ninguém, só rebaixa', () => {
    const rows = [row('a', 100, 'diamante'), row('b', 50, 'diamante')]
    const moves = computeDivisionMoves(rows, flat(1, 1))
    expect(moves).toEqual([{ studentId: 'b', from: 'diamante', to: 'ouro' }])
  })

  it('bronze não rebaixa ninguém, só promove', () => {
    const rows = [row('a', 100, 'bronze'), row('b', 50, 'bronze')]
    const moves = computeDivisionMoves(rows, flat(1, 1))
    expect(moves).toEqual([{ studentId: 'a', from: 'bronze', to: 'prata' }])
  })

  it('aluno com 0 ponto nunca é promovido', () => {
    const rows = [row('a', 0, 'bronze'), row('b', 0, 'bronze')]
    expect(computeDivisionMoves(rows, flat(2, 0))).toEqual([])
  })

  it('divisão com menos gente que o corte não promove e rebaixa ao mesmo tempo o mesmo aluno', () => {
    const rows = [row('a', 100, 'prata'), row('b', 90, 'prata')]
    const moves = computeDivisionMoves(rows, flat(2, 2))
    expect(moves).toEqual([
      { studentId: 'a', from: 'prata', to: 'ouro' },
      { studentId: 'b', from: 'prata', to: 'ouro' },
    ])
  })

  it('empate em pontos desempata de forma estável por studentId', () => {
    const rows = [row('z', 50, 'prata'), row('a', 50, 'prata'), row('m', 50, 'prata')]
    const moves = computeDivisionMoves(rows, flat(1, 0))
    expect(moves).toEqual([{ studentId: 'a', from: 'prata', to: 'ouro' }])
  })

  it('processa divisões independentemente', () => {
    const rows = [row('a', 100, 'bronze'), row('b', 10, 'bronze'), row('c', 100, 'ouro'), row('d', 10, 'ouro')]
    const moves = computeDivisionMoves(rows, flat(1, 1))
    expect(moves).toEqual([
      { studentId: 'a', from: 'bronze', to: 'prata' },
      { studentId: 'c', from: 'ouro', to: 'diamante' },
      { studentId: 'd', from: 'ouro', to: 'prata' },
    ])
  })

  it('lista vazia devolve lista vazia', () => {
    expect(computeDivisionMoves([], flat(5, 3))).toEqual([])
  })

  it('cada divisão usa o próprio corte: funil de 3, 2 e 1', () => {
    const cuts: DivisionCuts = {
      bronze: { promote: 3, demoteMode: 'ultimos', demote: 0 },
      prata: { promote: 2, demoteMode: 'ultimos', demote: 0 },
      ouro: { promote: 1, demoteMode: 'ultimos', demote: 0 },
      diamante: { promote: 0, demoteMode: 'ultimos', demote: 0 },
    }
    const rows = [
      row('b1', 90, 'bronze'), row('b2', 80, 'bronze'), row('b3', 70, 'bronze'), row('b4', 60, 'bronze'),
      row('p1', 90, 'prata'), row('p2', 80, 'prata'), row('p3', 70, 'prata'),
      row('o1', 90, 'ouro'), row('o2', 80, 'ouro'),
    ]
    expect(computeDivisionMoves(rows, cuts).map((m) => m.studentId)).toEqual([
      'b1', 'b2', 'b3', 'p1', 'p2', 'o1',
    ])
  })

  it('modo permanecem: na divisão do topo só o campeão fica e o resto desce', () => {
    const cuts = flat(0, 0)
    cuts.diamante = { promote: 0, demoteMode: 'permanecem', demote: 1 }
    const rows = [
      row('a', 100, 'diamante'),
      row('b', 90, 'diamante'),
      row('c', 80, 'diamante'),
      row('d', 70, 'diamante'),
    ]
    expect(computeDivisionMoves(rows, cuts)).toEqual([
      { studentId: 'b', from: 'diamante', to: 'ouro' },
      { studentId: 'c', from: 'diamante', to: 'ouro' },
      { studentId: 'd', from: 'diamante', to: 'ouro' },
    ])
  })

  it('modo permanecem conta depois de quem sobe, então promovido nunca é rebaixado', () => {
    const cuts = flat(0, 0)
    cuts.prata = { promote: 2, demoteMode: 'permanecem', demote: 1 }
    const rows = [
      row('a', 100, 'prata'),
      row('b', 90, 'prata'),
      row('c', 80, 'prata'),
      row('d', 70, 'prata'),
    ]
    expect(computeDivisionMoves(rows, cuts)).toEqual([
      { studentId: 'a', from: 'prata', to: 'ouro' },
      { studentId: 'b', from: 'prata', to: 'ouro' },
      { studentId: 'd', from: 'prata', to: 'bronze' },
    ])
  })

  it('corte zero não rebaixa ninguém, em qualquer modo', () => {
    const cuts = flat(0, 0)
    cuts.ouro = { promote: 0, demoteMode: 'permanecem', demote: 0 }
    const rows = [row('a', 100, 'ouro'), row('b', 10, 'ouro')]
    expect(computeDivisionMoves(rows, cuts)).toEqual([])
  })
})

describe('promoteLimit', () => {
  it('zera no topo da escada, mesmo com corte configurado', () => {
    expect(promoteLimit(flat(5, 0), 'diamante')).toBe(0)
    expect(promoteLimit(flat(5, 0), 'ouro')).toBe(5)
  })
})

describe('firstDemotedPosition', () => {
  it('bronze nunca rebaixa', () => {
    expect(firstDemotedPosition(flat(0, 3), 'bronze', 10)).toBe(11)
  })

  it('modo ultimos conta do fim da divisão', () => {
    expect(firstDemotedPosition(flat(0, 3), 'prata', 10)).toBe(8)
  })

  it('modo ultimos não passa da primeira posição quando o corte é maior que a divisão', () => {
    expect(firstDemotedPosition(flat(0, 30), 'prata', 10)).toBe(1)
  })

  it('modo permanecem conta do topo, somando quem sobe', () => {
    const cuts = flat(0, 0)
    cuts.prata = { promote: 2, demoteMode: 'permanecem', demote: 1 }
    expect(firstDemotedPosition(cuts, 'prata', 10)).toBe(4)
  })
})
