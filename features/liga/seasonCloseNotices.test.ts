// features/liga/seasonCloseNotices.test.ts
// Só a montagem da lista de avisos — a parte com regra do fechamento. O resto de
// closeLigaSeason é I/O contra o Supabase e não cabe em teste unitário.
import { describe, it, expect } from 'vitest'
import { buildSeasonCloseNotices, type SeasonMove } from './seasonClose'
import type { Division } from '@/lib/liga/divisions'

function st(student_id: string, points: number, division: Division, sport = 'beach_tennis') {
  return { student_id, sport, division, points }
}

describe('buildSeasonCloseNotices', () => {
  it('avisa o campeão da divisão, mesmo sem promoção', () => {
    const notices = buildSeasonCloseNotices(
      [st('a', 300, 'diamante'), st('b', 200, 'diamante')],
      [],
    )
    expect(notices).toEqual([
      { studentId: 'a', outcome: 'campeao', sport: 'beach_tennis', from: 'diamante', to: null },
    ])
  })

  it('campeão que subiu recebe um aviso só, com a divisão de destino', () => {
    const moves: SeasonMove[] = [
      { studentId: 'a', sport: 'beach_tennis', from: 'prata', to: 'ouro' },
    ]
    const notices = buildSeasonCloseNotices([st('a', 300, 'prata'), st('b', 10, 'prata')], moves)
    expect(notices).toEqual([
      { studentId: 'a', outcome: 'campeao_subiu', sport: 'beach_tennis', from: 'prata', to: 'ouro' },
    ])
  })

  it('quem caiu com ponto é avisado; quem caiu com zero não', () => {
    const moves: SeasonMove[] = [
      { studentId: 'b', sport: 'beach_tennis', from: 'ouro', to: 'prata' },
      { studentId: 'c', sport: 'beach_tennis', from: 'ouro', to: 'prata' },
    ]
    const notices = buildSeasonCloseNotices(
      [st('a', 100, 'ouro'), st('b', 20, 'ouro'), st('c', 0, 'ouro')],
      moves,
    )
    expect(notices.map((n) => n.studentId).sort()).toEqual(['a', 'b'])
    expect(notices.find((n) => n.studentId === 'b')?.outcome).toBe('caiu')
  })

  it('divisão em que ninguém pontuou não produz campeão', () => {
    expect(buildSeasonCloseNotices([st('a', 0, 'bronze'), st('b', 0, 'bronze')], [])).toEqual([])
  })

  it('campeão é por divisão, não por academia: o Bronze tem o seu', () => {
    const notices = buildSeasonCloseNotices(
      [st('ouro1', 50, 'ouro'), st('bronze1', 400, 'bronze'), st('bronze2', 10, 'bronze')],
      [],
    )
    expect(notices.map((n) => n.studentId).sort()).toEqual(['bronze1', 'ouro1'])
  })

  it('aluno que se moveu em dois esportes recebe um aviso só, o melhor deles', () => {
    const moves: SeasonMove[] = [
      { studentId: 'a', sport: 'beach_tennis', from: 'ouro', to: 'prata' },
      { studentId: 'a', sport: 'padel', from: 'prata', to: 'ouro' },
    ]
    const notices = buildSeasonCloseNotices(
      [
        st('a', 30, 'ouro', 'beach_tennis'),
        st('outro', 90, 'ouro', 'beach_tennis'),
        st('a', 80, 'prata', 'padel'),
        st('outro2', 90, 'prata', 'padel'),
      ],
      moves,
    )
    const meu = notices.filter((n) => n.studentId === 'a')
    expect(meu).toHaveLength(1)
    expect(meu[0]).toMatchObject({ outcome: 'subiu', sport: 'padel', to: 'ouro' })
  })

  it('empate em pontos escolhe o mesmo campeão que computeDivisionMoves promoveria', () => {
    const notices = buildSeasonCloseNotices(
      [st('z', 50, 'prata'), st('a', 50, 'prata'), st('m', 50, 'prata')],
      [],
    )
    expect(notices.map((n) => n.studentId)).toEqual(['a'])
  })

  it('quem pontuou, não foi campeão e não se moveu fica de fora', () => {
    const notices = buildSeasonCloseNotices([st('a', 100, 'prata'), st('b', 50, 'prata')], [])
    expect(notices.map((n) => n.studentId)).toEqual(['a'])
  })
})
