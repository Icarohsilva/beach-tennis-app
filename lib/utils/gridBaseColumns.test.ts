// @vitest-environment node
// lib/utils/gridBaseColumns.test.ts
// Trava de layout: todo grid com colunas responsivas (`sm:grid-cols-2`) tem de
// dizer também a coluna do celular (`grid-cols-1`).
//
// Sem ela, no celular o grid fica com uma coluna IMPLÍCITA, que cresce até o
// conteúdo mais largo do card: um link de torneio com UUID (em `truncate`, que
// não quebra) deixava o card com 613px numa tela de 361px. O `overflow-x: clip`
// do body corta o excesso, então o botão "Copiar" e o fim das mensagens sumiam
// sem barra de rolagem. `grid-cols-1` é `minmax(0, 1fr)`: a mesma coluna, mas
// que encolhe.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOTS = ['app', 'features', 'components']

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return tsxFiles(path)
    return path.endsWith('.tsx') ? [path] : []
  })
}

const CLASS_ATTR = /className=(?:"([^"]*)"|\{`([^`]*)`\})/g

describe('grids responsivos', () => {
  it('todo grid com sm:/md:/lg:grid-cols-* declara a coluna base (grid-cols-1)', () => {
    const offenders: string[] = []
    for (const file of ROOTS.flatMap(tsxFiles)) {
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        for (const m of Array.from(line.matchAll(CLASS_ATTR))) {
          const tokens: string[] = (m[1] ?? m[2] ?? '').split(/\s+/)
          const responsive = tokens.some((t) => /^[a-z0-9]+:grid-cols-/.test(t))
          const base = tokens.some((t) => t.startsWith('grid-cols-'))
          if (tokens.includes('grid') && responsive && !base) offenders.push(`${file}:${i + 1}`)
        }
      })
    }
    expect(offenders).toEqual([])
  })
})
