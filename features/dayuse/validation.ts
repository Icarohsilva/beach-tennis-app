// features/dayuse/validation.ts
// Regras puras do slot de day use. Sem I/O: quem busca os slots do dia é a
// action (createDayUseSlot), no mesmo padrão de lib/utils/accessRules.ts.

/** Um intervalo de horário na mesma quadra e data — o que pode colidir. */
export interface TimeRange {
  start_time: string
  end_time: string
}

/**
 * `HH:MM` para comparar, venha `HH:MM` do formulário ou `HH:MM:SS` do banco.
 *
 * Sem isto a comparação de string erra exatamente na borda: `'10:00'` é MENOR
 * que `'10:00:00'` (a mais curta é prefixo da outra), então um slot novo de
 * 10:00 colidia com um existente que terminava às 10:00:00 — e turno seguido na
 * mesma quadra, que é o caso mais comum da arena, era recusado como conflito.
 */
function hhmm(time: string): string {
  return time.slice(0, 5)
}

/**
 * Dois intervalos se sobrepõem?
 *
 * Fim exclusivo dos dois lados: um slot 09:00–10:00 e outro 10:00–11:00 são
 * vizinhos, não conflito — é como a arena encaixa turnos seguidos na mesma
 * quadra.
 */
export function overlaps(a: TimeRange, b: TimeRange): boolean {
  return hhmm(a.start_time) < hhmm(b.end_time) && hhmm(b.start_time) < hhmm(a.end_time)
}

export interface ValidateDayUseInput {
  start_time: string
  end_time: string
  capacity?: number
  /** YYYY-MM-DD do slot. Ausente = não valida data (compatibilidade). */
  date?: string
  /** YYYY-MM-DD de hoje, em BRT (brtToday). Exigido junto de `date`. */
  today?: string
  /**
   * Slots JÁ existentes na mesma quadra e data. A action busca e passa; vazio
   * quando não há nenhum. Sem isto dava para criar dois day use no mesmo
   * horário e na mesma quadra, e a arena só descobria com gente na areia.
   */
  sameCourtSlots?: TimeRange[]
}

/**
 * Valida o slot antes de gravar.
 *
 * Assinatura posicional antiga (`start`, `end`, `capacity`) preservada pelo
 * overload abaixo: `createDayUseSlot` já chamava assim, e os testes também.
 */
export function validateDayUseSlot(input: ValidateDayUseInput): { error?: string }
export function validateDayUseSlot(
  startTime: string,
  endTime: string,
  capacity?: number,
): { error?: string }
export function validateDayUseSlot(
  first: ValidateDayUseInput | string,
  endTime?: string,
  capacity = 1,
): { error?: string } {
  const input: ValidateDayUseInput =
    typeof first === 'string'
      ? { start_time: first, end_time: endTime as string, capacity }
      : first

  const cap = input.capacity ?? 1

  if (input.start_time >= input.end_time) {
    return { error: 'Horário de fim deve ser depois do início' }
  }
  if (cap < 1) return { error: 'capacidade mínima é 1' }

  // Day use no passado não é erro de digitação inofensivo: ele entra na agenda
  // do aluno e na lista da arena como se fosse reservável.
  if (input.date && input.today && input.date < input.today) {
    return { error: 'Não é possível criar day use em data passada' }
  }

  const conflito = (input.sameCourtSlots ?? []).find((s) => overlaps(input, s))
  if (conflito) {
    return {
      error: `Já existe day use nesta quadra das ${conflito.start_time.slice(0, 5)} às ${conflito.end_time.slice(0, 5)}.`,
    }
  }

  return {}
}
