import { describe, it, expect } from 'vitest'
import crypto from 'crypto'
import { parseWellhubEvent, verifyWellhubSignature } from './wellhub'

const SAMPLE = JSON.stringify({
  id: 'evt_abc123',
  event: 'checkin.created',
  data: {
    gym: { id: 'gym_789' },
    member: { id: 'GP123456' },
    checkin: { at: '2026-06-25T13:45:00Z' },
  },
})

describe('parseWellhubEvent', () => {
  it('normaliza o payload de exemplo para o formato canônico', () => {
    expect(parseWellhubEvent(SAMPLE)).toEqual({
      gymId: 'gym_789',
      partnerMemberId: 'GP123456',
      checkinDate: '2026-06-25',
      externalRef: 'evt_abc123',
    })
  })

  it('lança erro em JSON malformado', () => {
    expect(() => parseWellhubEvent('{ not json')).toThrow()
  })

  it('lança erro quando faltam campos obrigatórios', () => {
    expect(() => parseWellhubEvent(JSON.stringify({ data: {} }))).toThrow()
  })
})

describe('verifyWellhubSignature', () => {
  const secret = 's3cr3t'
  const signature = crypto.createHmac('sha256', secret).update(SAMPLE).digest('hex')

  it('aceita assinatura válida', () => {
    expect(verifyWellhubSignature(SAMPLE, signature, secret)).toBe(true)
  })

  it('rejeita assinatura inválida', () => {
    expect(verifyWellhubSignature(SAMPLE, 'deadbeef', secret)).toBe(false)
  })

  it('rejeita assinatura vazia', () => {
    expect(verifyWellhubSignature(SAMPLE, '', secret)).toBe(false)
  })
})
