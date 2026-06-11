// components/ui/EmptyState.tsx
import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import { Card } from './Card'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description?: string
  ctaHref?: string
  ctaLabel?: string
}

export function EmptyState({ icon: Icon, title, description, ctaHref, ctaLabel }: EmptyStateProps) {
  return (
    <Card className="flex flex-col items-center text-center py-8">
      <Icon className="h-8 w-8 text-slate-600 mb-3" />
      <p className="text-sm font-semibold text-white">{title}</p>
      {description && <p className="text-xs text-slate-400 mt-1 max-w-[240px]">{description}</p>}
      {ctaHref && ctaLabel && (
        <Link
          href={ctaHref}
          className="mt-4 inline-flex items-center rounded-lg bg-gradient-to-r from-brand-600 to-brand-700 px-4 py-2 text-sm font-semibold text-white hover:from-brand-500 hover:to-brand-600 transition-all active:scale-[0.98]"
        >
          {ctaLabel}
        </Link>
      )}
    </Card>
  )
}
