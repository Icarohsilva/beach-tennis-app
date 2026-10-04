import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const create = vi.fn()
vi.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error {
    status = 500
  }
  class Anthropic {
    static APIError = APIError
    beta = { messages: { create } }
  }
  return { default: Anthropic }
})

import { readWellhubReceipt } from './receiptReader'

const img = new Uint8Array([1, 2, 3])

describe('readWellhubReceipt', () => {
  beforeEach(() => {
    create.mockReset()
    process.env.ANTHROPIC_API_KEY = 'test-key'
  })
  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY
  })

  it('manda a imagem com schema e fallback, e devolve os campos lidos', async () => {
    create.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{
        type: 'text',
        text: JSON.stringify({
          is_wellhub_checkin: true, gym_name: ' Varandas Beach ', day: 4, month: 10, hour: 11, minute: 38,
        }),
      }],
    })

    const r = await readWellhubReceipt(img, 'image/jpeg')
    expect(r).toEqual({
      isWellhubCheckin: true, gymName: 'Varandas Beach', day: 4, month: 10, hour: 11, minute: 38,
    })

    const req = create.mock.calls[0][0]
    expect(req.model).toBe('claude-opus-5-5')
    expect(req.fallbacks).toBe('default')
    expect(req.betas).toEqual(['server-side-fallback-2026-07-01'])
    expect(req.output_config.format.type).toBe('json_schema')
    expect(req.messages[0].content[0]).toMatchObject({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: 'AQID' },
    })
  })

  it('sem chave configurada não chama a API', async () => {
    delete process.env.ANTHROPIC_API_KEY
    expect(await readWellhubReceipt(img, 'image/png')).toBeNull()
    expect(create).not.toHaveBeenCalled()
  })

  it('recusa do modelo, JSON fora do formato ou erro viram "sem leitura"', async () => {
    create.mockResolvedValueOnce({ stop_reason: 'refusal', content: [] })
    expect(await readWellhubReceipt(img, 'image/png')).toBeNull()

    create.mockResolvedValueOnce({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '{"is_wellhub_checkin":"sim"}' }],
    })
    expect(await readWellhubReceipt(img, 'image/png')).toBeNull()

    create.mockRejectedValueOnce(new Error('rede'))
    expect(await readWellhubReceipt(img, 'image/png')).toBeNull()
  })
})
