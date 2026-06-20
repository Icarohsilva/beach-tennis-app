// lib/billing/webhookSignature.test.ts
import { describe, it, expect } from 'vitest'
import crypto from 'crypto'
import {
  buildSignatureManifest,
  parseSignatureHeader,
  isValidSignature,
} from './webhookSignature'

describe('buildSignatureManifest', () => {
  it('monta o template oficial id;request-id;ts com todos os valores', () => {
    // Exemplo literal da doc do MercadoPago.
    const manifest = buildSignatureManifest({
      dataId: '123456',
      requestId: 'bb56a2f1-6aae-46ac-982e-9dcd3581d08e',
      ts: '1742505638683',
    })
    expect(manifest).toBe('id:123456;request-id:bb56a2f1-6aae-46ac-982e-9dcd3581d08e;ts:1742505638683;')
  })

  it('coloca o data.id alfanumérico em minúsculas', () => {
    const manifest = buildSignatureManifest({ dataId: 'AbC123XyZ', requestId: 'r1', ts: '10' })
    expect(manifest).toBe('id:abc123xyz;request-id:r1;ts:10;')
  })

  it('omite o segmento id quando data.id está ausente (regra oficial)', () => {
    expect(buildSignatureManifest({ dataId: null, requestId: 'r1', ts: '10' })).toBe(
      'request-id:r1;ts:10;',
    )
    expect(buildSignatureManifest({ dataId: '', requestId: 'r1', ts: '10' })).toBe(
      'request-id:r1;ts:10;',
    )
  })

  it('omite o segmento request-id quando ausente', () => {
    expect(buildSignatureManifest({ dataId: '99', requestId: null, ts: '10' })).toBe('id:99;ts:10;')
  })
})

describe('parseSignatureHeader', () => {
  it('extrai ts e v1 do header "ts=...,v1=..."', () => {
    expect(parseSignatureHeader('ts=1704908010,v1=abc123')).toEqual({ ts: '1704908010', v1: 'abc123' })
  })

  it('tolera espaços ao redor dos pares', () => {
    expect(parseSignatureHeader('ts=10, v1=ff')).toEqual({ ts: '10', v1: 'ff' })
  })

  it('retorna nulos quando o header está vazio ou malformado', () => {
    expect(parseSignatureHeader(null)).toEqual({ ts: null, v1: null })
    expect(parseSignatureHeader('')).toEqual({ ts: null, v1: null })
    expect(parseSignatureHeader('garbage')).toEqual({ ts: null, v1: null })
  })
})

describe('isValidSignature', () => {
  const secret = 'segredo_de_teste'
  const dataId = 'abc123'
  const requestId = 'req-xyz'
  const ts = '1700000000000'

  function sign(manifest: string): string {
    return crypto.createHmac('sha256', secret).update(manifest).digest('hex')
  }

  it('aceita uma assinatura calculada com o template correto', () => {
    const v1 = sign(`id:${dataId};request-id:${requestId};ts:${ts};`)
    const xSignature = `ts=${ts},v1=${v1}`
    expect(isValidSignature({ xSignature, requestId, dataId, secret })).toBe(true)
  })

  it('rejeita quando o data.id não bate (assinatura forjada para outro recurso)', () => {
    const v1 = sign(`id:${dataId};request-id:${requestId};ts:${ts};`)
    const xSignature = `ts=${ts},v1=${v1}`
    expect(isValidSignature({ xSignature, requestId, dataId: 'outro', secret })).toBe(false)
  })

  it('rejeita um v1 incorreto', () => {
    const xSignature = `ts=${ts},v1=${'0'.repeat(64)}`
    expect(isValidSignature({ xSignature, requestId, dataId, secret })).toBe(false)
  })

  it('rejeita quando ts ou v1 faltam no header', () => {
    expect(isValidSignature({ xSignature: 'v1=abc', requestId, dataId, secret })).toBe(false)
    expect(isValidSignature({ xSignature: null, requestId, dataId, secret })).toBe(false)
  })

  it('rejeita um v1 malformado (não-hex) sem lançar', () => {
    const xSignature = `ts=${ts},v1=zzz`
    expect(isValidSignature({ xSignature, requestId, dataId, secret })).toBe(false)
  })
})
