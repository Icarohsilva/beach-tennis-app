// lib/torneios/display.ts
// Helpers de apresentação compartilhados pela UI de torneios.

/** Iniciais de um nome para avatares (ex: "João Silva" -> "JS"). */
export function initials(name: string | null | undefined): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** Nome de uma dupla/lado a partir dos nomes disponíveis. */
export function teamLabel(names: (string | null | undefined)[]): string {
  const valid = names.filter((n): n is string => !!n && n.trim().length > 0)
  return valid.length > 0 ? valid.join(' / ') : 'A definir'
}
