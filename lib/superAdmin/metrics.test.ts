import { describe, it, expect } from 'vitest'
import {
  tenantMrr,
  tenantMrrAtRisk,
  platformSummary,
  tenantHealth,
  attentionQueue,
  growthSeries,
  cohortRetention,
  filterTenants,
  sortTenants,
  availableStates,
  tenantsToCsv,
  formatBRL,
  formatPercent,
  relativeDays,
  daysUntil,
  type TenantSnapshot,
} from './metrics'

const NOW = new Date('2026-08-06T12:00:00Z')
const PRICE = 49.9

function daysFromNow(n: number): string {
  return new Date(NOW.getTime() + n * 86_400_000).toISOString()
}

// Academia saudável e pagante — base dos overrides de cada teste.
function tenant(over: Partial<TenantSnapshot> = {}): TenantSnapshot {
  return {
    id: 'org-1',
    name: 'Arena Central',
    slug: 'arena-central',
    city: 'Recife',
    state: 'PE',
    ownerName: 'Ana Souza',
    ownerEmail: 'ana@arena.com',
    orgStatus: 'active',
    subStatus: 'active',
    trialEndsAt: null,
    currentPeriodEnd: daysFromNow(20),
    subUpdatedAt: daysFromNow(-40),
    createdAt: daysFromNow(-200),
    onboardingCompleted: true,
    isComped: false,
    students: 40,
    activeStudents: 32,
    staff: 3,
    sessions30d: 60,
    checkins30d: 400,
    lastActivityAt: daysFromNow(-1),
    ...over,
  }
}

describe('tenantMrr', () => {
  it('conta só assinatura ativa', () => {
    expect(tenantMrr(tenant({ subStatus: 'active' }), PRICE)).toBe(PRICE)
    expect(tenantMrr(tenant({ subStatus: 'trialing' }), PRICE)).toBe(0)
    expect(tenantMrr(tenant({ subStatus: 'past_due' }), PRICE)).toBe(0)
    expect(tenantMrr(tenant({ subStatus: 'canceled' }), PRICE)).toBe(0)
    expect(tenantMrr(tenant({ subStatus: 'none' }), PRICE)).toBe(0)
  })

  it('exclui conta cortesia mesmo ativa', () => {
    expect(tenantMrr(tenant({ isComped: true }), PRICE)).toBe(0)
  })

  it('past_due entra como receita em risco, não como MRR', () => {
    const t = tenant({ subStatus: 'past_due' })
    expect(tenantMrr(t, PRICE)).toBe(0)
    expect(tenantMrrAtRisk(t, PRICE)).toBe(PRICE)
    expect(tenantMrrAtRisk(tenant({ subStatus: 'active' }), PRICE)).toBe(0)
  })
})

describe('platformSummary', () => {
  it('soma MRR e deriva ARR e ARPA das contas pagantes', () => {
    const s = platformSummary(
      [
        tenant({ id: 'a' }),
        tenant({ id: 'b' }),
        tenant({ id: 'c', subStatus: 'trialing', trialEndsAt: daysFromNow(10) }),
      ],
      PRICE,
      NOW,
    )
    expect(s.mrr).toBeCloseTo(99.8)
    expect(s.arr).toBeCloseTo(1197.6)
    expect(s.payingTenants).toBe(2)
    expect(s.arpa).toBeCloseTo(PRICE)
    expect(s.trialingTenants).toBe(1)
    expect(s.totalTenants).toBe(3)
  })

  it('ARPA é 0 e LTV null quando ninguém paga', () => {
    const s = platformSummary([tenant({ subStatus: 'trialing' })], PRICE, NOW)
    expect(s.arpa).toBe(0)
    expect(s.ltv).toBeNull()
  })

  it('churn 30d usa cancelamentos recentes sobre a base do início da janela', () => {
    const s = platformSummary(
      [
        tenant({ id: 'a' }),
        tenant({ id: 'b' }),
        tenant({ id: 'c' }),
        tenant({ id: 'd', subStatus: 'canceled', subUpdatedAt: daysFromNow(-5) }),
      ],
      PRICE,
      NOW,
    )
    // 1 cancelado sobre base 4 (3 retidos + 1 churn).
    expect(s.churnedTenants30d).toBe(1)
    expect(s.logoChurnRate30d).toBeCloseTo(0.25)
    expect(s.logoRetentionRate30d).toBeCloseTo(0.75)
  })

  it('ignora cancelamento antigo na janela de 30 dias', () => {
    const s = platformSummary(
      [tenant({ id: 'a' }), tenant({ id: 'b', subStatus: 'canceled', subUpdatedAt: daysFromNow(-90) })],
      PRICE,
      NOW,
    )
    expect(s.churnedTenants30d).toBe(0)
    expect(s.logoChurnRate30d).toBe(0)
  })

  it('não conta academia nova no denominador do churn', () => {
    const s = platformSummary(
      [
        tenant({ id: 'velha' }),
        tenant({ id: 'nova', createdAt: daysFromNow(-3) }),
        tenant({ id: 'saiu', subStatus: 'canceled', subUpdatedAt: daysFromNow(-2) }),
      ],
      PRICE,
      NOW,
    )
    // base = 1 retida antiga + 1 churn = 2 (a "nova" fica de fora).
    expect(s.logoChurnRate30d).toBeCloseTo(0.5)
  })

  it('LTV = ARPA / churn mensal', () => {
    const s = platformSummary(
      [
        tenant({ id: 'a' }),
        tenant({ id: 'b' }),
        tenant({ id: 'c' }),
        tenant({ id: 'd', subStatus: 'canceled', subUpdatedAt: daysFromNow(-5) }),
      ],
      PRICE,
      NOW,
    )
    expect(s.ltv).toBeCloseTo(PRICE / 0.25)
  })

  it('conversão de trial olha só trials já encerrados', () => {
    const s = platformSummary(
      [
        tenant({ id: 'converteu', subStatus: 'active', trialEndsAt: daysFromNow(-40) }),
        tenant({ id: 'expirou', subStatus: 'canceled', trialEndsAt: daysFromNow(-10) }),
        // Ainda em trial: fora do denominador, senão a taxa fica pessimista.
        tenant({ id: 'em-trial', subStatus: 'trialing', trialEndsAt: daysFromNow(15) }),
      ],
      PRICE,
      NOW,
    )
    expect(s.trialConversionBase).toBe(2)
    expect(s.trialConversionRate).toBeCloseTo(0.5)
  })

  it('conta trials acabando em 7 dias, inativas e sem assinatura', () => {
    const s = platformSummary(
      [
        tenant({ id: 'a', subStatus: 'trialing', trialEndsAt: daysFromNow(3) }),
        tenant({ id: 'b', subStatus: 'trialing', trialEndsAt: daysFromNow(20) }),
        tenant({ id: 'c', sessions30d: 0, checkins30d: 0 }),
        tenant({ id: 'd', subStatus: 'none' }),
      ],
      PRICE,
      NOW,
    )
    expect(s.trialsEndingIn7d).toBe(1)
    expect(s.inactiveTenants).toBe(1)
    expect(s.noSubTenants).toBe(1)
  })

  it('soma o uso agregado da plataforma', () => {
    const s = platformSummary(
      [tenant({ activeStudents: 10, sessions30d: 5, checkins30d: 50 }), tenant({ id: 'b', activeStudents: 7, sessions30d: 3, checkins30d: 20 })],
      PRICE,
      NOW,
    )
    expect(s.totalActiveStudents).toBe(17)
    expect(s.totalSessions30d).toBe(8)
    expect(s.totalCheckins30d).toBe(70)
  })

  it('base vazia não quebra e devolve zeros', () => {
    const s = platformSummary([], PRICE, NOW)
    expect(s.mrr).toBe(0)
    expect(s.logoChurnRate30d).toBe(0)
    expect(s.trialConversionRate).toBe(0)
    expect(s.ltv).toBeNull()
  })
})

describe('tenantHealth', () => {
  it('academia em pleno uso é saudável', () => {
    const h = tenantHealth(tenant(), NOW)
    expect(h.score).toBe(100)
    expect(h.tier).toBe('saudavel')
    expect(h.reasons).toEqual([])
  })

  it('penaliza pagamento em atraso e explica o motivo', () => {
    const h = tenantHealth(tenant({ subStatus: 'past_due' }), NOW)
    expect(h.score).toBe(70)
    expect(h.reasons).toContain('Pagamento em atraso')
  })

  it('academia sem alunos e sem aulas cai para risco', () => {
    const h = tenantHealth(
      tenant({ activeStudents: 0, sessions30d: 0, checkins30d: 0 }),
      NOW,
    )
    expect(h.score).toBe(35)
    expect(h.tier).toBe('risco')
  })

  it('nunca passa de 0 nem de 100', () => {
    const pior = tenantHealth(
      tenant({
        orgStatus: 'suspended',
        subStatus: 'canceled',
        onboardingCompleted: false,
        activeStudents: 0,
        sessions30d: 0,
        checkins30d: 0,
      }),
      NOW,
    )
    expect(pior.score).toBe(0)
    expect(pior.tier).toBe('risco')
  })

  it('trial acabando sem uso vira sinal de risco', () => {
    const h = tenantHealth(
      tenant({
        subStatus: 'trialing',
        trialEndsAt: daysFromNow(2),
        sessions30d: 0,
        checkins30d: 0,
        activeStudents: 2,
      }),
      NOW,
    )
    expect(h.reasons).toContain('Trial acabando sem uso')
  })
})

describe('attentionQueue', () => {
  const zeroQueues = { pendingRefunds: 0, pendingDeletions: 0, unreadFeedback: 0 }

  it('base impecável não gera pendências', () => {
    expect(attentionQueue([tenant()], zeroQueues, NOW)).toEqual([])
  })

  it('prioriza severidade alta antes de média e baixa', () => {
    const items = attentionQueue(
      [tenant({ id: 'a', subStatus: 'past_due' }), tenant({ id: 'b', subStatus: 'trialing', trialEndsAt: daysFromNow(2) })],
      { ...zeroQueues, unreadFeedback: 3 },
      NOW,
    )
    expect(items.map((i) => i.severity)).toEqual(['alta', 'media', 'baixa'])
    expect(items[0].id).toBe('past-due')
  })

  it('inclui filas de reembolso e exclusão com link próprio', () => {
    const items = attentionQueue([tenant()], { pendingRefunds: 2, pendingDeletions: 1, unreadFeedback: 0 }, NOW)
    const ids = items.map((i) => i.id)
    expect(ids).toContain('refunds')
    expect(ids).toContain('deletions')
    expect(items.find((i) => i.id === 'refunds')?.href).toBe('/super-admin/reembolsos')
  })

  it('sinaliza academia sem linha de assinatura', () => {
    const items = attentionQueue([tenant({ subStatus: 'none' })], zeroQueues, NOW)
    expect(items.some((i) => i.id === 'no-subscription')).toBe(true)
  })

  it('não cobra onboarding de academia já cancelada', () => {
    const items = attentionQueue(
      [tenant({ subStatus: 'canceled', onboardingCompleted: false, subUpdatedAt: daysFromNow(-2) })],
      zeroQueues,
      NOW,
    )
    expect(items.some((i) => i.id === 'onboarding')).toBe(false)
  })
})

describe('growthSeries', () => {
  it('agrupa criações por mês e acumula o total', () => {
    const rows = [
      tenant({ id: '1', createdAt: '2026-06-10T00:00:00Z' }),
      tenant({ id: '2', createdAt: '2026-07-02T00:00:00Z' }),
      tenant({ id: '3', createdAt: '2026-07-20T00:00:00Z' }),
      tenant({ id: '4', createdAt: '2026-08-01T00:00:00Z' }),
    ]
    const s = growthSeries(rows, 3, NOW)
    expect(s.map((p) => p.month)).toEqual(['2026-06', '2026-07', '2026-08'])
    expect(s.map((p) => p.novas)).toEqual([1, 2, 1])
    expect(s.map((p) => p.acumulado)).toEqual([1, 3, 4])
  })

  it('academias anteriores à janela entram no acumulado inicial', () => {
    const s = growthSeries(
      [tenant({ id: 'antiga', createdAt: '2025-01-05T00:00:00Z' }), tenant({ id: 'nova', createdAt: '2026-08-03T00:00:00Z' })],
      2,
      NOW,
    )
    expect(s[0].novas).toBe(0)
    expect(s[0].acumulado).toBe(1)
    expect(s[1].acumulado).toBe(2)
  })

  it('rotula o mês em mm/aa', () => {
    expect(growthSeries([], 1, NOW)[0].label).toBe('08/26')
  })
})

describe('cohortRetention', () => {
  it('mede quantos da coorte seguem na base', () => {
    const rows = [
      tenant({ id: '1', createdAt: '2026-07-05T00:00:00Z', subStatus: 'active' }),
      tenant({ id: '2', createdAt: '2026-07-06T00:00:00Z', subStatus: 'canceled' }),
      tenant({ id: '3', createdAt: '2026-08-02T00:00:00Z', subStatus: 'trialing' }),
    ]
    const c = cohortRetention(rows, 2, NOW)
    expect(c[0]).toMatchObject({ month: '2026-07', size: 2, retained: 1 })
    expect(c[0].rate).toBeCloseTo(0.5)
    expect(c[1]).toMatchObject({ month: '2026-08', size: 1, retained: 1, rate: 1 })
  })

  it('coorte vazia tem taxa 0 em vez de NaN', () => {
    const c = cohortRetention([], 1, NOW)
    expect(c[0].rate).toBe(0)
  })
})

describe('filterTenants', () => {
  const rows = [
    tenant({ id: '1', name: 'Arena Boa Viagem', city: 'Recife', state: 'PE' }),
    tenant({ id: '2', name: 'Cláudia Sports', city: 'São Paulo', state: 'SP', subStatus: 'past_due' }),
    tenant({ id: '3', name: 'Beira-Mar', city: 'Fortaleza', state: 'CE', orgStatus: 'suspended' }),
  ]

  it('busca ignorando acento e caixa', () => {
    expect(filterTenants(rows, { q: 'claudia' }, NOW).map((r) => r.id)).toEqual(['2'])
    expect(filterTenants(rows, { q: 'SAO paulo' }, NOW).map((r) => r.id)).toEqual(['2'])
  })

  it('busca também por dono e e-mail', () => {
    const comDono = [tenant({ id: 'x', ownerName: 'Rafael Lima', ownerEmail: 'rafa@quadra.com' })]
    expect(filterTenants(comDono, { q: 'rafael' }, NOW)).toHaveLength(1)
    expect(filterTenants(comDono, { q: 'quadra.com' }, NOW)).toHaveLength(1)
  })

  it('filtra por status, UF e suspensão', () => {
    expect(filterTenants(rows, { status: 'past_due' }, NOW).map((r) => r.id)).toEqual(['2'])
    expect(filterTenants(rows, { uf: 'CE' }, NOW).map((r) => r.id)).toEqual(['3'])
    expect(filterTenants(rows, { onlySuspended: true }, NOW).map((r) => r.id)).toEqual(['3'])
  })

  it('filtra por faixa de health', () => {
    const mix = [
      tenant({ id: 'ok' }),
      tenant({ id: 'ruim', activeStudents: 0, sessions30d: 0, checkins30d: 0 }),
    ]
    expect(filterTenants(mix, { health: 'risco' }, NOW).map((r) => r.id)).toEqual(['ruim'])
    expect(filterTenants(mix, { health: 'saudavel' }, NOW).map((r) => r.id)).toEqual(['ok'])
  })

  it('"todos" e busca vazia não filtram nada', () => {
    expect(filterTenants(rows, { q: '', status: 'todos', uf: 'todos', health: 'todos' }, NOW)).toHaveLength(3)
  })

  it('combina filtros', () => {
    expect(filterTenants(rows, { q: 'a', status: 'past_due' }, NOW).map((r) => r.id)).toEqual(['2'])
  })
})

describe('sortTenants', () => {
  const rows = [
    tenant({ id: 'b', name: 'Beta', activeStudents: 10, createdAt: daysFromNow(-10) }),
    tenant({ id: 'a', name: 'Alfa', activeStudents: 30, createdAt: daysFromNow(-50) }),
    tenant({ id: 'c', name: 'Gama', activeStudents: 20, createdAt: daysFromNow(-1) }),
  ]

  it('ordena por nome respeitando a direção', () => {
    expect(sortTenants(rows, 'name', true, NOW).map((r) => r.id)).toEqual(['a', 'b', 'c'])
    expect(sortTenants(rows, 'name', false, NOW).map((r) => r.id)).toEqual(['c', 'b', 'a'])
  })

  it('ordena por alunos e por data', () => {
    expect(sortTenants(rows, 'students', false, NOW).map((r) => r.id)).toEqual(['a', 'c', 'b'])
    expect(sortTenants(rows, 'createdAt', false, NOW).map((r) => r.id)).toEqual(['c', 'b', 'a'])
  })

  it('coloca problemas de cobrança primeiro ao ordenar por status', () => {
    const mix = [
      tenant({ id: 'ativa', subStatus: 'active' }),
      tenant({ id: 'atraso', subStatus: 'past_due' }),
      tenant({ id: 'trial', subStatus: 'trialing' }),
    ]
    expect(sortTenants(mix, 'subStatus', true, NOW).map((r) => r.id)).toEqual([
      'atraso',
      'trial',
      'ativa',
    ])
  })

  it('não muta o array original', () => {
    const original = [...rows]
    sortTenants(rows, 'name', true, NOW)
    expect(rows).toEqual(original)
  })

  it('trata última atividade ausente como a mais antiga', () => {
    const mix = [
      tenant({ id: 'sem', lastActivityAt: null }),
      tenant({ id: 'com', lastActivityAt: daysFromNow(-2) }),
    ]
    expect(sortTenants(mix, 'lastActivityAt', false, NOW).map((r) => r.id)).toEqual(['com', 'sem'])
  })
})

describe('availableStates', () => {
  it('lista UFs únicas em ordem, ignorando nulos', () => {
    expect(
      availableStates([
        tenant({ state: 'SP' }),
        tenant({ state: 'PE' }),
        tenant({ state: 'SP' }),
        tenant({ state: null }),
      ]),
    ).toEqual(['PE', 'SP'])
  })
})

describe('tenantsToCsv', () => {
  it('gera cabeçalho e linha com separador ponto e vírgula', () => {
    const csv = tenantsToCsv([tenant()], PRICE, NOW)
    const [header, row] = csv.split('\n')
    expect(header).toContain('Academia;Cidade;UF')
    expect(row).toContain('Arena Central;Recife;PE')
    expect(row).toContain('49,90')
  })

  it('começa com BOM para o Excel pt-BR abrir com acento certo', () => {
    expect(tenantsToCsv([], PRICE, NOW).startsWith('﻿')).toBe(true)
  })

  it('escapa aspas e separador dentro do valor', () => {
    const csv = tenantsToCsv([tenant({ name: 'Arena "Top"; Recife' })], PRICE, NOW)
    expect(csv).toContain('"Arena ""Top""; Recife"')
  })

  it('campo nulo vira célula vazia', () => {
    const csv = tenantsToCsv([tenant({ city: null, ownerEmail: null, lastActivityAt: null })], PRICE, NOW)
    expect(csv.split('\n')[1]).toContain('Arena Central;;PE')
  })
})

describe('formatação', () => {
  it('formata reais', () => {
    expect(formatBRL(49.9).replace(/ /g, ' ')).toBe('R$ 49,90')
    expect(formatBRL(1000).replace(/ /g, ' ')).toBe('R$ 1.000')
  })

  it('formata percentual com vírgula', () => {
    expect(formatPercent(0.256)).toBe('25,6%')
    expect(formatPercent(1, 0)).toBe('100%')
  })

  it('descreve a atividade em tempo relativo', () => {
    expect(relativeDays(null, NOW)).toBe('—')
    expect(relativeDays(daysFromNow(0), NOW)).toBe('hoje')
    expect(relativeDays(daysFromNow(-1), NOW)).toBe('ontem')
    expect(relativeDays(daysFromNow(-5), NOW)).toBe('há 5 dias')
    expect(relativeDays(daysFromNow(-45), NOW)).toBe('há 1 mês')
    expect(relativeDays(daysFromNow(-90), NOW)).toBe('há 3 meses')
  })

  it('daysUntil é negativo no passado e null sem data', () => {
    expect(daysUntil(null, NOW)).toBeNull()
    expect(daysUntil(daysFromNow(5), NOW)).toBe(5)
    expect(daysUntil(daysFromNow(-5), NOW)).toBe(-5)
  })
})
