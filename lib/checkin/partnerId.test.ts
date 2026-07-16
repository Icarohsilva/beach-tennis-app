import { describe, it, expect } from 'vitest'
import { normalizePartnerId } from './partnerId'

describe('normalizePartnerId', () => {
  it('remove os espaços INTERNOS do ID copiado do portal da Wellhub', () => {
    // O caso que quebrava: o portal exibe agrupado, o webhook manda limpo.
    expect(normalizePartnerId('3603 3181 0803 2')).toBe('3603318108032')
  })

  it('remove espaços das pontas (o que o .trim() já fazia)', () => {
    expect(normalizePartnerId('  3603318108032  ')).toBe('3603318108032')
  })

  it('remove tabs e quebras de linha coladas junto', () => {
    expect(normalizePartnerId('\t3603318108032\n')).toBe('3603318108032')
  })

  it('remove NBSP e zero-width vindos de copy/paste de página web', () => {
    expect(normalizePartnerId('3603 3181​08032')).toBe('3603318108032')
  })

  it('mantém um ID já limpo intacto', () => {
    expect(normalizePartnerId('3603318108032')).toBe('3603318108032')
  })

  it('preserva IDs alfanuméricos (TotalPass) sem mexer no conteúdo', () => {
    expect(normalizePartnerId('TP-9A 8B7C')).toBe('TP-9A8B7C')
  })

  it('vira null quando sobra vazio, para gravar NULL na coluna', () => {
    expect(normalizePartnerId('   ')).toBeNull()
    expect(normalizePartnerId('')).toBeNull()
    expect(normalizePartnerId(null)).toBeNull()
    expect(normalizePartnerId(undefined)).toBeNull()
  })
})
