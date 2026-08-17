// features/liga/SeasonHistory.tsx
import { Crown, History } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { DIVISION_LABEL } from '@/lib/liga/labels'
import { cn } from '@/lib/utils/cn'
import { DIVISION_THEME } from './divisionTheme'
import type { SeasonHistoryRow } from './queries'

interface Props {
  rows: SeasonHistoryRow[]
}

const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

/**
 * Mês da temporada a partir do `starts_on`.
 *
 * Fatiado da string, não passado por `new Date()`: 'YYYY-MM-DD' é interpretado como UTC
 * e num servidor a oeste vira o dia 30 do mês anterior — a temporada de agosto
 * apareceria como julho.
 */
function labelDaTemporada(startsOn: string): string {
  const [ano, mes] = startsOn.split('-').map(Number)
  const nome = MESES[mes - 1] ?? startsOn
  const anoAtual = new Date().getFullYear()
  return ano === anoAtual ? nome : `${nome} de ${ano}`
}

/**
 * O que já aconteceu nas temporadas fechadas.
 *
 * Existe porque, sem isto, virar o mês apagava tudo: o ranking sumia da tela e não
 * sobrava registro de onde o aluno chegou nem de quem ganhou. A medalha é permanente,
 * mas não guarda posição nem divisão.
 *
 * Não renderiza nada quando não há temporada fechada — academia no primeiro mês não
 * precisa ver um card vazio prometendo passado.
 */
export function SeasonHistory({ rows }: Props) {
  if (rows.length === 0) return null

  return (
    <Card>
      <p className="mb-3 flex items-center gap-1.5 text-xs tracking-wide text-slate-400">
        <History className="h-3.5 w-3.5" />
        TEMPORADAS ANTERIORES
      </p>

      <ul className="space-y-2">
        {rows.map((row) => {
          const theme = row.me ? DIVISION_THEME[row.me.division] : null
          return (
            <li
              key={row.seasonId}
              className="flex items-start justify-between gap-2 rounded-xl border border-surface-border bg-surface/50 px-3 py-2"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-white">
                  {labelDaTemporada(row.startsOn)}
                </span>
                {/* Sem truncate: em 320px um nome comprido comia a divisão do campeão,
                    que é metade da informação. Quebrar em duas linhas custa menos. */}
                {row.champion ? (
                  <span className="mt-0.5 flex items-start gap-1 text-[11px] text-slate-400">
                    <Crown className="mt-0.5 h-3 w-3 shrink-0 text-yellow-400" />
                    <span className="min-w-0">
                      {row.champion.name}
                      <span className="text-slate-500">
                        {' · '}
                        {DIVISION_LABEL[row.champion.division].replace('Divisão ', '')}
                      </span>
                    </span>
                  </span>
                ) : (
                  <span className="mt-0.5 block text-[11px] text-slate-500">
                    Ninguém pontuou nesta modalidade
                  </span>
                )}
              </span>

              {row.me ? (
                <span className="shrink-0 text-right">
                  <span className={cn('block text-sm font-bold tabular-nums', theme?.solid)}>
                    {row.me.position}º
                  </span>
                  <span className="block text-[10px] text-slate-500">
                    {DIVISION_LABEL[row.me.division].replace('Divisão ', '')} · {row.me.points} pts
                  </span>
                </span>
              ) : (
                <span className="shrink-0 text-[10px] text-slate-600">você não disputou</span>
              )}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
