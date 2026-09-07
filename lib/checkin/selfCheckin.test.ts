// lib/checkin/selfCheckin.test.ts
import { describe, it, expect } from 'vitest'
import {
  haversineMeters,
  selfCheckinWindow,
  isWithinSelfCheckinWindow,
  resolveSelfCheckinStatus,
  selfCheckinGeoErrorLabel,
  formatDistance,
  isAccurateEnough,
  pickBetterReading,
  canRetrySelfCheckin,
  DEFAULT_CHECKIN_RADIUS_M,
  GOOD_ACCURACY_M,
} from './selfCheckin'

// Ponto de referência arbitrário (orla de Copacabana) — só precisa ser estável.
const ARENA = { latitude: -22.971964, longitude: -43.182543 }

describe('haversineMeters', () => {
  it('é zero para o mesmo ponto', () => {
    expect(haversineMeters(ARENA, ARENA)).toBe(0)
  })

  it('mede ~111 km por grau de latitude', () => {
    const oneDegreeNorth = { latitude: ARENA.latitude + 1, longitude: ARENA.longitude }
    expect(haversineMeters(ARENA, oneDegreeNorth)).toBeCloseTo(111_195, -2)
  })

  it('mede distâncias curtas na escala de uma quadra', () => {
    // ~0,0009° de latitude ≈ 100 m
    const perto = { latitude: ARENA.latitude + 0.0009, longitude: ARENA.longitude }
    expect(haversineMeters(ARENA, perto)).toBeGreaterThan(90)
    expect(haversineMeters(ARENA, perto)).toBeLessThan(110)
  })

  it('é simétrica', () => {
    const outro = { latitude: -23.5505, longitude: -46.6333 }
    expect(haversineMeters(ARENA, outro)).toBeCloseTo(haversineMeters(outro, ARENA), 6)
  })
})

describe('selfCheckinWindow', () => {
  // Aula das 19:00 às 20:00 no fuso de Brasília.
  const startsAt = '2026-08-03T19:00:00-03:00'
  const endsAt = '2026-08-03T20:00:00-03:00'

  it('abre 1h antes do início e fecha 1h depois do fim', () => {
    const w = selfCheckinWindow(startsAt, endsAt)
    expect(w.opensAt).toBe(new Date('2026-08-03T18:00:00-03:00').toISOString())
    expect(w.closesAt).toBe(new Date('2026-08-03T21:00:00-03:00').toISOString())
  })
})

describe('isWithinSelfCheckinWindow', () => {
  const w = selfCheckinWindow('2026-08-03T19:00:00-03:00', '2026-08-03T20:00:00-03:00')

  it('aceita o instante exato da abertura', () => {
    expect(isWithinSelfCheckinWindow(w, '2026-08-03T18:00:00-03:00')).toBe(true)
  })

  it('aceita o instante exato do fechamento', () => {
    expect(isWithinSelfCheckinWindow(w, '2026-08-03T21:00:00-03:00')).toBe(true)
  })

  it('recusa um minuto antes de abrir', () => {
    expect(isWithinSelfCheckinWindow(w, '2026-08-03T17:59:00-03:00')).toBe(false)
  })

  it('recusa um minuto depois de fechar', () => {
    expect(isWithinSelfCheckinWindow(w, '2026-08-03T21:01:00-03:00')).toBe(false)
  })

  it('aceita durante a aula', () => {
    expect(isWithinSelfCheckinWindow(w, '2026-08-03T19:30:00-03:00')).toBe(true)
  })

  it('aceita um Date, não só string', () => {
    expect(isWithinSelfCheckinWindow(w, new Date('2026-08-03T19:30:00-03:00'))).toBe(true)
  })
})

describe('resolveSelfCheckinStatus', () => {
  const radiusM = DEFAULT_CHECKIN_RADIUS_M // 150

  it('valida quem está em cima da quadra', () => {
    const v = resolveSelfCheckinStatus({
      device: { ...ARENA, accuracyM: 10 },
      org: ARENA,
      radiusM,
    })
    expect(v).toEqual({ status: 'validated', distanceM: 0, geoError: null })
  })

  it('valida dentro do raio', () => {
    const dentro = { latitude: ARENA.latitude + 0.0009, longitude: ARENA.longitude } // ~100 m
    const v = resolveSelfCheckinStatus({
      device: { ...dentro, accuracyM: 15 },
      org: ARENA,
      radiusM,
    })
    expect(v.status).toBe('validated')
    expect(v.distanceM).toBeGreaterThan(90)
  })

  it('deixa pendente quem está longe, guardando a distância', () => {
    const longe = { latitude: -23.5505, longitude: -46.6333 } // São Paulo
    const v = resolveSelfCheckinStatus({
      device: { ...longe, accuracyM: 10 },
      org: ARENA,
      radiusM,
    })
    expect(v.status).toBe('pending')
    expect(v.geoError).toBe('out_of_range')
    expect(v.distanceM).toBeGreaterThan(300_000)
  })

  it('concede a folga da imprecisão do GPS, até o teto', () => {
    // ~200 m: fora do raio de 150, mas dentro de 150 + 80 de folga.
    const borda = { latitude: ARENA.latitude + 0.0018, longitude: ARENA.longitude }
    expect(
      resolveSelfCheckinStatus({ device: { ...borda, accuracyM: 80 }, org: ARENA, radiusM }).status,
    ).toBe('validated')
    // Mesma posição com GPS preciso não ganha folga nenhuma.
    expect(
      resolveSelfCheckinStatus({ device: { ...borda, accuracyM: 5 }, org: ARENA, radiusM }).status,
    ).toBe('pending')
  })

  it('não deixa a folga passar do teto de 100 m', () => {
    // ~300 m com precisão declarada de 500 m: a folga para em 100.
    const fora = { latitude: ARENA.latitude + 0.0027, longitude: ARENA.longitude }
    const v = resolveSelfCheckinStatus({
      device: { ...fora, accuracyM: 500 },
      org: ARENA,
      radiusM,
    })
    expect(v.status).toBe('pending')
    expect(v.geoError).toBe('out_of_range')
  })

  it('trata leitura absurdamente imprecisa como inconclusiva', () => {
    const v = resolveSelfCheckinStatus({
      device: { ...ARENA, accuracyM: 5000 },
      org: ARENA,
      radiusM,
    })
    expect(v.status).toBe('pending')
    expect(v.geoError).toBe('inaccurate')
    // Ainda registra a distância medida, para o professor ver.
    expect(v.distanceM).toBe(0)
  })

  it('aceita accuracy nula sem conceder folga', () => {
    const borda = { latitude: ARENA.latitude + 0.0018, longitude: ARENA.longitude } // ~200 m
    expect(
      resolveSelfCheckinStatus({ device: { ...borda, accuracyM: null }, org: ARENA, radiusM })
        .status,
    ).toBe('pending')
  })

  it('deixa pendente quando a academia não marcou o ponto', () => {
    const v = resolveSelfCheckinStatus({
      device: { ...ARENA, accuracyM: 10 },
      org: null,
      radiusM,
    })
    expect(v).toEqual({ status: 'pending', distanceM: null, geoError: 'org_unset' })
  })

  it.each(['denied', 'unavailable', 'timeout', 'unsupported'] as const)(
    'deixa pendente e preserva o motivo quando o GPS falha (%s)',
    (geoError) => {
      const v = resolveSelfCheckinStatus({ device: { geoError }, org: ARENA, radiusM })
      expect(v).toEqual({ status: 'pending', distanceM: null, geoError })
    },
  )

  it('respeita um raio maior configurado pela academia', () => {
    const longe = { latitude: ARENA.latitude + 0.0045, longitude: ARENA.longitude } // ~500 m
    expect(
      resolveSelfCheckinStatus({ device: { ...longe, accuracyM: 10 }, org: ARENA, radiusM: 150 })
        .status,
    ).toBe('pending')
    expect(
      resolveSelfCheckinStatus({ device: { ...longe, accuracyM: 10 }, org: ARENA, radiusM: 800 })
        .status,
    ).toBe('validated')
  })
})

describe('formatDistance', () => {
  it('usa metros abaixo de 1 km', () => {
    expect(formatDistance(340)).toBe('340 m')
    expect(formatDistance(999)).toBe('999 m')
  })

  it('usa quilômetros com vírgula acima disso', () => {
    expect(formatDistance(1240)).toBe('1,2 km')
  })
})

describe('selfCheckinGeoErrorLabel', () => {
  it('explica cada motivo em pt-BR', () => {
    expect(selfCheckinGeoErrorLabel('denied', null)).toContain('permitir a localização')
    expect(selfCheckinGeoErrorLabel('org_unset', null)).toContain('sem ponto configurado')
    expect(selfCheckinGeoErrorLabel('out_of_range', 340)).toBe('confirmou a 340 m da academia')
  })

  it('cai num texto neutro sem motivo', () => {
    expect(selfCheckinGeoErrorLabel(null, null)).toBe('confirmou pelo app')
  })
})

describe('isAccurateEnough', () => {
  it('aceita o fix de satélite típico de quadra aberta', () => {
    expect(isAccurateEnough(8)).toBe(true)
    expect(isAccurateEnough(GOOD_ACCURACY_M)).toBe(true)
  })

  it('recusa o fix de rede, que é o que fazia o aluno na quadra cair como pendente', () => {
    expect(isAccurateEnough(GOOD_ACCURACY_M + 1)).toBe(false)
    expect(isAccurateEnough(1200)).toBe(false)
  })
})

describe('pickBetterReading', () => {
  it('a primeira leitura sempre entra', () => {
    expect(pickBetterReading(null, { accuracyM: 900 })).toEqual({ accuracyM: 900 })
  })

  it('troca quando a nova é mais precisa (o caso do GPS esquentando)', () => {
    expect(pickBetterReading({ accuracyM: 900 }, { accuracyM: 12 })).toEqual({ accuracyM: 12 })
  })

  it('mantém a atual quando a nova é pior ou igual', () => {
    expect(pickBetterReading({ accuracyM: 12 }, { accuracyM: 800 })).toEqual({ accuracyM: 12 })
    expect(pickBetterReading({ accuracyM: 12 }, { accuracyM: 12 })).toEqual({ accuracyM: 12 })
  })

  it('preserva os outros campos da leitura escolhida', () => {
    const melhor = { accuracyM: 10, latitude: -22.97, longitude: -43.18 }
    expect(pickBetterReading({ accuracyM: 500, latitude: 0, longitude: 0 }, melhor)).toBe(melhor)
  })
})

describe('canRetrySelfCheckin', () => {
  it('deixa tentar de novo o que depende do aparelho ou do lugar', () => {
    expect(canRetrySelfCheckin('out_of_range')).toBe(true)
    expect(canRetrySelfCheckin('inaccurate')).toBe(true)
    expect(canRetrySelfCheckin('timeout')).toBe(true)
    expect(canRetrySelfCheckin('unavailable')).toBe(true)
    expect(canRetrySelfCheckin('denied')).toBe(true)
    expect(canRetrySelfCheckin('unsupported')).toBe(true)
  })

  it('não oferece nova tentativa quando o problema é a academia sem ponto', () => {
    expect(canRetrySelfCheckin('org_unset')).toBe(false)
  })

  it('sem motivo nenhum não há o que repetir', () => {
    expect(canRetrySelfCheckin(null)).toBe(false)
  })
})
