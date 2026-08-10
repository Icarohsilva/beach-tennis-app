// components/ui/CheckinProgressCard.tsx
import { Card } from '@/components/ui/Card'
import type { CheckinProgress } from '@/lib/checkin/progress'

export function CheckinProgressCard({
  partner,
  progress,
}: {
  partner: 'wellhub' | 'totalpass'
  progress: CheckinProgress
}) {
  const label = partner === 'wellhub' ? 'Wellhub' : 'TotalPass'
  const pct = progress.target > 0 ? Math.min((progress.done / progress.target) * 100, 100) : 0

  return (
    <Card>
      {/* gap + shrink-0: "Check-ins do mês · TotalPass" pede ~190px e o contador
          ~52px; sem folga entre os dois eles encostavam em tela estreita. */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="min-w-0 text-sm font-semibold text-white">Check-ins do mês · {label}</p>
        <span className="shrink-0 whitespace-nowrap text-sm text-slate-400">
          {progress.done}
          {progress.target > 0 ? ` / ${progress.target}` : ''}
        </span>
      </div>
      {progress.target > 0 && (
        <div className="h-2 w-full rounded-full bg-surface-border overflow-hidden">
          <div className="h-full bg-brand-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
      )}
      {progress.target > 0 && progress.remaining > 0 && (
        <p className="text-xs text-slate-400 mt-2">Faltam {progress.remaining} para a meta.</p>
      )}
      {progress.target > 0 && progress.remaining === 0 && (
        <p className="text-xs text-green-400 mt-2">Meta do mês alcançada!</p>
      )}
    </Card>
  )
}
