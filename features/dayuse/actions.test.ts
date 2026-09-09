import { describe, it, expect } from 'vitest'
import { validateDayUseSlot, overlaps } from './validation'

describe('validateDayUseSlot', () => {
  it('rejeita quando end_time <= start_time', () => {
    expect(validateDayUseSlot('10:00', '09:00').error).toMatch(/fim/)
    expect(validateDayUseSlot('10:00', '10:00').error).toMatch(/fim/)
  })

  it('rejeita capacidade menor que 1', () => {
    expect(validateDayUseSlot('09:00', '10:00', 0).error).toMatch(/capacidade/)
  })

  it('aceita slot válido', () => {
    expect(validateDayUseSlot('09:00', '10:00', 4).error).toBeUndefined()
  })
})

describe('overlaps', () => {
  it('turnos seguidos não colidem (fim é exclusivo nos dois lados)', () => {
    expect(
      overlaps({ start_time: '09:00', end_time: '10:00' }, { start_time: '10:00', end_time: '11:00' }),
    ).toBe(false)
  })

  it('sobreposição parcial colide, nos dois sentidos', () => {
    const a = { start_time: '09:00', end_time: '11:00' }
    const b = { start_time: '10:00', end_time: '12:00' }
    expect(overlaps(a, b)).toBe(true)
    expect(overlaps(b, a)).toBe(true)
  })

  it('um dentro do outro colide', () => {
    expect(
      overlaps({ start_time: '09:00', end_time: '17:00' }, { start_time: '10:00', end_time: '11:00' }),
    ).toBe(true)
  })

  it('mesmo horário colide', () => {
    const a = { start_time: '09:00', end_time: '10:00' }
    expect(overlaps(a, a)).toBe(true)
  })
})

describe('validateDayUseSlot — data no passado', () => {
  it('recusa day use em data já passada', () => {
    const r = validateDayUseSlot({
      start_time: '09:00', end_time: '10:00', capacity: 8,
      date: '2026-09-01', today: '2026-09-09',
    })
    expect(r.error).toMatch(/passada/)
  })

  it('aceita hoje e futuro', () => {
    const base = { start_time: '09:00', end_time: '10:00', capacity: 8, today: '2026-09-09' }
    expect(validateDayUseSlot({ ...base, date: '2026-09-09' }).error).toBeUndefined()
    expect(validateDayUseSlot({ ...base, date: '2026-09-20' }).error).toBeUndefined()
  })

  it('sem `today` não valida data (compatibilidade)', () => {
    expect(
      validateDayUseSlot({ start_time: '09:00', end_time: '10:00', date: '2020-01-01' }).error,
    ).toBeUndefined()
  })
})

describe('validateDayUseSlot — conflito na mesma quadra', () => {
  const base = { start_time: '10:00', end_time: '12:00', capacity: 8 }

  it('recusa quando bate com slot existente, dizendo qual', () => {
    const r = validateDayUseSlot({
      ...base,
      sameCourtSlots: [{ start_time: '11:00:00', end_time: '13:00:00' }],
    })
    expect(r.error).toContain('11:00')
    expect(r.error).toContain('13:00')
  })

  it('aceita quando os slots existentes são vizinhos, não sobrepostos', () => {
    const r = validateDayUseSlot({
      ...base,
      sameCourtSlots: [
        { start_time: '08:00:00', end_time: '10:00:00' },
        { start_time: '12:00:00', end_time: '14:00:00' },
      ],
    })
    expect(r.error).toBeUndefined()
  })

  it('sem slots existentes, nada a conferir', () => {
    expect(validateDayUseSlot({ ...base, sameCourtSlots: [] }).error).toBeUndefined()
  })
})
