import { describe, it, expect } from 'vitest'
import { mapWithConcurrency } from './concurrency'

const tick = () => new Promise((r) => setTimeout(r, 1))

describe('mapWithConcurrency', () => {
  it('processa todos os itens preservando a ordem do resultado', async () => {
    const { results, skipped } = await mapWithConcurrency(
      [1, 2, 3, 4, 5],
      async (n) => {
        await tick()
        return n * 2
      },
      { concurrency: 2 },
    )

    expect(results).toEqual([2, 4, 6, 8, 10])
    expect(skipped).toBe(0)
  })

  it('nunca passa do paralelismo pedido', async () => {
    let emVoo = 0
    let pico = 0

    await mapWithConcurrency(
      Array.from({ length: 20 }, (_, i) => i),
      async () => {
        emVoo++
        pico = Math.max(pico, emVoo)
        await tick()
        emVoo--
      },
      { concurrency: 3 },
    )

    expect(pico).toBe(3)
  })

  it('para de iniciar tarefas depois do prazo e informa quantas sobraram', async () => {
    let relogio = 0
    const processados: number[] = []

    const { results, skipped } = await mapWithConcurrency(
      Array.from({ length: 10 }, (_, i) => i),
      async (n) => {
        processados.push(n)
        relogio += 10 // cada item "gasta" 10ms
        return n
      },
      { concurrency: 1, deadline: 35, now: () => relogio },
    )

    // Inicia em 0, 10, 20, 30; em 40 já passou do prazo.
    expect(processados).toEqual([0, 1, 2, 3])
    expect(results).toEqual([0, 1, 2, 3])
    expect(skipped).toBe(6)
  })

  it('lista vazia não trava nem abre worker', async () => {
    const { results, skipped } = await mapWithConcurrency([], async () => 1, { concurrency: 4 })
    expect(results).toEqual([])
    expect(skipped).toBe(0)
  })

  it('propaga erro em vez de engolir', async () => {
    await expect(
      mapWithConcurrency([1, 2], async () => {
        throw new Error('falhou')
      }),
    ).rejects.toThrow('falhou')
  })
})
