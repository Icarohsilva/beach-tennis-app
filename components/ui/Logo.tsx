import Image from 'next/image'

interface Props {
  size?: 'sm' | 'md' | 'lg'
  variant?: 'full' | 'icon'
}

const sizes = {
  sm: { w: 110, h: 26 },
  md: { w: 154, h: 36 },
  lg: { w: 198, h: 46 },
}

const iconSizes = {
  sm: 28,
  md: 36,
  lg: 48,
}

export function Logo({ size = 'md', variant = 'full' }: Props) {
  if (variant === 'icon') {
    const s = iconSizes[size]
    return (
      <Image
        src="public/icon.svg"
        alt="Beach Tennis"
        width={s}
        height={s}
        priority
      />
    )
  }

  const { w, h } = sizes[size]
  return (
    <Image
      src="/logo.svg"
      alt="Beach Tennis"
      width={w}
      height={h}
      priority
    />
  )
}
