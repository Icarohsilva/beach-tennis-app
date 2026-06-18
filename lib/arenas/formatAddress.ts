// lib/arenas/formatAddress.ts
// Compõe a linha de endereço (logradouro + número) para exibição pública.

export function formatAddress(input: {
  address_line: string | null
  address_number: string | null
  no_number: boolean
}): string {
  const line = (input.address_line ?? '').trim()
  if (!line) return ''
  if (input.no_number) return `${line}, s/n`
  const num = (input.address_number ?? '').trim()
  return num ? `${line}, ${num}` : line
}
