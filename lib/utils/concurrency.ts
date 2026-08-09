// lib/utils/concurrency.ts
// Execução com paralelismo limitado e orçamento de tempo, para os crons.
//
// Os crons varrem a base inteira. Em série cada round-trip soma latência e a
// função morre no timeout antes do fim; com Promise.all sem limite a gente abre
// milhares de conexões contra o PostgREST de uma vez e o cron vira um ataque ao
// próprio banco. O meio-termo é uma fila com N em voo.

export interface MapOptions {
  /** Quantas tarefas em voo ao mesmo tempo. */
  concurrency?: number
  /**
   * Instante (ms epoch) em que a varredura para de iniciar tarefas novas. As já
   * iniciadas terminam. Serve para devolver resposta antes de a plataforma
   * matar a função — o que sobrar fica para a próxima passada.
   */
  deadline?: number
  /** Relógio injetável, para teste. */
  now?: () => number
}

export interface MapResult<R> {
  results: R[]
  /** Itens que nem começaram porque o prazo estourou. */
  skipped: number
}

/**
 * Aplica `fn` a cada item com no máximo `concurrency` em voo, parando de iniciar
 * novas tarefas quando passa do `deadline`.
 *
 * Não engole erro: se `fn` lançar, a chamada inteira rejeita. Quem quiser
 * tolerar falha por item que faça o try/catch dentro de `fn` — é o que os crons
 * fazem, para uma academia quebrada não derrubar as outras.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  options: MapOptions = {},
): Promise<MapResult<R>> {
  const concurrency = Math.max(1, options.concurrency ?? 8)
  const deadline = options.deadline ?? Infinity
  const now = options.now ?? (() => Date.now())

  const results: R[] = new Array(items.length)
  let next = 0
  let skipped = 0

  async function worker() {
    for (;;) {
      const index = next++
      if (index >= items.length) return
      if (now() >= deadline) {
        // Conta todo o resto uma vez só: quem chegar aqui depois já foi contado.
        skipped += items.length - index
        next = items.length
        return
      }
      results[index] = await fn(items[index], index)
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  )

  return { results: results.slice(0, items.length - skipped), skipped }
}
