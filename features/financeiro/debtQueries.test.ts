// features/financeiro/debtQueries.test.ts
import { describe, it, expect } from 'vitest'
import { getOrgDebtors, getDebtGraceDays, DEFAULT_GRACE_DAYS } from './debtQueries'

type FakePayment = {
  id: string
  organization_id: string
  status: string
  student_id: string
  amount: number
  created_at: string
  receipt_url: string | null
  session_id: string | null
  missed_checkin: boolean
  class_sessions: { session_date: string } | { session_date: string }[] | null
}

/**
 * Fake client: `payments` grava os filtros de `.eq()`/`.not()` e o `.then()`
 * de fato filtra por eles — mesma técnica de enrollmentRoster.test.ts /
 * gridGeneration.test.ts, para que um teste que exige filtro por
 * organization_id/status/session_id falhe de verdade se o filtro
 * correspondente for removido do código-fonte. `system_settings` resolve via
 * `.maybeSingle()` (como em classDebt.test.ts) e `profiles` é pass-through,
 * mas conta chamadas para provar o short-circuit do caso vazio.
 */
function makeClient(opts: {
  payments: FakePayment[]
  settings?: { value: string } | null
  profiles?: { id: string; full_name: string }[]
}) {
  const calls = { profiles: 0, settings: 0 }

  const from = (table: string) => {
    if (table === 'payments') {
      const eqFilters: [string, unknown][] = []
      const notFilters: [string, string, unknown][] = []
      const builder: any = {
        select() { return builder },
        eq(field: string, value: unknown) {
          eqFilters.push([field, value])
          return builder
        },
        not(field: string, op: string, value: unknown) {
          notFilters.push([field, op, value])
          return builder
        },
        order() { return builder },
        then(resolve: (v: { data: unknown[] }) => void) {
          const filtered = opts.payments.filter((p) =>
            eqFilters.every(([field, value]) => (p as Record<string, unknown>)[field] === value) &&
            notFilters.every(([field, op, value]) => {
              if (op === 'is' && value === null) return (p as Record<string, unknown>)[field] !== null
              return true
            }),
          )
          resolve({ data: filtered })
        },
      }
      return builder
    }
    if (table === 'system_settings') {
      calls.settings++
      const builder: any = {
        select() { return builder },
        eq() { return builder },
        maybeSingle() { return Promise.resolve({ data: opts.settings ?? null }) },
      }
      return builder
    }
    if (table === 'profiles') {
      calls.profiles++
      const builder: any = {
        select() { return builder },
        in(_field: string, ids: string[]) {
          return Promise.resolve({ data: (opts.profiles ?? []).filter((p) => ids.includes(p.id)) })
        },
      }
      return builder
    }
    throw new Error(`tabela inesperada: ${table}`)
  }

  return { client: { from } as any, calls }
}

const payment = (over: Partial<FakePayment> = {}): FakePayment => ({
  id: 'p1',
  organization_id: 'org1',
  status: 'pending',
  student_id: 'a',
  amount: 30,
  created_at: '2026-07-01T10:00:00+00:00',
  receipt_url: null,
  session_id: 's1',
  missed_checkin: false,
  class_sessions: { session_date: '2026-07-01' },
  ...over,
})

describe('getOrgDebtors', () => {
  it('agrega dívidas por aluno (total, count, debts)', async () => {
    const { client } = makeClient({
      payments: [
        payment({ id: 'p1', student_id: 'a', amount: 30, created_at: '2026-07-01T10:00:00+00:00' }),
        payment({ id: 'p2', student_id: 'a', amount: 20, created_at: '2026-07-05T10:00:00+00:00' }),
        payment({ id: 'p3', student_id: 'b', amount: 15, created_at: '2026-07-02T10:00:00+00:00' }),
      ],
      profiles: [
        { id: 'a', full_name: 'Aluno A' },
        { id: 'b', full_name: 'Aluno B' },
      ],
    })

    const result = await getOrgDebtors(client, 'org1')
    const a = result.find((r) => r.studentId === 'a')!
    const b = result.find((r) => r.studentId === 'b')!

    expect(a.fullName).toBe('Aluno A')
    expect(a.summary.total).toBe(50)
    expect(a.summary.count).toBe(2)
    expect(a.debts).toHaveLength(2)
    expect(a.debts.map((d) => d.id).sort()).toEqual(['p1', 'p2'])

    expect(b.fullName).toBe('Aluno B')
    expect(b.summary.total).toBe(15)
    expect(b.summary.count).toBe(1)
  })

  it('mapeia sessionDate a partir de class_sessions (objeto ou array-de-um)', async () => {
    const { client } = makeClient({
      payments: [
        payment({ id: 'p1', student_id: 'a', class_sessions: { session_date: '2026-07-01' } }),
        payment({ id: 'p2', student_id: 'a', class_sessions: [{ session_date: '2026-07-08' }] }),
      ],
      profiles: [{ id: 'a', full_name: 'Aluno A' }],
    })

    const result = await getOrgDebtors(client, 'org1')
    const a = result.find((r) => r.studentId === 'a')!
    const dates = a.debts.map((d) => d.sessionDate).sort()
    expect(dates).toEqual(['2026-07-01', '2026-07-08'])
  })

  it('filtra por organization_id, status=pending, session_id não nulo e não-check-in', async () => {
    const { client } = makeClient({
      payments: [
        payment({ id: 'ok', student_id: 'a' }), // deve aparecer
        payment({ id: 'other-org', student_id: 'z', organization_id: 'org2' }), // outra academia
        payment({ id: 'paid', student_id: 'z', status: 'paid' }), // já pago
        payment({ id: 'no-session', student_id: 'z', session_id: null }), // pendência de assinatura, não de aula
        // Pendência de CHECK-IN: tem tela própria (/admin/wellhub) e regra própria
        // de bloqueio — não pode aparecer na cobrança de aula avulsa.
        payment({ id: 'checkin', student_id: 'z', missed_checkin: true }),
      ],
      profiles: [{ id: 'a', full_name: 'Aluno A' }],
    })

    const result = await getOrgDebtors(client, 'org1')
    expect(result).toHaveLength(1)
    expect(result[0].studentId).toBe('a')
    expect(result[0].debts.map((d) => d.id)).toEqual(['ok'])
  })

  it('ordena aguardando conferência (comprovante) primeiro, mesmo com dívida menor', async () => {
    const { client } = makeClient({
      payments: [
        // Dívida menor, mas com comprovante enviado → precisa aparecer primeiro.
        payment({ id: 'p-receipt', student_id: 'receipt-student', amount: 20, receipt_url: 'receipt-student/p1/receipt.jpg' }),
        // Dívida bem maior, sem comprovante → não deve furar a fila de conferência.
        payment({ id: 'p-big', student_id: 'big-debtor', amount: 100, receipt_url: null }),
      ],
      profiles: [
        { id: 'receipt-student', full_name: 'Com Comprovante' },
        { id: 'big-debtor', full_name: 'Dívida Grande' },
      ],
    })

    const result = await getOrgDebtors(client, 'org1')
    expect(result.map((r) => r.studentId)).toEqual(['receipt-student', 'big-debtor'])
    expect(result[0].summary.awaitingReview).toBe(1)
    expect(result[1].summary.awaitingReview).toBe(0)
    expect(result[1].summary.total).toBeGreaterThan(result[0].summary.total)
  })

  it('sem pendências retorna [] e não consulta profiles (short-circuit)', async () => {
    const { client, calls } = makeClient({ payments: [] })
    const result = await getOrgDebtors(client, 'org1')
    expect(result).toEqual([])
    expect(calls.profiles).toBe(0)
  })
})

describe('getDebtGraceDays', () => {
  it('retorna o valor configurado quando válido', async () => {
    const { client } = makeClient({ payments: [], settings: { value: '10' } })
    expect(await getDebtGraceDays(client, 'org1')).toBe(10)
  })

  it('retorna o padrão (7) quando a chave não existe', async () => {
    const { client } = makeClient({ payments: [], settings: null })
    expect(await getDebtGraceDays(client, 'org1')).toBe(DEFAULT_GRACE_DAYS)
  })

  it('retorna o padrão quando o valor é lixo (não numérico)', async () => {
    const { client } = makeClient({ payments: [], settings: { value: 'abc' } })
    expect(await getDebtGraceDays(client, 'org1')).toBe(7)
  })

  it('retorna o padrão quando o valor é negativo', async () => {
    const { client } = makeClient({ payments: [], settings: { value: '-5' } })
    expect(await getDebtGraceDays(client, 'org1')).toBe(7)
  })
})
