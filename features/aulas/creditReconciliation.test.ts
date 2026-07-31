import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: vi.fn(),
}))
vi.mock('./reconcileEnrollment', () => ({
  reconcileEnrollmentCredits: vi.fn(),
}))
vi.mock('@/lib/billing/planEligibility', () => ({
  getActivePlan: vi.fn(),
}))
vi.mock('./quotaSettings', () => ({
  isQuotaEnforced: vi.fn(),
}))
vi.mock('./quotaUsage', () => ({
  getQuotaSnapshot: vi.fn(),
}))
vi.mock('./quotaSkipNotify', () => ({
  notifyQuotaSkips: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('./missedCheckinSkipNotify', () => ({
  notifyMissedCheckinSkips: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/features/checkin/missedCheckinSettings', () => ({
  getMissedCheckinSettings: vi.fn(),
  countOpenMissedCheckinsByStudent: vi.fn(),
}))

import { createAdminClient } from '@/lib/supabase/server'
import { reconcileAllActiveEnrollments } from './creditReconciliation'
import { reconcileEnrollmentCredits } from './reconcileEnrollment'
import { getActivePlan } from '@/lib/billing/planEligibility'
import { isQuotaEnforced } from './quotaSettings'
import { getQuotaSnapshot } from './quotaUsage'
import { notifyQuotaSkips } from './quotaSkipNotify'
import { notifyMissedCheckinSkips } from './missedCheckinSkipNotify'
import {
  getMissedCheckinSettings,
  countOpenMissedCheckinsByStudent,
} from '@/features/checkin/missedCheckinSettings'

type EnrollRow = {
  student_id: string
  class_id: string
  organization_id: string
  enrolled_at: string
  classes: { name: string; day_of_week: number; start_time: string }
}

function makeClient(opts: {
  enrollments: EnrollRow[]
  memberships?: { user_id: string; organization_id: string; partner: string | null }[]
  subscriptions?: {
    student_id: string
    organization_id: string
    gateway: string
    current_period_end: string | null
  }[]
}) {
  const from = vi.fn((table: string) => {
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      then: (resolve: (v: { data: unknown }) => void) => {
        const data =
          table === 'enrollments'
            ? opts.enrollments
            : table === 'memberships'
              ? (opts.memberships ?? [])
              : table === 'student_subscriptions'
                ? (opts.subscriptions ?? [])
                : []
        return Promise.resolve({ data }).then(resolve)
      },
    }
    return builder
  })
  return { from } as never
}

const PLANO = { classesPerWeek: 2, cycle: 'monthly' as const, maxClassesPerDay: 2, refundOnLateCancel: true }

describe('reconcileAllActiveEnrollments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(notifyQuotaSkips).mockResolvedValue(undefined)
    vi.mocked(notifyMissedCheckinSkips).mockResolvedValue(undefined)
    // Default: bloqueio por pendência de check-in desligado (é o default de toda
    // academia), pra não interferir nos testes de cota.
    vi.mocked(getMissedCheckinSettings).mockResolvedValue({ blockLimit: 0, price: 0 })
    vi.mocked(countOpenMissedCheckinsByStudent).mockResolvedValue(new Map())
  })

  it('processa as fixas do aluno em ordem de dia da semana, decrementando o orçamento', async () => {
    const client = makeClient({
      enrollments: [
        {
          student_id: 'stu-1', class_id: 'thu-class', organization_id: 'org-1',
          enrolled_at: '2026-01-01T00:00:00Z',
          classes: { name: 'Turma Quinta', day_of_week: 4, start_time: '18:00:00' },
        },
        {
          student_id: 'stu-1', class_id: 'tue-class', organization_id: 'org-1',
          enrolled_at: '2026-01-02T00:00:00Z',
          classes: { name: 'Turma Terça', day_of_week: 2, start_time: '18:00:00' },
        },
      ],
      memberships: [{ user_id: 'stu-1', organization_id: 'org-1', partner: null }],
      subscriptions: [{ student_id: 'stu-1', organization_id: 'org-1', gateway: 'manual', current_period_end: null }],
    })
    vi.mocked(createAdminClient).mockReturnValue(client)
    vi.mocked(isQuotaEnforced).mockResolvedValue(true)
    vi.mocked(getActivePlan).mockResolvedValue(PLANO)
    vi.mocked(getQuotaSnapshot).mockResolvedValue({
      limit: 8, used: 7, remaining: 1, bookingsOnDate: 0, window: { from: '2026-07-01', to: '2026-07-31' },
    })
    vi.mocked(reconcileEnrollmentCredits).mockImplementation(async (_s, _c, _f, _t, _client, budget) => {
      const bookedNow = budget == null || budget > 0 ? 1 : 0
      return { booked: bookedNow, skipped: 0, quotaSkipped: bookedNow === 1 ? 0 : 1 }
    })

    await reconcileAllActiveEnrollments('2026-07-27', '2026-08-02', 'org-1')

    // Terça (dia 2) processa antes de Quinta (dia 4), com orçamento inicial 1.
    expect(reconcileEnrollmentCredits).toHaveBeenNthCalledWith(
      1, 'stu-1', 'tue-class', '2026-07-27', '2026-08-02', client, 1,
    )
    // Depois de reservar a terça (orçamento decrementado pra 0), a quinta recebe orçamento 0.
    expect(reconcileEnrollmentCredits).toHaveBeenNthCalledWith(
      2, 'stu-1', 'thu-class', '2026-07-27', '2026-08-02', client, 0,
    )
  })

  it('matrícula excedente (mais nova) perde a prioridade mesmo caindo antes na semana', async () => {
    const client = makeClient({
      enrollments: [
        // Mais antiga, cai depois na semana (sexta) — deve ser "contada"/protegida.
        {
          student_id: 'stu-1', class_id: 'fri-class', organization_id: 'org-1',
          enrolled_at: '2026-01-01T00:00:00Z',
          classes: { name: 'Turma Sexta', day_of_week: 5, start_time: '18:00:00' },
        },
        // Mais nova, cai antes na semana (segunda) — excedente, já que o
        // plano só permite 1 fixa por semana.
        {
          student_id: 'stu-1', class_id: 'mon-class', organization_id: 'org-1',
          enrolled_at: '2026-02-01T00:00:00Z',
          classes: { name: 'Turma Segunda', day_of_week: 1, start_time: '18:00:00' },
        },
      ],
      memberships: [{ user_id: 'stu-1', organization_id: 'org-1', partner: null }],
      subscriptions: [{ student_id: 'stu-1', organization_id: 'org-1', gateway: 'manual', current_period_end: null }],
    })
    vi.mocked(createAdminClient).mockReturnValue(client)
    vi.mocked(isQuotaEnforced).mockResolvedValue(true)
    vi.mocked(getActivePlan).mockResolvedValue({ ...PLANO, classesPerWeek: 1 })
    vi.mocked(getQuotaSnapshot).mockResolvedValue({
      limit: 4, used: 3, remaining: 1, bookingsOnDate: 0, window: { from: '2026-07-01', to: '2026-07-31' },
    })
    vi.mocked(reconcileEnrollmentCredits).mockImplementation(async (_s, _c, _f, _t, _client, budget) => {
      const bookedNow = budget == null || budget > 0 ? 1 : 0
      return { booked: bookedNow, skipped: 0, quotaSkipped: bookedNow === 1 ? 0 : 1 }
    })

    await reconcileAllActiveEnrollments('2026-07-27', '2026-08-02', 'org-1')

    // A fixa protegida (sexta, mais antiga) processa primeiro e recebe o
    // orçamento inteiro, apesar de cair depois na semana.
    expect(reconcileEnrollmentCredits).toHaveBeenNthCalledWith(
      1, 'stu-1', 'fri-class', '2026-07-27', '2026-08-02', client, 1,
    )
    // A excedente (segunda, mais nova) processa depois e não sobra orçamento,
    // mesmo caindo antes na semana.
    expect(reconcileEnrollmentCredits).toHaveBeenNthCalledWith(
      2, 'stu-1', 'mon-class', '2026-07-27', '2026-08-02', client, 0,
    )
  })

  it('cacheia isQuotaEnforced por academia — não repete a query por aluno', async () => {
    const client = makeClient({
      enrollments: [
        {
          student_id: 'stu-1', class_id: 'class-1', organization_id: 'org-1',
          enrolled_at: '2026-01-01T00:00:00Z',
          classes: { name: 'Turma', day_of_week: 2, start_time: '18:00:00' },
        },
        {
          student_id: 'stu-2', class_id: 'class-2', organization_id: 'org-1',
          enrolled_at: '2026-01-01T00:00:00Z',
          classes: { name: 'Turma', day_of_week: 3, start_time: '18:00:00' },
        },
      ],
      memberships: [
        { user_id: 'stu-1', organization_id: 'org-1', partner: null },
        { user_id: 'stu-2', organization_id: 'org-1', partner: null },
      ],
      subscriptions: [
        { student_id: 'stu-1', organization_id: 'org-1', gateway: 'manual', current_period_end: null },
        { student_id: 'stu-2', organization_id: 'org-1', gateway: 'manual', current_period_end: null },
      ],
    })
    vi.mocked(createAdminClient).mockReturnValue(client)
    vi.mocked(isQuotaEnforced).mockResolvedValue(true)
    vi.mocked(getActivePlan).mockResolvedValue(PLANO)
    vi.mocked(getQuotaSnapshot).mockResolvedValue({
      limit: 8, used: 0, remaining: 8, bookingsOnDate: 0, window: { from: '2026-07-01', to: '2026-07-31' },
    })
    vi.mocked(reconcileEnrollmentCredits).mockResolvedValue({ booked: 1, skipped: 0, quotaSkipped: 0 })

    await reconcileAllActiveEnrollments('2026-07-27', '2026-08-02', 'org-1')

    // 2 alunos na mesma academia — a pergunta "a cota está ligada?" só é
    // feita uma vez, não uma vez por aluno (evita reintroduzir o risco de
    // timeout que o fan-out por org já existe pra evitar).
    expect(isQuotaEnforced).toHaveBeenCalledTimes(1)
  })

  it('cota desligada não aplica orçamento (comportamento de hoje, sem limite)', async () => {
    const client = makeClient({
      enrollments: [{
        student_id: 'stu-1', class_id: 'class-1', organization_id: 'org-1',
        enrolled_at: '2026-01-01T00:00:00Z',
        classes: { name: 'Turma', day_of_week: 2, start_time: '18:00:00' },
      }],
      memberships: [{ user_id: 'stu-1', organization_id: 'org-1', partner: null }],
      subscriptions: [{ student_id: 'stu-1', organization_id: 'org-1', gateway: 'manual', current_period_end: null }],
    })
    vi.mocked(createAdminClient).mockReturnValue(client)
    vi.mocked(isQuotaEnforced).mockResolvedValue(false)
    vi.mocked(reconcileEnrollmentCredits).mockResolvedValue({ booked: 1, skipped: 0, quotaSkipped: 0 })

    await reconcileAllActiveEnrollments('2026-07-27', '2026-08-02', 'org-1')

    expect(getActivePlan).not.toHaveBeenCalled()
    expect(reconcileEnrollmentCredits).toHaveBeenCalledWith(
      'stu-1', 'class-1', '2026-07-27', '2026-08-02', client, null,
    )
  })

  it('aluno parceiro nunca recebe orçamento, mesmo com cota ligada', async () => {
    const client = makeClient({
      enrollments: [{
        student_id: 'stu-1', class_id: 'class-1', organization_id: 'org-1',
        enrolled_at: '2026-01-01T00:00:00Z',
        classes: { name: 'Turma', day_of_week: 2, start_time: '18:00:00' },
      }],
      memberships: [{ user_id: 'stu-1', organization_id: 'org-1', partner: 'wellhub' }],
    })
    vi.mocked(createAdminClient).mockReturnValue(client)
    vi.mocked(isQuotaEnforced).mockResolvedValue(true)
    vi.mocked(reconcileEnrollmentCredits).mockResolvedValue({ booked: 1, skipped: 0, quotaSkipped: 0 })

    await reconcileAllActiveEnrollments('2026-07-27', '2026-08-02', 'org-1')

    expect(getActivePlan).not.toHaveBeenCalled()
    expect(reconcileEnrollmentCredits).toHaveBeenCalledWith(
      'stu-1', 'class-1', '2026-07-27', '2026-08-02', client, null,
    )
  })

  it('notifica os alunos/turmas puladas por falta de cota', async () => {
    const client = makeClient({
      enrollments: [{
        student_id: 'stu-1', class_id: 'class-1', organization_id: 'org-1',
        enrolled_at: '2026-01-01T00:00:00Z',
        classes: { name: 'Turma X', day_of_week: 2, start_time: '18:00:00' },
      }],
      memberships: [{ user_id: 'stu-1', organization_id: 'org-1', partner: null }],
      subscriptions: [{ student_id: 'stu-1', organization_id: 'org-1', gateway: 'manual', current_period_end: null }],
    })
    vi.mocked(createAdminClient).mockReturnValue(client)
    vi.mocked(isQuotaEnforced).mockResolvedValue(true)
    vi.mocked(getActivePlan).mockResolvedValue({ ...PLANO, classesPerWeek: 1 })
    vi.mocked(getQuotaSnapshot).mockResolvedValue({
      limit: 4, used: 4, remaining: 0, bookingsOnDate: 0, window: { from: '2026-07-01', to: '2026-07-31' },
    })
    vi.mocked(reconcileEnrollmentCredits).mockResolvedValue({ booked: 0, skipped: 0, quotaSkipped: 1 })

    await reconcileAllActiveEnrollments('2026-07-27', '2026-08-02', 'org-1')

    expect(notifyQuotaSkips).toHaveBeenCalledWith(
      [{ studentId: 'stu-1', classId: 'class-1', className: 'Turma X', orgId: 'org-1' }],
      client,
    )
  })
})

describe('reconcileAllActiveEnrollments — pendência de check-in', () => {
  function parceiroComDuasFixas() {
    return makeClient({
      enrollments: [
        {
          student_id: 'stu-1', class_id: 'tue-class', organization_id: 'org-1',
          enrolled_at: '2026-01-01T00:00:00Z',
          classes: { name: 'Turma Terça', day_of_week: 2, start_time: '18:00:00' },
        },
        {
          student_id: 'stu-1', class_id: 'thu-class', organization_id: 'org-1',
          enrolled_at: '2026-01-02T00:00:00Z',
          classes: { name: 'Turma Quinta', day_of_week: 4, start_time: '18:00:00' },
        },
      ],
      memberships: [{ user_id: 'stu-1', organization_id: 'org-1', partner: 'wellhub' }],
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(notifyQuotaSkips).mockResolvedValue(undefined)
    vi.mocked(notifyMissedCheckinSkips).mockResolvedValue(undefined)
    vi.mocked(isQuotaEnforced).mockResolvedValue(false)
    vi.mocked(reconcileEnrollmentCredits).mockResolvedValue({ booked: 1, skipped: 0, quotaSkipped: 0 })
  })

  it('aluno bloqueado não recebe reserva de nenhuma das fixas dele', async () => {
    const client = parceiroComDuasFixas()
    vi.mocked(createAdminClient).mockReturnValue(client)
    vi.mocked(getMissedCheckinSettings).mockResolvedValue({ blockLimit: 2, price: 10 })
    vi.mocked(countOpenMissedCheckinsByStudent).mockResolvedValue(new Map([['stu-1', 3]]))

    const r = await reconcileAllActiveEnrollments('2026-07-27', '2026-08-02', 'org-1')

    expect(reconcileEnrollmentCredits).not.toHaveBeenCalled()
    expect(r.missedCheckinSkipped).toBe(2)
    expect(r.booked).toBe(0)
  })

  it('agrupa as turmas puladas num aviso só por aluno', async () => {
    const client = parceiroComDuasFixas()
    vi.mocked(createAdminClient).mockReturnValue(client)
    vi.mocked(getMissedCheckinSettings).mockResolvedValue({ blockLimit: 2, price: 10 })
    vi.mocked(countOpenMissedCheckinsByStudent).mockResolvedValue(new Map([['stu-1', 3]]))

    await reconcileAllActiveEnrollments('2026-07-27', '2026-08-02', 'org-1')

    expect(notifyMissedCheckinSkips).toHaveBeenCalledWith(
      [{
        studentId: 'stu-1',
        orgId: 'org-1',
        openCount: 3,
        classNames: ['Turma Terça', 'Turma Quinta'],
      }],
      client,
    )
  })

  it('abaixo do limite o parceiro segue sendo reservado', async () => {
    const client = parceiroComDuasFixas()
    vi.mocked(createAdminClient).mockReturnValue(client)
    vi.mocked(getMissedCheckinSettings).mockResolvedValue({ blockLimit: 5, price: 10 })
    vi.mocked(countOpenMissedCheckinsByStudent).mockResolvedValue(new Map([['stu-1', 3]]))

    const r = await reconcileAllActiveEnrollments('2026-07-27', '2026-08-02', 'org-1')

    expect(reconcileEnrollmentCredits).toHaveBeenCalledTimes(2)
    expect(r.missedCheckinSkipped).toBe(0)
    expect(notifyMissedCheckinSkips).toHaveBeenCalledWith([], client)
  })

  it('regra desligada (limite 0) nem consulta as pendências', async () => {
    const client = parceiroComDuasFixas()
    vi.mocked(createAdminClient).mockReturnValue(client)
    vi.mocked(getMissedCheckinSettings).mockResolvedValue({ blockLimit: 0, price: 0 })
    vi.mocked(countOpenMissedCheckinsByStudent).mockResolvedValue(new Map())

    const r = await reconcileAllActiveEnrollments('2026-07-27', '2026-08-02', 'org-1')

    expect(countOpenMissedCheckinsByStudent).not.toHaveBeenCalled()
    expect(r.missedCheckinSkipped).toBe(0)
    expect(reconcileEnrollmentCredits).toHaveBeenCalledTimes(2)
  })

  it('consulta as pendências uma vez por academia, não por aluno', async () => {
    const client = parceiroComDuasFixas()
    vi.mocked(createAdminClient).mockReturnValue(client)
    vi.mocked(getMissedCheckinSettings).mockResolvedValue({ blockLimit: 5, price: 10 })
    vi.mocked(countOpenMissedCheckinsByStudent).mockResolvedValue(new Map())

    await reconcileAllActiveEnrollments('2026-07-27', '2026-08-02', 'org-1')

    expect(getMissedCheckinSettings).toHaveBeenCalledTimes(1)
    expect(countOpenMissedCheckinsByStudent).toHaveBeenCalledTimes(1)
  })
})
