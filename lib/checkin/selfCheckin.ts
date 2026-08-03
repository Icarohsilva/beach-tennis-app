// lib/checkin/selfCheckin.ts
// Regras puras da confirmação de presença pelo aluno: janela de tempo e
// conferência da localização contra o ponto da academia.
//
// Nada aqui toca banco nem relógio global — quem chama passa `now`. É o que
// permite a action decidir pelo relógio do servidor e o componente decidir pelo
// relógio do aluno, com a mesma regra.

import type { SelfCheckinGeoError } from '@/types'

/** A confirmação abre 1h antes do INÍCIO da aula. */
export const SELF_CHECKIN_OPENS_MINUTES_BEFORE_START = 60
/** E fecha 1h depois do FIM — cobre quem só lembra quando a aula acaba. */
export const SELF_CHECKIN_CLOSES_MINUTES_AFTER_END = 60

/** Raio padrão da academia, em metros, quando ela não configurou outro. */
export const DEFAULT_CHECKIN_RADIUS_M = 150

/**
 * Folga máxima concedida pela imprecisão do próprio GPS. Sem ela, um aluno na
 * quadra com leitura de ±80m cairia como pendente. Limitada para que uma
 * precisão ruim não vire raio infinito.
 */
export const ACCURACY_SLACK_MAX_M = 100

/** Acima disso a leitura não afirma nada útil — trata como se não houvesse GPS. */
export const ACCURACY_UNRELIABLE_M = 1500

const MINUTE_MS = 60 * 1000
const EARTH_RADIUS_M = 6_371_008.8

export interface Coords {
  latitude: number
  longitude: number
}

export interface SelfCheckinWindow {
  /** ISO — a partir de quando o aluno pode confirmar. */
  opensAt: string
  /** ISO — depois disso a confirmação não é mais aceita. */
  closesAt: string
}

/** Leitura do dispositivo, ou o motivo de não ter sido possível obtê-la. */
export type DeviceReading =
  | { latitude: number; longitude: number; accuracyM: number | null }
  | { geoError: Extract<SelfCheckinGeoError, 'denied' | 'unavailable' | 'timeout' | 'unsupported'> }

export interface SelfCheckinVerdict {
  status: 'validated' | 'pending'
  /** Metros até a academia. null quando não deu para medir. */
  distanceM: number | null
  geoError: SelfCheckinGeoError | null
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180
}

/**
 * Distância em metros entre dois pontos, pela fórmula de haversine.
 * Precisão de sobra na escala de uma quadra — não vale a pena um Vincenty aqui.
 */
export function haversineMeters(a: Coords, b: Coords): number {
  const dLat = toRad(b.latitude - a.latitude)
  const dLon = toRad(b.longitude - a.longitude)
  const lat1 = toRad(a.latitude)
  const lat2 = toRad(b.latitude)

  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Janela de confirmação a partir dos instantes de início e fim da aula. */
export function selfCheckinWindow(startsAt: string, endsAt: string): SelfCheckinWindow {
  const start = new Date(startsAt).getTime()
  const end = new Date(endsAt).getTime()
  return {
    opensAt: new Date(start - SELF_CHECKIN_OPENS_MINUTES_BEFORE_START * MINUTE_MS).toISOString(),
    closesAt: new Date(end + SELF_CHECKIN_CLOSES_MINUTES_AFTER_END * MINUTE_MS).toISOString(),
  }
}

/** Inclusiva nos dois extremos: confirmar no segundo exato da abertura vale. */
export function isWithinSelfCheckinWindow(window: SelfCheckinWindow, now: string | Date): boolean {
  const at = (typeof now === 'string' ? new Date(now) : now).getTime()
  return at >= new Date(window.opensAt).getTime() && at <= new Date(window.closesAt).getTime()
}

/**
 * Decide se a confirmação nasce válida ou pendente de revisão do professor.
 *
 * Nunca recusa: sem GPS, com GPS ruim ou fora do raio a confirmação continua
 * valendo como registro — apenas fica pendente, e o professor bate o martelo na
 * chamada. Bloquear geraria mais atrito (GPS urbano falha, iOS nega permissão)
 * do que fraude evitada.
 */
export function resolveSelfCheckinStatus(input: {
  device: DeviceReading
  /** Ponto da academia. null = ainda não configurado. */
  org: Coords | null
  radiusM: number
}): SelfCheckinVerdict {
  const { device, org, radiusM } = input

  if ('geoError' in device) {
    return { status: 'pending', distanceM: null, geoError: device.geoError }
  }

  // Sem ponto da academia não há o que conferir. A confirmação vale como
  // registro e o professor decide.
  if (!org) {
    return { status: 'pending', distanceM: null, geoError: 'org_unset' }
  }

  const distanceM = Math.round(haversineMeters(device, org))

  if (device.accuracyM !== null && device.accuracyM > ACCURACY_UNRELIABLE_M) {
    return { status: 'pending', distanceM, geoError: 'inaccurate' }
  }

  const slack = Math.min(device.accuracyM ?? 0, ACCURACY_SLACK_MAX_M)
  if (distanceM <= radiusM + slack) {
    return { status: 'validated', distanceM, geoError: null }
  }

  return { status: 'pending', distanceM, geoError: 'out_of_range' }
}

/** Texto curto do motivo, para o professor entender a pendência na chamada. */
export function selfCheckinGeoErrorLabel(
  error: SelfCheckinGeoError | null,
  distanceM: number | null,
): string {
  switch (error) {
    case 'denied':
      return 'confirmou sem permitir a localização'
    case 'unavailable':
      return 'confirmou sem sinal de GPS'
    case 'timeout':
      return 'confirmou sem o GPS responder a tempo'
    case 'unsupported':
      return 'confirmou de um aparelho sem GPS'
    case 'org_unset':
      return 'confirmou (academia sem ponto configurado)'
    case 'inaccurate':
      return 'confirmou com localização imprecisa'
    case 'out_of_range':
      return distanceM !== null
        ? `confirmou a ${formatDistance(distanceM)} da academia`
        : 'confirmou fora do raio da academia'
    default:
      return 'confirmou pelo app'
  }
}

/** 340 m · 1,2 km — evita "1240 m" na tela do professor. */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`
  return `${(meters / 1000).toFixed(1).replace('.', ',')} km`
}
