// components/ui/SectionHeader.tsx
import Link from 'next/link'

interface SectionHeaderProps {
  title: string
  href?: string
  linkLabel?: string
}

export function SectionHeader({ title, href, linkLabel = 'ver todos' }: SectionHeaderProps) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h2 className="text-sm font-extrabold uppercase tracking-wide text-white">{title}</h2>
      {href && (
        <Link href={href} className="text-xs text-brand-500 hover:text-brand-400 transition-colors">
          {linkLabel} →
        </Link>
      )}
    </div>
  )
}
