import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Supabase admin client
const insertMock = vi.fn().mockResolvedValue({ error: null })
const fromMock = vi.fn().mockReturnValue({ insert: insertMock })
vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => ({ from: fromMock }),
}))

import { buildSessionRows } from './sessionUtils'

describe('buildSessionRows', () => {
  it('returns weekly rows for the given day_of_week', () => {
    // day_of_week=1 (Monday), from 2026-06-01 to 2026-06-30
    const rows = buildSessionRows('class-uuid', 1, '2026-06-01', '2026-06-30')
    // Mondays in June 2026: 1,8,15,22,29
    expect(rows).toHaveLength(5)
    expect(rows[0]).toEqual({
      class_id: 'class-uuid',
      session_date: '2026-06-01',
      status: 'scheduled',
      notes: null,
    })
    expect(rows[4].session_date).toBe('2026-06-29')
  })

  it('returns empty array when no matching days in range', () => {
    // day_of_week=0 (Sunday), from Mon to Sat
    const rows = buildSessionRows('class-uuid', 0, '2026-06-01', '2026-06-06')
    expect(rows).toHaveLength(0)
  })
})
