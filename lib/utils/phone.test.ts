import { describe, it, expect } from 'vitest'
import { formatWhatsApp, parseWhatsApp } from './phone'

describe('parseWhatsApp', () => {
  it('aceita celular com máscara, espaços ou +55', () => {
    for (const raw of ['(31) 99999-8888', '31999998888', '+55 31 99999-8888', '5531999998888']) {
      expect(parseWhatsApp(raw)).toEqual({ ok: true, digits: '31999998888', formatted: '(31) 99999-8888' })
    }
  })

  it('aceita fixo com DDD (WhatsApp Business)', () => {
    expect(parseWhatsApp('(31) 3651-1234')).toMatchObject({ ok: true, digits: '3136511234' })
  })

  it('vazio pede o número', () => {
    const r = parseWhatsApp('   ')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/Informe/)
  })

  it('recusa número sem DDD, DDD com zero e celular sem o 9', () => {
    for (const raw of ['99999-8888', '(01) 99999-8888', '(30) 99999-8888', '(31) 89999-8888', '123']) {
      expect(parseWhatsApp(raw).ok).toBe(false)
    }
  })
})

describe('formatWhatsApp', () => {
  it('aplica a máscara conforme digita', () => {
    expect(formatWhatsApp('')).toBe('')
    expect(formatWhatsApp('3')).toBe('(3')
    expect(formatWhatsApp('319')).toBe('(31) 9')
    expect(formatWhatsApp('3199999')).toBe('(31) 9999-9')
    expect(formatWhatsApp('31999998888')).toBe('(31) 99999-8888')
    expect(formatWhatsApp('3136511234')).toBe('(31) 3651-1234')
    expect(formatWhatsApp('3199999888877')).toBe('(31) 99999-8888')
  })
})
