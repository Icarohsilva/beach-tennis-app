import { describe, it, expect } from 'vitest'
import { buildIcsCalendar, type CalendarEvent } from './icsFeed'

const STAMP = '2026-08-20T10:00:00Z'

function evento(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    uid: 'sess-1',
    title: 'Beach Tennis Intermediário',
    location: 'Quadra 2',
    startsAtIso: '2026-08-21T19:00:00-03:00',
    endsAtIso: '2026-08-21T20:00:00-03:00',
    ...overrides,
  }
}

describe('buildIcsCalendar', () => {
  it('envelope VCALENDAR/VEVENT básico', () => {
    const ics = buildIcsCalendar('Agenda Arena X', [evento()], STAMP)
    expect(ics).toContain('BEGIN:VCALENDAR')
    expect(ics).toContain('VERSION:2.0')
    expect(ics).toContain('END:VCALENDAR')
    expect(ics).toContain('BEGIN:VEVENT')
    expect(ics).toContain('END:VEVENT')
    expect(ics).toContain('X-WR-CALNAME:Agenda Arena X')
  })

  // UID estável entre gerações é o que faz cancelamento/remarcação "sincronizar
  // sozinhos": o app de calendário casa eventos pelo UID, não pela posição.
  it('UID inclui o identificador da sessão', () => {
    const ics = buildIcsCalendar('Agenda', [evento({ uid: 'abc-123' })], STAMP)
    expect(ics).toContain('UID:abc-123@arenahub.website')
  })

  // -03:00 (BRT) precisa virar Z (UTC) — RFC 5545 exige um dos dois formatos
  // para DTSTART/DTEND, e o offset de Brasília sozinho não é válido.
  it('converte o horário local (BRT) para UTC com sufixo Z', () => {
    const ics = buildIcsCalendar(
      'Agenda',
      [evento({ startsAtIso: '2026-08-21T19:00:00-03:00', endsAtIso: '2026-08-21T20:00:00-03:00' })],
      STAMP,
    )
    expect(ics).toContain('DTSTART:20260821T220000Z')
    expect(ics).toContain('DTEND:20260821T230000Z')
  })

  it('sem location, a linha LOCATION some inteira', () => {
    const ics = buildIcsCalendar('Agenda', [evento({ location: null })], STAMP)
    expect(ics).not.toContain('LOCATION')
  })

  it('com location, aparece', () => {
    const ics = buildIcsCalendar('Agenda', [evento({ location: 'Quadra 3' })], STAMP)
    expect(ics).toContain('LOCATION:Quadra 3')
  })

  // RFC 5545 §3.3.11: vírgula, ponto-e-vírgula e barra invertida têm significado
  // sintático no formato e precisam ser escapados, senão o .ics fica malformado.
  it('escapa vírgula, ponto-e-vírgula e barra invertida no título', () => {
    const ics = buildIcsCalendar(
      'Agenda',
      [evento({ title: 'Turma A; nível 2, avançado \\ extra' })],
      STAMP,
    )
    expect(ics).toContain('SUMMARY:Turma A\\; nível 2\\, avançado \\\\ extra')
  })

  it('lista vazia ainda produz um calendário válido, sem nenhum VEVENT', () => {
    const ics = buildIcsCalendar('Agenda', [], STAMP)
    expect(ics).toContain('BEGIN:VCALENDAR')
    expect(ics).toContain('END:VCALENDAR')
    expect(ics).not.toContain('VEVENT')
  })

  it('múltiplos eventos, um VEVENT por sessão', () => {
    const ics = buildIcsCalendar(
      'Agenda',
      [evento({ uid: 's1' }), evento({ uid: 's2' })],
      STAMP,
    )
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2)
    expect(ics).toContain('UID:s1@arenahub.website')
    expect(ics).toContain('UID:s2@arenahub.website')
  })

  // Linha maior que 75 octetos precisa dobrar (RFC 5545 §3.1) com CRLF + espaço
  // de continuação — sem isso alguns clientes recusam o arquivo.
  it('dobra linha comprida em 75 octetos com continuação por espaço', () => {
    const tituloLongo = 'A'.repeat(120)
    const ics = buildIcsCalendar('Agenda', [evento({ title: tituloLongo })], STAMP)
    const linhaSummary = ics.split('\r\n').find((l) => l.startsWith('SUMMARY:'))
    expect(linhaSummary?.length).toBeLessThanOrEqual(75)
    // A continuação da linha começa com espaço, marca de dobra da RFC.
    const linhas = ics.split('\r\n')
    const idx = linhas.findIndex((l) => l.startsWith('SUMMARY:'))
    expect(linhas[idx + 1].startsWith(' ')).toBe(true)
  })

  it('usa CRLF como separador de linha (exigência da RFC 5545)', () => {
    const ics = buildIcsCalendar('Agenda', [evento()], STAMP)
    expect(ics).toContain('\r\n')
  })
})
