import Image from 'next/image'

interface Props {
  size?: 'sm' | 'md' | 'lg'
  variant?: 'full' | 'icon'
}

const textSizes = {
  sm: 'text-base',
  md: 'text-xl',
  lg: 'text-2xl',
}

// Tamanho do símbolo (px) por escala — casa com a altura da wordmark.
const symbolPx = {
  sm: 22,
  md: 30,
  lg: 40,
}

const SYMBOL = '/brand/arenahub-symbol-transparent.png'

export function Logo({ size = 'md', variant = 'full' }: Props) {
  const px = symbolPx[size]

  if (variant === 'icon') {
    return (
      <Image src={SYMBOL} alt="ArenaHub" width={px} height={px} priority className="object-contain" />
    )
  }

  return (
    <span className={`inline-flex items-center gap-2 font-extrabold tracking-tight ${textSizes[size]}`}>
      <Image src={SYMBOL} alt="" aria-hidden width={px} height={px} priority className="object-contain" />
      <span aria-label="ArenaHub">
        <span className="text-white">Arena</span>
        <span className="text-brand-500">Hub</span>
      </span>
    </span>
  )
}
