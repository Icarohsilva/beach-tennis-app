// lib/painel/gradeStatus.ts
// "O que eu já gerei e o que ainda falta gerar?" — a pergunta que só o admin faz.
//
// A grade tem duas camadas: `classes` é o molde (turma de terça às 19h, ativa) e
// `class_sessions` é a ocorrência gerada para uma data. Entre uma e outra existe
// um botão que alguém precisa apertar. Quando ninguém aperta, a turma existe, o
// aluno não vê aula nenhuma e o admin só descobre quando alguém reclama.
//
// Aqui a conta é explícita: para cada data, quais turmas ativas daquele dia da
// semana ainda não têm sessão. É exatamente o que o "Gerar" criaria — a mesma
// regra de generateGrid, para o número na tela não mentir sobre o botão.

export interface ActiveClass {
  id: string
  /** 0 = domingo. Mesma convenção de `classes.day_of_week`. */
  dayOfWeek: number
}

/** Dia da semana de 'YYYY-MM-DD' em UTC (0 = domingo). */
function dayOfWeek(dateISO: string): number {
  const [y, m, d] = dateISO.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

/**
 * Turmas ativas daquela data que ainda não têm sessão gerada.
 *
 * Data passada nunca acusa pendência: não se gera grade para trás, e marcar o
 * mês inteiro de vermelho ensinaria o admin a ignorar o aviso.
 */
export function pendingClassesFor(
  classes: ActiveClass[],
  generatedClassIds: Set<string>,
  dateISO: string,
  todayISO: string,
): string[] {
  if (dateISO < todayISO) return []
  const dow = dayOfWeek(dateISO)
  return classes
    .filter((c) => c.dayOfWeek === dow && !generatedClassIds.has(c.id))
    .map((c) => c.id)
}

export interface DayGeneration {
  /** Turmas ativas previstas para o dia da semana desta data. */
  expected: number
  /** Quantas dessas já têm sessão criada. */
  generated: number
  /** Quantas faltam. Zero no passado, sempre. */
  pending: number
}

/**
 * O retrato de geração de cada data de uma janela.
 *
 * `sessionClassIdsByDate` vem do banco: para cada data, os `class_id` que já têm
 * sessão **ativa** (`scheduled` ou `completed`).
 *
 * Cancelada fica de fora de propósito, e isso mudou: a geração hoje reabre a
 * sessão cancelada (`generateGrid` → `reopenCancelledSessions`), então aquela
 * data ainda tem trabalho a fazer. Contá-la como gerada apagava o botão de gerar
 * exatamente na data que o admin queria reconstruir.
 */
export function summarizeGeneration(
  classes: ActiveClass[],
  sessionClassIdsByDate: Map<string, Set<string>>,
  dates: string[],
  todayISO: string,
): Map<string, DayGeneration> {
  const out = new Map<string, DayGeneration>()

  for (const date of dates) {
    const dow = dayOfWeek(date)
    const ofDay = classes.filter((c) => c.dayOfWeek === dow)
    const generatedIds = sessionClassIdsByDate.get(date) ?? new Set<string>()
    // Conta só as sessões que correspondem a uma turma ativa deste dia: sessão
    // de turma desativada depois continua no banco e inflaria "generated"
    // acima de "expected".
    const generated = ofDay.filter((c) => generatedIds.has(c.id)).length
    const pending = date < todayISO ? 0 : ofDay.length - generated
    out.set(date, { expected: ofDay.length, generated, pending })
  }

  return out
}

/** Total de pendências da janela — o número do aviso no topo do calendário. */
export function totalPending(summary: Map<string, DayGeneration>): number {
  let total = 0
  for (const day of Array.from(summary.values())) total += day.pending
  return total
}
