// lib/torneios/matchTime.ts
// Helpers de fuso para agendamento de confrontos.
// O input datetime-local não carrega fuso; interpretamos sempre como
// America/Sao_Paulo (offset fixo -03:00, sem horário de verão no Brasil atual).

const BRT_OFFSET = '-03:00'
const TZ = 'America/Sao_Paulo'

/** "2026-07-05T18:00" (BRT) -> ISO UTC. null se vazio/inválido. */
export function brtLocalToIso(local: string): string | null {
  if (!local) return null
  const withSeconds = local.length === 16 ? `${local}:00` : local
  const d = new Date(`${withSeconds}${BRT_OFFSET}`)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

/** ISO UTC -> "2026-07-05T18:00" (BRT) para preencher o input. '' se inválido. */
export function isoToBrtLocalInput(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  // sv-SE produz "YYYY-MM-DD HH:mm"
  const s = new Intl.DateTimeFormat('sv-SE', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d)
  return s.replace(' ', 'T')
}

/** ISO UTC -> "sáb., 05/07 · 18:00" (BRT). '' se inválido. */
export function formatMatchDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const date = new Intl.DateTimeFormat('pt-BR', {
    timeZone: TZ,
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
  }).format(d)
  const time = new Intl.DateTimeFormat('pt-BR', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d)
  return `${date} · ${time}`
}

/** Meia-noite (BRT) do dia corrente, como Date UTC. */
export function startOfTodayBrt(now: Date): Date {
  const dateStr = new Intl.DateTimeFormat('sv-SE', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
  return new Date(`${dateStr}T00:00:00${BRT_OFFSET}`)
}
