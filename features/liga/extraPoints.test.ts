// features/liga/extraPoints.test.ts
//
// O que se testa aqui é a SIMETRIA entre creditar e revogar, não o crédito em si
// (esse é a RPC, com índice de deduplicação próprio). O bug que motivou o
// arquivo: entrar numa aula rendia `early_booking`, sair rendia `cancel_in_time`,
// e nada era revogado — quem entrava e saía somava os dois numa aula que nunca
// aconteceu, e repetia a manobra em toda sessão.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }))
vi.mock('./settings', () => ({ getLigaSettings: vi.fn() }))
vi.mock('./season', () => ({ getOrCreateActiveSeason: vi.fn() }))
vi.mock('./awardPoints', () => ({
  awardLigaPoints: vi.fn().mockResolvedValue(undefined),
  revokeLigaPoints: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/arenas/orgSports', () => ({ getOrgSports: vi.fn().mockResolvedValue([]) }))

import { awardLigaExtra, revokeLigaExtra, ENTRY_REASONS, EXIT_REASON } from './extraPoints'
import { getLigaSettings } from './settings'
import { getOrCreateActiveSeason } from './season'
import { awardLigaPoints, revokeLigaPoints } from './awardPoints'
import { DEFAULT_LIGA_WEIGHTS } from '@/lib/liga/points'

const ORG = 'org-1'
const ALUNO = 'aluno-1'
const SESSAO = 'sessao-1'
const TEMPORADA = 'temporada-1'

// O client nunca é usado nos caminhos testados (sempre passamos `sport`
// explícito, que é o que as actions de aula fazem), então um objeto vazio basta.
const admin = {} as never

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getLigaSettings).mockResolvedValue({
    enabled: true,
    weights: DEFAULT_LIGA_WEIGHTS,
  } as never)
  vi.mocked(getOrCreateActiveSeason).mockResolvedValue({ id: TEMPORADA } as never)
})

describe('revokeLigaExtra', () => {
  it('revoga a linha exata (temporada, aluno, esporte, motivo, origem)', async () => {
    await revokeLigaExtra(admin, {
      orgId: ORG,
      studentId: ALUNO,
      reason: 'early_booking',
      sourceId: SESSAO,
      sport: 'beach-tennis',
    })

    expect(revokeLigaPoints).toHaveBeenCalledWith(admin, {
      seasonId: TEMPORADA,
      studentId: ALUNO,
      sport: 'beach-tennis',
      reason: 'early_booking',
      sourceId: SESSAO,
    })
  })

  it('Liga desligada não mexe em nada', async () => {
    vi.mocked(getLigaSettings).mockResolvedValue({
      enabled: false,
      weights: DEFAULT_LIGA_WEIGHTS,
    } as never)

    await revokeLigaExtra(admin, {
      orgId: ORG,
      studentId: ALUNO,
      reason: 'early_booking',
      sourceId: SESSAO,
      sport: 'beach-tennis',
    })

    expect(revokeLigaPoints).not.toHaveBeenCalled()
  })

  // Best-effort é contrato: a Liga não pode derrubar um cancelamento de aula.
  it('nunca lança, mesmo se a temporada não resolver', async () => {
    vi.mocked(getOrCreateActiveSeason).mockRejectedValue(new Error('banco fora'))

    await expect(
      revokeLigaExtra(admin, {
        orgId: ORG,
        studentId: ALUNO,
        reason: 'early_booking',
        sourceId: SESSAO,
        sport: 'beach-tennis',
      }),
    ).resolves.toBeUndefined()
    expect(revokeLigaPoints).not.toHaveBeenCalled()
  })

  it('sem esporte resolvível não tenta revogar nada', async () => {
    await revokeLigaExtra(admin, {
      orgId: ORG,
      studentId: ALUNO,
      reason: 'early_booking',
      sourceId: SESSAO,
      // sport ausente e a academia não tem modalidade única: nada a fazer.
    })

    expect(revokeLigaPoints).not.toHaveBeenCalled()
  })
})

// Simulação do ciclo que o usuário relatou: entra, sai, entra, sai. Cada saída
// revoga a entrada e cada entrada revoga a saída, então o extrato final é o mesmo
// de quem entrou e saiu uma vez só.
describe('ciclo entrar → sair → entrar → sair', () => {
  const base = { orgId: ORG, studentId: ALUNO, sourceId: SESSAO, sport: 'beach-tennis' as const }

  async function entrar() {
    // Espelha bookSessionAs: revoga o ponto da saída, credita o da entrada.
    await revokeLigaExtra(admin, { ...base, reason: EXIT_REASON })
    await awardLigaExtra(admin, { ...base, reason: 'early_booking' })
  }

  async function sair() {
    // Espelha cancelBookingAs: revoga os pontos da entrada, credita o da saída.
    for (const reason of ENTRY_REASONS) {
      await revokeLigaExtra(admin, { ...base, reason })
    }
    await awardLigaExtra(admin, { ...base, reason: EXIT_REASON })
  }

  it('cada crédito tem exatamente uma revogação do outro lado', async () => {
    await entrar()
    await sair()
    await entrar()
    await sair()

    const creditos = vi.mocked(awardLigaPoints).mock.calls.map((c) => c[1].reason)
    const revogacoes = vi.mocked(revokeLigaPoints).mock.calls.map((c) => c[1].reason)

    // 2 entradas + 2 saídas creditadas...
    expect(creditos.filter((r) => r === 'early_booking')).toHaveLength(2)
    expect(creditos.filter((r) => r === 'cancel_in_time')).toHaveLength(2)

    // ...e cada uma delas revogada pelo movimento seguinte. A revogação a mais de
    // `early_booking` é a primeira saída revogando uma entrada que existia; a de
    // `cancel_in_time` na primeira entrada não encontra linha e é inofensiva (a
    // RPC não acha nada e não faz nada).
    expect(revogacoes.filter((r) => r === 'early_booking')).toHaveLength(2)
    expect(revogacoes.filter((r) => r === 'cancel_in_time')).toHaveLength(2)
  })

  it('sair sempre tenta revogar as DUAS formas de entrada', async () => {
    await sair()

    const revogados = vi.mocked(revokeLigaPoints).mock.calls.map((c) => c[1].reason)
    expect(revogados).toContain('early_booking')
    expect(revogados).toContain('waitlist_accept')
  })

  it('a revogação usa o mesmo esporte do crédito — senão não acha a linha', async () => {
    await entrar()
    await sair()

    const esportesCreditados = new Set(
      vi.mocked(awardLigaPoints).mock.calls.map((c) => c[1].sport),
    )
    const esportesRevogados = new Set(
      vi.mocked(revokeLigaPoints).mock.calls.map((c) => c[1].sport),
    )
    expect(esportesCreditados).toEqual(new Set(['beach-tennis']))
    expect(esportesRevogados).toEqual(new Set(['beach-tennis']))
  })
})
