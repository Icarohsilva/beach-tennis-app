// lib/utils/requestCache.ts
// Memoização por request, resolvida em tempo de execução.
//
// `cache()` do React só existe no build servido sob a condição de exportação
// `react-server` — que é o que o Next usa em Server Component e server action.
// Debaixo do vitest (jsdom, condição de browser) `require('react').cache` é
// undefined, e um `import { cache } from 'react'` derruba qualquer teste que
// importe o módulo, mesmo sem exercitar a função.
//
// Aqui o acesso é tardio e com fallback: em produção memoiza de verdade, no teste
// vira repasse. O fallback não muda resultado — só deixa de deduplicar, que é
// otimização, não semântica.

import * as React from 'react'

type AnyFn = (...args: never[]) => unknown

// Namespace estático (nada de require, que o Edge Runtime não tem) e leitura da
// propriedade em runtime: sob react-server ela existe, sob jsdom vem undefined.
const reactCache = (React as unknown as { cache?: <T extends AnyFn>(fn: T) => T }).cache

/**
 * Memoiza pelo par (função, argumentos) dentro do mesmo request.
 *
 * Só para leitura idempotente: o valor congela no primeiro acesso do request, então
 * não use para reler algo que a própria requisição acabou de escrever.
 */
export const requestCache: <T extends AnyFn>(fn: T) => T =
  reactCache ?? (<T extends AnyFn>(fn: T) => fn)
