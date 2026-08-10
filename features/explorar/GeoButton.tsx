'use client'
// features/explorar/GeoButton.tsx
// Pede a posição ao navegador e devolve a ordenação por distância.
//
// A posição vai para a URL (?lat=&lng=) em vez de ficar em estado do React:
// assim a ordenação acontece no servidor, junto com a busca dos dados, e não
// exige baixar todas as arenas para ordenar no celular. É o mesmo padrão dos
// filtros de torneio.
//
// A coordenada é arredondada para três casas (~110 m) antes de entrar na URL.
// Serve de sobra para ordenar arenas e evita deixar a posição exata da pessoa
// no histórico do navegador e nos logs de acesso.
import { useState, useTransition } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { LocateFixed, LocateOff } from 'lucide-react'
import { roundCoord } from '@/lib/explorar/nearby'
import { cn } from '@/lib/utils/cn'

/** Sem isso o pedido fica pendurado para sempre em aparelho sem GPS. */
const GEO_TIMEOUT_MS = 10_000

interface GeoButtonProps {
  /** Já há posição na URL: o botão vira "desligar". */
  active: boolean
}

export function GeoButton({ active }: GeoButtonProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function push(next: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value)
      else params.delete(key)
    }
    const qs = params.toString()
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }))
  }

  function locate() {
    setError(null)
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setError('Este aparelho não informa a localização.')
      return
    }
    setAsking(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setAsking(false)
        push({
          lat: String(roundCoord(pos.coords.latitude)),
          lng: String(roundCoord(pos.coords.longitude)),
          // Ordenar por distância e filtrar por cidade ao mesmo tempo não faz
          // sentido: a cidade é justamente o substituto de quem não deu a posição.
          cidade: '',
        })
      },
      (err) => {
        setAsking(false)
        setError(
          err.code === err.PERMISSION_DENIED
            ? 'Permissão negada. Use o filtro por cidade abaixo.'
            : 'Não consegui pegar sua localização. Use o filtro por cidade.',
        )
      },
      { timeout: GEO_TIMEOUT_MS, maximumAge: 5 * 60_000 },
    )
  }

  const busy = asking || isPending

  return (
    <div>
      <button
        type="button"
        onClick={() => (active ? push({ lat: '', lng: '' }) : locate())}
        disabled={busy}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition-colors disabled:opacity-60',
          active
            ? 'border border-brand-400/40 bg-brand-500/20 text-brand-200'
            : 'border border-white/[0.08] bg-white/[0.04] text-slate-300 hover:border-brand-600/50 hover:text-white',
        )}
      >
        {active ? <LocateOff className="h-3.5 w-3.5" /> : <LocateFixed className="h-3.5 w-3.5" />}
        {busy ? 'Localizando…' : active ? 'Perto de mim · ativo' : 'Perto de mim'}
      </button>
      {error && <p className="mt-1.5 text-xs text-amber-300">{error}</p>}
    </div>
  )
}
