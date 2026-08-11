// features/liga/DivisionRanking.tsx
import { ChevronUp, ChevronDown } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { PlayerAvatar } from '@/features/torneios/PlayerAvatar'
import { cn } from '@/lib/utils/cn'
import { DIVISION_THEME } from './divisionTheme'
import type { RankingEntry } from './queries'
import type { LigaDivision } from '@/types'

interface Props {
  entries: RankingEntry[]
  division: LigaDivision
  divisionSize: number
  /** Quantos sobem desta divisão (0 = ninguém). */
  promoteCount: number
  /** Primeira posição que desce; acima do tamanho da divisão significa que ninguém desce. */
  demoteFrom: number
}

type Zone = 'promocao' | 'rebaixamento' | null

/**
 * Ranking da divisão com as zonas marcadas.
 *
 * As faixas de promoção e rebaixamento são o motor da coisa: sem elas o aluno vê uma
 * lista e não sabe o que está em jogo. Com elas, cada linha responde "estou subindo ou
 * caindo?" — que é a pergunta que faz ele voltar amanhã.
 */
export function DivisionRanking({
  entries,
  division,
  divisionSize,
  promoteCount,
  demoteFrom,
}: Props) {
  if (entries.length === 0) {
    return (
      <Card>
        <p className="text-xs text-slate-400 tracking-wide mb-2">RANKING DA DIVISÃO</p>
        <p className="text-sm text-slate-300">
          Ninguém pontuou nessa modalidade ainda. Sua próxima aula já abre o ranking.
        </p>
      </Card>
    )
  }

  // Os cortes já chegam resolvidos pela divisão (o teto não promove, o piso não
  // rebaixa) — aqui é só desenhar.
  const promotes = promoteCount > 0
  const demotes = demoteFrom <= divisionSize

  const zoneOf = (position: number): Zone => {
    if (promotes && position <= promoteCount) return 'promocao'
    if (demotes && position >= demoteFrom) return 'rebaixamento'
    return null
  }

  const podium = entries.filter((e) => e.position <= 3)
  const theme = DIVISION_THEME[division]

  return (
    <Card className="overflow-hidden">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs tracking-wide text-slate-400">RANKING DA DIVISÃO</p>
        <div className="flex items-center gap-2 text-[10px]">
          {promotes && (
            <span className="inline-flex items-center gap-0.5 text-emerald-400">
              <ChevronUp className="h-3 w-3" />
              sobe
            </span>
          )}
          {demotes && (
            <span className="inline-flex items-center gap-0.5 text-rose-400">
              <ChevronDown className="h-3 w-3" />
              desce
            </span>
          )}
        </div>
      </div>

      {/* Pódio: os três primeiros ganham corpo, o resto é lista. */}
      {podium.length >= 3 && (
        <ul className="mb-4 grid grid-cols-3 items-end gap-1.5 xs:gap-2">
          {[podium[1], podium[0], podium[2]].map((e, i) => {
            const place = i === 1 ? 1 : i === 0 ? 2 : 3
            return (
              <li
                key={e.studentId}
                className={cn(
                  'flex min-w-0 flex-col items-center gap-1 rounded-2xl border px-1.5 pb-2 pt-3 text-center xs:px-2',
                  place === 1
                    ? 'border-yellow-400/40 bg-yellow-400/10 pt-4'
                    : 'border-surface-border bg-surface/50',
                  e.isMe && 'ring-1 ring-brand-500',
                )}
              >
                <PlayerAvatar
                  name={e.fullName}
                  tone={place === 1 ? 'gold' : e.isMe ? 'brand' : 'slate'}
                />
                <span className="w-full truncate text-[11px] font-medium text-slate-200">
                  {e.isMe ? 'Você' : e.fullName.split(' ')[0]}
                </span>
                <span className={cn('text-xs font-bold', place === 1 ? 'text-yellow-300' : theme.solid)}>
                  {e.points}
                </span>
                <span className="text-[10px] text-slate-500">{place}º</span>
              </li>
            )
          })}
        </ul>
      )}

      <ul className="-mx-4">
        {entries.map((e, index) => {
          const zone = zoneOf(e.position)
          const previousZone = index > 0 ? zoneOf(entries[index - 1].position) : 'inicio'
          const abreRebaixamento = zone === 'rebaixamento' && previousZone !== 'rebaixamento'
          const fechaPromocao = zone !== 'promocao' && previousZone === 'promocao'

          return (
            <li key={e.studentId}>
              {/* Linhas de corte: onde a temporada realmente separa quem sobe de quem cai. */}
              {fechaPromocao && (
                <p className="mb-1 mt-1 px-4 text-[10px] font-semibold uppercase tracking-wider text-emerald-400/70">
                  ── linha de promoção ──
                </p>
              )}
              {abreRebaixamento && (
                <p className="mb-1 mt-1 px-4 text-[10px] font-semibold uppercase tracking-wider text-rose-400/70">
                  ── zona de rebaixamento ──
                </p>
              )}

              <div
                className={cn(
                  'flex items-center gap-2.5 border-l-2 px-4 py-1.5',
                  zone === 'promocao' && 'border-l-emerald-500/70 bg-emerald-500/[0.06]',
                  zone === 'rebaixamento' && 'border-l-rose-500/60 bg-rose-500/[0.06]',
                  !zone && 'border-l-transparent',
                  e.isMe && 'bg-brand-500/10 border-l-brand-500',
                )}
              >
                <span
                  className={cn(
                    'w-5 text-right text-xs tabular-nums',
                    e.isMe ? 'font-bold text-brand-500' : 'text-slate-500',
                  )}
                >
                  {e.position}
                </span>
                <PlayerAvatar name={e.fullName} size="sm" tone={e.isMe ? 'brand' : 'slate'} />
                <span
                  className={cn(
                    'min-w-0 flex-1 truncate text-sm',
                    e.isMe ? 'font-semibold text-white' : 'text-slate-200',
                  )}
                >
                  {e.isMe ? 'Você' : e.fullName}
                </span>
                <span
                  className={cn(
                    'text-xs tabular-nums',
                    e.isMe ? 'font-bold text-brand-500' : 'text-slate-400',
                  )}
                >
                  {e.points}
                </span>
              </div>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
