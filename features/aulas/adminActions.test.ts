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

import { adminSkipEnrollmentDate, adminUnskipEnrollmentDate } from './adminActions'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdmin } from './authGuards'
import { revalidatePath } from 'next/cache'

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
