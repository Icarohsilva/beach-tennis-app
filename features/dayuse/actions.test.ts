import { describe, it, expect } from 'vitest'
import { validateDayUseSlot } from './validation'

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
