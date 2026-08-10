'use client'
// features/torneios/ParticipantName.tsx
// O nome do inscrito, clicável, dentro das tabelas do torneio.
//
// É um <button> e não um <a>: abre a ficha na própria página em vez de navegar.
// O link para o retrospecto completo continua existindo, dentro do modal — o
// clique rápido resolve "quem é essa pessoa e como falo com ela", que é o que
// se quer no meio de um torneio.
import { useParticipantModal } from './ParticipantModal'
import { cn } from '@/lib/utils/cn'

export function ParticipantName({
  playerId,
  name,
  className,
}: {
  playerId: string
  name: string
  className?: string
}) {
  const { open } = useParticipantModal()
  return (
    <button
      type="button"
      onClick={() => open(playerId)}
      className={cn(
        'truncate text-left underline-offset-2 transition-colors hover:text-brand-300 hover:underline',
        className,
      )}
    >
      {name}
    </button>
  )
}
