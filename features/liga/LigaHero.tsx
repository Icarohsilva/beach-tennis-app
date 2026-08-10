// features/liga/LigaHero.tsx
// Cabeçalho da Liga: divisão, pontos, posição e o quanto falta para subir.
//
// Mesma gramática do HeroHeader da home (gradiente + malha + sheen), mas colorido
// pela DIVISÃO, não pela marca: é o que faz subir de divisão parecer uma mudança de
// patamar em vez de um rótulo trocado.
import { Flame } from 'lucide-react'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { MedalIcon } from './MedalIcon'
import { DIVISION_THEME, DIVISION_ICON } from './divisionTheme'
import { sportLabel, sportEmoji } from '@/lib/arenas/sports'
import { cn } from '@/lib/utils/cn'
import type { LigaDivision } from '@/types'

interface Props {
  division: LigaDivision
  points: number
  position: number
  divisionSize: number
  pointsToPromote: number | null
  streakWeeks: number
  sport: string
  endsOn: string
  /** Quantos sobem por temporada — define a "zona de promoção". */
  promoteCount: number
}

/** Dias restantes até o fim da temporada, pelo relógio do servidor. */
function daysLeft(endsOn: string): number {
  const end = new Date(`${endsOn}T23:59:59`)
  return Math.max(0, Math.ceil((end.getTime() - Date.now()) / 86400000))
}

export function LigaHero({
  division,
  points,
  position,
  divisionSize,
  pointsToPromote,
  streakWeeks,
  sport,
  endsOn,
  promoteCount,
}: Props) {
  const theme = DIVISION_THEME[division]
  const dias = daysLeft(endsOn)
  const naZona = pointsToPromote === null && division !== 'diamante'
  const progress =
    pointsToPromote === null
      ? 100
      : Math.min(100, Math.round((points / Math.max(1, points + pointsToPromote)) * 100))

  return (
    <div
      className={cn(
        'sheen relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br p-5 shadow-[0_24px_60px_-30px_rgb(0_0_0/0.9)]',
        theme.gradient,
      )}
    >
      {/* Malha técnica e clarão: mesma textura do hero da home. */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.15] [background-image:linear-gradient(rgb(255_255_255/0.5)_1px,transparent_1px),linear-gradient(90deg,rgb(255_255_255/0.5)_1px,transparent_1px)] [background-size:24px_24px]"
      />
      <div
        aria-hidden
        className="absolute -right-16 -top-20 h-52 w-52 rounded-full bg-white/25 blur-3xl"
      />

      <div className="relative">
        {/* Em 320px sobravam ~136px para dividir entre a divisão ("Diamante",
            ~76px) e o bloco de pontos (4 dígitos em 30px, ~76px): eles se
            encontravam no meio e a linha do esporte quebrava em 3-4 linhas. O bloco
            de pontos ganha shrink-0 (não pode ser comprimido), a divisão truncate, e
            a linha do esporte não quebra no meio de "1º de 12". */}
        <div className="flex items-start gap-2 xs:gap-3">
          <div
            className={cn(
              'flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border backdrop-blur-sm xs:h-14 xs:w-14',
              theme.ring,
            )}
          >
            <MedalIcon name={DIVISION_ICON[division]} className="h-6 w-6 text-white xs:h-7 xs:w-7" />
          </div>

          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-extrabold leading-tight text-white">{theme.label}</p>
            <p className={cn('text-xs', theme.accent)}>
              <span className="whitespace-nowrap">
                {sportEmoji(sport)} {sportLabel(sport)}
              </span>{' '}
              · <span className="whitespace-nowrap">{position}º de {divisionSize}</span>
            </p>
          </div>

          <div className="shrink-0 text-right">
            <p className="text-2xl font-extrabold leading-none text-white xs:text-3xl">
              <AnimatedNumber value={points} />
            </p>
            <p className={cn('text-[10px] font-bold uppercase tracking-[0.12em]', theme.accent)}>
              pontos
            </p>
          </div>
        </div>

        {/* Barra: o quanto falta para entrar na zona que sobe. */}
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-black/30">
          <div
            className="bar-grow h-full rounded-full bg-white/90"
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-white">
            {division === 'diamante'
              ? 'Você está no topo da escada'
              : naZona
                ? `Na zona de promoção: os ${promoteCount} primeiros sobem`
                : `Faltam ${pointsToPromote} ${pointsToPromote === 1 ? 'ponto' : 'pontos'} para subir`}
          </p>
          <span
            className={cn(
              'shrink-0 rounded-full border border-white/20 bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm',
            )}
          >
            {dias === 0 ? 'último dia' : `${dias} ${dias === 1 ? 'dia' : 'dias'}`}
          </span>
        </div>

        {streakWeeks > 0 && (
          <div className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-2.5 py-1 backdrop-blur-sm">
            <Flame className="h-3.5 w-3.5 text-white" />
            <span className="text-xs font-semibold text-white">
              {streakWeeks} {streakWeeks === 1 ? 'semana seguida' : 'semanas seguidas'}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
