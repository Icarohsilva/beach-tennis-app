// lib/liga/sportForPoints.test.ts
import { describe, it, expect } from 'vitest'
import { sportForAttendance } from './sportForPoints'

describe('sportForAttendance', () => {
  it('usa a modalidade da turma quando ela existe', () => {
    expect(sportForAttendance('padel', ['beach_tennis', 'padel'])).toBe('padel')
  })

  it('turma sem modalidade cai no único esporte da academia', () => {
    expect(sportForAttendance(null, ['beach_tennis'])).toBe('beach_tennis')
  })

  it('turma sem modalidade em academia multi-modalidade não pontua', () => {
    expect(sportForAttendance(null, ['beach_tennis', 'padel'])).toBeNull()
  })

  it('turma sem modalidade em academia sem cardápio não pontua', () => {
    expect(sportForAttendance(null, [])).toBeNull()
  })

  it('modalidade da turma vale mesmo se a academia parou de oferecer', () => {
    // updateClass preserva a modalidade já gravada (spec de esportes); o histórico
    // de pontos não pode mudar de esporte porque o cardápio mudou depois.
    expect(sportForAttendance('futevolei', ['beach_tennis'])).toBe('futevolei')
  })

  it('string vazia é tratada como sem modalidade', () => {
    expect(sportForAttendance('', ['beach_tennis'])).toBe('beach_tennis')
    expect(sportForAttendance('', ['beach_tennis', 'padel'])).toBeNull()
  })
})
