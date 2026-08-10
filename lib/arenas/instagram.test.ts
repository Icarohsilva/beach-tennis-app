import { describe, it, expect } from 'vitest'
import { instagramUrl, normalizeInstagram } from './instagram'

describe('normalizeInstagram', () => {
  it('handle simples passa inteiro', () => {
    expect(normalizeInstagram('arenadopraia')).toBe('arenadopraia')
  })

  it('tira o @ da frente', () => {
    expect(normalizeInstagram('@arenadopraia')).toBe('arenadopraia')
    expect(normalizeInstagram('@@arenadopraia')).toBe('arenadopraia')
  })

  it('aceita a URL completa colada da barra de endereços', () => {
    expect(normalizeInstagram('https://www.instagram.com/arenadopraia/')).toBe('arenadopraia')
    expect(normalizeInstagram('instagram.com/arenadopraia')).toBe('arenadopraia')
    expect(normalizeInstagram('m.instagram.com/arenadopraia')).toBe('arenadopraia')
  })

  it('descarta a query do link compartilhado pelo app', () => {
    // O botão "copiar link" do Instagram anexa ?igsh=... — sem cortar, o handle
    // gravado viraria "arenadopraia?igsh=xyz".
    expect(normalizeInstagram('https://instagram.com/arenadopraia?igsh=Nzc4')).toBe('arenadopraia')
  })

  it('vazio e só espaço viram null, não string vazia', () => {
    expect(normalizeInstagram('')).toBeNull()
    expect(normalizeInstagram('   ')).toBeNull()
    expect(normalizeInstagram(null)).toBeNull()
    expect(normalizeInstagram(undefined)).toBeNull()
    expect(normalizeInstagram('@')).toBeNull()
  })

  it('preserva ponto e underline, que são válidos no Instagram', () => {
    expect(normalizeInstagram('arena.do_praia')).toBe('arena.do_praia')
  })

  it('descarta o que não é handle em vez de gravar lixo', () => {
    // Um link quebrado na página da arena é pior que o bloco não aparecer.
    expect(normalizeInstagram('arena do praia')).toBeNull()
    expect(normalizeInstagram('fale com a gente!')).toBeNull()
  })

  it('recusa handle acima do limite do Instagram', () => {
    expect(normalizeInstagram('a'.repeat(31))).toBeNull()
    expect(normalizeInstagram('a'.repeat(30))).toBe('a'.repeat(30))
  })
})

describe('instagramUrl', () => {
  it('monta o link a partir de qualquer forma aceita', () => {
    expect(instagramUrl('@arenadopraia')).toBe('https://instagram.com/arenadopraia')
    expect(instagramUrl('https://instagram.com/arenadopraia/')).toBe(
      'https://instagram.com/arenadopraia',
    )
  })

  it('sem handle não há link', () => {
    expect(instagramUrl(null)).toBeNull()
    expect(instagramUrl('  ')).toBeNull()
  })
})
