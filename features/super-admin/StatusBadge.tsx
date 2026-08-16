// features/super-admin/StatusBadge.tsx
import { cn } from '@/lib/utils/cn'
import { SUB_STATUS_LABEL, type SubStatus } from '@/lib/superAdmin/metrics'

const STATUS_STYLE: Record<SubStatus, string> = {
  active: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
  trialing: 'bg-sky-500/15 text-sky-300 ring-sky-500/30',
  past_due: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
  canceled: 'bg-slate-500/15 text-slate-400 ring-slate-500/30',
  none: 'bg-red-500/15 text-red-300 ring-red-500/30',
}

/** Estado da assinatura da academia com a plataforma. */
export function StatusBadge({
  status,
  comped,
  className,
}: {
  status: SubStatus
  comped?: boolean
  className?: string
}) {
  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      <span
        className={cn(
          'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold ring-1 ring-inset',
          STATUS_STYLE[status],
        )}
      >
        {SUB_STATUS_LABEL[status]}
      </span>
      {comped && (
        <span
          title="Conta cortesia — não entra no MRR"
          className="inline-flex items-center rounded-full bg-violet-500/15 px-2 py-0.5 text-xs font-bold text-violet-300 ring-1 ring-inset ring-violet-500/30"
        >
          Cortesia
        </span>
      )}
    </span>
  )
}
