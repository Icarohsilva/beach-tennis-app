import { describe, it, expect } from 'vitest'
import { isValidCronAuth } from './cronAuth'

describe('isValidCronAuth', () => {
  const secret = 'super-secret-value'

  it('aceita o header correto', () => {
    expect(isValidCronAuth(`Bearer ${secret}`, secret)).toBe(true)
  })

  it('rejeita secret errado de mesmo comprimento', () => {
    const wrong = 'x'.repeat(secret.length)
    expect(isValidCronAuth(`Bearer ${wrong}`, secret)).toBe(false)
  })

  it('rejeita header ausente', () => {
    expect(isValidCronAuth(null, secret)).toBe(false)
  })

  it('rejeita quando o CRON_SECRET não está configurado (fail-closed)', () => {
    expect(isValidCronAuth(`Bearer ${secret}`, undefined)).toBe(false)
    expect(isValidCronAuth(`Bearer ${secret}`, '')).toBe(false)
  })

  it('rejeita comprimentos diferentes sem lançar', () => {
    expect(() => isValidCronAuth('Bearer short', secret)).not.toThrow()
    expect(isValidCronAuth('Bearer short', secret)).toBe(false)
  })
})
