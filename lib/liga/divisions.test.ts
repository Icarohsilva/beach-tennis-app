// lib/liga/divisions.test.ts
import { describe, it, expect } from 'vitest'
import { computeDivisionMoves, type StandingRow } from './divisions'

function row(studentId: string, points: number, division: StandingRow['division']): StandingRow {
  return { studentId, points, division }
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
    const moves = computeDivisionMoves(rows, 2, 2)
    expect(moves).toEqual([
      { studentId: 'a', from: 'prata', to: 'ouro' },
      { studentId: 'b', from: 'prata', to: 'ouro' },
      { studentId: 'e', from: 'prata', to: 'bronze' },
      { studentId: 'f', from: 'prata', to: 'bronze' },
    ])
  })

  it('diamante não promove ninguém, só rebaixa', () => {
    const rows = [row('a', 100, 'diamante'), row('b', 50, 'diamante')]
    const moves = computeDivisionMoves(rows, 1, 1)
    expect(moves).toEqual([{ studentId: 'b', from: 'diamante', to: 'ouro' }])
  })

  it('bronze não rebaixa ninguém, só promove', () => {
    const rows = [row('a', 100, 'bronze'), row('b', 50, 'bronze')]
    const moves = computeDivisionMoves(rows, 1, 1)
    expect(moves).toEqual([{ studentId: 'a', from: 'bronze', to: 'prata' }])
  })

  it('aluno com 0 ponto nunca é promovido', () => {
    const rows = [row('a', 0, 'bronze'), row('b', 0, 'bronze')]
    expect(computeDivisionMoves(rows, 2, 0)).toEqual([])
  })

  it('divisão com menos gente que o corte não promove e rebaixa ao mesmo tempo o mesmo aluno', () => {
    const rows = [row('a', 100, 'prata'), row('b', 90, 'prata')]
    const moves = computeDivisionMoves(rows, 2, 2)
    expect(moves).toEqual([
      { studentId: 'a', from: 'prata', to: 'ouro' },
      { studentId: 'b', from: 'prata', to: 'ouro' },
    ])
  })

  it('empate em pontos desempata de forma estável por studentId', () => {
    const rows = [row('z', 50, 'prata'), row('a', 50, 'prata'), row('m', 50, 'prata')]
    const moves = computeDivisionMoves(rows, 1, 0)
    expect(moves).toEqual([{ studentId: 'a', from: 'prata', to: 'ouro' }])
  })

  it('processa divisões independentemente', () => {
    const rows = [row('a', 100, 'bronze'), row('b', 10, 'bronze'), row('c', 100, 'ouro'), row('d', 10, 'ouro')]
    const moves = computeDivisionMoves(rows, 1, 1)
    expect(moves).toEqual([
      { studentId: 'a', from: 'bronze', to: 'prata' },
      { studentId: 'c', from: 'ouro', to: 'diamante' },
      { studentId: 'd', from: 'ouro', to: 'prata' },
    ])
  })

  it('lista vazia devolve lista vazia', () => {
    expect(computeDivisionMoves([], 5, 3)).toEqual([])
  })
})
