import { describe, it, expect } from 'vitest'
import { resolveDayUseCta, dayUseShareMessage } from './publicPage'

// 20/09/2026, 10h em BRT (13:00Z).
const NOW = new Date('2026-09-20T13:00:00Z')

const BASE = {
  date: '2026-09-27',
  end_time: '12:00',
  capacity: 8,
  occupied: 3,
  signedIn: true,
  priceCents: 4000,
  now: NOW,
}

describe('resolveDayUseCta', () => {
  it('abre para reserva com preço e vagas na linha de apoio', () => {
    const cta = resolveDayUseCta(BASE)
    expect(cta.state).toBe('open')
    expect(cta.actionable).toBe(true)
    expect(cta.label).toBe('Reservar minha vaga')
    expect(cta.note).toBe('R$ 40,00 por pessoa · 5 vagas')
  })

  it('convida quem não está logado a criar conta, sem esconder que dá para reservar', () => {
    const cta = resolveDayUseCta({ ...BASE, signedIn: false })
    expect(cta.state).toBe('open')
    expect(cta.label).toBe('Criar conta e reservar')
  })

  it('diz "última vaga" no singular', () => {
    expect(resolveDayUseCta({ ...BASE, occupied: 7 }).note).toContain('última vaga')
  })

  it('diz Gratuito quando não há preço', () => {
    expect(resolveDayUseCta({ ...BASE, priceCents: 0 }).note).toBe('Gratuito · 5 vagas')
  })

  it('lota quando a ocupação alcança a capacidade', () => {
    const cta = resolveDayUseCta({ ...BASE, occupied: 8 })
    expect(cta.state).toBe('full')
    expect(cta.actionable).toBe(false)
  })

  it('encerra depois do fim do horário, em BRT', () => {
    // 20/09 às 10h BRT: um day use que terminou às 09:00 do mesmo dia já passou.
    const cta = resolveDayUseCta({ ...BASE, date: '2026-09-20', end_time: '09:00' })
    expect(cta.state).toBe('ended')
    // ...mas um que termina às 12:00 do mesmo dia ainda está de pé.
    expect(resolveDayUseCta({ ...BASE, date: '2026-09-20', end_time: '12:00' }).state).toBe('open')
  })

  it('encerrado vence lotado', () => {
    // Day use de ontem, cheio, não é convite para nada.
    const cta = resolveDayUseCta({ ...BASE, date: '2026-09-19', occupied: 8 })
    expect(cta.state).toBe('ended')
  })

  it('reserva de quem está vendo vence lotado', () => {
    // Sem esta ordem, quem JÁ reservou lia "Lotado" e achava que perdeu a vaga.
    const cta = resolveDayUseCta({ ...BASE, occupied: 8, myStatus: 'confirmed' })
    expect(cta.state).toBe('booked')
  })

  it('mostra a espera do pagamento e o prazo da vaga', () => {
    const cta = resolveDayUseCta({ ...BASE, myStatus: 'pending_payment' })
    expect(cta.state).toBe('pending')
    expect(cta.note).toContain('30 minutos')
  })

  it('aceita HH:MM:SS do banco tanto quanto HH:MM do formulário', () => {
    expect(resolveDayUseCta({ ...BASE, date: '2026-09-20', end_time: '09:00:00' }).state)
      .toBe('ended')
  })
})

describe('dayUseShareMessage', () => {
  const input = {
    orgName: 'Arena Sol',
    sportLabel: 'Beach Tennis',
    kind: 'scheduled' as const,
    dateLabel: 'domingo, 27 de setembro',
    startLabel: '09:00',
    endLabel: '12:00',
    priceCents: 4000,
    url: 'https://arenahub.website/d/abc',
  }

  it('diz o que é, quando, quanto e onde reservar', () => {
    expect(dayUseShareMessage(input)).toBe(
      'Day use de Beach Tennis na Arena Sol\n'
      + 'domingo, 27 de setembro, das 09:00 às 12:00\n'
      + 'R$ 40,00 por pessoa\n'
      + '\n'
      + 'Reserve sua vaga: https://arenahub.website/d/abc',
    )
  })

  it('marca o tipo livre no período, que não se explica sozinho', () => {
    expect(dayUseShareMessage({ ...input, kind: 'open' })).toContain('(livre no período)')
  })

  it('funciona sem modalidade e sem preço', () => {
    const msg = dayUseShareMessage({ ...input, sportLabel: null, priceCents: 0 })
    expect(msg.startsWith('Day use na Arena Sol')).toBe(true)
    expect(msg).toContain('Entrada gratuita')
  })
})
