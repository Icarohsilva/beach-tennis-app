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

import { generateGridDay, generateGridWeek, generateGridClass } from './gridActions'
import { createAdminClient } from '@/lib/supabase/server'
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
    vi.mocked(generateGrid).mockResolvedValue({ sessionsCreated: 0, sessionsReopened: 0, studentsBooked: 0, quotaSkipped: 0, missedCheckinSkipped: 0, error: 'boom' })

    const result = await generateGridWeek()

    expect(result).toEqual({ error: 'boom' })
    expect(getClassRoster).not.toHaveBeenCalled()
    expect(notifyGridGenerated).not.toHaveBeenCalled()
  })

  it('nao notifica quando sessionsCreated=0, mas ainda calcula e retorna o roster', async () => {
    vi.mocked(generateGrid).mockResolvedValue({ sessionsCreated: 0, sessionsReopened: 0, studentsBooked: 0, quotaSkipped: 0, missedCheckinSkipped: 0 })

    const result = await generateGridDay(2)

    expect(notifyGridGenerated).not.toHaveBeenCalled()
    expect(getClassRoster).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      sessionsCreated: 0,
      sessionsReopened: 0,
      reservados: 6,
      aConfirmar: 3,
      semPlano: 1,
      semCota: 0,
      comPendenciaCheckin: 0,
    })
  })

  it('notifica com escopo "day" (e roster escopado ao dia) quando generateGridDay cria sessões novas', async () => {
    vi.mocked(generateGrid).mockResolvedValue({ sessionsCreated: 2, sessionsReopened: 0, studentsBooked: 5, quotaSkipped: 1, missedCheckinSkipped: 0 })

    const result = await generateGridDay(3)

    expect(getClassRoster).toHaveBeenCalledWith(expect.anything(), 'org-1', { dayOfWeek: 3 })
    expect(notifyGridGenerated).toHaveBeenCalledTimes(1)
    expect(notifyGridGenerated).toHaveBeenCalledWith('org-1', { kind: 'day', dayOfWeek: 3 })
    expect(result.semCota).toBe(1)
  })

  it('notifica com escopo "week" quando generateGridWeek cria sessões novas', async () => {
    vi.mocked(generateGrid).mockResolvedValue({ sessionsCreated: 4, sessionsReopened: 0, studentsBooked: 9, quotaSkipped: 0, missedCheckinSkipped: 0 })

    await generateGridWeek()

    expect(getClassRoster).toHaveBeenCalledWith(expect.anything(), 'org-1', {})
    expect(notifyGridGenerated).toHaveBeenCalledTimes(1)
    expect(notifyGridGenerated).toHaveBeenCalledWith('org-1', { kind: 'week' })
  })

  it('falha do getClassRoster degrada para zeros em vez de rejeitar, e ainda assim notifica', async () => {
    vi.mocked(generateGrid).mockResolvedValue({ sessionsCreated: 1, sessionsReopened: 0, studentsBooked: 1, quotaSkipped: 0, missedCheckinSkipped: 0 })
    vi.mocked(getClassRoster).mockRejectedValue(new Error('roster boom'))
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await generateGridWeek()

    expect(result).toEqual({
      sessionsCreated: 1,
      sessionsReopened: 0,
      reservados: 0,
      aConfirmar: 0,
      semPlano: 0,
      semCota: 0,
      comPendenciaCheckin: 0,
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

/** Devolve um cliente falso cujo `classes` responde com a turma dada (ou nada). */
function mockClassLookup(turma: { day_of_week: number; is_active: boolean } | null) {
  vi.mocked(createAdminClient).mockReturnValue({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: () => Promise.resolve({ data: turma }) }),
        }),
      }),
    }),
  } as never)
}

describe('generateGridClass', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAdmin).mockResolvedValue({ userId: 'user-1', orgId: 'org-1' })
    vi.mocked(getClassRoster).mockResolvedValue(SAMPLE_ROSTER)
    vi.mocked(notifyGridGenerated).mockResolvedValue(undefined)
    vi.mocked(generateGrid).mockResolvedValue({
      sessionsCreated: 1, sessionsReopened: 0, studentsBooked: 4, quotaSkipped: 0, missedCheckinSkipped: 0,
    })
  })

  it('gera só aquela turma, numa data só', async () => {
    mockClassLookup({ day_of_week: 2, is_active: true })

    const result = await generateGridClass('c1')

    const [orgId, from, to, opts] = vi.mocked(generateGrid).mock.calls[0]
    expect(orgId).toBe('org-1')
    expect(from).toBe(to) // uma data, não uma semana
    expect(opts).toEqual({ classId: 'c1' })
    expect(result.sessionsCreated).toBe(1)
  })

  // O escopo mais estreito de notifyGridGenerated é o dia inteiro da academia:
  // anunciar "a grade da terça está no ar" porque UMA turma foi gerada avisaria
  // muita gente sobre nada.
  it('não dispara o push de grade da academia', async () => {
    mockClassLookup({ day_of_week: 2, is_active: true })

    await generateGridClass('c1')

    expect(notifyGridGenerated).not.toHaveBeenCalled()
  })

  // O classId vem do cliente: sem esta checagem, um admin de uma academia
  // geraria aula na turma de outra.
  it('turma de outra academia não é encontrada', async () => {
    mockClassLookup(null)

    expect(await generateGridClass('c-alheia')).toEqual({ error: 'Turma não encontrada.' })
    expect(generateGrid).not.toHaveBeenCalled()
  })

  // deleteClass cancela as aulas futuras e marca is_active=false. Como gerar
  // agora REABRE cancelada, gerar numa turma excluída desfaria a exclusão.
  it('turma excluída não gera', async () => {
    mockClassLookup({ day_of_week: 2, is_active: false })

    const result = await generateGridClass('c-excluida')

    expect(result.error).toContain('excluída')
    expect(generateGrid).not.toHaveBeenCalled()
  })

  it('reabertura aparece no retorno para o admin ver', async () => {
    mockClassLookup({ day_of_week: 2, is_active: true })
    vi.mocked(generateGrid).mockResolvedValue({
      sessionsCreated: 0, sessionsReopened: 1, studentsBooked: 4, quotaSkipped: 0, missedCheckinSkipped: 0,
    })

    expect((await generateGridClass('c1')).sessionsReopened).toBe(1)
  })
})
