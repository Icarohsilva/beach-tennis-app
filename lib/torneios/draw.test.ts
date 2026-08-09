import { describe, it, expect } from 'vitest'
import { splitBySeed } from './bracket'

interface Row {
  id: string
  seed: number | null
}

describe('splitBySeed', () => {
  it('devolve os cabeças em ordem crescente', () => {
    const { seeded } = splitBySeed<Row>([
      { id: 'c', seed: 3 },
      { id: 'a', seed: 1 },
      { id: 'b', seed: 2 },
    ])
    expect(seeded.map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })

  it('separa quem não tem cabeça declarada', () => {
    const { seeded, unseeded } = splitBySeed<Row>([
      { id: 'a', seed: 1 },
      { id: 'x', seed: null },
      { id: 'y', seed: null },
    ])
    expect(seeded.map((r) => r.id)).toEqual(['a'])
    expect(unseeded.map((r) => r.id)).toEqual(['x', 'y'])
  })

  it('preserva a ordem de chegada de quem vai ao sorteio', () => {
    // O embaralhamento é responsabilidade de quem chama; aqui só a separação.
    const { unseeded } = splitBySeed<Row>([
      { id: 'x', seed: null },
      { id: 'y', seed: null },
      { id: 'z', seed: null },
    ])
    expect(unseeded.map((r) => r.id)).toEqual(['x', 'y', 'z'])
  })

  it('não perde nem duplica ninguém', () => {
    const rows: Row[] = [
      { id: 'a', seed: 2 },
      { id: 'x', seed: null },
      { id: 'b', seed: 1 },
      { id: 'y', seed: null },
    ]
    const { seeded, unseeded } = splitBySeed(rows)
    expect(seeded.length + unseeded.length).toBe(rows.length)
    expect(new Set([...seeded, ...unseeded].map((r) => r.id)).size).toBe(rows.length)
  })

  it('seed 0 conta como declarado, não como ausente', () => {
    // Guarda contra checar `!e.seed` em vez de `!== null`.
    const { seeded, unseeded } = splitBySeed<Row>([{ id: 'a', seed: 0 }])
    expect(seeded.map((r) => r.id)).toEqual(['a'])
    expect(unseeded).toHaveLength(0)
  })

  it('lista sem nenhum cabeça devolve tudo para o sorteio', () => {
    const { seeded, unseeded } = splitBySeed<Row>([{ id: 'x', seed: null }])
    expect(seeded).toHaveLength(0)
    expect(unseeded).toHaveLength(1)
  })
})
