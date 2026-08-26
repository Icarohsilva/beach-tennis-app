import { describe, it, expect, vi, beforeEach } from 'vitest'

// Stub escopado ao que promoteFromWaitlist lê/escreve. `bookSessionAs` é
// mockado porque o caminho de reserva já tem cobertura própria — aqui o que
// está sob teste é QUEM é promovido, em que ordem, e quem é avisado.
// vi.mock é hoisted para o topo do arquivo, então as factories não podem ler
// variáveis de módulo. vi.hoisted sobe os stubs junto.
const H: {
  bookSessionAs: ReturnType<typeof vi.fn>
  notifyUsers: ReturnType<typeof vi.fn>
  resolveStudentClassAccess: ReturnType<typeof vi.fn>
  getMembershipFor: ReturnType<typeof vi.fn>
  state: {
    fila: { id: string; student_id: string; first_notified_at: string | null }[]
    confirmados: number
    sessionStatus: string
    sessionDate: string
    updates: { table: string; patch: Record<string, unknown>; id?: string }[]
  }
} = vi.hoisted(() => ({
  // A reserva de verdade chama `clearWaitlistEntry`, que marca a entrada como
  // 'accepted' — o aluno sai da consulta de status='waiting'. O stub precisa
  // fazer o mesmo, senão o promovido continuaria aparecendo como primeiro da
  // fila e o teste mediria um sistema que não existe.
  bookSessionAs: vi.fn(async (studentId: string) => {
    H.state.fila = H.state.fila.filter((e) => e.student_id !== studentId)
    return {} as { error?: string }
  }),
  notifyUsers: vi.fn(async () => {}),
  resolveStudentClassAccess: vi.fn(),
  getMembershipFor: vi.fn(async () => ({ credits_balance: 0, partner: null })),
  state: {
    fila: [] as { id: string; student_id: string; first_notified_at: string | null }[],
    confirmados: 3,
    sessionStatus: 'scheduled',
    sessionDate: '2026-08-25',
    updates: [] as { table: string; patch: Record<string, unknown>; id?: string }[],
  },
}))
const { bookSessionAs, notifyUsers, resolveStudentClassAccess } = H
const updates = H.state.updates

vi.mock('./actions', () => ({ bookSessionAs: H.bookSessionAs }))
vi.mock('@/lib/notifications/dispatch', () => ({ notifyUsers: H.notifyUsers }))
vi.mock('./classAccessQuery', () => ({
  resolveStudentClassAccess: H.resolveStudentClassAccess,
  getMembershipFor: H.getMembershipFor,
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
  getActiveOrgId: vi.fn(async () => 'org-1'),
  createAdminClient: () => ({
    from: (table: string) => {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        order: () => builder,
        limit: () => builder,
        maybeSingle: () =>
          Promise.resolve({ data: table === 'user_emails' ? { email: 'a@b.com' } : null }),
        single: () =>
          Promise.resolve({
            data:
              table === 'class_sessions'
                ? {
                    id: 'sess-1',
                    organization_id: 'org-1',
                    session_date: H.state.sessionDate,
                    status: H.state.sessionStatus,
                    start_time: null,
                    end_time: null,
                    court: null,
                    max_students: null,
                    class: {
                      name: 'Beach Tennis',
                      max_students: 4,
                      start_time: '19:00:00',
                      end_time: '20:00:00',
                      court: 1,
                    },
                  }
                : null,
          }),
        update: (patch: Record<string, unknown>) => ({
          eq: (_c: string, id: string) => {
            H.state.updates.push({ table, patch, id })
            return Promise.resolve({ data: null })
          },
        }),
        then: (resolve: (v: { data: unknown; count?: number }) => void) => {
          if (table === 'waitlists') return Promise.resolve({ data: H.state.fila }).then(resolve)
          if (table === 'session_bookings') {
            return Promise.resolve({ data: [], count: H.state.confirmados }).then(resolve)
          }
          return Promise.resolve({ data: [] }).then(resolve)
        },
      }
      return builder
    },
  }),
}))

import { promoteFromWaitlist } from './waitlistActions'

const LIBERADO = { decision: { grant: 'plan' }, dailyCapExceeded: false, dailyCap: 2, quotaLimit: 8, debtTotal: 0 }
const COM_DIVIDA = { decision: { denied: 'blocked_by_debt' }, dailyCapExceeded: null, dailyCap: 2, quotaLimit: null, debtTotal: 90 }

function setup(entries: string[], opts: { confirmados?: number; firstNotified?: string | null } = {}) {
  H.state.fila = entries.map((sid, i) => ({
    id: `w${i + 1}`,
    student_id: sid,
    first_notified_at: i === 0 ? (opts.firstNotified ?? null) : null,
  }))
  H.state.confirmados = opts.confirmados ?? 3
}

describe('promoteFromWaitlist', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    updates.length = 0
    H.state.sessionStatus = 'scheduled'
    H.state.sessionDate = '2026-08-25'
    // Bem longe do início: o corte de 1h não interfere.
    vi.setSystemTime(new Date('2026-08-25T10:00:00-03:00'))
    resolveStudentClassAccess.mockResolvedValue(LIBERADO)
    bookSessionAs.mockImplementation(async (studentId: string) => {
      H.state.fila = H.state.fila.filter((e) => e.student_id !== studentId)
      return {}
    })
  })

  it('o primeiro da fila entra e é avisado; o segundo é avisado que virou primeiro', async () => {
    setup(['aluno-1', 'aluno-2', 'aluno-3'])
    await promoteFromWaitlist('sess-1')

    expect(bookSessionAs).toHaveBeenCalledTimes(1)
    expect(bookSessionAs).toHaveBeenCalledWith('aluno-1', 'sess-1', { orgId: 'org-1' })

    const tipos = notifyUsers.mock.calls.map((c) => (c[1] as { type: string }).type)
    expect(tipos).toEqual(['waitlist_auto_entered', 'waitlist_now_first'])

    const primeiro = notifyUsers.mock.calls[0][1] as { recipients: { userId: string }[]; channels: string[] }
    expect(primeiro.recipients[0].userId).toBe('aluno-1')
    // Push e e-mail, sem WhatsApp.
    expect(primeiro.channels).toEqual(['inapp', 'email', 'push'])

    const segundo = notifyUsers.mock.calls[1][1] as { recipients: { userId: string }[] }
    expect(segundo.recipients[0].userId).toBe('aluno-2')
  })

  it('primeiro barrado sai da fila com aviso do motivo, e a vaga vai para o segundo', async () => {
    setup(['aluno-1', 'aluno-2'])
    resolveStudentClassAccess
      .mockResolvedValueOnce(COM_DIVIDA)
      .mockResolvedValueOnce(LIBERADO)

    await promoteFromWaitlist('sess-1')

    expect(bookSessionAs).toHaveBeenCalledTimes(1)
    expect(bookSessionAs).toHaveBeenCalledWith('aluno-2', 'sess-1', { orgId: 'org-1' })

    const tipos = notifyUsers.mock.calls.map((c) => (c[1] as { type: string }).type)
    expect(tipos.slice(0, 2)).toEqual(['waitlist_removed', 'waitlist_auto_entered'])

    // Removido de verdade da fila, não só pulado.
    expect(updates.some((u) => u.table === 'waitlists' && u.patch.status === 'cancelled' && u.id === 'w1')).toBe(true)
    // E o aviso diz o valor em aberto.
    expect((notifyUsers.mock.calls[0][1] as { body: string }).body).toContain('R$ 90,00')
  })

  it('dentro de 1h do início ninguém entra e ninguém é avisado', async () => {
    setup(['aluno-1', 'aluno-2'])
    vi.setSystemTime(new Date('2026-08-25T18:30:00-03:00'))
    await promoteFromWaitlist('sess-1')
    expect(bookSessionAs).not.toHaveBeenCalled()
    expect(notifyUsers).not.toHaveBeenCalled()
  })

  it('sem vaga não promove ninguém', async () => {
    setup(['aluno-1'], { confirmados: 4 })
    await promoteFromWaitlist('sess-1')
    expect(bookSessionAs).not.toHaveBeenCalled()
  })

  it('turma ACIMA do limite (matrícula incorreta) não promove ninguém, mesmo depois de tirar um aluno', async () => {
    // Cenário real: a turma tinha 4 de capacidade e chegou a 5 confirmados por um
    // bug de vínculo automático. Tirar UM aluno dessas 5 não abre vaga — ainda
    // sobra 1 além do limite. `confirmados` aqui já reflete o estado PÓS-remoção
    // (é o que a query de verdade lê, já que a remoção grava 'cancelled' antes de
    // chamar promoteFromWaitlist) — então isto testa exatamente o que o admin
    // veria ao tirar o aluno excedente de uma turma lotada além da conta.
    setup(['aluno-1'], { confirmados: 5 })
    await promoteFromWaitlist('sess-1')
    expect(bookSessionAs).not.toHaveBeenCalled()
    // "virou o primeiro" é só aviso, não vaga — continua disparando mesmo sem
    // promoção nenhuma, e não é o que este teste protege.
    const tipos = notifyUsers.mock.calls.map((c) => (c[1] as { type: string }).type)
    expect(tipos).not.toContain('waitlist_auto_entered')
  })

  it('duas vagas promovem dois, em ordem de chegada', async () => {
    setup(['aluno-1', 'aluno-2', 'aluno-3'], { confirmados: 2 })
    await promoteFromWaitlist('sess-1')
    expect(bookSessionAs.mock.calls.map((c) => c[0])).toEqual(['aluno-1', 'aluno-2'])
  })

  it('quem já foi avisado que é o primeiro não é reavisado (o cron passa de novo)', async () => {
    // Fila com um só, já avisado, e sem vaga: é a passada seguinte do cron.
    setup(['aluno-1'], { confirmados: 4, firstNotified: '2026-08-24T10:00:00Z' })
    await promoteFromWaitlist('sess-1')
    expect(notifyUsers).not.toHaveBeenCalled()
  })

  it('aula cancelada não promove', async () => {
    setup(['aluno-1'])
    H.state.sessionStatus = 'cancelled'
    await promoteFromWaitlist('sess-1')
    expect(bookSessionAs).not.toHaveBeenCalled()
  })

  it('reserva recusada em corrida mantém o aluno na fila', async () => {
    setup(['aluno-1', 'aluno-2'])
    bookSessionAs.mockResolvedValue({ error: 'Esta turma está lotada.' })
    await promoteFromWaitlist('sess-1')
    // Não avisou entrada, e não removeu ninguém da fila.
    const tipos = notifyUsers.mock.calls.map((c) => (c[1] as { type: string }).type)
    expect(tipos).not.toContain('waitlist_auto_entered')
    expect(updates.some((u) => u.patch.status === 'cancelled')).toBe(false)
  })
})
