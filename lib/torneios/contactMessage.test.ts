import { describe, it, expect } from 'vitest'
import { buildAccessMessage, buildContactMessage, firstName } from './contactMessage'
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

describe('buildAccessMessage', () => {
  const base = {
    toName: 'Ana Carolina Prado',
    tournamentName: 'Super 8 Feminino',
    tournamentUrl: 'https://arenahub.website/t/abc',
    email: 'ana@exemplo.com',
    orgName: 'Arena Maré Alta',
  }

  it('diz o torneio, a arena, o link e como entrar', () => {
    const msg = buildAccessMessage({ ...base, password: 'Xk4p2Qw9' })
    expect(msg).toContain('Oi, Ana!')
    expect(msg).toContain('Super 8 Feminino')
    expect(msg).toContain('Arena Maré Alta')
    expect(msg).toContain('https://arenahub.website/t/abc')
    expect(msg).toContain('ana@exemplo.com')
    expect(msg).toContain('Xk4p2Qw9')
  })

  it('avisa que a senha é só do primeiro acesso', () => {
    // Sem isso a pessoa guarda a provisória e estranha o app pedir outra.
    const msg = buildAccessMessage({ ...base, password: 'Xk4p2Qw9' })
    expect(msg).toMatch(/primeiro login/i)
  })

  it('sem senha nova, manda para "esqueci minha senha" em vez de inventar uma', () => {
    const msg = buildAccessMessage({ ...base })
    expect(msg).not.toMatch(/senha provis/i)
    expect(msg).toMatch(/Esqueci minha senha/i)
    expect(msg).toContain('ana@exemplo.com')
  })

  it('sem arena, a frase continua de pé', () => {
    const msg = buildAccessMessage({ ...base, orgName: null, password: 'a1b2' })
    expect(msg).toContain('Super 8 Feminino')
    expect(msg).not.toMatch(/undefined|null|\(\)/)
  })

  it('sem nome, não sai "Oi, !"', () => {
    const msg = buildAccessMessage({ ...base, toName: '' })
    expect(msg.startsWith('Oi!')).toBe(true)
  })

  it('quebra de linha sobrevive ao link do wa.me', () => {
    // O WhatsApp respeita %0A; sem escapar, o texto chegaria numa linha só.
    const url = buildWhatsAppUrl('31994147094', buildAccessMessage({ ...base, password: 'a1' }))
    expect(url).toContain('%0A')
    expect(url.startsWith('https://wa.me/5531994147094?text=')).toBe(true)
  })
})
