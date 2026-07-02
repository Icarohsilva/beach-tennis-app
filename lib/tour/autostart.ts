export type TourVariant = 'aluno' | 'admin'

export function shouldAutoStart(
  variant: TourVariant,
  pathname: string,
  seenAt: string | null,
): boolean {
  if (seenAt) return false
  if (variant === 'aluno') return pathname === '/home'
  return true // admin: alvos na sidebar existem em qualquer rota do painel
}
