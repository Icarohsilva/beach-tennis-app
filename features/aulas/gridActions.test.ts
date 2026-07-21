import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: vi.fn(() => ({})),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('./authGuards', () => ({
  requireAdmin: vi.fn(),
}))

vi.mock('./gridGeneration', () => ({
  generateGrid: vi.fn(),
}))

vi.mock('./enrollmentRoster', () => ({
  getClassRoster: vi.fn(),
}))

vi.mock('./gridNotify', () => ({
  notifyGridGenerated: vi.fn(),
}))

import { generateGridDay, generateGridWeek } from './gridActions'
import { requireAdmin } from './authGuards'
import { generateGrid } from './gridGeneration'
import { getClassRoster, type Roster } from './enrollmentRoster'
import { notifyGridGenerated } from './gridNotify'

const SAMPLE_ROSTER: Roster = {
  byClass: new Map(),
  totals: { enrolled: 10, eligible: 6, pendingConfirmation: 3, noPlan: 1 },
}

describe('generateGridDay / generateGridWeek', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAdmin).mockResolvedValue({ userId: 'user-1', orgId: 'org-1' })
    vi.mocked(getClassRoster).mockResolvedValue(SAMPLE_ROSTER)
    vi.mocked(notifyGridGenerated).mockResolvedValue(undefined)
  })

  it('erro do generateGrid interrompe antes do roster e do notify', async () => {
    vi.mocked(generateGrid).mockResolvedValue({ sessionsCreated: 0, studentsBooked: 0, error: 'boom' })

    const result = await generateGridWeek()

    expect(result).toEqual({ error: 'boom' })
    expect(getClassRoster).not.toHaveBeenCalled()
    expect(notifyGridGenerated).not.toHaveBeenCalled()
  })

  it('nao notifica quando sessionsCreated=0, mas ainda calcula e retorna o roster', async () => {
    vi.mocked(generateGrid).mockResolvedValue({ sessionsCreated: 0, studentsBooked: 0 })

    const result = await generateGridDay(2)

    expect(notifyGridGenerated).not.toHaveBeenCalled()
    expect(getClassRoster).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      sessionsCreated: 0,
      reservados: 6,
      aConfirmar: 3,
      semPlano: 1,
    })
  })

  it('notifica com escopo "day" (e roster escopado ao dia) quando generateGridDay cria sessões novas', async () => {
    vi.mocked(generateGrid).mockResolvedValue({ sessionsCreated: 2, studentsBooked: 5 })

    await generateGridDay(3)

    expect(getClassRoster).toHaveBeenCalledWith(expect.anything(), 'org-1', { dayOfWeek: 3 })
    expect(notifyGridGenerated).toHaveBeenCalledTimes(1)
    expect(notifyGridGenerated).toHaveBeenCalledWith('org-1', { kind: 'day', dayOfWeek: 3 })
  })

  it('notifica com escopo "week" quando generateGridWeek cria sessões novas', async () => {
    vi.mocked(generateGrid).mockResolvedValue({ sessionsCreated: 4, studentsBooked: 9 })

    await generateGridWeek()

    expect(getClassRoster).toHaveBeenCalledWith(expect.anything(), 'org-1', {})
    expect(notifyGridGenerated).toHaveBeenCalledTimes(1)
    expect(notifyGridGenerated).toHaveBeenCalledWith('org-1', { kind: 'week' })
  })

  it('falha do getClassRoster degrada para zeros em vez de rejeitar, e ainda assim notifica', async () => {
    vi.mocked(generateGrid).mockResolvedValue({ sessionsCreated: 1, studentsBooked: 1 })
    vi.mocked(getClassRoster).mockRejectedValue(new Error('roster boom'))
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await generateGridWeek()

    expect(result).toEqual({
      sessionsCreated: 1,
      reservados: 0,
      aConfirmar: 0,
      semPlano: 0,
    })
    // A falha do roster não pode bloquear o push: sessionsCreated>0 ainda notifica.
    expect(notifyGridGenerated).toHaveBeenCalledTimes(1)
    expect(notifyGridGenerated).toHaveBeenCalledWith('org-1', { kind: 'week' })
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[gridActions] getClassRoster falhou',
      expect.objectContaining({ orgId: 'org-1' }),
    )
  })
})
