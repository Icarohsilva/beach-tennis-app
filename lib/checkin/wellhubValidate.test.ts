import { describe, it, expect, vi } from 'vitest'
import { validateWellhubCheckin } from './wellhubValidate'

const base = { environment: 'sandbox' as const, gymId: '505', apiKey: 'k', gympassId: '1000000000001' }

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

describe('validateWellhubCheckin', () => {
  it('monta a request com endpoint, headers e body corretos (sandbox)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ metadata: { total: 1, errors: 0 } }))
    await validateWellhubCheckin(base, fetchMock)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://apitesting.partners.gympass.com/access/v1/validate')
    expect(init.method).toBe('POST')
    expect(init.headers['X-Gym-Id']).toBe('505')
    expect(init.headers.Authorization).toBe('Bearer k')
    expect(JSON.parse(init.body)).toEqual({ gympass_id: '1000000000001' })
  })

  it('usa a base de produção quando environment=production', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ metadata: { errors: 0 } }))
    await validateWellhubCheckin({ ...base, environment: 'production' }, fetchMock)
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.partners.gympass.com/access/v1/validate')
  })

  it('valida quando metadata.errors == 0', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ metadata: { total: 1, errors: 0 } }))
    expect(await validateWellhubCheckin(base, fetchMock)).toEqual({ valid: true })
  })

  it('não valida quando há errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ metadata: { total: 0, errors: 1 } }))
    const res = await validateWellhubCheckin(base, fetchMock)
    expect(res.valid).toBe(false)
  })

  it('não valida em erro HTTP', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ message: 'unauthorized' }, false, 401))
    const res = await validateWellhubCheckin(base, fetchMock)
    expect(res.valid).toBe(false)
    expect(res.error).toContain('401')
  })

  it('usa a mensagem de erro de domínio da Wellhub quando disponível (mesmo com HTTP não-2xx)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          metadata: { total: 0, errors: 1 },
          errors: [{ message: 'Check-In not found in database', key: 'checkin.validation.notfound' }],
        },
        false,
        404,
      ),
    )
    const res = await validateWellhubCheckin(base, fetchMock)
    expect(res).toEqual({ valid: false, error: 'Check-In not found in database' })
  })

  it('não valida em falha de rede', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNRESET'))
    const res = await validateWellhubCheckin(base, fetchMock)
    expect(res.valid).toBe(false)
    expect(res.error).toContain('ECONNRESET')
  })
})
