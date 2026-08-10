'use client'
// features/torneios/LiveRefresher.tsx
// Mantém a página do torneio viva enquanto os jogos acontecem.
//
// Quem está na quadra lança o placar pelo celular; quem está na arquibancada
// (ou em casa) vê a chave e a classificação mudarem sem tocar em nada. É o que
// separa uma página de torneio de uma tabela estática.
//
// Só recarrega os dados do servidor (router.refresh) em vez de manter uma cópia
// no cliente: a classificação é derivada de todas as partidas, e recalcular
// isso no browser duplicaria a regra que já existe em lib/torneios.
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Radio } from 'lucide-react'

interface LiveRefresherProps {
  tournamentId: string
  /** Torneio encerrado não tem o que atualizar — nem abre canal. */
  enabled: boolean
}

/** Janela mínima entre dois refreshes: uma rodada inteira lança placar junta. */
const REFRESH_THROTTLE_MS = 1200

export function LiveRefresher({ tournamentId, enabled }: LiveRefresherProps) {
  const router = useRouter()
  const [live, setLive] = useState(false)
  const pendingRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!enabled) return
    const supabase = createClient()

    const channel = supabase
      .channel(`tournament-${tournamentId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tournament_matches',
          filter: `tournament_id=eq.${tournamentId}`,
        },
        () => {
          // Agrupa a rajada: confirmar um placar dispara o UPDATE da partida e
          // mais um do avanço na chave. Dois refreshes seguidos não somam nada.
          if (pendingRef.current) clearTimeout(pendingRef.current)
          pendingRef.current = setTimeout(() => router.refresh(), REFRESH_THROTTLE_MS)
        },
      )
      .subscribe((status) => setLive(status === 'SUBSCRIBED'))

    return () => {
      if (pendingRef.current) clearTimeout(pendingRef.current)
      supabase.removeChannel(channel)
    }
  }, [tournamentId, enabled, router])

  if (!enabled || !live) return null

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-bold text-emerald-300">
      <Radio className="h-3 w-3" aria-hidden />
      Atualizando ao vivo
    </span>
  )
}
