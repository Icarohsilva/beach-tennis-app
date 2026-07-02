// features/torneios/PlayerAvatar.tsx
// Avatar de iniciais (sem estado — usável em Server e Client Components).
import { initials } from '@/lib/torneios/display'
import { cn } from '@/lib/utils/cn'

const TONES = {
  brand: 'bg-brand-500/15 text-brand-300 ring-brand-500/40',
  sky: 'bg-sky-500/15 text-sky-300 ring-sky-500/40',
  slate: 'bg-surface-border text-slate-300 ring-white/10',
  gold: 'bg-yellow-400/15 text-yellow-300 ring-yellow-400/40',
} as const

const SIZES = {
  sm: 'h-6 w-6 text-[10px]',
  md: 'h-8 w-8 text-xs',
} as const

interface PlayerAvatarProps {
  name: string | null | undefined
  tone?: keyof typeof TONES
  size?: keyof typeof SIZES
  className?: string
}

export function PlayerAvatar({ name, tone = 'slate', size = 'md', className }: PlayerAvatarProps) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-bold ring-1',
        TONES[tone],
        SIZES[size],
        className,
      )}
      title={name ?? undefined}
    >
      {initials(name)}
    </span>
  )
}
