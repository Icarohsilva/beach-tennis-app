import { describe, it, expect } from 'vitest'
import { fetchAllPages, chunk } from './paginate'

/** Fonte falsa que devolve `total` linhas respeitando a faixa pedida. */
function fakeTable(total: number) {
  const rows = Array.from({ length: total }, (_, i) => ({ id: i }))
  const calls: Array<[number, number]> = []
  const query = async (from: number, to: number) => {
    calls.push([from, to])
    return { data: rows.slice(from, to + 1), error: null }
  }
  return { query, calls }
}

describe('fetchAllPages', () => {
  it('junta todas as páginas quando o total passa do teto do PostgREST', async () => {
    const { query, calls } = fakeTable(2500)
    const out = await fetchAllPages<{ id: number }>(query, { pageSize: 1000 })

    expect(out).toHaveLength(2500)
    expect(out[0].id).toBe(0)
    expect(out[2499].id).toBe(2499)
    expect(calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]])
  })

  it('para na primeira página quando o resultado cabe nela', async () => {
    const { query, calls } = fakeTable(10)
    const out = await fetchAllPages<{ id: number }>(query, { pageSize: 1000 })

    expect(out).toHaveLength(10)
    expect(calls).toHaveLength(1)
  })

  it('faz uma página a mais quando o total é múltiplo exato do tamanho', async () => {
    // Página cheia não prova que acabou — só a página incompleta prova.
    const { query, calls } = fakeTable(2000)
    const out = await fetchAllPages<{ id: number }>(query, { pageSize: 1000 })

    expect(out).toHaveLength(2000)
    expect(calls).toHaveLength(3)
  })

  it('devolve vazio quando não há linhas', async () => {
    const { query } = fakeTable(0)
    expect(await fetchAllPages(query, { pageSize: 1000 })).toEqual([])
  })

  it('trata data null como página vazia', async () => {
    const out = await fetchAllPages(async () => ({ data: null, error: null }), { pageSize: 10 })
    expect(out).toEqual([])
  })

  it('propaga erro do PostgREST com o label do call site', async () => {
    const query = async () => ({ data: null, error: { message: 'permission denied' } })
    await expect(fetchAllPages(query, { label: 'attendance/streak' })).rejects.toThrow(
      '[attendance/streak] permission denied',
    )
  })

  it('lança ao passar do teto em vez de consumir a memória toda', async () => {
    const { query } = fakeTable(10_000)
    await expect(
      fetchAllPages(query, { pageSize: 1000, maxRows: 2000, label: 'gigante' }),
    ).rejects.toThrow(/passou de 2000 linhas/)
  })
})

describe('chunk', () => {
  it('quebra em pedaços do tamanho pedido, com resto no último', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })

  it('devolve vazio para lista vazia', () => {
    expect(chunk([], 10)).toEqual([])
  })

  it('recusa tamanho inválido em vez de entrar em loop infinito', () => {
    expect(() => chunk([1], 0)).toThrow()
  })
})
