import { describe, it, expect } from 'vitest'
import { matchesToSheet, type ExportableMatch } from './matchExport'

const rodada = (round: number) => `Rodada ${round}`

function match(over: Partial<ExportableMatch> = {}): ExportableMatch {
  return {
    round: 1,
    group_label: null,
    played_at: null,
    games1: null,
    games2: null,
    result_status: null,
    side1: ['Ícaro Silva', 'Danielle da Silva Oliveira'],
    side2: ['Wagner Eustaquio Franco', 'Sabrina Moreira'],
    ...over,
  }
}

describe('matchesToSheet', () => {
  it('Super 8: uma linha por confronto, dupla com os dois nomes, placar e situação', () => {
    const sheet = matchesToSheet(
      [
        match({ games1: 6, games2: 4, result_status: 'confirmed', played_at: '2026-09-12T17:30:00Z' }),
        match({ result_status: 'pending', games1: 3, games2: 6 }),
      ],
      { roundLabel: rodada, unit: 'atleta' },
    )
    expect(sheet.columns.map((c) => c.header)).toEqual([
      'Rodada', 'Jogo', 'Data e hora', 'Dupla 1', 'Placar 1', 'Placar 2', 'Dupla 2', 'Situação',
    ])
    expect(sheet.rows[0]).toEqual([
      'Rodada 1',
      1,
      // 17:30 UTC = 14:30 em Brasília: a planilha mostra a hora da quadra.
      { dateTime: '2026-09-12T14:30' },
      'Ícaro Silva / Danielle da Silva Oliveira',
      6,
      4,
      'Wagner Eustaquio Franco / Sabrina Moreira',
      'Confirmado',
    ])
    expect(sheet.rows[1][1]).toBe(2)
    expect(sheet.rows[1][7]).toBe('Aguardando confirmação')
  })

  it('sem placar e sem data: células vazias e "A jogar"', () => {
    const [row] = matchesToSheet([match()], { roundLabel: rodada, unit: 'atleta' }).rows
    expect(row[2]).toBeNull()
    expect(row[4]).toBeNull()
    expect(row[5]).toBeNull()
    expect(row[7]).toBe('A jogar')
  })

  it('o número do jogo recomeça a cada rodada', () => {
    const sheet = matchesToSheet(
      [match(), match(), match({ round: 2 }), match({ round: 2 })],
      { roundLabel: rodada, unit: 'atleta' },
    )
    expect(sheet.rows.map((r) => [r[0], r[1]])).toEqual([
      ['Rodada 1', 1], ['Rodada 1', 2], ['Rodada 2', 1], ['Rodada 2', 2],
    ])
  })

  it('fase de grupos: grupo na rodada e numeração separada por grupo', () => {
    const sheet = matchesToSheet(
      [match({ group_label: 'A' }), match({ group_label: 'B' }), match({ group_label: 'A' })],
      { roundLabel: rodada, unit: 'dupla' },
    )
    expect(sheet.rows.map((r) => [r[0], r[1]])).toEqual([
      ['Grupo A · Rodada 1', 1], ['Grupo B · Rodada 1', 1], ['Grupo A · Rodada 1', 2],
    ])
  })

  it('individual chama o lado de atleta; esporte coletivo, de time', () => {
    const solo = match({ side1: ['Ana'], side2: ['Bia'] })
    expect(matchesToSheet([solo], { roundLabel: rodada, unit: 'atleta' }).columns[3].header).toBe('Atleta 1')
    expect(matchesToSheet([solo], { roundLabel: rodada, unit: 'time' }).columns[6].header).toBe('Time 2')
  })

  it('lado ainda sem ninguém (chave à espera do vencedor) sai como "A definir"', () => {
    const [row] = matchesToSheet(
      [match({ side2: [null, null] })],
      { roundLabel: rodada, unit: 'dupla' },
    ).rows
    expect(row[6]).toBe('A definir')
  })
})
