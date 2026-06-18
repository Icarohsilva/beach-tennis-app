// lib/arenas/filters.ts
// Traduz os parâmetros da query string (?cidade=&esporte=) em critérios de filtro
// aplicados na consulta do diretório. Função pura, sem acesso a banco.

import { SPORT_BY_SLUG } from './sports'

export interface DirectoryQuery {
  cidade?: string
  esporte?: string
}

export interface DirectoryFilter {
  city?: string
  sport?: string
}

export function buildDirectoryFilter(q: DirectoryQuery): DirectoryFilter {
  const filter: DirectoryFilter = {}

  const city = q.cidade?.trim()
  if (city) filter.city = city

  const sport = q.esporte?.trim()
  if (sport && SPORT_BY_SLUG.has(sport)) filter.sport = sport

  return filter
}
