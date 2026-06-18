// lib/validation/documento.ts
// Validação de CPF/CNPJ (com dígitos verificadores) e máscara para exibição.
// Funções puras, testáveis sem rede. O armazenamento guarda só dígitos.

export function onlyDigits(raw: string): string {
  return (raw ?? '').replace(/\D/g, '')
}

export function detectDocumentType(digits: string): 'cpf' | 'cnpj' | null {
  if (digits.length === 11) return 'cpf'
  if (digits.length === 14) return 'cnpj'
  return null
}

export function isValidCPF(digits: string): boolean {
  if (digits.length !== 11) return false
  if (/^(\d)\1{10}$/.test(digits)) return false // todos iguais

  let sum = 0
  for (let i = 0; i < 9; i++) sum += Number(digits[i]) * (10 - i)
  let d1 = (sum * 10) % 11
  if (d1 === 10) d1 = 0
  if (d1 !== Number(digits[9])) return false

  sum = 0
  for (let i = 0; i < 10; i++) sum += Number(digits[i]) * (11 - i)
  let d2 = (sum * 10) % 11
  if (d2 === 10) d2 = 0
  return d2 === Number(digits[10])
}

export function isValidCNPJ(digits: string): boolean {
  if (digits.length !== 14) return false
  if (/^(\d)\1{13}$/.test(digits)) return false // todos iguais

  const calc = (len: 12 | 13): number => {
    const weights =
      len === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    let sum = 0
    for (let i = 0; i < len; i++) sum += Number(digits[i]) * weights[i]
    const r = sum % 11
    return r < 2 ? 0 : 11 - r
  }

  if (calc(12) !== Number(digits[12])) return false
  return calc(13) === Number(digits[13])
}

export function isValidDocument(raw: string): boolean {
  const d = onlyDigits(raw)
  const type = detectDocumentType(d)
  if (type === 'cpf') return isValidCPF(d)
  if (type === 'cnpj') return isValidCNPJ(d)
  return false
}

// Máscara progressiva: serve tanto para exibir quanto para mascarar enquanto
// o usuário digita. Até 11 dígitos formata como CPF; acima, como CNPJ.
export function formatDocument(raw: string): string {
  const d = onlyDigits(raw).slice(0, 14)
  if (d.length <= 11) {
    return d
      .replace(/^(\d{3})(\d)/, '$1.$2')
      .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/^(\d{3})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3-$4')
  }
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/^(\d{2})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3/$4')
    .replace(/^(\d{2})\.(\d{3})\.(\d{3})\/(\d{4})(\d)/, '$1.$2.$3/$4-$5')
}
