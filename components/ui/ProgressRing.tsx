// components/ui/ProgressRing.tsx
import { cn } from '@/lib/utils/cn'

interface ProgressRingProps {
  /** 0–100. */
  percent: number
  size?: number
  strokeWidth?: number
  /** Conteúdo no miolo do anel (número, ícone). */
  children?: React.ReactNode
  className?: string
}

/**
 * Anel de progresso em SVG. O traço usa a cor da marca da academia; o trilho
 * fica num branco quase transparente para não competir com o card.
 */
export function ProgressRing({
  percent,
  size = 56,
  strokeWidth = 5,
  children,
  className,
}: ProgressRingProps) {
  const clamped = Math.max(0, Math.min(100, percent))
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const dash = (clamped / 100) * circumference

  return (
    <div className={cn('relative shrink-0', className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          className="stroke-white/[0.08]"
        />
        {/* Em 0% o traço é omitido: a ponta arredondada deixaria um ponto solto. */}
        {clamped > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circumference}`}
            className="stroke-brand-500 transition-[stroke-dasharray] duration-700 ease-out"
          />
        )}
      </svg>
      {children && (
        <div className="absolute inset-0 flex items-center justify-center">{children}</div>
      )}
    </div>
  )
}
