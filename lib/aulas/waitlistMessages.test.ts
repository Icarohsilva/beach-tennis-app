import { describe, it, expect } from 'vitest'
import {
  buildAutoEnteredNotice,
  buildNowFirstNotice,
  buildRemovedFromWaitlistNotice,
} from './waitlistMessages'

const REF = {
  className: 'Beach Tennis Iniciante',
  sessionDate: '2026-08-25',
  startTime: '19:00:00',
}

describe('buildAutoEnteredNotice', () => {
  const n = buildAutoEnteredNotice(REF)

  it('diz que está dentro, com aula, data e hora', () => {
    expect(n.title).toBe('Você entrou na aula')
    expect(n.body).toContain('Beach Tennis Iniciante')
    expect(n.body).toContain('25/08/2026')
    expect(n.body).toContain('19:00')
  })

  // A reserva foi feita sem o aluno pedir: sem o prazo, a cortesia vira
  // cobrança surpresa. É a asserção que protege o texto de uma refatoração.
  it('avisa o prazo para sair sem perder crédito nem levar falta', () => {
    expect(n.body).toContain('60 minutos')
    expect(n.body).toMatch(/crédito/)
    expect(n.body).toMatch(/falta/)
  })
})

describe('buildNowFirstNotice', () => {
  it('avisa que virou primeiro e que a entrada será automática', () => {
    const n = buildNowFirstNotice(REF)
    expect(n.title).toContain('primeiro')
    expect(n.body).toContain('automaticamente')
    expect(n.body).toContain('25/08/2026')
  })
})

describe('buildRemovedFromWaitlistNotice', () => {
  it('dívida: mostra o valor formatado em real', () => {
    const n = buildRemovedFromWaitlistNotice(REF, 'blocked_by_debt', 1234.5)
    expect(n.body).toContain('R$ 1234,50')
    expect(n.body).toContain('entrar na fila de novo')
  })

  it('cada motivo tem texto próprio, nenhum cai no genérico', () => {
    const motivos = [
      'blocked_by_missed_checkins',
      'archived',
      'on_vacation',
      'quota_exhausted',
      'daily_cap',
    ] as const
    const corpos = motivos.map((m) => buildRemovedFromWaitlistNotice(REF, m).body)
    for (const c of corpos) {
      expect(c).not.toContain('não foi possível confirmar sua vaga')
    }
    expect(new Set(corpos).size).toBe(motivos.length)
  })
})
