// features/super-admin/HealthPill.tsx
import { cn } from '@/lib/utils/cn'
import { HEALTH_LABEL, type HealthTier } from '@/lib/superAdmin/metrics'

const TIER_STYLE: Record<HealthTier, string> = {
  saudavel: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
  atencao: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
  risco: 'bg-red-500/15 text-red-300 ring-red-500/30',
}

/**
 * Selo de saúde da conta. Mostra a faixa E o número: a faixa dá a leitura de
 * relance, o número diferencia dois "atenção" que não são iguais.
 */
export function HealthPill({
  tier,
  score,
  className,
}: {
  tier: HealthTier
  score: number
  className?: string
}) {
  return (
    <span
      title={`Health ${score}/100`}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-bold ring-1 ring-inset',
        TIER_STYLE[tier],
        className,
      )}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
      {HEALTH_LABEL[tier]}
      <span className="font-mono text-[10px] opacity-70">{score}</span>
    </span>
  )
}
