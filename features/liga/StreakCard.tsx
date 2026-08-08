// features/liga/StreakCard.tsx
import { Flame } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { ProgressRing } from '@/components/ui/ProgressRing'

interface Props {
  streakWeeks: number
}

/** Marcos de sequência que valem medalha (lib/liga/medals.ts). */
const MARCOS = [4, 8, 12, 24]

export function StreakCard({ streakWeeks }: Props) {
  const proximo = MARCOS.find((m) => m > streakWeeks) ?? null
  const anterior = [...MARCOS].reverse().find((m) => m <= streakWeeks) ?? 0
  const percent = proximo
    ? Math.round(((streakWeeks - anterior) / (proximo - anterior)) * 100)
    : 100

  return (
    <Card>
      <div className="flex items-center gap-4">
        <div className="relative">
          {/* Halo pulsante só quando há sequência viva: em zero seria enfeite mentiroso. */}
          {streakWeeks > 0 && (
            <span
              aria-hidden
              className="pulse-halo absolute inset-0 rounded-full bg-brand-500/30"
            />
          )}
          <ProgressRing percent={percent} size={62}>
            <Flame className="h-5 w-5 text-brand-500" />
          </ProgressRing>
        </div>

        <div className="min-w-0">
          <p className="text-2xl font-extrabold leading-none text-white">
            {streakWeeks}
            <span className="ml-1 text-sm font-semibold text-slate-400">
              {streakWeeks === 1 ? 'semana' : 'semanas'}
            </span>
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {streakWeeks === 0
              ? 'Treine essa semana para começar sua sequência'
              : proximo
                ? `Seguidas treinando. Faltam ${proximo - streakWeeks} para a medalha de ${proximo} semanas`
                : 'Seguidas treinando. Você passou de todos os marcos'}
          </p>
        </div>
      </div>
    </Card>
  )
}
