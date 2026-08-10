// lib/explorar/nearby.ts
// Regras puras da descoberta de arenas.
//
// Ordenar por distância só é possível quando a pessoa deixa o navegador dar a
// posição E a academia marcou o ponto da quadra (organizations.latitude, que já
// existia para o geofence do self check-in). Nenhum dos dois é garantido, então
// o módulo trata "sem coordenada" como caso normal e cai para uma ordem por
// cidade — não como erro.
import { haversineMeters } from '@/lib/checkin/selfCheckin'

/** Posição do dispositivo, quando concedida. */
export interface Position {
  latitude: number
  longitude: number
}

export interface NearbyArena {
  id: string
  name: string
  slug: string
  city: string | null
  neighborhood: string | null
  state: string | null
  sports: string[]
  latitude: number | null
  longitude: number | null
  /** Torneios com inscrição aberta nesta arena. */
  openTournaments: number
  /** Horários de day use ainda disponíveis. */
  openDayUse: number
}

export interface ArenaWithDistance extends NearbyArena {
  /** Metros até a pessoa. null = sem posição ou sem ponto marcado. */
  distanceM: number | null
}

/**
 * Coordenada arredondada antes de virar parâmetro de URL.
 *
 * Três casas são ~110 m — de sobra para ordenar arenas e longe de identificar
 * uma casa. A posição exata acabaria no histórico do navegador e nos logs de
 * acesso do servidor, e nada aqui precisa dessa precisão.
 */
export const COORD_PRECISION = 3

export function roundCoord(value: number): number {
  const factor = 10 ** COORD_PRECISION
  return Math.round(value * factor) / factor
}

/** Lê lat/lng da query string. Qualquer coisa fora do globo é descartada. */
export function parsePosition(
  lat: string | undefined,
  lng: string | undefined,
): Position | null {
  if (!lat || !lng) return null
  const latitude = Number(lat)
  const longitude = Number(lng)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  if (latitude < -90 || latitude > 90) return null
  if (longitude < -180 || longitude > 180) return null
  return { latitude, longitude }
}

/**
 * Distância de cada arena e ordenação.
 *
 * Com posição: as que têm ponto marcado vêm primeiro, da mais perto para a mais
 * longe; as sem coordenada descem para o fim (não dá para afirmar que estão
 * longe, mas também não dá para colocá-las na frente de quem se sabe perto).
 * Sem posição: ordem alfabética por cidade e nome, que é o que o diretório
 * público já fazia.
 */
export function rankArenas(
  arenas: NearbyArena[],
  position: Position | null,
): ArenaWithDistance[] {
  const withDistance = arenas.map((arena): ArenaWithDistance => {
    const canMeasure =
      position !== null && arena.latitude !== null && arena.longitude !== null
    return {
      ...arena,
      distanceM: canMeasure
        ? Math.round(
            haversineMeters(position, {
              latitude: arena.latitude as number,
              longitude: arena.longitude as number,
            }),
          )
        : null,
    }
  })

  const byName = (a: ArenaWithDistance, b: ArenaWithDistance) =>
    (a.city ?? '').localeCompare(b.city ?? '', 'pt-BR') ||
    a.name.localeCompare(b.name, 'pt-BR')

  if (!position) return withDistance.sort(byName)

  return withDistance.sort((a, b) => {
    if (a.distanceM === null && b.distanceM === null) return byName(a, b)
    if (a.distanceM === null) return 1
    if (b.distanceM === null) return -1
    return a.distanceM - b.distanceM || byName(a, b)
  })
}

/** "850 m", "2,4 km", "12 km". Sem distância devolve null (a UI omite). */
export function formatDistance(distanceM: number | null): string | null {
  if (distanceM === null) return null
  if (distanceM < 1000) return `${Math.round(distanceM / 10) * 10} m`
  const km = distanceM / 1000
  // Abaixo de 10 km a casa decimal ajuda a decidir; acima dela é ruído.
  return km < 10
    ? `${km.toFixed(1).replace('.', ',')} km`
    : `${Math.round(km)} km`
}

/** Cidades presentes na lista, para o seletor de quem não deu a posição. */
export function cityFacets(arenas: NearbyArena[]): string[] {
  const cities = new Set<string>()
  for (const arena of arenas) {
    if (arena.city) cities.add(arena.city)
  }
  return Array.from(cities).sort((a, b) => a.localeCompare(b, 'pt-BR'))
}

/**
 * Arena que vale destacar: tem algo acontecendo agora.
 *
 * Sem isso a lista viraria uma lista telefônica — o que traz a pessoa de volta
 * é ter torneio aberto ou quadra livre, não a existência da arena.
 */
export function hasSomethingOpen(arena: NearbyArena): boolean {
  return arena.openTournaments > 0 || arena.openDayUse > 0
}
