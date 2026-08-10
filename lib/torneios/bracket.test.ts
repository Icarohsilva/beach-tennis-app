import { describe, it, expect } from 'vitest'
import {
  bracketSize,
  matchesInRound,
  roundLabel,
  roundsForSize,
  seedOrder,
  winnerSlot,
} from './bracket'

describe('bracketSize', () => {
  it('arredonda para cima até a potência de 2', () => {
    expect(bracketSize(2)).toBe(2)
    expect(bracketSize(3)).toBe(4)
    expect(bracketSize(5)).toBe(8)
    expect(bracketSize(8)).toBe(8)
    expect(bracketSize(9)).toBe(16)
    expect(bracketSize(33)).toBe(64)
  })

  it('nunca devolve menos que 2', () => {
    expect(bracketSize(1)).toBe(2)
    expect(bracketSize(0)).toBe(2)
  })
})

describe('roundsForSize e matchesInRound', () => {
  it('conta as rodadas da chave', () => {
    expect(roundsForSize(2)).toBe(1)
    expect(roundsForSize(8)).toBe(3)
    expect(roundsForSize(64)).toBe(6)
  })

  it('cada rodada tem metade das partidas da anterior', () => {
    expect(matchesInRound(8, 1)).toBe(4)
    expect(matchesInRound(8, 2)).toBe(2)
    expect(matchesInRound(8, 3)).toBe(1)
  })

  it('a soma das partidas de uma chave cheia é size - 1', () => {
    for (const size of [2, 4, 8, 16, 32, 64]) {
      let total = 0
      for (let r = 1; r <= roundsForSize(size); r++) total += matchesInRound(size, r)
      expect(total, `chave de ${size}`).toBe(size - 1)
    }
  })
})

describe('winnerSlot', () => {
  it('ímpar sobe pela esquerda, par pela direita', () => {
    expect(winnerSlot(1, 1, 3)).toEqual({ round: 2, matchNo: 1, slot: 1 })
    expect(winnerSlot(1, 2, 3)).toEqual({ round: 2, matchNo: 1, slot: 2 })
    expect(winnerSlot(1, 3, 3)).toEqual({ round: 2, matchNo: 2, slot: 1 })
    expect(winnerSlot(1, 4, 3)).toEqual({ round: 2, matchNo: 2, slot: 2 })
  })

  it('a final não alimenta ninguém', () => {
    expect(winnerSlot(3, 1, 3)).toBeNull()
    expect(winnerSlot(1, 1, 1)).toBeNull()
  })

  it('duas partidas distintas nunca disputam o mesmo lado', () => {
    // Se duas partidas apontassem para o mesmo slot, um vencedor apagaria o outro.
    const seen = new Set<string>()
    for (let r = 1; r < 4; r++) {
      for (let m = 1; m <= matchesInRound(16, r); m++) {
        const dest = winnerSlot(r, m, 4)!
        const key = `${dest.round}:${dest.matchNo}:${dest.slot}`
        expect(seen.has(key), key).toBe(false)
        seen.add(key)
      }
    }
  })
})

describe('roundLabel', () => {
  it('nomeia pela distância até a final', () => {
    expect(roundLabel(3, 3)).toBe('Final')
    expect(roundLabel(2, 3)).toBe('Semifinal')
    expect(roundLabel(1, 3)).toBe('Quartas de final')
  })

  it('a mesma rodada muda de nome conforme o tamanho da chave', () => {
    // Rodada 2 numa chave de 8 é semifinal; numa de 32, é oitavas.
    expect(roundLabel(2, 3)).toBe('Semifinal')
    expect(roundLabel(2, 5)).toBe('Oitavas de final')
  })

  it('chave de 2 tem só a final', () => {
    expect(roundLabel(1, 1)).toBe('Final')
  })
})

describe('seedOrder', () => {
  it('dobra a chave a cada passo, casando cada seed com seu complemento', () => {
    // Há mais de uma ordem publicada por aí (umas listam 5×4, outras 4×5); o
    // que define a chave são os CONFRONTOS e as metades, conferidos abaixo.
    expect(seedOrder(2)).toEqual([1, 2])
    expect(seedOrder(4)).toEqual([1, 4, 2, 3])
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6])
  })

  it('usa cada seed exatamente uma vez', () => {
    for (const size of [2, 4, 8, 16, 32, 64]) {
      const order = seedOrder(size)
      expect(order).toHaveLength(size)
      expect(new Set(order).size, `chave de ${size}`).toBe(size)
    }
  })

  it('todo confronto de primeira rodada soma size + 1', () => {
    // É a assinatura do chaveamento: o 1 pega o último, o 2 o penúltimo.
    const size = 16
    const order = seedOrder(size)
    for (let i = 0; i < size; i += 2) {
      expect(order[i] + order[i + 1]).toBe(size + 1)
    }
  })

  it('os dois cabeças só podem se encontrar na final', () => {
    const size = 16
    const order = seedOrder(size)
    const half = order.slice(0, size / 2)
    // Um em cada metade da chave.
    expect(half.includes(1)).toBe(true)
    expect(half.includes(2)).toBe(false)
  })

  it('cabeças 1 a 4 caem em quartos diferentes da chave', () => {
    const size = 16
    const order = seedOrder(size)
    const quarterOf = (seed: number) => Math.floor(order.indexOf(seed) / (size / 4))
    expect(new Set([1, 2, 3, 4].map(quarterOf)).size).toBe(4)
  })
})
