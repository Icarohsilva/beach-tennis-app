// lib/arenas/cep.ts
// Helpers de CEP. As funções puras (formatCep/isCompleteCep/mapViaCep) são testadas
// sem rede. fetchAddressByCep faz o fetch ViaCEP no client (não é coberto por teste).

export function formatCep(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8)
  if (digits.length <= 5) return digits
  return `${digits.slice(0, 5)}-${digits.slice(5)}`
}

export function isCompleteCep(raw: string): boolean {
  return raw.replace(/\D/g, '').length === 8
}

export interface ViaCepPayload {
  uf?: string
  localidade?: string
  bairro?: string
  logradouro?: string
  erro?: boolean
}

export interface MappedAddress {
  state: string
  city: string
  neighborhood: string
  addressLine: string
}

export function mapViaCep(payload: ViaCepPayload): MappedAddress {
  return {
    state: payload.uf ?? '',
    city: payload.localidade ?? '',
    neighborhood: payload.bairro ?? '',
    addressLine: payload.logradouro ?? '',
  }
}

// Busca endereço no ViaCEP. Retorna null se CEP inválido, não encontrado ou erro de rede.
export async function fetchAddressByCep(raw: string): Promise<MappedAddress | null> {
  const digits = raw.replace(/\D/g, '')
  if (digits.length !== 8) return null
  try {
    const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`)
    if (!res.ok) return null
    const payload = (await res.json()) as ViaCepPayload
    if (payload.erro) return null
    return mapViaCep(payload)
  } catch {
    return null
  }
}
