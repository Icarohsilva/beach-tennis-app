import { describe, it, expect } from 'vitest'
import {
  SHIRT_SIZES,
  parseShirtSize,
  shirtCut,
  shirtRowsToCsv,
  summarizeShirtSizes,
  validateShirtSize,
  type ShirtRow,
} from './shirtSize'

describe('parseShirtSize', () => {
  it('aceita a grade e recusa o resto', () => {
    expect(parseShirtSize('gg')).toBe('gg')
    expect(parseShirtSize('baby_m')).toBe('baby_m')
    expect(parseShirtSize('xxg')).toBeNull()
    expect(parseShirtSize('')).toBeNull()
    expect(parseShirtSize(undefined)).toBeNull()
    expect(parseShirtSize(3)).toBeNull()
  })
})

describe('shirtCut', () => {
  it('separa o corte, que é o que a confecção encomenda em separado', () => {
    expect(shirtCut('g')).toBe('tradicional')
    expect(shirtCut('baby_g')).toBe('baby_look')
  })
})

describe('validateShirtSize', () => {
  it('exige quando o torneio dá camisa', () => {
    const r = validateShirtSize('', { required: true })
    expect(r.ok).toBe(false)
  })

  it('nomeia de quem é o tamanho que falta', () => {
    const r = validateShirtSize(null, { required: true, who: 'Ana' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('Ana')
  })

  it('torneio sem camisa não barra ninguém e grava nulo', () => {
    const r = validateShirtSize('', { required: false })
    expect(r).toEqual({ ok: true, size: null })
  })

  it('valor inválido é recusado mesmo com algo preenchido', () => {
    expect(validateShirtSize('gigante', { required: true }).ok).toBe(false)
  })
})

describe('summarizeShirtSizes', () => {
  it('soma por tamanho na ordem da grade e conta quem falta', () => {
    const s = summarizeShirtSizes(['m', 'g', 'm', null, 'baby_p', 'm'])
    expect(s.tally.map((t) => [t.size, t.count])).toEqual([
      ['m', 3], ['g', 1], ['baby_p', 1],
    ])
    expect(s.total).toBe(5)
    expect(s.missing).toBe(1)
  })

  it('tamanho sem pedido não polui a lista', () => {
    const s = summarizeShirtSizes(['p'])
    expect(s.tally).toHaveLength(1)
    expect(s.tally.length).toBeLessThan(SHIRT_SIZES.length)
  })

  it('lista vazia não quebra', () => {
    expect(summarizeShirtSizes([])).toEqual({ tally: [], total: 0, missing: 0 })
  })
})

describe('shirtRowsToCsv', () => {
  const rows: ShirtRow[] = [
    { name: 'Zeca', size: 'p', entryStatus: 'confirmed', phone: '11999' },
    { name: 'Ana', size: 'gg', entryStatus: 'confirmed', phone: null },
    { name: 'Bia', size: null, entryStatus: 'waitlist', phone: null },
    { name: 'Caio', size: 'p', entryStatus: 'confirmed', phone: null },
  ]

  it('ordena por TAMANHO, que é como a confecção separa as pilhas', () => {
    const linhas = shirtRowsToCsv(rows).split('\n')
    // P vem antes de GG na grade; dentro do tamanho, ordem alfabética.
    expect(linhas[1]).toContain('Caio')
    expect(linhas[2]).toContain('Zeca')
    expect(linhas[3]).toContain('GG')
  })

  it('quem não informou vai para o fim, marcado', () => {
    const linhas = shirtRowsToCsv(rows).split('\n')
    expect(linhas[linhas.length - 1]).toContain('NAO INFORMADO')
  })

  it('leva BOM e separador ; para o Excel pt-BR abrir direito', () => {
    const csv = shirtRowsToCsv(rows)
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv.split('\n')[0]).toBe('\ufeffTamanho;Corte;Nome;Situacao;Telefone')
  })

  it('escapa nome com ponto e vírgula, senão a planilha ganha uma coluna', () => {
    const csv = shirtRowsToCsv([
      { name: 'Silva; Ana', size: 'm', entryStatus: 'confirmed', phone: null },
    ])
    expect(csv).toContain('"Silva; Ana"')
  })

  it('a situação vai junto: não se encomenda camisa para a fila de espera', () => {
    expect(shirtRowsToCsv(rows)).toContain('Lista de espera')
  })
})
