// features/torneios/StandingsTable.tsx
import type { StandingRow } from '@/types'

interface StandingsTableProps {
  rows: StandingRow[]
  nameById: Record<string, string>
}

export function StandingsTable({ rows, nameById }: StandingsTableProps) {
  if (rows.length === 0) {
    return <p className="text-slate-400 text-sm">Sem classificação ainda.</p>
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-surface-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-surface-card text-slate-400 text-xs uppercase tracking-wide">
            <th className="px-3 py-2 text-left">#</th>
            <th className="px-3 py-2 text-left">Jogador</th>
            <th className="px-3 py-2 text-center">J</th>
            <th className="px-3 py-2 text-center">V</th>
            <th className="px-3 py-2 text-center">Games</th>
            <th className="px-3 py-2 text-center">Saldo</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.playerId} className="border-t border-surface-border">
              <td className="px-3 py-2 text-slate-400">{i + 1}</td>
              <td className="px-3 py-2 text-white">{nameById[r.playerId] ?? r.playerId}</td>
              <td className="px-3 py-2 text-center text-slate-300">{r.played}</td>
              <td className="px-3 py-2 text-center text-slate-300">{r.wins}</td>
              <td className="px-3 py-2 text-center text-slate-400">
                {r.gamesFor}/{r.gamesAgainst}
              </td>
              <td
                className={`px-3 py-2 text-center font-semibold ${
                  r.diff > 0 ? 'text-green-400' : r.diff < 0 ? 'text-red-400' : 'text-slate-300'
                }`}
              >
                {r.diff > 0 ? `+${r.diff}` : r.diff}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
