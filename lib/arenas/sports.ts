// lib/arenas/sports.ts
// Lista curada de modalidades usada no diretório /arenas e nos formulários de vitrine.
// Não há tabela: modalidade é metadado (tag) da organização para busca.
// Entradas "Outro" (texto livre) são prefixadas com "custom:" e não entram nas facetas.

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
  { slug: 'futebol', label: 'Futebol', emoji: '⚽' },
  { slug: 'crossfit', label: 'CrossFit', emoji: '🏋️' },
  { slug: 'funcional', label: 'Funcional', emoji: '🤸' },
  { slug: 'pilates', label: 'Pilates', emoji: '🧘' },
  { slug: 'yoga', label: 'Yoga', emoji: '🧘' },
  { slug: 'muay_thai', label: 'Muay Thai / Luta', emoji: '🥊' },
  { slug: 'natacao', label: 'Natação', emoji: '🏊' },
  { slug: 'volei_quadra', label: 'Vôlei de Quadra', emoji: '🏐' },
  { slug: 'basquete', label: 'Basquete', emoji: '🏀' },
  { slug: 'danca', label: 'Dança', emoji: '💃' },
]

export const SPORT_BY_SLUG = new Map<string, Sport>(SPORTS.map((s) => [s.slug, s]))

const CUSTOM_PREFIX = 'custom:'
const MAX_CUSTOM_SPORT_LEN = 40

export function isCustomSport(slug: string): boolean {
  return slug.startsWith(CUSTOM_PREFIX)
}

// Normaliza texto livre "Outro" em uma tag "custom:<texto>". Retorna null se vazio.
export function sanitizeCustomSport(raw: string): string | null {
  const text = String(raw).trim().replace(/\s+/g, ' ').slice(0, MAX_CUSTOM_SPORT_LEN)
  if (!text) return null
  return CUSTOM_PREFIX + text
}

// Filtra a entrada contra a lista válida + entradas custom; remove duplicados e inválidos.
export function normalizeSports(input: string[]): string[] {
  const out: string[] = []
  for (const raw of input) {
    const slug = String(raw).trim()
    if (isCustomSport(slug)) {
      const clean = sanitizeCustomSport(slug.slice(CUSTOM_PREFIX.length))
      if (clean && !out.includes(clean)) out.push(clean)
    } else if (SPORT_BY_SLUG.has(slug) && !out.includes(slug)) {
      out.push(slug)
    }
  }
  return out
}

// Rótulo de exibição para uma tag: slug conhecido → label; custom → texto puro.
export function sportLabel(slug: string): string {
  if (isCustomSport(slug)) return slug.slice(CUSTOM_PREFIX.length)
  return SPORT_BY_SLUG.get(slug)?.label ?? slug
}
