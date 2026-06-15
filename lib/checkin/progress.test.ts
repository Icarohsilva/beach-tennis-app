import { describe, it, expect } from 'vitest'
import { computeProgress } from './progress'

describe('computeProgress', () => {
  it('below target: remaining > 0, ahead = 0', () => {
    expect(computeProgress(8, 3)).toEqual({ target: 8, done: 3, remaining: 5, ahead: 0 })
  })
  it('on target: remaining = 0, ahead = 0', () => {
    expect(computeProgress(8, 8)).toEqual({ target: 8, done: 8, remaining: 0, ahead: 0 })
  })
  it('above target: remaining = 0, ahead > 0', () => {
    expect(computeProgress(8, 10)).toEqual({ target: 8, done: 10, remaining: 0, ahead: 2 })
  })
  it('zero target: remaining = 0, ahead = done', () => {
    expect(computeProgress(0, 2)).toEqual({ target: 0, done: 2, remaining: 0, ahead: 2 })
  })
})
