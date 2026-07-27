import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readDismissedAt, writeDismissedAt, DISMISS_KEY } from './dismissStorage'

describe('dismissStorage', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sem nada gravado devolve null', () => {
    expect(readDismissedAt()).toBeNull()
  })

  it('grava e lê o timestamp', () => {
    writeDismissedAt(1_700_000_000_000)
    expect(readDismissedAt(1_700_000_050_000)).toBe(1_700_000_000_000)
  })

  it('writeDismissedAt sem argumento usa a hora atual', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_234_567_890)
    writeDismissedAt()
    expect(readDismissedAt(1_234_567_899)).toBe(1_234_567_890)
  })

  it('valor não numérico é tratado como nunca dispensado', () => {
    localStorage.setItem(DISMISS_KEY, 'ontem')
    expect(readDismissedAt()).toBeNull()
  })

  it('valor vazio é tratado como nunca dispensado', () => {
    localStorage.setItem(DISMISS_KEY, '')
    expect(readDismissedAt()).toBeNull()
  })

  it('timestamp no futuro é descartado', () => {
    // Relógio do aparelho errado esconderia o popup por tempo indeterminado.
    localStorage.setItem(DISMISS_KEY, String(2_000_000_000_000))
    expect(readDismissedAt(1_700_000_000_000)).toBeNull()
  })

  it('localStorage que lança ao ler não quebra a página', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    expect(readDismissedAt()).toBeNull()
  })

  it('localStorage que lança ao gravar não quebra a página', () => {
    // Safari em navegação privada lança QuotaExceededError ao escrever.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(() => writeDismissedAt(1_700_000_000_000)).not.toThrow()
  })
})
