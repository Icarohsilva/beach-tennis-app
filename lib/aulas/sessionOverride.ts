// lib/aulas/sessionOverride.ts
// Horário, quadra e capacidade de uma aula: o da turma, ou o override daquela data.
//
// Puro e num lugar só porque a mesma pergunta é feita em uma dúzia de telas —
// agenda do aluno, calendário, ficha da aula, chamada, janela de check-in, janela
// de cancelamento, teto da fila de espera. Cada uma lendo `classes.start_time`
// direto é como a aula remarcada apareceria no horário velho em metade delas.
//
// A regra é uma linha (`??`), e é justamente por ser trivial que ela precisa de um
// nome: o erro aqui nunca é errar o `??`, é esquecer de aplicá-lo.

/** O que a turma recorrente define. */
export interface ClassDefaults {
  start_time: string
  end_time: string
  court?: number | null
  max_students: number
}

/** O que a sessão daquela data pode sobrescrever. Tudo opcional e anulável. */
export interface SessionOverrides {
  start_time?: string | null
  end_time?: string | null
  court?: number | null
  max_students?: number | null
}

export interface ResolvedSession {
  startTime: string
  endTime: string
  court: number | null
  maxStudents: number
}

/**
 * Os valores que valem para ESTA data.
 *
 * `??` e não `||`: capacidade e quadra são números, e `0` — ainda que barrado pelo
 * CHECK da migração — não pode virar silenciosamente o valor da turma.
 */
export function resolveSession(
  session: SessionOverrides | null | undefined,
  cls: ClassDefaults,
): ResolvedSession {
  return {
    startTime: session?.start_time ?? cls.start_time,
    endTime: session?.end_time ?? cls.end_time,
    court: session?.court ?? cls.court ?? null,
    maxStudents: session?.max_students ?? cls.max_students,
  }
}

/**
 * A data foi alterada em relação à turma?
 *
 * Serve para a tela marcar "horário alterado" — sem isso o aluno vê um horário
 * diferente do que combinou e não tem como saber se é mudança ou engano dele.
 */
export function hasOverride(session: SessionOverrides | null | undefined): boolean {
  if (!session) return false
  return (
    session.start_time != null ||
    session.end_time != null ||
    session.court != null ||
    session.max_students != null
  )
}

/** Campos que zeram todos os overrides — "voltar ao horário da turma". */
export const CLEARED_OVERRIDES: Required<SessionOverrides> = {
  start_time: null,
  end_time: null,
  court: null,
  max_students: null,
}
