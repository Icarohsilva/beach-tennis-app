interface Props {
  size?: 'sm' | 'md' | 'lg'
  variant?: 'full' | 'icon'
}

const textSizes = {
  sm: 'text-base',
  md: 'text-xl',
  lg: 'text-2xl',
}

const iconSizes = {
  sm: 'text-xl',
  md: 'text-2xl',
  lg: 'text-3xl',
}

export function Logo({ size = 'md', variant = 'full' }: Props) {
  if (variant === 'icon') {
    return (
      <span className={iconSizes[size]} role="img" aria-label="ArenaHub">
        🏟️
      </span>
    )
  }

  return (
    <span className={`font-extrabold tracking-tight ${textSizes[size]}`} aria-label="ArenaHub">
      <span aria-hidden="true">🏟️ </span>
      <span className="text-white">Arena</span>
      <span className="text-brand-500">Hub</span>
    </span>
  )
}
