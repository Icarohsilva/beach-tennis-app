// components/ui/Skeleton.tsx
import { cn } from '@/lib/utils/cn'

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-xl bg-surface-card', className)} />
}

/** Página de loading padrão: header + 3 cards. */
export function PageSkeleton() {
  return (
    <div className="p-4 space-y-4 pb-24">
      <Skeleton className="h-24" />
      <Skeleton className="h-20" />
      <Skeleton className="h-20" />
      <Skeleton className="h-20" />
    </div>
  )
}
