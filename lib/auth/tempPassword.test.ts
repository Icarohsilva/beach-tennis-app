import { describe, it, expect } from 'vitest'
import { generateTempPassword } from './tempPassword'

const ALLOWED = /^[ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789]+$/
const AMBIGUOUS = /[Il1O0]/

describe('generateTempPassword', () => {
  it('usa o tamanho padrão de 10', () => {
    expect(generateTempPassword()).toHaveLength(10)
  })

  it('respeita o tamanho informado', () => {
    expect(generateTempPassword(16)).toHaveLength(16)
  })

  it('usa só caracteres do charset permitido (sem ambíguos)', () => {
    for (let i = 0; i < 50; i++) {
      const pwd = generateTempPassword()
      expect(pwd).toMatch(ALLOWED)
      expect(pwd).not.toMatch(AMBIGUOUS)
    }
  })
})
