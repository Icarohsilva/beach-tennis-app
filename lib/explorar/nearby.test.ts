import { describe, it, expect } from 'vitest'
import {
  cityFacets,
  formatDistance,
  hasSomethingOpen,
  parsePosition,
  rankArenas,
  roundCoord,
  type NearbyArena,
} from './nearby'

// Referência: Copacabana. As distâncias abaixo são reais o bastante para o teste
// distinguir "perto" de "longe" sem depender do valor exato do haversine.
const EU = { latitude: -22.9711, longitude: -43.1822 }

function arena(over: Partial<NearbyArena> & { id: string }): NearbyArena {
  return {
    name: `Arena ${over.id}`,
    slug: over.id,
    city: 'Rio de Janeiro',
    neighborhood: null,
    state: 'RJ',
    sports: ['beach_tennis'],
    latitude: null,
    longitude: null,
    openTournaments: 0,
    openDayUse: 0,
    ...over,
  }
}

describe('roundCoord', () => {
  it('corta a precisão em três casas', () => {
    expect(roundCoord(-22.97114567)).toBe(-22.971)
    expect(roundCoord(-43.18229999)).toBe(-43.182)
  })

  it('não distorce o sinal', () => {
    expect(roundCoord(-0.0004)).toBe(-0)
    expect(roundCoord(10.9999)).toBe(11)
  })
})

describe('parsePosition', () => {
  it('lê o par válido', () => {
    expect(parsePosition('-22.971', '-43.182')).toEqual({ latitude: -22.971, longitude: -43.182 })
  })

  it('faltando qualquer um dos dois, não há posição', () => {
    expect(parsePosition('-22.971', undefined)).toBeNull()
    expect(parsePosition(undefined, '-43.182')).toBeNull()
    expect(parsePosition(undefined, undefined)).toBeNull()
  })

  it('recusa texto que não é número', () => {
    expect(parsePosition('perto', 'de-casa')).toBeNull()
    expect(parsePosition('', '')).toBeNull()
  })

  it('recusa coordenada fora do globo', () => {
    // Parâmetro de URL é entrada de usuário: vale qualquer coisa.
    expect(parsePosition('91', '0')).toBeNull()
    expect(parsePosition('-91', '0')).toBeNull()
    expect(parsePosition('0', '181')).toBeNull()
    expect(parsePosition('0', '-181')).toBeNull()
  })

  it('aceita o limite exato e a origem', () => {
    expect(parsePosition('90', '180')).toEqual({ latitude: 90, longitude: 180 })
    expect(parsePosition('0', '0')).toEqual({ latitude: 0, longitude: 0 })
  })
})

describe('rankArenas', () => {
  const perto = arena({ id: 'perto', latitude: -22.972, longitude: -43.183 })
  const longe = arena({ id: 'longe', latitude: -23.55, longitude: -46.63 }) // São Paulo
  const semPonto = arena({ id: 'sem-ponto', name: 'Arena AAA' })

  it('sem posição, ordena por cidade e nome', () => {
    const out = rankArenas(
      [arena({ id: 'z', name: 'Zeta' }), arena({ id: 'a', name: 'Alfa' })],
      null,
    )
    expect(out.map((a) => a.id)).toEqual(['a', 'z'])
    expect(out.every((a) => a.distanceM === null)).toBe(true)
  })

  it('com posição, ordena da mais perto para a mais longe', () => {
    const out = rankArenas([longe, perto], EU)
    expect(out.map((a) => a.id)).toEqual(['perto', 'longe'])
    expect(out[0].distanceM!).toBeLessThan(out[1].distanceM!)
  })

  it('a distância bate com a realidade', () => {
    const out = rankArenas([perto, longe], EU)
    expect(out[0].distanceM!).toBeLessThan(500) // mesma orla
    expect(out[1].distanceM!).toBeGreaterThan(300_000) // Rio → São Paulo
  })

  it('arena sem ponto marcado vai para o fim, não para a frente', () => {
    // Não dá para afirmar que está longe, mas também não pode passar na frente
    // de quem se sabe perto.
    const out = rankArenas([semPonto, longe, perto], EU)
    expect(out.map((a) => a.id)).toEqual(['perto', 'longe', 'sem-ponto'])
  })

  it('todas sem ponto: cai na ordem alfabética mesmo com posição', () => {
    const out = rankArenas([arena({ id: 'z', name: 'Zeta' }), semPonto], EU)
    expect(out.map((a) => a.id)).toEqual(['sem-ponto', 'z'])
  })

  it('não perde nem duplica arena', () => {
    const out = rankArenas([perto, longe, semPonto], EU)
    expect(out).toHaveLength(3)
    expect(new Set(out.map((a) => a.id)).size).toBe(3)
  })

  it('lista vazia não quebra', () => {
    expect(rankArenas([], EU)).toEqual([])
  })
})

describe('formatDistance', () => {
  it('abaixo de 1 km usa metros, arredondados na dezena', () => {
    expect(formatDistance(0)).toBe('0 m')
    expect(formatDistance(847)).toBe('850 m')
    expect(formatDistance(999)).toBe('1000 m')
  })

  it('de 1 a 10 km usa uma casa decimal com vírgula', () => {
    expect(formatDistance(1000)).toBe('1,0 km')
    expect(formatDistance(2430)).toBe('2,4 km')
  })

  it('acima de 10 km a casa decimal vira ruído', () => {
    expect(formatDistance(12_400)).toBe('12 km')
    expect(formatDistance(340_000)).toBe('340 km')
  })

  it('sem distância não inventa texto', () => {
    expect(formatDistance(null)).toBeNull()
  })
})

describe('cityFacets', () => {
  it('lista as cidades sem repetir, em ordem', () => {
    expect(
      cityFacets([
        arena({ id: '1', city: 'Niterói' }),
        arena({ id: '2', city: 'Angra' }),
        arena({ id: '3', city: 'Niterói' }),
      ]),
    ).toEqual(['Angra', 'Niterói'])
  })

  it('arena sem cidade não vira opção em branco', () => {
    expect(cityFacets([arena({ id: '1', city: null })])).toEqual([])
  })
})

describe('hasSomethingOpen', () => {
  it('torneio aberto ou day use livre destacam a arena', () => {
    expect(hasSomethingOpen(arena({ id: '1', openTournaments: 1 }))).toBe(true)
    expect(hasSomethingOpen(arena({ id: '2', openDayUse: 3 }))).toBe(true)
  })

  it('arena parada não é destaque', () => {
    expect(hasSomethingOpen(arena({ id: '3' }))).toBe(false)
  })
})
