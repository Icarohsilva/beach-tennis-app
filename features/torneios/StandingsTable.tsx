// features/torneios/StandingsTable.tsx
import Link from 'next/link'
import type { StandingRow } from '@/types'
import { PlayerAvatar } from './PlayerAvatar'
import { cn } from '@/lib/utils/cn'

interface StandingsTableProps {
  rows: StandingRow[]
  nameById: Record<string, string>
  /** Destaca a linha deste jogador (ex: o aluno logado). */
  highlightId?: string
  /**
   * Nome vira link para o retrospecto do atleta. Fica de fora no painel do
   * admin, que navega dentro do próprio painel.
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
    <div className="overflow-hidden rounded-xl border border-surface-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-surface text-[11px] uppercase tracking-wide text-slate-400">
            <th className="w-10 px-3 py-2.5 text-center font-semibold">#</th>
            <th className="px-3 py-2.5 text-left font-semibold">Jogador</th>
            <th className="px-2 py-2.5 text-center font-semibold" title="Jogos">J</th>
            <th className="px-2 py-2.5 text-center font-semibold" title="Vitórias">V</th>
            <th className="px-2 py-2.5 text-center font-semibold">Games</th>
            <th className="px-3 py-2.5 text-center font-semibold">Saldo</th>
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
                <td className="px-3 py-2.5 text-center">
                  {i < 3 ? (
                    <span className="text-base">{MEDALS[i]}</span>
                  ) : (
                    <span className="text-sm font-semibold text-slate-400">{i + 1}</span>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <PlayerAvatar
                      name={name}
                      tone={isMe ? 'brand' : i < 3 ? 'gold' : 'slate'}
                      size="sm"
                    />
                    {linkToProfile ? (
                      <Link
                        href={`/torneios/atleta/${r.playerId}`}
                        className="truncate font-medium text-white underline-offset-2 hover:text-brand-300 hover:underline"
                      >
                        {name}
                      </Link>
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
                <td className="px-2 py-2.5 text-center text-slate-300">{r.played}</td>
                <td className="px-2 py-2.5 text-center font-semibold text-white">{r.wins}</td>
                <td className="whitespace-nowrap px-2 py-2.5 text-center text-slate-400">
                  {r.gamesFor}/{r.gamesAgainst}
                </td>
                <td
                  className={cn(
                    'px-3 py-2.5 text-center font-bold',
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
