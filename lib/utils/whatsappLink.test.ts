import { describe, it, expect } from 'vitest'
import { buildWhatsAppUrl } from './whatsappLink'

describe('buildWhatsAppUrl', () => {
  it('adiciona DDI 55 quando ausente', () => {
    const url = buildWhatsAppUrl('11987654321', 'Olá')
    expect(url).toContain('wa.me/5511987654321')
  })
  it('não duplica DDI 55 quando já presente', () => {
    const url = buildWhatsAppUrl('5511987654321', 'Olá')
    expect(url).toContain('wa.me/5511987654321')
    expect(url).not.toContain('555511987654321')
  })
  it('remove formatação (parênteses, hífens, espaços)', () => {
    const url = buildWhatsAppUrl('(11) 98765-4321', 'Mensagem')
    expect(url).toContain('wa.me/5511987654321')
  })
  it('codifica a mensagem corretamente no query string', () => {
    const url = buildWhatsAppUrl('11987654321', 'Olá mundo!')
    expect(url).toContain(encodeURIComponent('Olá mundo!'))
  })
})
