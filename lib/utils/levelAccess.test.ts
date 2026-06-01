import { describe, it, expect } from 'vitest'
import { canStudentAttendLevel, LEVEL_HIERARCHY } from './levelAccess'

describe('canStudentAttendLevel', () => {
  it('allows student to attend their own level', () => {
    expect(canStudentAttendLevel('C', 'C')).toBe(true)
  })

  it('allows student to attend a lower level', () => {
    expect(canStudentAttendLevel('C', 'D')).toBe(true)
    expect(canStudentAttendLevel('A', 'iniciante')).toBe(true)
  })

  it('blocks student from attending a higher level', () => {
    expect(canStudentAttendLevel('D', 'C')).toBe(false)
    expect(canStudentAttendLevel('iniciante', 'A')).toBe(false)
  })

  it('A can attend any level', () => {
    expect(canStudentAttendLevel('A', 'B')).toBe(true)
    expect(canStudentAttendLevel('A', 'iniciante')).toBe(true)
  })

  it('iniciante can only attend iniciante', () => {
    expect(canStudentAttendLevel('iniciante', 'iniciante')).toBe(true)
    expect(canStudentAttendLevel('iniciante', 'D')).toBe(false)
  })
})
