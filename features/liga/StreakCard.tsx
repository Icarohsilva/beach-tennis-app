// features/liga/StreakCard.tsx
import { Flame } from 'lucide-react'
import { Card } from '@/components/ui/Card'

interface Props {
  streakWeeks: number
}

export function StreakCard({ streakWeeks }: Props) {
  return (
    <Card>
      <div className="flex items-center gap-3">
        <Flame className="h-5 w-5 text-brand-500 shrink-0" />
        <div className="min-w-0">
          <p className="text-lg font-semibold text-white leading-tight">
            {streakWeeks} {streakWeeks === 1 ? 'semana' : 'semanas'}
          </p>
          <p className="text-xs text-slate-400">
            {streakWeeks === 0
              ? 'Treine essa semana para começar sua sequência'
              : 'seguidas treinando, não perca o ritmo'}
          </p>
        </div>
      </div>
    </Card>
  )
}
