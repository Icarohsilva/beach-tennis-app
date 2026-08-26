// lib/torneios/registrationWindow.test.ts
import { describe, it, expect } from 'vitest'
import { resolveRegistrationWindow, deadlineLabel, closingSoonLabel } from './registrationWindow'

const NOW = new Date('2026-08-20T12:00:00Z')

describe('resolveRegistrationWindow', () => {
  it('status draft/in_progress/finished bloqueiam, cada um com sua razão', () => {
    for (const status of ['draft', 'in_progress', 'finished'] as const) {
      const r = resolveRegistrationWindow({ status, registration_deadline: null }, NOW)
      expect(r.open).toBe(false)
      expect(r.block).toBe('not_open')
      expect(r.reason).toBeTruthy()
    }
  })

  it('open sem prazo (nulo) está aberto — nenhum torneio existente muda de comportamento', () => {
    const r = resolveRegistrationWindow({ status: 'open', registration_deadline: null }, NOW)
    expect(r.open).toBe(true)
    expect(r.block).toBeNull()
  })

  it('open com prazo no futuro está aberto', () => {
    const r = resolveRegistrationWindow({ status: 'open', registration_deadline: '2026-08-21T00:00:00Z' }, NOW)
    expect(r.open).toBe(true)
  })

  it('open com prazo vencido fecha com block deadline_passed', () => {
    const r = resolveRegistrationWindow({ status: 'open', registration_deadline: '2026-08-19T00:00:00Z' }, NOW)
    expect(r.open).toBe(false)
    expect(r.block).toBe('deadline_passed')
  })

  it('prazo exatamente igual a now conta como fechado (fronteira)', () => {
    const r = resolveRegistrationWindow({ status: 'open', registration_deadline: NOW.toISOString() }, NOW)
    expect(r.open).toBe(false)
  })
})

describe('deadlineLabel', () => {
  it('nulo sem prazo', () => {
    expect(deadlineLabel(null)).toBeNull()
  })

  it('formata com prefixo', () => {
    expect(deadlineLabel('2026-08-21T23:59:00Z')).toMatch(/^Inscrições até /)
  })
})

describe('closingSoonLabel', () => {
  it('nulo sem prazo', () => {
    expect(closingSoonLabel(null, NOW)).toBeNull()
  })

  it('nulo quando falta mais de 48h', () => {
    const daqui3dias = new Date(NOW.getTime() + 72 * 60 * 60 * 1000).toISOString()
    expect(closingSoonLabel(daqui3dias, NOW)).toBeNull()
  })

  it('nulo quando o prazo já passou', () => {
    const ontem = new Date(NOW.getTime() - 60 * 60 * 1000).toISOString()
    expect(closingSoonLabel(ontem, NOW)).toBeNull()
  })

  it('mostra horas dentro da janela de 48h', () => {
    const daqui3h = new Date(NOW.getTime() + 3 * 60 * 60 * 1000).toISOString()
    expect(closingSoonLabel(daqui3h, NOW)).toBe('Fecha em 3h')
  })

  it('mostra minutos quando falta menos de 1h', () => {
    const daqui30min = new Date(NOW.getTime() + 30 * 60 * 1000).toISOString()
    expect(closingSoonLabel(daqui30min, NOW)).toBe('Fecha em 30min')
  })
})
