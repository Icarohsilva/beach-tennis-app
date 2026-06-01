import type { Class, DayUseSlot, DayUseBooking } from './index'
import { describe, it, expect } from 'vitest'

describe('types', () => {
  it('Class has court field', () => {
    const c: Class = {
      id: '1', name: 'Terça 18h', description: null,
      level: 'iniciante', type: 'adult', day_of_week: 2,
      start_time: '18:00', end_time: '19:00',
      max_students: 8, is_active: true, court: 1,
    }
    expect(c.court).toBe(1)
  })

  it('DayUseSlot has required shape', () => {
    const s: DayUseSlot = {
      id: 'abc', court: 2, date: '2026-06-10',
      start_time: '09:00', end_time: '10:00',
      capacity: 8, notes: null, is_active: true,
      created_by: 'uid', created_at: '2026-06-01T00:00:00Z',
    }
    expect(s.court).toBe(2)
  })

  it('DayUseBooking status is union type', () => {
    const b: DayUseBooking = {
      id: 'x', slot_id: 'y', student_id: 'z',
      status: 'confirmed',
      booked_at: '2026-06-01T00:00:00Z',
      cancelled_at: null,
    }
    expect(b.status).toBe('confirmed')
  })
})
