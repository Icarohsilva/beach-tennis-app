// lib/dayuse/recurrence.ts
// Regra pura da recorrência de day use: quais datas um molde semanal produz
// numa janela. Espelha buildSessionRows (features/aulas/sessionUtils.ts) — é a
// mesma pergunta que a grade de aulas responde, e day use recorrente entra na
// mesma passada do cron.
import { eachDayOfInterval, format, getDay, parseISO } from 'date-fns'
import type { DayUseKind } from '@/types'
import type { DayUsePaymentTiming } from './paymentMethod'

/** O molde: uma linha de dayuse_recurrences, só o que a geração precisa. */
export interface DayUseRecurrence {
  id: string
  day_of_week: number
  start_time: string
  end_time: string
  court: number
  capacity: number
  sport?: string | null
  kind?: DayUseKind
  price_cents?: number | null
  payment_timing?: DayUsePaymentTiming
  notes?: string | null
}

/** Uma linha de dayuse_slots pronta para o upsert. */
export interface DayUseSlotRow {
  recurrence_id: string
  court: number
  date: string
  start_time: string
  end_time: string
  capacity: number
  sport: string | null
  kind: DayUseKind
  price_cents: number | null
  payment_timing: DayUsePaymentTiming
  notes: string | null
}

/**
 * As datas que estes moldes produzem em [from, to], inclusive nas duas pontas.
 *
 * `from`/`to` são `yyyy-MM-dd` sem fuso — a janela é dia de calendário, e é o
 * chamador que decide o "hoje" em BRT (brtToday), como no cron da grade.
 *
 * Determinística e sem I/O: rodar duas vezes com a mesma janela devolve as
 * mesmas linhas. A idempotência da GRAVAÇÃO é do índice único
 * (organization_id, court, date, start_time) — aqui só não se inventa data.
 */
export function buildDayUseRows(
  recurrences: DayUseRecurrence[],
  from: string,
  to: string,
): DayUseSlotRow[] {
  if (recurrences.length === 0) return []
  const start = parseISO(from)
  const end = parseISO(to)
  // Janela invertida devolve nada em vez de estourar: eachDayOfInterval lança
  // com start > end, e um cron não pode cair por causa de aritmética de data.
  if (start > end) return []

  const days = eachDayOfInterval({ start, end })
  const rows: DayUseSlotRow[] = []

  for (const rec of recurrences) {
    for (const d of days) {
      if (getDay(d) !== rec.day_of_week) continue
      rows.push({
        recurrence_id: rec.id,
        court: rec.court,
        date: format(d, 'yyyy-MM-dd'),
        start_time: rec.start_time,
        end_time: rec.end_time,
        capacity: rec.capacity,
        sport: rec.sport ?? null,
        kind: rec.kind ?? 'scheduled',
        price_cents: rec.price_cents ?? null,
        payment_timing: rec.payment_timing ?? 'on_site',
        notes: rec.notes ?? null,
      })
    }
  }

  return rows
}

/**
 * Dois moldes ativos que se atropelam no mesmo espaço e dia da semana?
 *
 * A validação por data de `validateDayUseSlot` não alcança isto: o conflito
 * entre recorrências só apareceria na geração, como erro de índice único do
 * cron — longe do admin que criou a segunda, semanas depois.
 */
export function recurrenceConflict(
  candidate: Pick<DayUseRecurrence, 'day_of_week' | 'court' | 'start_time' | 'end_time'>,
  existing: Pick<DayUseRecurrence, 'day_of_week' | 'court' | 'start_time' | 'end_time'>[],
): DayUseRecurrence['start_time'] | null {
  const hhmm = (t: string) => t.slice(0, 5)
  const found = existing.find(
    (e) =>
      e.day_of_week === candidate.day_of_week &&
      e.court === candidate.court &&
      // Fim exclusivo dos dois lados, igual a `overlaps` de validation.ts:
      // 9h-12h e 12h-15h no mesmo espaço são turnos seguidos, não conflito.
      hhmm(candidate.start_time) < hhmm(e.end_time) &&
      hhmm(e.start_time) < hhmm(candidate.end_time),
  )
  return found ? found.start_time : null
}
