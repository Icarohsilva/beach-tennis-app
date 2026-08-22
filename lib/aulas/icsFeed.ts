// lib/aulas/icsFeed.ts
// Monta o texto de um arquivo .ics (RFC 5545) a partir de eventos já resolvidos.
//
// Puro, sem I/O — quem busca as aulas do aluno é features/aulas/calendarFeedQuery.ts.
// Sem depender de pacote novo: o formato é texto simples, e a única parte que
// merece função própria é o escape de vírgula/ponto-e-vírgula/quebra de linha
// (seção 3.3.11 da RFC) e a dobra de linha em 75 octetos (seção 3.1).
//
// Gerado do zero a cada busca do app de calendário — não existe "diff" entre
// gerações. Uma aula cancelada simplesmente não entra na lista de eventos, e a
// maioria dos apps de calendário entende UID ausente como "remova este
// evento": é assim que cancelamento e remarcação "sincronizam sozinhos", sem
// nenhum código aqui reagir a mutação nenhuma.

export interface CalendarEvent {
  /** Estável entre gerações do feed — normalmente class_sessions.id. */
  uid: string
  title: string
  location: string | null
  /** Instante ISO com offset (ex.: sessionStartIso) — convertido para UTC aqui. */
  startsAtIso: string
  endsAtIso: string
}

/** Escapa texto livre para dentro de um campo ICS (RFC 5545 §3.3.11). */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
}

/** yyyyMMddTHHmmssZ em UTC — formato exigido para DTSTART/DTEND com `Z`. */
function toIcsUtc(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

/**
 * Dobra uma linha em 75 octetos, com continuação por espaço na linha seguinte
 * (RFC 5545 §3.1) — sem isso, um nome de turma comprido produz um .ics
 * tecnicamente inválido que alguns clientes recusam a importar.
 */
function foldLine(line: string): string {
  if (line.length <= 75) return line
  const parts: string[] = []
  let rest = line
  while (rest.length > 75) {
    parts.push(rest.slice(0, 75))
    rest = ' ' + rest.slice(75)
  }
  parts.push(rest)
  return parts.join('\r\n')
}

function eventToVevent(event: CalendarEvent, stampIso: string): string {
  const lines = [
    'BEGIN:VEVENT',
    `UID:${event.uid}@arenahub.website`,
    `DTSTAMP:${toIcsUtc(stampIso)}`,
    `DTSTART:${toIcsUtc(event.startsAtIso)}`,
    `DTEND:${toIcsUtc(event.endsAtIso)}`,
    `SUMMARY:${escapeText(event.title)}`,
  ]
  if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`)
  lines.push('END:VEVENT')
  return lines.map(foldLine).join('\r\n')
}

/**
 * O `.ics` inteiro, pronto para a rota devolver com `Content-Type: text/calendar`.
 *
 * `stampIso` é injetado (não `new Date()` aqui dentro) para a função continuar
 * pura e testável — quem chama passa o instante atual.
 */
export function buildIcsCalendar(
  calendarName: string,
  events: CalendarEvent[],
  stampIso: string,
): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ArenaHub//Agenda do Aluno//PT',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(calendarName)}`,
    ...events.map((e) => eventToVevent(e, stampIso)),
    'END:VCALENDAR',
  ]
  return lines.join('\r\n') + '\r\n'
}
