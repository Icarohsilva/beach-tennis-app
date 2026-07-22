// components/ui/OccupancyBar.tsx
import { cn } from '@/lib/utils/cn'
import { occupancyLevel } from '@/lib/utils/agenda'

interface OccupancyBarProps {
  booked: number
  capacity: number
  /** Ordem na cascata — a barra cresce junto com o bloco que a contém. */
  step?: number
  className?: string
}

const FILL: Record<ReturnType<typeof occupancyLevel>, string> = {
  low: 'bg-brand-800',
  mid: 'bg-brand-600',
  high: 'bg-brand-400',
}

/**
 * Quanto da turma já está preenchido. É uma grandeza, não um estado: usa um só
 * matiz (o da marca) escurecendo→clareando conforme enche. O rótulo textual ao
 * lado carrega o número, então a leitura nunca depende só da cor.
 */
export function OccupancyBar({ booked, capacity, step = 0, className }: OccupancyBarProps) {
  const pct = capacity > 0 ? Math.min(Math.round((booked / capacity) * 100), 100) : 0

  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]', className)}>
      <div
        className={cn('bar-grow h-full rounded-full', FILL[occupancyLevel(booked, capacity)])}
        style={{ width: `${pct}%`, '--reveal-delay': `${step * 70 + 120}ms` } as React.CSSProperties}
      />
    </div>
  )
}
