import Image from 'next/image'

interface Props {
  size?: 'sm' | 'md' | 'lg'
  variant?: 'full' | 'icon'
  /** Logo da academia (Supabase Storage). Quando presente, sobrescreve o logo ArenaHub. */
  logoUrl?: string | null
  /** Nome da academia — usado como alt da logo. */
  orgName?: string
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

export function Logo({ size = 'md', variant = 'full', logoUrl, orgName }: Props) {
  const px = symbolPx[size]

  // Override por academia: renderiza a logo enviada, sem a wordmark ArenaHub.
  if (logoUrl) {
    return (
      <Image
        src={logoUrl}
        alt={orgName ?? 'Logo'}
        width={px}
        height={px}
        priority
        unoptimized
        className="object-contain"
      />
    )
  }

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
