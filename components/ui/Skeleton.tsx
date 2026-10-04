// components/ui/Skeleton.tsx
import { cn } from '@/lib/utils/cn'
import { PageLoading } from './PageLoading'

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-xl bg-surface-card', className)} />
}

/**
 * Página de loading padrão da área do aluno. Mantido como atalho: hoje é o
 * PageLoading (com o "Carregando…" escrito) na variante do aluno.
 */
export function PageSkeleton() {
  return <PageLoading variant="dashboard" />
}
