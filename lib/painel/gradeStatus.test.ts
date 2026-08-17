import { describe, it, expect } from 'vitest'
import {
  pendingClassesFor,
  summarizeGeneration,
  totalPending,
  type ActiveClass,
} from './gradeStatus'

// 2026-08-10 é segunda; 11 terça; 15 sábado; 16 domingo.
const HOJE = '2026-08-10'

const TURMAS: ActiveClass[] = [
  { id: 'seg-07', dayOfWeek: 1 },
  { id: 'seg-19', dayOfWeek: 1 },
  { id: 'ter-19', dayOfWeek: 2 },
  { id: 'sab-09', dayOfWeek: 6 },
]

describe('pendingClassesFor', () => {
  it('lista as turmas do dia que ainda não têm sessão', () => {
    expect(pendingClassesFor(TURMAS, new Set(['seg-07']), '2026-08-10', HOJE)).toEqual(['seg-19'])
  })

  it('dia sem turma nenhuma não tem pendência', () => {
    // Quarta: nenhuma turma cadastrada.
    expect(pendingClassesFor(TURMAS, new Set(), '2026-08-12', HOJE)).toEqual([])
  })

  it('tudo gerado devolve lista vazia', () => {
    expect(pendingClassesFor(TURMAS, new Set(['seg-07', 'seg-19']), '2026-08-10', HOJE)).toEqual([])
  })

  it('data passada nunca acusa pendência', () => {
    // Não se gera grade para trás; marcar o passado ensinaria a ignorar o aviso.
    expect(pendingClassesFor(TURMAS, new Set(), '2026-08-03', HOJE)).toEqual([])
  })

  it('hoje ainda conta como pendente', () => {
    expect(pendingClassesFor(TURMAS, new Set(), HOJE, HOJE)).toEqual(['seg-07', 'seg-19'])
  })

  it('olha só as turmas do dia da semana da data', () => {
    expect(pendingClassesFor(TURMAS, new Set(), '2026-08-11', HOJE)).toEqual(['ter-19'])
    expect(pendingClassesFor(TURMAS, new Set(), '2026-08-15', HOJE)).toEqual(['sab-09'])
  })
})

describe('summarizeGeneration', () => {
  it('conta previstas, geradas e faltando por data', () => {
    const s = summarizeGeneration(
      TURMAS,
      new Map([['2026-08-10', new Set(['seg-07'])]]),
      ['2026-08-10', '2026-08-11', '2026-08-12'],
      HOJE,
    )
    expect(s.get('2026-08-10')).toEqual({ expected: 2, generated: 1, pending: 1 })
    expect(s.get('2026-08-11')).toEqual({ expected: 1, generated: 0, pending: 1 })
    expect(s.get('2026-08-12')).toEqual({ expected: 0, generated: 0, pending: 0 })
  })

  it('sessão de turma desativada não infla o gerado', () => {
    // A turma saiu da grade mas a sessão dela continua no banco. Sem o filtro,
    // generated (1) passaria de expected (0) e o dia viraria pendência negativa.
    const s = summarizeGeneration(
      [],
      new Map([['2026-08-10', new Set(['turma-antiga'])]]),
      ['2026-08-10'],
      HOJE,
    )
    expect(s.get('2026-08-10')).toEqual({ expected: 0, generated: 0, pending: 0 })
  })

  it('no passado, pendência é zero mesmo com turma prevista e nada gerado', () => {
    const s = summarizeGeneration(TURMAS, new Map(), ['2026-08-03'], HOJE)
    expect(s.get('2026-08-03')).toEqual({ expected: 2, generated: 0, pending: 0 })
  })

  it('sessão cancelada acusa pendência — gerar de novo a reabre', () => {
    // O contrato com o chamador (adminMonthQuery): o mapa traz só sessão ATIVA.
    // Uma data cuja única sessão está cancelada chega aqui como não-gerada, e
    // tem de acusar pendência, porque hoje a geração reabre o que foi cancelado.
    // Enquanto ela contava como gerada, o calendário escondia o botão justamente
    // na data que o admin queria reconstruir.
    const s = summarizeGeneration(TURMAS, new Map(), ['2026-08-11'], HOJE)
    expect(s.get('2026-08-11')?.pending).toBe(1)
  })

  it('janela vazia devolve mapa vazio', () => {
    expect(summarizeGeneration(TURMAS, new Map(), [], HOJE).size).toBe(0)
  })
})

describe('totalPending', () => {
  it('soma as pendências da janela', () => {
    const s = summarizeGeneration(
      TURMAS,
      new Map([['2026-08-10', new Set(['seg-07'])]]),
      ['2026-08-10', '2026-08-11', '2026-08-15'],
      HOJE,
    )
    expect(totalPending(s)).toBe(3)
  })

  it('nada pendente é zero', () => {
    expect(totalPending(new Map())).toBe(0)
  })
})
