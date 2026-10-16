// lib/torneios/matchExport.ts
// Os confrontos como planilha — o que o admin imprime, leva para a quadra ou
// manda no grupo do torneio. Mesma ordem e mesmos nomes de rodada da tela.
import type { XlsxCell, XlsxSheet } from '@/lib/utils/xlsx'
import type { CompetitorUnit } from './sportProfile'
import { teamLabel } from './display'
import { isoToBrtLocalInput } from './matchTime'

export interface ExportableMatch {
  round: number
  group_label: string | null
  played_at: string | null
  games1: number | null
  games2: number | null
  result_status: string | null
  side1: (string | null | undefined)[]
  side2: (string | null | undefined)[]
}

const SITUACAO: Record<string, string> = {
  confirmed: 'Confirmado',
  pending: 'Aguardando confirmação',
}

export function matchesToSheet(
  matches: ExportableMatch[],
  opts: {
    roundLabel: (round: number, group: string | null) => string
    unit: CompetitorUnit
  },
): XlsxSheet {
  // O Super inscreve atletas mas joga em dupla, então o que cada lado É sai
  // dos confrontos, não da unidade de inscrição.
  const paired = matches.some((m) => m.side1.filter(Boolean).length > 1 || m.side2.filter(Boolean).length > 1)
  const side = paired ? 'Dupla' : opts.unit === 'time' ? 'Time' : 'Atleta'

  // Jogo 1, 2, 3 dentro da rodada (e do grupo), na ordem da tela. Não é o
  // match_no: na eliminatória ele é coordenada da chave e pula o jogo do bye.
  const jogos = new Map<string, number>()
  const rows: XlsxCell[][] = matches.map((m) => {
    const key = `${m.group_label ?? ''}|${m.round}`
    const jogo = (jogos.get(key) ?? 0) + 1
    jogos.set(key, jogo)
    const rodada = opts.roundLabel(m.round, m.group_label)
    const local = m.played_at ? isoToBrtLocalInput(m.played_at) : ''
    return [
      m.group_label ? `Grupo ${m.group_label} · ${rodada}` : rodada,
      jogo,
      local ? { dateTime: local } : null,
      teamLabel(m.side1),
      m.games1,
      m.games2,
      teamLabel(m.side2),
      SITUACAO[m.result_status ?? ''] ?? 'A jogar',
    ]
  })

  return {
    name: 'Confrontos',
    columns: [
      { header: 'Rodada', width: 20 },
      { header: 'Jogo', width: 7, align: 'center' },
      { header: 'Data e hora', width: 17 },
      { header: `${side} 1`, width: 42 },
      { header: 'Placar 1', width: 9, align: 'center' },
      { header: 'Placar 2', width: 9, align: 'center' },
      { header: `${side} 2`, width: 42 },
      { header: 'Situação', width: 24 },
    ],
    rows,
  }
}
