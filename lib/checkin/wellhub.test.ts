import { describe, it, expect } from 'vitest'
import crypto from 'crypto'
import { parseWellhubEvent, verifyWellhubSignature } from './wellhub'

// Payload real do evento de check-in (doc de sandbox do Access Control API).
const CHECKIN = JSON.stringify({
  event_type: 'checkin',
  event_data: {
    user: { unique_token: '1000000000001', first_name: 'Mike', last_name: 'Hightower' },
    gym: { id: 123456, title: 'Arena' },
    timestamp: 1666629613, // 2022-10-24T17:20:13Z → 14:20 BRT (mesmo dia)
  },
})

describe('parseWellhubEvent', () => {
  it('normaliza o evento de check-in para o formato canônico', () => {
    expect(parseWellhubEvent(CHECKIN)).toEqual({
      kind: 'checkin',
      gymId: '123456',
      partnerMemberId: '1000000000001',
      checkinDate: '2022-10-24',
      externalRef: '123456:1000000000001:1666629613',
    })
  })

  it('converte o epoch para a data LOCAL da academia (não UTC)', () => {
    // 01:30 UTC do dia 25 = 22:30 BRT do dia 24 → data local deve ser 2022-10-24.
    const lateNight = JSON.stringify({
      event_type: 'checkin',
      event_data: {
        user: { unique_token: '1000000000002' },
        gym: { id: 505 },
        timestamp: 1666659000,
      },
    })
    const parsed = parseWellhubEvent(lateNight)
    expect(parsed.kind).toBe('checkin')
    if (parsed.kind === 'checkin') expect(parsed.checkinDate).toBe('2022-10-24')
  })

  it('aceita timestamp em milissegundos (13 díg., como no response de exemplo da doc)', () => {
    const inMs = JSON.stringify({
      event_type: 'checkin',
      event_data: {
        user: { unique_token: '1000000000003' },
        gym: { id: 123456 },
        timestamp: 1666629613000, // mesmo instante que 1666629613s
      },
    })
    const parsed = parseWellhubEvent(inMs)
    expect(parsed.kind).toBe('checkin')
    if (parsed.kind === 'checkin') expect(parsed.checkinDate).toBe('2022-10-24')
  })

  it('aceita a variação "checkin-booking-occurred" (emitida pelo simulador do sandbox)', () => {
    const simulated = JSON.stringify({
      event_type: 'checkin-booking-occurred',
      event_data: {
        user: { unique_token: '1000000000004' },
        gym: { id: 129 },
        timestamp: 1666629613,
      },
    })
    const parsed = parseWellhubEvent(simulated)
    expect(parsed.kind).toBe('checkin')
    if (parsed.kind === 'checkin') expect(parsed.gymId).toBe('129')
  })

  it('ignora eventos que não são check-in (ex.: booking)', () => {
    const booking = JSON.stringify({ event_type: 'booking-requested', event_data: {} })
    expect(parseWellhubEvent(booking)).toEqual({ kind: 'ignored' })
  })

  it('lança erro em JSON malformado', () => {
    expect(() => parseWellhubEvent('{ not json')).toThrow()
  })

  it('lança erro quando um check-in está incompleto', () => {
    expect(() =>
      parseWellhubEvent(JSON.stringify({ event_type: 'checkin', event_data: {} })),
    ).toThrow()
  })
})

describe('verifyWellhubSignature', () => {
  const secret = 's3cr3t'
  // Doc do Access Control API: HMAC-SHA1 em hex MAIÚSCULO.
  const signature = crypto.createHmac('sha1', secret).update(CHECKIN).digest('hex').toUpperCase()

  it('aceita assinatura válida (hex maiúsculo, como a Wellhub envia)', () => {
    expect(verifyWellhubSignature(CHECKIN, signature, secret)).toBe(true)
  })

  it('aceita assinatura com prefixo 0X (visto no exemplo da doc)', () => {
    expect(verifyWellhubSignature(CHECKIN, `0X${signature}`, secret)).toBe(true)
  })

  it('aceita assinatura em minúsculo (hex é case-insensitive)', () => {
    expect(verifyWellhubSignature(CHECKIN, signature.toLowerCase(), secret)).toBe(true)
  })

  it('rejeita assinatura SHA-256 (algoritmo errado)', () => {
    const sha256 = crypto.createHmac('sha256', secret).update(CHECKIN).digest('hex')
    expect(verifyWellhubSignature(CHECKIN, sha256, secret)).toBe(false)
  })

  it('rejeita assinatura inválida', () => {
    expect(verifyWellhubSignature(CHECKIN, 'deadbeef', secret)).toBe(false)
  })

  it('rejeita conteúdo não-hex', () => {
    expect(verifyWellhubSignature(CHECKIN, 'not-a-hex-string', secret)).toBe(false)
  })

  it('rejeita assinatura vazia', () => {
    expect(verifyWellhubSignature(CHECKIN, '', secret)).toBe(false)
  })
})
