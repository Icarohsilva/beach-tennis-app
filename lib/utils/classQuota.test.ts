import { describe, it, expect } from 'vitest'
import { cycleWindow } from './classQuota'

describe('cycleWindow', () => {
  it('semanal: quarta-feira devolve a segunda e o domingo da mesma semana', () => {
    // 2026-07-29 é uma quarta-feira.
    expect(cycleWindow('2026-07-29', 'weekly')).toEqual({
      from: '2026-07-27',
      to: '2026-08-02',
    })
  })

  it('semanal: a própria segunda é o início da janela', () => {
    expect(cycleWindow('2026-07-27', 'weekly')).toEqual({
      from: '2026-07-27',
      to: '2026-08-02',
    })
  })

  it('semanal: domingo fecha a semana que começou na segunda anterior', () => {
    // 2026-08-02 é domingo. Não pode abrir uma semana nova.
    expect(cycleWindow('2026-08-02', 'weekly')).toEqual({
      from: '2026-07-27',
      to: '2026-08-02',
    })
  })

  it('mensal: devolve o primeiro e o último dia do mês', () => {
    expect(cycleWindow('2026-07-28', 'monthly')).toEqual({
      from: '2026-07-01',
      to: '2026-07-31',
    })
  })

  it('mensal: fevereiro não-bissexto termina no dia 28', () => {
    expect(cycleWindow('2026-02-10', 'monthly')).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    })
  })
})
