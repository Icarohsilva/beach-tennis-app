import { describe, it, expect } from 'vitest'
import { formatDate, formatTime } from './dateHelpers'

/**
 * O bug que estes testes travam: `class_sessions.session_date` é uma coluna
 * `date` e chega como 'YYYY-MM-DD'. `new Date('2026-07-28')` parseia como
 * meia-noite UTC; formatar isso em BRT (UTC-3) volta para 27/07. Em produção o
 * aluno via a aula de terça 28 como "seg, 27" na tela de agendar, e o admin via
 * a data errada no menu "Faltar em…".
 *
 * Estes casos falham na implementação antiga quando a máquina roda em fuso
 * negativo (dev em BRT) e passam nos dois casos depois do fix.
 */
describe('formatDate', () => {
  it('preserva o dia do calendário em data pura (não volta um dia)', () => {
    expect(formatDate('2026-07-28')).toBe('28/07/2026')
    expect(formatDate('2026-07-22')).toBe('22/07/2026')
    expect(formatDate('2026-01-01')).toBe('01/01/2026')
  })

  it('preserva o dia-da-semana correto em data pura', () => {
    // 2026-07-28 é terça; 2026-07-22 é quarta.
    expect(formatDate('2026-07-28', 'EEE')).toMatch(/^ter/i)
    expect(formatDate('2026-07-22', 'EEE')).toMatch(/^qua/i)
  })

  // O mesmo defeito apareceu na lista de check-ins da ficha do aluno: um check-in
  // gravado em 01/08 (data BRT correta, coluna `date`) era exibido como 31/07, e a
  // academia lia isso como "a contagem do mês está pegando o mês passado".
  it('primeiro dia do mês não vira o último dia do mês anterior', () => {
    expect(formatDate('2026-08-01')).toBe('01/08/2026')
    expect(formatDate('2026-03-01')).toBe('01/03/2026')
  })

  it('primeiro dia do ano não vira 31/12 do ano anterior', () => {
    expect(formatDate('2027-01-01')).toBe('01/01/2027')
  })

  it('respeita o formato customizado', () => {
    expect(formatDate('2026-07-28', 'dd/MM')).toBe('28/07')
    expect(formatDate('2026-07-28', "dd 'de' MMM")).toBe('28 de jul')
  })

  it('aceita Date e string com hora sem alterar o comportamento', () => {
    expect(formatDate(new Date(2026, 6, 28))).toBe('28/07/2026')
    expect(formatDate('2026-07-28T15:30:00')).toBe('28/07/2026')
  })
})

describe('formatTime', () => {
  it('corta os segundos', () => {
    expect(formatTime('18:00:00')).toBe('18:00')
    expect(formatTime('09:30')).toBe('09:30')
  })
})
