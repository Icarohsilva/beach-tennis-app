// features/liga/MedalIcon.tsx
// Mapa explícito ícone → componente lucide.
//
// Explícito, e não import dinâmico pelo nome: o catálogo de medalhas guarda o nome do
// ícone como string, e um import dinâmico arrastaria a biblioteca inteira para o
// bundle do cliente. Serve tanto no Server Component da vitrine quanto no Client
// Component da comemoração.
import { Medal, Award, Flame, Trophy, Shield, Gem, Sunrise, Star } from 'lucide-react'

const ICONS = { Medal, Award, Flame, Trophy, Shield, Gem, Sunrise, Star } as const

interface Props {
  name: string
  className?: string
}

export function MedalIcon({ name, className }: Props) {
  const Icon = (ICONS as Record<string, typeof Medal>)[name] ?? Medal
  return <Icon className={className} />
}
