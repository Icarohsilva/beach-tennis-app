// lib/checkin/wellhubValidate.ts
// Adaptador da chamada VALIDATE do Access Control API da Wellhub (Gympass).
// É o passo que CONFIRMA o check-in e gera a transação de pagamento para a academia:
//   POST {base}/access/v1/validate
//   Headers: X-Gym-Id, Authorization: Bearer <api_key>, Content-Type: application/json
//   Body:    { "gympass_id": "1000000000001" }
//   Sucesso: metadata.errors == 0
// Peça isolada e testável; não depende de sessão nem de Supabase.

export type WellhubEnvironment = 'sandbox' | 'production'

const BASE_URL: Record<WellhubEnvironment, string> = {
  sandbox: 'https://apitesting.partners.gympass.com',
  production: 'https://api.partners.gympass.com',
}

export interface WellhubValidateInput {
  environment: WellhubEnvironment
  gymId: string
  apiKey: string
  gympassId: string
}

export interface WellhubValidateResult {
  valid: boolean
  error?: string
}

interface ValidateResponse {
  metadata?: { total?: number; errors?: number }
}

export async function validateWellhubCheckin(
  input: WellhubValidateInput,
  fetchImpl: typeof fetch = fetch,
): Promise<WellhubValidateResult> {
  const url = `${BASE_URL[input.environment]}/access/v1/validate`

  let res: Response
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'X-Gym-Id': input.gymId,
        Authorization: `Bearer ${input.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ gympass_id: input.gympassId }),
    })
  } catch (e) {
    return { valid: false, error: `Falha de rede ao validar: ${(e as Error).message}` }
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    return { valid: false, error: `HTTP ${res.status} do validate: ${text.slice(0, 300)}` }
  }

  let body: ValidateResponse
  try {
    body = (await res.json()) as ValidateResponse
  } catch {
    return { valid: false, error: 'Resposta do validate não é JSON.' }
  }

  if (body.metadata?.errors === 0) return { valid: true }
  return { valid: false, error: `Validate retornou errors=${body.metadata?.errors ?? '?'}` }
}
