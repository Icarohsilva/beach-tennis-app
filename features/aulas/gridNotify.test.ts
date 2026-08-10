import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/notifications/dispatch', () => ({ notifyUsers: vi.fn() }))
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))

import { notifyGridGenerated } from './gridNotify'
import { notifyUsers } from '@/lib/notifications/dispatch'
import * as Sentry from '@sentry/nextjs'

/**
 * Fake client: `organizations` responde ao `.single()` com o nome configurado
 * (ou null, simulando org não encontrada). `memberships` grava os filtros de
 * `.eq()` e o `.then()` de fato filtra por eles — mesma técnica de
 * gridGeneration.test.ts — para que um teste que exige escopo por org/role/
 * contract_active falhe de verdade se algum `.eq(...)` for removido do
 * código-fonte (é exatamente o vazamento entre academias que este helper não
 * pode cometer).
 */
function makeClient(opts: {
  orgName?: string | null
  memberships: Array<{
    user_id: string
    organization_id: string
    role: string
    contract_active: boolean
    /** Ausente = cadastro ativo (o padrão no banco é null). */
    archived_at?: string | null
  }>
}) {
  const client = {
    from(table: string) {
      if (table === 'organizations') {
        const filters: [string, unknown][] = []
        const builder: Record<string, unknown> = {}
        builder.select = () => builder
        builder.eq = (field: string, value: unknown) => {
          filters.push([field, value])
          return builder
        }
        builder.single = () => {
          if (opts.orgName == null) return Promise.resolve({ data: null })
          // Só devolve o nome se o filtro por id foi de fato aplicado.
          const filteredById = filters.some(([f]) => f === 'id')
          return Promise.resolve({ data: filteredById ? { name: opts.orgName } : null })
        }
        return builder
      }
      if (table === 'memberships') {
        const filters: [string, unknown][] = []
        const builder: Record<string, unknown> = {}
        builder.select = () => builder
        builder.eq = (field: string, value: unknown) => {
          filters.push([field, value])
          return builder
        }
        // `.is(campo, null)` entra como filtro de igualdade contra null: assim
        // remover o `.is('archived_at', null)` do código-fonte volta a incluir o
        // aluno inativado e o teste falha.
        builder.is = (field: string, value: unknown) => {
          filters.push([field, value])
          return builder
        }
        builder.then = (resolve: (v: { data: unknown[] }) => void) => {
          const filtered = opts.memberships.filter((m) => {
            const row = { archived_at: null, ...m } as Record<string, unknown>
            return filters.every(([field, value]) => row[field] === value)
          })
          resolve({ data: filtered.map((m) => ({ user_id: m.user_id })) })
        }
        return builder
      }
      throw new Error(`tabela inesperada: ${table}`)
    },
  }
  return client as never
}

describe('notifyGridGenerated', () => {
  beforeEach(() => {
    vi.mocked(notifyUsers).mockReset()
    vi.mocked(Sentry.captureException).mockReset()
  })

  it('notifica só os alunos ativos da academia informada (escopo semana)', async () => {
    const client = makeClient({
      orgName: 'Arena Beach Tennis',
      memberships: [
        { user_id: 'aluno-1', organization_id: 'org-1', role: 'student', contract_active: true },
        { user_id: 'aluno-2', organization_id: 'org-1', role: 'student', contract_active: true },
        // Não deve aparecer: outra org, outro role, contrato inativo.
        { user_id: 'aluno-outra-org', organization_id: 'org-2', role: 'student', contract_active: true },
        { user_id: 'admin-1', organization_id: 'org-1', role: 'admin', contract_active: true },
        { user_id: 'aluno-inativo', organization_id: 'org-1', role: 'student', contract_active: false },
        // Nem quem teve o cadastro inativado na academia: avisar da grade alguém
        // que saiu é convite a ele tentar agendar e bater na trava.
        {
          user_id: 'aluno-arquivado',
          organization_id: 'org-1',
          role: 'student',
          contract_active: true,
          archived_at: '2026-08-01T12:00:00Z',
        },
      ],
    })

    await notifyGridGenerated('org-1', { kind: 'week' }, client)

    expect(notifyUsers).toHaveBeenCalledTimes(1)
    expect(notifyUsers).toHaveBeenCalledWith(client, {
      orgId: 'org-1',
      recipients: [{ userId: 'aluno-1' }, { userId: 'aluno-2' }],
      type: 'grade_disponivel',
      title: 'Novas aulas na Arena Beach Tennis',
      body: 'A grade da semana já está disponível. Agende sua aula!',
      channels: ['push', 'inapp'],
    })
  })

  it('escopo dia usa o nome do dia da semana no título e mensagem curta', async () => {
    const client = makeClient({
      orgName: 'Arena Beach Tennis',
      memberships: [{ user_id: 'aluno-1', organization_id: 'org-1', role: 'student', contract_active: true }],
    })

    await notifyGridGenerated('org-1', { kind: 'day', dayOfWeek: 2 }, client) // terça

    expect(notifyUsers).toHaveBeenCalledWith(client, expect.objectContaining({
      title: 'Aulas de terça na Arena Beach Tennis',
      body: 'Já dá pra agendar. Bora treinar!',
    }))
  })

  it('dayOfWeek fora do intervalo cai no fallback "sua turma"', async () => {
    const client = makeClient({
      orgName: 'Arena Beach Tennis',
      memberships: [{ user_id: 'aluno-1', organization_id: 'org-1', role: 'student', contract_active: true }],
    })

    await notifyGridGenerated('org-1', { kind: 'day', dayOfWeek: 99 }, client)

    expect(notifyUsers).toHaveBeenCalledWith(client, expect.objectContaining({
      title: 'Aulas de sua turma na Arena Beach Tennis',
    }))
  })

  it('org não encontrada cai no fallback "sua academia" em vez de vazar undefined', async () => {
    const client = makeClient({
      orgName: null,
      memberships: [{ user_id: 'aluno-1', organization_id: 'org-1', role: 'student', contract_active: true }],
    })

    await notifyGridGenerated('org-1', { kind: 'week' }, client)

    expect(notifyUsers).toHaveBeenCalledWith(client, expect.objectContaining({
      title: 'Novas aulas na sua academia',
    }))
  })

  it('sem destinatários (nenhum aluno ativo na academia) não chama notifyUsers', async () => {
    const client = makeClient({
      orgName: 'Arena Beach Tennis',
      memberships: [
        { user_id: 'admin-1', organization_id: 'org-1', role: 'admin', contract_active: true },
        { user_id: 'aluno-inativo', organization_id: 'org-1', role: 'student', contract_active: false },
        // Nem quem teve o cadastro inativado na academia: avisar da grade alguém
        // que saiu é convite a ele tentar agendar e bater na trava.
        {
          user_id: 'aluno-arquivado',
          organization_id: 'org-1',
          role: 'student',
          contract_active: true,
          archived_at: '2026-08-01T12:00:00Z',
        },
      ],
    })

    await notifyGridGenerated('org-1', { kind: 'week' }, client)

    expect(notifyUsers).not.toHaveBeenCalled()
  })

  it('nunca lança mesmo se notifyUsers falhar — reporta ao Sentry', async () => {
    const client = makeClient({
      orgName: 'Arena Beach Tennis',
      memberships: [{ user_id: 'aluno-1', organization_id: 'org-1', role: 'student', contract_active: true }],
    })
    vi.mocked(notifyUsers).mockRejectedValueOnce(new Error('boom'))

    await expect(notifyGridGenerated('org-1', { kind: 'week' }, client)).resolves.toBeUndefined()
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: { feature: 'gridNotify' }, extra: { orgId: 'org-1' } }),
    )
  })

  it('nunca lança mesmo se a query da organization falhar', async () => {
    const client = {
      from(table: string) {
        if (table === 'organizations') {
          return {
            select: () => ({ eq: () => ({ single: () => Promise.reject(new Error('db down')) }) }),
          }
        }
        throw new Error(`tabela inesperada: ${table}`)
      },
    } as never

    await expect(notifyGridGenerated('org-1', { kind: 'week' }, client)).resolves.toBeUndefined()
    expect(notifyUsers).not.toHaveBeenCalled()
    expect(Sentry.captureException).toHaveBeenCalledTimes(1)
  })
})
