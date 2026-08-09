// lib/supabase/paginate.ts
// Leitura paginada do PostgREST.
//
// O Supabase hospedado corta TODA resposta em `max_rows` linhas (1.000 por
// padrão) — e o corte vale também para a service role, porque é configuração do
// PostgREST, não da RLS. Um `.select()` sem `.range()` que casaria com 18.000
// linhas devolve 1.000 e `error` vem null: a query "deu certo" e o resultado
// está errado. É a falha mais perigosa deste sistema porque não acende Sentry.
//
// Regra: toda leitura cujo volume cresce com o tamanho da academia (presenças,
// reservas, extrato de pontos, memberships) passa por aqui. Leitura com teto
// natural — uma sessão, um aluno, as 20 últimas notificações — pode usar
// `.select()` direto.

/** Página do PostgREST. Igual ao `max_rows` do projeto: pedir mais não adianta. */
export const PAGE_SIZE = 1000

/**
 * Teto de segurança por chamada. Existe para transformar "consumiu toda a
 * memória da função e morreu" em erro legível. Uma academia de 300 alunos com
 * 30 semanas de histórico fica na casa de 20k linhas; 200k é folga de 10x.
 */
export const DEFAULT_MAX_ROWS = 200_000

export interface PageResult<T> {
  data: T[] | null
  error: { message: string } | null
}

export interface FetchAllOptions {
  /** Linhas por página. Baixe só se as linhas forem muito largas (memória). */
  pageSize?: number
  /** Teto total; estourar lança. Ver DEFAULT_MAX_ROWS. */
  maxRows?: number
  /** Nome usado na mensagem de erro, para achar o call site no Sentry. */
  label?: string
}

/**
 * Percorre todas as páginas de uma query e devolve as linhas concatenadas.
 *
 * `makeQuery` recebe a faixa e devolve a query já com `.range(from, to)`:
 *
 * ```ts
 * const rows = await fetchAllPages<Row>(
 *   (from, to) => admin.from('attendance').select('student_id').eq('organization_id', orgId).range(from, to),
 *   { label: 'attendance/streak' },
 * )
 * ```
 *
 * Para o loop terminar, a query precisa ter ordem estável entre as páginas.
 * Sem `.order()` explícito o Postgres não garante a mesma ordem em dois
 * `range()` diferentes e uma linha pode vir duas vezes (ou nenhuma) — prefira
 * ordenar pela chave primária quando a duplicata importar.
 */
export async function fetchAllPages<T>(
  makeQuery: (from: number, to: number) => PromiseLike<PageResult<T>>,
  options: FetchAllOptions = {},
): Promise<T[]> {
  const pageSize = options.pageSize ?? PAGE_SIZE
  const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS
  const label = options.label ?? 'fetchAllPages'

  const all: T[] = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await makeQuery(from, from + pageSize - 1)
    if (error) throw new Error(`[${label}] ${error.message}`)

    const rows = data ?? []
    all.push(...rows)

    // Página incompleta = acabou. É o único critério de parada confiável:
    // pedir o total com count exact custa um segundo scan.
    if (rows.length < pageSize) return all

    if (all.length >= maxRows) {
      throw new Error(
        `[${label}] passou de ${maxRows} linhas numa leitura só. ` +
          'Filtre mais (janela de data, uma academia por vez) ou processe em lote.',
      )
    }
  }
}

/**
 * Quebra uma lista em pedaços — para `.in('id', [...])`, que também tem limite
 * prático: a query vai na URL e servidor/proxy cortam por tamanho de URL muito
 * antes de o Postgres reclamar.
 */
export function chunk<T>(items: T[], size: number): T[][] {
  if (size <= 0) throw new Error('chunk: size precisa ser > 0')
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** Tamanho seguro para `.in(...)` de uuids sem estourar a URL. */
export const IN_CHUNK_SIZE = 200
