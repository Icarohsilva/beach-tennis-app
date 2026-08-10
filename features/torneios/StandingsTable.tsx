// features/torneios/StandingsTable.tsx
import type { StandingRow } from '@/types'
import { PlayerAvatar } from './PlayerAvatar'
import { ParticipantName } from './ParticipantName'
import { cn } from '@/lib/utils/cn'

interface StandingsTableProps {
  rows: StandingRow[]
  nameById: Record<string, string>
  /** Destaca a linha deste jogador (ex: o aluno logado). */
  highlightId?: string
  /**
   * Nome abre a ficha do inscrito (contato + campanha). Exige estar dentro de
   * um ParticipantModalProvider; sem ele o clique não faz nada.
   */
  linkToProfile?: boolean
}

const MEDALS = ['🥇', '🥈', '🥉']

export function StandingsTable({
  rows,
  nameById,
  highlightId,
  linkToProfile,
}: StandingsTableProps) {
  if (rows.length === 0) {
    return <p className="text-slate-400 text-sm">Sem classificação ainda.</p>
  }

  return (
    /* table-fixed + max-w-0 na célula do nome: numa tabela auto-layout o
       `truncate` do nome (que implica white-space:nowrap) fazia o nome INTEIRO
       contar para a largura mínima da tabela. As reticências nunca apareciam, a
       tabela crescia além do card e o `overflow-hidden` amputava Games e Saldo em
       silêncio — um "Maria Fernanda Albuquerque" bastava. Com largura fixa o
       truncate volta a funcionar e nenhuma coluna sai da tela. "Games" sai em tela
       estreita: é a coluna que o Saldo já resume, e são os ~48px que devolvem
       espaço legível ao nome. */
    <div className="overflow-hidden rounded-xl border border-surface-border">
      <table className="w-full table-fixed text-sm">
        <thead>
          <tr className="bg-surface text-[11px] uppercase tracking-wide text-slate-400">
            <th className="w-8 px-2 py-2.5 text-center font-semibold xs:w-10 xs:px-3">#</th>
            <th className="px-2 py-2.5 text-left font-semibold xs:px-3">Jogador</th>
            <th className="w-8 px-1 py-2.5 text-center font-semibold" title="Jogos">J</th>
            <th className="w-8 px-1 py-2.5 text-center font-semibold" title="Vitórias">V</th>
            <th className="hidden w-14 px-2 py-2.5 text-center font-semibold xs:table-cell">
              Games
            </th>
            <th className="w-12 px-2 py-2.5 text-center font-semibold xs:w-14 xs:px-3">Saldo</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const isMe = !!highlightId && r.playerId === highlightId
            const name = nameById[r.playerId] ?? 'Jogador'
            return (
              <tr
                key={r.playerId}
                className={cn(
                  'border-t border-surface-border',
                  isMe ? 'bg-brand-500/10' : i % 2 === 0 ? 'bg-surface-card' : 'bg-surface-card/40',
                )}
              >
                <td className="px-2 py-2.5 text-center xs:px-3">
                  {i < 3 ? (
                    <span className="text-base">{MEDALS[i]}</span>
                  ) : (
                    <span className="text-sm font-semibold text-slate-400">{i + 1}</span>
                  )}
                </td>
                <td className="max-w-0 px-2 py-2.5 xs:px-3">
                  <div className="flex min-w-0 items-center gap-2 xs:gap-2.5">
                    <PlayerAvatar
                      name={name}
                      tone={isMe ? 'brand' : i < 3 ? 'gold' : 'slate'}
                      size="sm"
                    />
                    {linkToProfile ? (
                      <ParticipantName
                        playerId={r.playerId}
                        name={name}
                        className="font-medium text-white"
                      />
                    ) : (
                      <span className="truncate font-medium text-white">{name}</span>
                    )}
                    {isMe && (
                      <span className="shrink-0 rounded bg-brand-500 px-1.5 py-0.5 text-[10px] font-bold text-surface">
                        Você
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-1 py-2.5 text-center text-slate-300">{r.played}</td>
                <td className="px-1 py-2.5 text-center font-semibold text-white">{r.wins}</td>
                <td className="hidden whitespace-nowrap px-2 py-2.5 text-center text-slate-400 xs:table-cell">
                  {r.gamesFor}/{r.gamesAgainst}
                </td>
                <td
                  className={cn(
                    'px-2 py-2.5 text-center font-bold xs:px-3',
                    r.diff > 0 ? 'text-emerald-400' : r.diff < 0 ? 'text-red-400' : 'text-slate-300',
                  )}
                >
                  {r.diff > 0 ? `+${r.diff}` : r.diff}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
