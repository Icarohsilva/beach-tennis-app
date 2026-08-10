// features/torneios/FormBadges.tsx
// A forma recente em pastilhas — V, D, E — do jogo mais recente para o mais
// antigo, que é a convenção de tabela de campeonato.
import { cn } from '@/lib/utils/cn'
import type { FormResult } from '@/lib/torneios/playerStats'

const STYLES: Record<FormResult, string> = {
  V: 'bg-emerald-400 text-surface',
  D: 'bg-red-500 text-white',
  E: 'bg-white/25 text-white',
}

const TITLES: Record<FormResult, string> = {
  V: 'Vitória',
  D: 'Derrota',
  E: 'Empate',
}

export function FormBadges({ form, className }: { form: FormResult[]; className?: string }) {
  if (form.length === 0) return null
  return (
    <ul className={cn('flex items-center gap-1', className)}>
      {form.map((result, i) => (
        <li
          key={i}
          title={TITLES[result]}
          className={cn(
            'flex h-5 w-5 items-center justify-center rounded text-[10px] font-extrabold',
            STYLES[result],
          )}
        >
          {result}
        </li>
      ))}
    </ul>
  )
}
