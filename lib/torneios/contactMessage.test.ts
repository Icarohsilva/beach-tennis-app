import { describe, it, expect } from 'vitest'
import { buildContactMessage, firstName } from './contactMessage'
import { buildWhatsAppUrl } from '@/lib/utils/whatsappLink'

describe('firstName', () => {
  it('pega só o primeiro nome', () => {
    expect(firstName('Ana Carolina Prado')).toBe('Ana')
  })

  it('nome único continua inteiro', () => {
    expect(firstName('Ana')).toBe('Ana')
  })

  it('aguenta espaço sobrando', () => {
    expect(firstName('   Bruno   Lima  ')).toBe('Bruno')
  })

  it('ausente vira string vazia, não "undefined"', () => {
    expect(firstName(null)).toBe('')
    expect(firstName(undefined)).toBe('')
    expect(firstName('   ')).toBe('')
  })
})

describe('buildContactMessage', () => {
  it('participante se apresenta pelo nome e cita o torneio', () => {
    expect(
      buildContactMessage({
        toName: 'Ana Prado',
        fromName: 'Caio Mendes',
        tournamentName: 'Copa de Verão',
      }),
    ).toBe('Oi, Ana! Sou Caio, do torneio Copa de Verão.')
  })

  it('organizador se apresenta pela academia', () => {
    expect(
      buildContactMessage({
        toName: 'Ana Prado',
        tournamentName: 'Copa de Verão',
        orgName: 'Arena Copacabana',
        fromAdmin: true,
      }),
    ).toBe('Oi, Ana! Aqui é da Arena Copacabana, sobre o torneio Copa de Verão.')
  })

  it('organizador sem nome de academia não deixa buraco na frase', () => {
    expect(
      buildContactMessage({ toName: 'Ana', tournamentName: 'Copa', fromAdmin: true }),
    ).toBe('Oi, Ana! Aqui é da organização, sobre o torneio Copa.')
  })

  it('participante sem nome cai no contexto em vez de sair quebrado', () => {
    // "Oi, Ana! Sou, do torneio X." seria o resultado de concatenar sem guarda.
    expect(
      buildContactMessage({ toName: 'Ana', fromName: null, tournamentName: 'Copa' }),
    ).toBe('Oi, Ana! Sobre o torneio Copa.')
  })

  it('destinatário sem nome ainda gera saudação válida', () => {
    expect(
      buildContactMessage({ toName: '', fromName: 'Caio', tournamentName: 'Copa' }),
    ).toBe('Oi! Sou Caio, do torneio Copa.')
  })

  it('nunca produz "undefined" ou "null" no texto', () => {
    const msg = buildContactMessage({
      toName: '',
      fromName: undefined,
      tournamentName: 'Copa',
      orgName: null,
    })
    expect(msg).not.toMatch(/undefined|null/)
  })
})

describe('mensagem dentro do link', () => {
  it('sobrevive à codificação do wa.me', () => {
    // Acento, vírgula e exclamação precisam ir escapados, senão o WhatsApp
    // trunca o texto no primeiro caractere inválido.
    const msg = buildContactMessage({
      toName: 'Ana Prado',
      fromName: 'Caio',
      tournamentName: 'Copa de Verão',
    })
    const url = buildWhatsAppUrl('(21) 99999-1234', msg)
    expect(url).toBe(
      'https://wa.me/5521999991234?text=' +
        'Oi%2C%20Ana!%20Sou%20Caio%2C%20do%20torneio%20Copa%20de%20Ver%C3%A3o.',
    )
  })

  it('telefone já com DDI não ganha outro 55', () => {
    expect(buildWhatsAppUrl('5521999991234', 'oi')).toContain('wa.me/5521999991234?')
  })
})
