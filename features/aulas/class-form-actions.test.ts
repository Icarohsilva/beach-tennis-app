import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Supabase admin client
const singleMock = vi.fn().mockResolvedValue({ data: { id: 'new-class-id' }, error: null })
const selectMock = vi.fn().mockReturnValue({ single: singleMock })
const insertMock = vi.fn().mockReturnValue({ select: selectMock })
const fromMock = vi.fn().mockReturnValue({ insert: insertMock })
vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => ({ from: fromMock }),
  getCurrentOrgId: vi.fn().mockResolvedValue('org-1'),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('./gridGeneration', () => ({
  generateGrid: vi.fn().mockResolvedValue({ sessionsCreated: 1, studentsBooked: 0 }),
}))

// Cardápio de modalidades da academia (organizations.sports).
vi.mock('@/lib/arenas/orgSports', () => ({
  getOrgSports: vi.fn().mockResolvedValue(['beach_tennis', 'padel']),
}))

import { buildSessionRows } from './sessionUtils'
import { createClass, type ClassFormData } from './class-form-actions'
import { generateGrid } from './gridGeneration'

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

describe('createClass', () => {
  const validData: ClassFormData = {
    name: 'Turma Iniciante',
    description: '',
    type: 'adult',
    sport: null,
    day_of_week: 1,
    start_time: '08:00',
    end_time: '09:00',
    max_students: 8,
    court: 1,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    singleMock.mockResolvedValue({ data: { id: 'new-class-id' }, error: null })
    selectMock.mockReturnValue({ single: singleMock })
    insertMock.mockReturnValue({ select: selectMock })
    fromMock.mockReturnValue({ insert: insertMock })
    vi.mocked(generateGrid).mockResolvedValue({ sessionsCreated: 1, studentsBooked: 0, quotaSkipped: 0, missedCheckinSkipped: 0 })
  })

  it('chama generateGrid escopado à turma nova, numa janela de 7 dias', async () => {
    const result = await createClass(validData)

    expect(result).toEqual({})
    expect(generateGrid).toHaveBeenCalledTimes(1)
    expect(generateGrid).toHaveBeenCalledWith(
      'org-1', // orgId
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), // from
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), // to
      { classId: 'new-class-id' },
    )

    // A janela deve ser exatamente 7 dias (from..to inclusive, 6 dias de diferença).
    const [, from, to] = vi.mocked(generateGrid).mock.calls[0]
    const fromDate = new Date(`${from}T00:00:00Z`)
    const toDate = new Date(`${to}T00:00:00Z`)
    const diffDays = (toDate.getTime() - fromDate.getTime()) / (24 * 60 * 60 * 1000)
    expect(diffDays).toBe(6)
  })

  it('loga erro quando generateGrid não cria a sessão esperada (sessionsCreated=0)', async () => {
    vi.mocked(generateGrid).mockResolvedValue({ sessionsCreated: 0, studentsBooked: 0, quotaSkipped: 0, missedCheckinSkipped: 0 })
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await createClass(validData)

    expect(result).toEqual({})
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[createClass] generateGrid nao criou a sessao esperada',
      expect.objectContaining({ classId: 'new-class-id', orgId: 'org-1' }),
    )
  })

  it('grava a modalidade quando ela está no cardápio da academia', async () => {
    await createClass({ ...validData, sport: 'padel' })
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({ sport: 'padel' }))
  })

  it('zera a modalidade que a academia não oferece', async () => {
    await createClass({ ...validData, sport: 'futebol' })
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({ sport: null }))
  })

  it('aceita turma sem modalidade', async () => {
    await createClass(validData)
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({ sport: null }))
  })
})
