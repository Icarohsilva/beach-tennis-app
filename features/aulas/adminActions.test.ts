// features/aulas/adminActions.test.ts
//
// Este arquivo não tinha testes (convenção deste arquivo: actions admin em
// geral não são testadas aqui — ver demais funções). Exceção deliberada: a
// revisão do Task 9 encontrou um bug crítico em adminSkipEnrollmentDate — o
// upsert sobrescrevia sem estorno uma reserva 'confirmed'+credit_used:true
// pré-existente (ex.: aluno adicionado à data via addStudentToSession usando
// crédito). Isso é lógica financeira nova (estorno via adjust_credits) que
// não existia antes, por isso ganha teste mesmo com o resto do arquivo sem.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('./authGuards', () => ({
  requireAdmin: vi.fn(),
}))

import {
  adminSkipEnrollmentDate,
  adminUnskipEnrollmentDate,
  cancelEnrollment,
  enrollStudentInClass,
} from './adminActions'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdmin } from './authGuards'
import { revalidatePath } from 'next/cache'
import type { PlanQuota } from '@/lib/utils/classQuota'

/**
 * Stub do client Supabase escopado ao que adminSkipEnrollmentDate/
 * adminUnskipEnrollmentDate precisam: lookups pontuais (maybeSingle) por
 * tabela, upsert/delete em session_bookings e rpc (adjust_credits). Mesma
 * técnica de features/financeiro/classDebt.test.ts e gridGeneration.test.ts.
 */
function makeClient(opts: {
  session?: { id: string; class_id: string } | null
  membership?: { user_id: string } | null
  existingBooking?: { status: string; credit_used: boolean } | null
  upsertError?: { message: string } | null
  deleteError?: { message: string } | null
  rpcError?: { message: string } | null
}) {
  const upsert = vi.fn().mockResolvedValue({ error: opts.upsertError ?? null })
  const rpc = vi.fn().mockResolvedValue({ error: opts.rpcError ?? null })

  const from = vi.fn((table: string) => {
    const single = () => {
      if (table === 'class_sessions') return Promise.resolve({ data: opts.session ?? null })
      if (table === 'memberships') return Promise.resolve({ data: opts.membership ?? null })
      if (table === 'session_bookings') return Promise.resolve({ data: opts.existingBooking ?? null })
      return Promise.resolve({ data: null })
    }
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      maybeSingle: single,
      single,
      upsert,
      delete: () => builder,
      // Encadeamento de delete().eq()...eq() não termina em maybeSingle(): o
      // próprio builder precisa ser thenable para o `await` final resolver.
      then: (resolve: (v: { error: unknown }) => void) =>
        Promise.resolve({ error: opts.deleteError ?? null }).then(resolve),
    }
    return builder
  })

  return { client: { from, rpc } as never, upsert, rpc }
}

const ADMIN = { userId: 'admin-1', orgId: 'org-1' }

describe('adminSkipEnrollmentDate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAdmin).mockResolvedValue(ADMIN)
  })

  it('estorna 1 crédito quando já havia reserva confirmada com crédito debitado (bug crítico do review)', async () => {
    const { client, upsert, rpc } = makeClient({
      session: { id: 'sess-1', class_id: 'class-1' },
      membership: { user_id: 'stu-1' },
      existingBooking: { status: 'confirmed', credit_used: true },
    })
    vi.mocked(createAdminClient).mockReturnValue(client)

    const result = await adminSkipEnrollmentDate('stu-1', 'sess-1')

    expect(result).toEqual({})
    expect(rpc).toHaveBeenCalledWith('adjust_credits', {
      p_student_id: 'stu-1',
      p_org: 'org-1',
      p_delta: 1,
      p_type: 'refunded',
      p_reason: expect.any(String),
      p_session_id: 'sess-1',
    })
    // A reserva ainda é marcada 'cancelled' (com cancelled_at) além do estorno.
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'cancelled',
        credit_used: false,
        cancelled_at: expect.any(String),
      }),
      { onConflict: 'student_id,session_id' },
    )
  })

  it('NÃO estorna crédito quando não havia reserva alguma para a data', async () => {
    const { client, rpc, upsert } = makeClient({
      session: { id: 'sess-1', class_id: 'class-1' },
      membership: { user_id: 'stu-1' },
      existingBooking: null,
    })
    vi.mocked(createAdminClient).mockReturnValue(client)

    const result = await adminSkipEnrollmentDate('stu-1', 'sess-1')

    expect(result).toEqual({})
    expect(rpc).not.toHaveBeenCalled()
    expect(upsert).toHaveBeenCalled()
  })

  it('NÃO estorna crédito quando a reserva existente não havia consumido crédito', async () => {
    const { client, rpc } = makeClient({
      session: { id: 'sess-1', class_id: 'class-1' },
      membership: { user_id: 'stu-1' },
      existingBooking: { status: 'confirmed', credit_used: false },
    })
    vi.mocked(createAdminClient).mockReturnValue(client)

    await adminSkipEnrollmentDate('stu-1', 'sess-1')

    expect(rpc).not.toHaveBeenCalled()
  })

  it('NÃO estorna crédito quando a reserva existente já estava cancelled (mesmo com credit_used true)', async () => {
    const { client, rpc } = makeClient({
      session: { id: 'sess-1', class_id: 'class-1' },
      membership: { user_id: 'stu-1' },
      existingBooking: { status: 'cancelled', credit_used: true },
    })
    vi.mocked(createAdminClient).mockReturnValue(client)

    await adminSkipEnrollmentDate('stu-1', 'sess-1')

    expect(rpc).not.toHaveBeenCalled()
  })

  it('registra a falta mas devolve aviso quando o estorno de crédito falha (não silencia o erro)', async () => {
    const { client, upsert } = makeClient({
      session: { id: 'sess-1', class_id: 'class-1' },
      membership: { user_id: 'stu-1' },
      existingBooking: { status: 'confirmed', credit_used: true },
      rpcError: { message: 'boom' },
    })
    vi.mocked(createAdminClient).mockReturnValue(client)
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await adminSkipEnrollmentDate('stu-1', 'sess-1')

    expect(upsert).toHaveBeenCalled()
    expect(result.error).toBeTruthy()
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[adminSkipEnrollmentDate] adjust_credits falhou',
      expect.objectContaining({ studentId: 'stu-1', sessionId: 'sess-1' }),
    )
  })

  it('retorna erro e não grava nada quando o aluno não participa desta academia', async () => {
    const { client, upsert } = makeClient({
      session: { id: 'sess-1', class_id: 'class-1' },
      membership: null,
    })
    vi.mocked(createAdminClient).mockReturnValue(client)

    const result = await adminSkipEnrollmentDate('stu-1', 'sess-1')

    expect(result).toEqual({ error: expect.any(String) })
    expect(upsert).not.toHaveBeenCalled()
  })

  it('retorna erro quando a sessão não é encontrada nesta academia', async () => {
    const { client } = makeClient({ session: null })
    vi.mocked(createAdminClient).mockReturnValue(client)

    const result = await adminSkipEnrollmentDate('stu-1', 'sess-1')

    expect(result).toEqual({ error: 'Sessão não encontrada.' })
  })

  it('revalida a listagem da grade e a página de edição da turma', async () => {
    const { client } = makeClient({
      session: { id: 'sess-1', class_id: 'class-1' },
      membership: { user_id: 'stu-1' },
      existingBooking: null,
    })
    vi.mocked(createAdminClient).mockReturnValue(client)

    await adminSkipEnrollmentDate('stu-1', 'sess-1')

    expect(revalidatePath).toHaveBeenCalledWith('/admin/grade')
    expect(revalidatePath).toHaveBeenCalledWith('/admin/grade/class-1/editar', 'page')
  })
})

describe('adminUnskipEnrollmentDate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAdmin).mockResolvedValue(ADMIN)
  })

  it('revalida a listagem e a página de edição quando encontra a turma da sessão', async () => {
    const { client } = makeClient({ session: { id: 'sess-1', class_id: 'class-1' } })
    vi.mocked(createAdminClient).mockReturnValue(client)

    const result = await adminUnskipEnrollmentDate('stu-1', 'sess-1')

    expect(result).toEqual({})
    expect(revalidatePath).toHaveBeenCalledWith('/admin/grade')
    expect(revalidatePath).toHaveBeenCalledWith('/admin/grade/class-1/editar', 'page')
  })

  it('não quebra e revalida só a listagem quando a sessão não é encontrada', async () => {
    const { client } = makeClient({ session: null })
    vi.mocked(createAdminClient).mockReturnValue(client)

    const result = await adminUnskipEnrollmentDate('stu-1', 'sess-1')

    expect(result).toEqual({})
    expect(revalidatePath).toHaveBeenCalledWith('/admin/grade')
    expect(revalidatePath).not.toHaveBeenCalledWith(expect.stringContaining('/editar'), expect.anything())
  })
})

/**
 * Stub que grava a tabela, a operação e os filtros de cada chamada, para poder
 * afirmar POR QUAIS reservas a action passou (o filtro é o comportamento aqui:
 * avulsa não pode ser tocada).
 */
interface Call {
  table: string
  op: 'select' | 'update'
  payload?: Record<string, unknown>
  filters: Record<string, unknown>
}

function makeCancelClient(opts: {
  enrollment?: { student_id: string; class_id: string; organization_id: string } | null
  futureSessions?: { id: string }[]
  bookings?: { id: string; session_id: string; credit_used: boolean }[]
  updateError?: { message: string } | null
}) {
  const calls: Call[] = []
  const rpc = vi.fn().mockResolvedValue({ error: null })

  const from = vi.fn((table: string) => {
    const rec: Call = { table, op: 'select', filters: {} }
    calls.push(rec)
    const builder: Record<string, unknown> = {
      select: () => builder,
      update: (p: Record<string, unknown>) => {
        rec.op = 'update'
        rec.payload = p
        return builder
      },
      eq: (k: string, v: unknown) => {
        rec.filters[k] = v
        return builder
      },
      in: (k: string, v: unknown) => {
        rec.filters[k] = v
        return builder
      },
      gte: (k: string, v: unknown) => {
        rec.filters[k] = v
        return builder
      },
      single: () => Promise.resolve({ data: opts.enrollment ?? null, error: null }),
      then: (resolve: (v: { data: unknown; error: unknown }) => void) => {
        let data: unknown = null
        if (rec.op === 'select' && table === 'class_sessions') data = opts.futureSessions ?? []
        if (rec.op === 'select' && table === 'session_bookings') data = opts.bookings ?? []
        const error = rec.op === 'update' && table === 'enrollments' ? opts.updateError ?? null : null
        return Promise.resolve({ data, error }).then(resolve)
      },
    }
    return builder
  })

  return { client: { from, rpc } as never, calls, rpc }
}

const ENROLLMENT = { student_id: 'stu-1', class_id: 'class-1', organization_id: 'org-1' }

describe('cancelEnrollment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAdmin).mockResolvedValue(ADMIN)
  })

  it('cancela as reservas futuras geradas pela matrícula (senão o aluno some da turma mas fica na chamada para sempre)', async () => {
    const { client, calls } = makeCancelClient({
      enrollment: ENROLLMENT,
      futureSessions: [{ id: 'sess-1' }, { id: 'sess-2' }],
      bookings: [
        { id: 'bk-1', session_id: 'sess-1', credit_used: false },
        { id: 'bk-2', session_id: 'sess-2', credit_used: false },
      ],
    })
    vi.mocked(createAdminClient).mockReturnValue(client)

    const result = await cancelEnrollment('enr-1')

    expect(result).toEqual({})
    const cancelled = calls.filter((c) => c.table === 'session_bookings' && c.op === 'update')
    expect(cancelled.map((c) => c.filters.id)).toEqual(['bk-1', 'bk-2'])
    for (const c of cancelled) {
      expect(c.payload).toEqual({ status: 'cancelled', cancelled_at: expect.any(String) })
    }
  })

  it('busca só reservas confirmadas nascidas da matrícula — avulsa paga com crédito continua valendo', async () => {
    const { client, calls } = makeCancelClient({
      enrollment: ENROLLMENT,
      futureSessions: [{ id: 'sess-1' }],
      bookings: [],
    })
    vi.mocked(createAdminClient).mockReturnValue(client)

    await cancelEnrollment('enr-1')

    const lookup = calls.find((c) => c.table === 'session_bookings' && c.op === 'select')
    expect(lookup?.filters).toMatchObject({
      student_id: 'stu-1',
      session_id: ['sess-1'],
      status: 'confirmed',
      from_enrollment: true,
    })
  })

  it('estorna 1 crédito por reserva que havia debitado crédito', async () => {
    const { client, rpc } = makeCancelClient({
      enrollment: ENROLLMENT,
      futureSessions: [{ id: 'sess-1' }, { id: 'sess-2' }],
      bookings: [
        { id: 'bk-1', session_id: 'sess-1', credit_used: true },
        { id: 'bk-2', session_id: 'sess-2', credit_used: false },
      ],
    })
    vi.mocked(createAdminClient).mockReturnValue(client)

    await cancelEnrollment('enr-1')

    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('adjust_credits', {
      p_student_id: 'stu-1',
      p_org: 'org-1',
      p_delta: 1,
      p_type: 'refunded',
      p_reason: expect.any(String),
      p_session_id: 'sess-1',
    })
  })

  it('não toca em reserva nenhuma quando a turma não tem sessão futura', async () => {
    const { client, calls, rpc } = makeCancelClient({
      enrollment: ENROLLMENT,
      futureSessions: [],
    })
    vi.mocked(createAdminClient).mockReturnValue(client)

    await cancelEnrollment('enr-1')

    expect(calls.some((c) => c.table === 'session_bookings')).toBe(false)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('não mexe em reservas quando a própria desativação da matrícula falha', async () => {
    const { client, calls } = makeCancelClient({
      enrollment: ENROLLMENT,
      futureSessions: [{ id: 'sess-1' }],
      bookings: [{ id: 'bk-1', session_id: 'sess-1', credit_used: true }],
      updateError: { message: 'boom' },
    })
    vi.mocked(createAdminClient).mockReturnValue(client)

    const result = await cancelEnrollment('enr-1')

    expect(result).toEqual({ error: 'Erro ao cancelar matrícula.' })
    expect(calls.some((c) => c.table === 'session_bookings')).toBe(false)
  })
})

/**
 * Stub escopado ao que enrollStudentInClass precisa: lookup de classes
 * (.single), memberships (.maybeSingle, partner: null para exercitar o
 * caminho de plano), a cota nova (system_settings + student_subscriptions,
 * ambos via .maybeSingle) e as contagens de enrollments (existing/capacity
 * via count head, e a lista de matrículas ativas para a cota via .then).
 * Adaptado do stub ilustrativo do plano: o original não tratava 'classes' nem
 * 'memberships' em single()/maybeSingle() (voltavam null, o que barrava a
 * function antes mesmo de chegar na cota) e não anexava reconcileEnrollmentCredits.
 */
function makeEnrollClient(opts: {
  plan: PlanQuota
  activeEnrollments: number
  quotaEnforced: boolean
  maxStudents?: number
}) {
  const rpc = vi.fn().mockResolvedValue({ error: null, data: null })
  const upsert = vi.fn().mockResolvedValue({ error: null })

  const from = vi.fn((table: string) => {
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      // Encadeamento usado por reconcileEnrollmentCredits (chamada ao fim de
      // enrollStudentInClass) em class_sessions: gte/lte/order antes do await.
      gte: () => builder,
      lte: () => builder,
      order: () => builder,
      in: () => builder,
      upsert,
      single: () => {
        if (table === 'classes') {
          return Promise.resolve({
            data: { id: 'class-x', is_active: true, max_students: opts.maxStudents ?? 10 },
          })
        }
        return Promise.resolve({ data: null, error: null })
      },
      maybeSingle: () => {
        if (table === 'memberships') {
          return Promise.resolve({ data: { partner: null } })
        }
        if (table === 'system_settings') {
          return Promise.resolve({ data: { value: String(opts.quotaEnforced) } })
        }
        if (table === 'student_subscriptions') {
          return Promise.resolve({
            data: {
              gateway: 'manual',
              current_period_end: null,
              subscription_plans: {
                classes_per_week: opts.plan.classesPerWeek,
                cycle: opts.plan.cycle,
                max_classes_per_day: opts.plan.maxClassesPerDay,
                refund_on_late_cancel: opts.plan.refundOnLateCancel,
              },
            },
          })
        }
        return Promise.resolve({ data: null })
      },
      // Sem .single()/.maybeSingle() no fim da cadeia: usado pelas contagens
      // de enrollments (count: 'exact', head: true) e pela lista de matrículas
      // ativas da cota (select('class_id')). `count` fica undefined nas duas
      // contagens — o `?? 0` do caller trata como "0 já matriculado/lotado",
      // que é o que os testes precisam (nenhum já ocupa a vaga ou a turma).
      then: (resolve: (v: { data: unknown; error: unknown; count?: number }) => void) => {
        const data =
          table === 'enrollments'
            ? Array.from({ length: opts.activeEnrollments }, (_, i) => ({
                class_id: `outra-turma-${i}`,
              }))
            : []
        return Promise.resolve({ data, error: null }).then(resolve)
      },
    }
    return builder
  })

  return { from, rpc } as never
}

describe('enrollStudentInClass — cota de fixas', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAdmin).mockResolvedValue(ADMIN)
  })

  it('rejeita a fixa que ultrapassa classes_per_week do plano', async () => {
    // Plano 2x/semana, aluno já com 2 matrículas fixas ativas (em OUTRAS turmas).
    const client = makeEnrollClient({
      plan: { classesPerWeek: 2, cycle: 'monthly', maxClassesPerDay: 2, refundOnLateCancel: true },
      activeEnrollments: 2,
      quotaEnforced: true,
    })
    vi.mocked(createAdminClient).mockReturnValue(client)

    const result = await enrollStudentInClass('stu-1', 'class-3')

    expect(result.error).toContain('2 aulas fixas')
  })

  it('aceita a fixa que bate no limite exato', async () => {
    const client = makeEnrollClient({
      plan: { classesPerWeek: 2, cycle: 'monthly', maxClassesPerDay: 2, refundOnLateCancel: true },
      activeEnrollments: 1,
      quotaEnforced: true,
    })
    vi.mocked(createAdminClient).mockReturnValue(client)

    await expect(enrollStudentInClass('stu-1', 'class-2')).resolves.toEqual({})
  })

  it('não valida nada quando a cota está desligada', async () => {
    const client = makeEnrollClient({
      plan: { classesPerWeek: 1, cycle: 'monthly', maxClassesPerDay: 2, refundOnLateCancel: true },
      activeEnrollments: 5,
      quotaEnforced: false,
    })
    vi.mocked(createAdminClient).mockReturnValue(client)

    await expect(enrollStudentInClass('stu-1', 'class-9')).resolves.toEqual({})
  })
})
