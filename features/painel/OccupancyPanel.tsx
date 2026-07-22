// features/painel/OccupancyPanel.tsx
import { ProgressRing } from '@/components/ui/ProgressRing'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'

interface OccupancyPanelProps {
  booked: number
  capacity: number
  fullest?: { name: string; booked: number; capacity: number } | null
  emptiest?: { name: string; booked: number; capacity: number } | null
}

/**
 * Quanto das vagas do dia já está preenchido, com as turmas nos dois extremos.
 * Um número só resume o dia; os extremos dizem onde agir.
 */
export function OccupancyPanel({ booked, capacity, fullest, emptiest }: OccupancyPanelProps) {
  const pct = capacity > 0 ? Math.round((booked / capacity) * 100) : 0

  return (
    <div className="glass rounded-2xl border border-white/[0.07] p-4">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
        Ocupação de hoje
      </p>

      <div className="mt-3 flex items-center gap-4">
        <ProgressRing percent={pct} size={72} strokeWidth={6}>
          <span className="text-base font-extrabold text-white">
            <AnimatedNumber value={pct} suffix="%" />
          </span>
        </ProgressRing>

        <div className="min-w-0">
          <p className="text-2xl font-extrabold leading-none text-white">
            <AnimatedNumber value={booked} />
            <span className="text-base font-bold text-slate-500"> / {capacity}</span>
          </p>
          <p className="mt-1 text-xs text-slate-400">lugares preenchidos hoje</p>
        </div>
      </div>

      {(fullest || emptiest) && (
        <dl className="mt-4 space-y-2 border-t border-white/[0.07] pt-3">
          {fullest && (
            <div className="flex items-baseline justify-between gap-2">
              <dt className="text-xs text-slate-400">Mais cheia</dt>
              <dd className="min-w-0 truncate text-xs font-semibold text-white">
                {fullest.name}{' '}
                <span className="font-normal text-slate-400">
                  {fullest.booked}/{fullest.capacity}
                </span>
              </dd>
            </div>
          )}
          {emptiest && (
            <div className="flex items-baseline justify-between gap-2">
              <dt className="text-xs text-slate-400">Mais vazia</dt>
              <dd className="min-w-0 truncate text-xs font-semibold text-white">
                {emptiest.name}{' '}
                <span className="font-normal text-slate-400">
                  {emptiest.booked}/{emptiest.capacity}
                </span>
              </dd>
            </div>
          )}
        </dl>
      )}
    </div>
  )
}
