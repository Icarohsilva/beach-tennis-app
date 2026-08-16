// lib/aulas/vacation.ts
// Período de férias do aluno. Puro, sem I/O — o caller busca as linhas.
//
// Toda data é 'yyyy-MM-dd' em BRT e comparada como STRING, nunca como Date: o
// formato ISO ordena lexicograficamente igual à ordem cronológica, e converter
// para Date traria o fuso do processo de volta (a Vercel roda em UTC, e o
// projeto já foi mordido por isso em gridSchedule.ts).
//
// Os limites são INCLUSIVOS dos dois lados: quem marca férias de 10 a 20 espera
// não ter aula no dia 10 nem no dia 20.

/** Um período de férias, do jeito que a regra precisa dele. */
export interface VacationPeriod {
  /** 'yyyy-MM-dd' */
  startsOn: string
  /** 'yyyy-MM-dd' */
  endsOn: string
}

/**
 * O aluno está de férias nesta data?
 *
 * `periods` deve conter só os períodos APROVADOS — pedido pendente não congela
 * nada, e é o caller que filtra por status ao buscar. Deixar essa decisão aqui
 * dentro esconderia, num helper puro, uma regra de negócio que a tela precisa
 * enunciar ("seu pedido está aguardando a arena").
 */
export function isOnVacation(periods: VacationPeriod[], dateStr: string): boolean {
  return periods.some((p) => dateStr >= p.startsOn && dateStr <= p.endsOn)
}

/**
 * Dois períodos se sobrepõem?
 *
 * Serve para barrar um pedido novo em cima de um já aprovado: dois períodos
 * cobrindo o mesmo dia não somam nada e só criam ambiguidade na hora de cancelar
 * um deles ("cancelei as férias e continuo de férias").
 */
export function overlaps(a: VacationPeriod, b: VacationPeriod): boolean {
  return a.startsOn <= b.endsOn && b.startsOn <= a.endsOn
}

/**
 * As datas de [from, to] em que o aluno está de férias.
 *
 * É o que a geração da grade consome: um conjunto pronto para `has(date)` no
 * laço de sessões, em vez de reavaliar os períodos a cada sessão. A janela da
 * geração é de dias (uma semana), então o custo é desprezível.
 */
export function vacationDatesInWindow(
  periods: VacationPeriod[],
  from: string,
  to: string,
): Set<string> {
  const out = new Set<string>()
  for (const p of periods) {
    // Recorta o período na janela pedida antes de percorrer: férias de dois
    // meses não deve gerar 60 iterações para uma janela de 7 dias.
    const start = p.startsOn > from ? p.startsOn : from
    const end = p.endsOn < to ? p.endsOn : to
    if (start > end) continue
    for (let cursor = start; cursor <= end; cursor = nextDay(cursor)) out.add(cursor)
  }
  return out
}

/**
 * Dia seguinte de 'yyyy-MM-dd', em UTC puro.
 *
 * Local aqui em vez de importar `addDaysStr` de gridSchedule: aquele módulo
 * carrega a agenda da grade inteira, e este arquivo é regra de calendário sem
 * mais nada. A conta é a mesma e cabe em três linhas.
 */
function nextDay(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const next = new Date(Date.UTC(y, m - 1, d + 1))
  return next.toISOString().slice(0, 10)
}
