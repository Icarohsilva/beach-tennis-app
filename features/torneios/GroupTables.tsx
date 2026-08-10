// features/torneios/GroupTables.tsx
// As tabelas da fase de grupos, com a linha de corte visível.
//
// Durante a primeira fase a pergunta do aluno não é "quem é o campeão", é "eu
// passo?". Por isso o corte de classificação é desenhado: acima dele estão os
// que avançam agora, e a faixa some quando o mata-mata já saiu.
import Link from 'next/link'
import { cn } from '@/lib/utils/cn'
import type { GroupTable } from '@/lib/torneios/schedule/grupos'
import { PlayerAvatar } from './PlayerAvatar'

interface GroupTablesProps {
  tables: GroupTable[]
  nameById: Record<string, string>
  advancePerGroup: number
  currentUserId?: string
  /** Fase encerrada: o corte vira histórico e para de piscar. */
  settled?: boolean
}

export function GroupTables({
  tables,
  nameById,
  advancePerGroup,
  currentUserId,
  settled,
}: GroupTablesProps) {
  if (tables.length === 0) return null

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {tables.map((table) => {
        // Em dupla fixa a classificação tem uma linha por jogador; a colocação
        // do grupo é a do titular, então o corte conta só quem é titular.
        const titulares = new Set(table.entries.map((e) => e.playerId))
        const rows = table.rows.filter((r) => titulares.has(r.playerId))

        return (
          <div key={table.label} className="overflow-hidden rounded-2xl border border-white/[0.07] bg-surface-card">
            <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2">
              <p className="text-xs font-extrabold uppercase tracking-wide text-white">
                Grupo {table.label}
              </p>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                {rows.length} {rows.length === 1 ? 'inscrito' : 'inscritos'}
              </p>
            </div>

            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface text-[10px] uppercase tracking-wide text-slate-500">
                  <th className="w-8 px-2 py-1.5 text-center font-semibold">#</th>
                  <th className="px-2 py-1.5 text-left font-semibold">Jogador</th>
                  <th className="px-1.5 py-1.5 text-center font-semibold" title="Jogos">J</th>
                  <th className="px-1.5 py-1.5 text-center font-semibold" title="Vitórias">V</th>
                  <th className="px-2 py-1.5 text-center font-semibold">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const isMe = !!currentUserId && row.playerId === currentUserId
                  const qualifies = i < advancePerGroup
                  const isCutLine = i === advancePerGroup - 1 && rows.length > advancePerGroup

                  return (
                    <tr
                      key={row.playerId}
                      className={cn(
                        'border-t border-white/[0.05]',
                        isMe && 'bg-brand-500/10',
                        qualifies && !isMe && 'bg-emerald-500/[0.06]',
                        // A linha de corte é uma borda mais forte embaixo do
                        // último classificado — o "risco" da tabela impressa.
                        isCutLine && 'border-b-2 border-b-emerald-500/40',
                      )}
                    >
                      <td className="px-2 py-1.5 text-center">
                        <span
                          className={cn(
                            'text-xs font-bold',
                            qualifies ? 'text-emerald-300' : 'text-slate-500',
                          )}
                        >
                          {i + 1}
                        </span>
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="flex min-w-0 items-center gap-2">
                          <PlayerAvatar
                            name={nameById[row.playerId] ?? 'Jogador'}
                            tone={isMe ? 'brand' : qualifies ? 'gold' : 'slate'}
                            size="sm"
                          />
                          <Link
                            href={`/torneios/atleta/${row.playerId}`}
                            className="truncate text-xs font-medium text-white underline-offset-2 hover:text-brand-300 hover:underline"
                          >
                            {nameById[row.playerId] ?? 'Jogador'}
                          </Link>
                          {isMe && (
                            <span className="shrink-0 rounded bg-brand-500 px-1 py-0.5 text-[9px] font-bold text-surface">
                              Você
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-1.5 py-1.5 text-center text-xs text-slate-400">{row.played}</td>
                      <td className="px-1.5 py-1.5 text-center text-xs font-semibold text-white">{row.wins}</td>
                      <td
                        className={cn(
                          'px-2 py-1.5 text-center text-xs font-bold',
                          row.diff > 0 ? 'text-emerald-400' : row.diff < 0 ? 'text-red-400' : 'text-slate-300',
                        )}
                      >
                        {row.diff > 0 ? `+${row.diff}` : row.diff}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            {!settled && rows.length > advancePerGroup && (
              <p className="border-t border-white/[0.06] px-3 py-1.5 text-[10px] font-semibold text-emerald-300/80">
                {advancePerGroup === 1 ? 'Passa o líder' : `Passam os ${advancePerGroup} primeiros`}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}
