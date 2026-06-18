// lib/arenas/sports.ts
// Lista fixa de esportes usada no diretório /arenas e no formulário da vitrine.
// Não há tabela: esporte é só metadado (tag) da organização para busca.

export interface Sport {
  slug: string
  label: string
  emoji: string
}

export const SPORTS: Sport[] = [
  { slug: 'beach_tennis', label: 'Beach Tennis', emoji: '🎾' },
  { slug: 'padel', label: 'Padel', emoji: '🟢' },
  { slug: 'futevolei', label: 'Futevôlei', emoji: '⚽' },
  { slug: 'volei_praia', label: 'Vôlei de Praia', emoji: '🏐' },
  { slug: 'tenis', label: 'Tênis', emoji: '🎾' },
]

export const SPORT_BY_SLUG = new Map<string, Sport>(SPORTS.map((s) => [s.slug, s]))

// Filtra a entrada do usuário contra a lista válida; remove duplicados e inválidos.
export function normalizeSports(input: string[]): string[] {
  const out: string[] = []
  for (const raw of input) {
    const slug = String(raw).trim()
    if (SPORT_BY_SLUG.has(slug) && !out.includes(slug)) {
      out.push(slug)
    }
  }
  return out
}
