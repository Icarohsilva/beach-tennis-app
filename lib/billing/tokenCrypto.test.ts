// lib/billing/tokenCrypto.test.ts
import { describe, it, expect } from 'vitest'
import { encryptSecret, decryptSecret } from './tokenCrypto'

// 32 bytes em hex (64 chars) — chave só de teste.
const KEY = 'a'.repeat(64)

describe('tokenCrypto', () => {
  it('roundtrip encrypt → decrypt', () => {
    const enc = encryptSecret('APP_USR-token-secreto', KEY)
    expect(decryptSecret(enc, KEY)).toBe('APP_USR-token-secreto')
  })

  it('gera ciphertexts diferentes a cada chamada (IV aleatório)', () => {
    expect(encryptSecret('x', KEY)).not.toBe(encryptSecret('x', KEY))
  })

  it('payload adulterado → lança (auth tag GCM)', () => {
    const enc = encryptSecret('segredo', KEY)
    const [iv, tag, data] = enc.split('.')
    const tampered = [iv, tag, data.slice(0, -4) + 'AAAA'].join('.')
    expect(() => decryptSecret(tampered, KEY)).toThrow()
  })

  it('chave errada → lança', () => {
    const enc = encryptSecret('segredo', KEY)
    expect(() => decryptSecret(enc, 'b'.repeat(64))).toThrow()
  })

  it('chave malformada → lança com mensagem clara', () => {
    expect(() => encryptSecret('x', 'curta')).toThrow(/GATEWAY_TOKEN_KEY/)
  })

  it('payload malformado → lança', () => {
    expect(() => decryptSecret('nao-tem-pontos', KEY)).toThrow(/malformado/)
  })
})
