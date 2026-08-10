// features/torneios/PodiumCard.tsx
// O pódio do torneio encerrado.
//
// A tabela de classificação responde "quem ficou em nono"; o pódio responde
// "quem ganhou", que é a pergunta que todo mundo faz primeiro. Por isso ele vem
// antes da tabela e não dentro dela.
import { cn } from '@/lib/utils/cn'
import { PlayerAvatar } from './PlayerAvatar'

export interface PodiumPlace {
  position: 1 | 2 | 3
  label: string
  ids: string[]
}

interface PodiumCardProps {
  places: PodiumPlace[]
  currentUserId?: string
}

// Ordem visual do pódio de verdade: prata à esquerda, ouro no meio, bronze à
// direita. Ler da esquerda para a direita aqui seria ler errado.
const VISUAL_ORDER: (1 | 2 | 3)[] = [2, 1, 3]

const STYLES: Record<1 | 2 | 3, { medal: string; height: string; ring: string }> = {
  1: { medal: '🥇', height: 'h-20', ring: 'from-amber-300/30 to-amber-500/10 border-amber-400/40' },
  2: { medal: '🥈', height: 'h-14', ring: 'from-slate-200/20 to-slate-400/10 border-slate-300/30' },
  3: { medal: '🥉', height: 'h-11', ring: 'from-orange-400/20 to-orange-600/10 border-orange-400/30' },
}

export function PodiumCard({ places, currentUserId }: PodiumCardProps) {
  if (places.length === 0) return null
  const byPosition = new Map(places.map((p) => [p.position, p]))

  return (
    <div className="rounded-2xl border border-white/[0.07] bg-surface-card p-4">
      <div className="flex items-end justify-center gap-2">
        {VISUAL_ORDER.map((position) => {
          const place = byPosition.get(position)
          if (!place) return null
          const style = STYLES[position]
          const isMine = !!currentUserId && place.ids.includes(currentUserId)

          return (
            <div key={position} className="flex w-full max-w-[120px] flex-col items-center">
              <span className="text-2xl" aria-hidden>{style.medal}</span>
              <PlayerAvatar
                name={place.label}
                tone={position === 1 ? 'gold' : isMine ? 'brand' : 'slate'}
                size="sm"
              />
              <p
                className={cn(
                  'mt-1.5 line-clamp-2 text-center text-[11px] font-semibold leading-tight',
                  isMine ? 'text-brand-300' : 'text-white',
                )}
              >
                {place.label}
              </p>
              <div
                className={cn(
                  'mt-2 w-full rounded-t-lg border border-b-0 bg-gradient-to-t',
                  style.height,
                  style.ring,
                )}
              >
                <p className="pt-1.5 text-center text-lg font-extrabold text-white/80">{position}º</p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
