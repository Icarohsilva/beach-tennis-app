import { describe, it, expect } from 'vitest'
import {
  MAX_SHIRT_NAME,
  SHIRT_SIZES,
  normalizeShirtName,
  parseShirtSize,
  shirtConfig,
  shirtCut,
  shirtRowsToCsv,
  suggestShirtName,
  summarizeShirtSizes,
  validateShirtName,
  validateShirtSize,
  type ShirtRow,
} from './shirt'

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
    { name: 'José Carlos', size: 'p', shirtName: 'Zeca', entryStatus: 'confirmed', phone: '11999' },
    { name: 'Ana', size: 'gg', shirtName: 'Ana', entryStatus: 'confirmed', phone: null },
    { name: 'Bia', size: null, shirtName: null, entryStatus: 'waitlist', phone: null },
    { name: 'Caio', size: 'p', shirtName: 'Caio', entryStatus: 'confirmed', phone: null },
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
    expect(csv.split('\n')[0])
      .toBe('\ufeffTamanho;Corte;Nome na camisa;Inscrito;Situacao;Telefone')
  })

  it('escapa nome com ponto e vírgula, senão a planilha ganha uma coluna', () => {
    const csv = shirtRowsToCsv([
      { name: 'Silva; Ana', size: 'm', shirtName: 'Ana', entryStatus: 'confirmed', phone: null },
    ])
    expect(csv).toContain('"Silva; Ana"')
  })

  it('a situação vai junto: não se encomenda camisa para a fila de espera', () => {
    expect(shirtRowsToCsv(rows)).toContain('Lista de espera')
  })
})

describe('shirtConfig', () => {
  it('nome só existe com camisa — a chave de cima é teto', () => {
    // Marcar só `shirt_names_enabled` não pode fazer a tela pedir estampa num
    // torneio que não dá camisa.
    expect(shirtConfig({ shirt_sizes_enabled: false, shirt_names_enabled: true }))
      .toEqual({ size: false, name: false })
  })

  it('camisa sem estampa pede só o tamanho', () => {
    expect(shirtConfig({ shirt_sizes_enabled: true, shirt_names_enabled: false }))
      .toEqual({ size: true, name: false })
  })

  it('camisa estampada pede os dois', () => {
    expect(shirtConfig({ shirt_sizes_enabled: true, shirt_names_enabled: true }))
      .toEqual({ size: true, name: true })
  })

  it('torneio anterior às colunas não pede nada', () => {
    expect(shirtConfig({})).toEqual({ size: false, name: false })
  })
})

describe('normalizeShirtName', () => {
  it('tira espaço das pontas e espaço duplo do meio', () => {
    expect(normalizeShirtName('  Zeca   Silva ')).toBe('Zeca Silva')
  })

  it('não força caixa: maiúscula é decisão da arte, não do cadastro', () => {
    expect(normalizeShirtName('Zeca')).toBe('Zeca')
  })

  it('valor que não é texto vira vazio', () => {
    expect(normalizeShirtName(undefined)).toBe('')
    expect(normalizeShirtName(42)).toBe('')
  })
})

describe('suggestShirtName', () => {
  it('sugere o primeiro nome, que é o que cabe nas costas', () => {
    expect(suggestShirtName('José Carlos da Silva Pereira')).toBe('José')
  })

  it('corta no limite da estampa, sem estourar', () => {
    const longo = suggestShirtName('Wolfeschlegelsteinhausenberger')
    expect(longo.length).toBeLessThanOrEqual(MAX_SHIRT_NAME)
  })

  it('cadastro sem nome não quebra', () => {
    expect(suggestShirtName(null)).toBe('')
    expect(suggestShirtName('')).toBe('')
  })
})

describe('validateShirtName', () => {
  it('exige quando a camisa é estampada', () => {
    expect(validateShirtName('  ', { required: true }).ok).toBe(false)
  })

  it('nomeia de quem é o nome que falta', () => {
    const r = validateShirtName('', { required: true, who: 'Ana' })
    if (!r.ok) expect(r.error).toContain('Ana')
    else throw new Error('deveria recusar')
  })

  it('recusa acima da largura da estampa e diz o tamanho', () => {
    const r = validateShirtName('A'.repeat(MAX_SHIRT_NAME + 1), { required: true })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain(String(MAX_SHIRT_NAME))
  })

  it('aceita exatamente no limite', () => {
    const r = validateShirtName('A'.repeat(MAX_SHIRT_NAME), { required: true })
    expect(r.ok).toBe(true)
  })

  it('camisa sem estampa grava nulo e não barra ninguém', () => {
    expect(validateShirtName('', { required: false })).toEqual({ ok: true, name: null })
  })

  it('grava normalizado, não o que foi digitado cru', () => {
    const r = validateShirtName('  Zeca  ', { required: true })
    if (r.ok) expect(r.name).toBe('Zeca')
    else throw new Error('deveria aceitar')
  })
})

describe('shirtRowsToCsv — nome estampado', () => {
  it('separa o nome da estampa do nome do cadastro', () => {
    // Misturar os dois entrega camisa na mão errada: a estampa diz "Zeca" e a
    // conferência precisa dizer "José Carlos".
    const csv = shirtRowsToCsv([
      { name: 'José Carlos', size: 'm', shirtName: 'Zeca', entryStatus: 'confirmed', phone: null },
    ])
    expect(csv).toContain('Zeca;José Carlos')
  })

  it('torneio de camisa lisa deixa a coluna da estampa vazia', () => {
    const csv = shirtRowsToCsv([
      { name: 'Ana', size: 'm', shirtName: null, entryStatus: 'confirmed', phone: null },
    ])
    expect(csv).toContain('M;Tradicional;;Ana')
  })
})
