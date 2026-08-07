// components/ui/PullToRefresh.tsx
'use client'
import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw } from 'lucide-react'

/** Distância (px) que o dedo precisa percorrer para disparar a atualização. */
const THRESHOLD = 70
/** Teto do arrasto: além disso o indicador não desce mais. */
const MAX_PULL = 110
/** Resistência — o indicador anda menos que o dedo, como no iOS. */
const RESISTANCE = 0.5

/**
 * Puxar-para-atualizar do app instalado.
 *
 * O manifest usa `display: standalone`, que remove o pull-to-refresh nativo do
 * navegador — no app da home screen não havia como forçar a busca de dados
 * novos sem fechar e reabrir. No navegador comum o gesto nativo continua
 * funcionando, então o handler só liga em standalone para não duplicar (e
 * brigar com) o comportamento do browser.
 *
 * Atualiza via `router.refresh()`: as páginas do aluno são Server Components,
 * então isso rebusca o RSC no servidor e repinta com dados frescos, sem full
 * reload. O indicador fica até `isPending` cair, ou seja, até o payload novo
 * realmente chegar — não some antes da tela atualizar.
 */
export function PullToRefresh({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [pull, setPull] = useState(0)
  const [enabled, setEnabled] = useState(false)

  // Início do gesto. null = não estamos num arrasto válido.
  const startY = useRef<number | null>(null)
  const pullRef = useRef(0)

  useEffect(() => {
    // Standalone (Android/desktop PWA) ou iOS Safari adicionado à tela de início.
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true
    setEnabled(standalone)
  }, [])

  useEffect(() => {
    if (!enabled) return

    function onTouchStart(e: TouchEvent) {
      // Só começa colado no topo. Em qualquer outra posição o gesto é rolagem.
      if (window.scrollY > 0) {
        startY.current = null
        return
      }
      // Modal aberto trava a rolagem do fundo; puxar ali seria arrastar a tela
      // errada. SessionModal/SelfCheckinModal usam role="dialog".
      const target = e.target as HTMLElement | null
      if (target?.closest('[role="dialog"]')) {
        startY.current = null
        return
      }
      startY.current = e.touches[0].clientY
    }

    function onTouchMove(e: TouchEvent) {
      if (startY.current === null) return
      const delta = e.touches[0].clientY - startY.current

      // Arrasto para cima (ou já saiu do topo): devolve o controle à rolagem.
      if (delta <= 0 || window.scrollY > 0) {
        if (pullRef.current !== 0) {
          pullRef.current = 0
          setPull(0)
        }
        startY.current = null
        return
      }

      const next = Math.min(delta * RESISTANCE, MAX_PULL)
      pullRef.current = next
      setPull(next)
      // Impede o overscroll/bounce nativo enquanto o nosso indicador está ativo.
      if (e.cancelable) e.preventDefault()
    }

    function onTouchEnd() {
      if (startY.current === null) return
      startY.current = null
      if (pullRef.current >= THRESHOLD) {
        startTransition(() => router.refresh())
      }
      pullRef.current = 0
      setPull(0)
    }

    // passive: false em touchmove — sem isso o preventDefault é ignorado.
    document.addEventListener('touchstart', onTouchStart, { passive: true })
    document.addEventListener('touchmove', onTouchMove, { passive: false })
    document.addEventListener('touchend', onTouchEnd, { passive: true })
    document.addEventListener('touchcancel', onTouchEnd, { passive: true })
    return () => {
      document.removeEventListener('touchstart', onTouchStart)
      document.removeEventListener('touchmove', onTouchMove)
      document.removeEventListener('touchend', onTouchEnd)
      document.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [enabled, router])

  if (!enabled) return <>{children}</>

  const active = pull > 0 || isPending
  // Durante o refresh o indicador para numa altura fixa; no arrasto ele segue o dedo.
  const offset = isPending ? THRESHOLD : pull
  const ready = pull >= THRESHOLD

  return (
    <>
      <div
        aria-hidden={!active}
        className="pointer-events-none fixed inset-x-0 top-11 z-30 flex justify-center"
        style={{
          transform: `translateY(${Math.max(offset - 36, -36)}px)`,
          opacity: active ? 1 : 0,
          // Sem transição durante o arrasto: o indicador tem que colar no dedo.
          transition: pull > 0 ? 'none' : 'transform 200ms ease-out, opacity 200ms ease-out',
        }}
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-full border border-surface-border bg-surface-card shadow-lg">
          <RefreshCw
            className={
              'h-4 w-4 ' +
              (isPending ? 'animate-spin text-brand-500' : ready ? 'text-brand-500' : 'text-slate-400')
            }
            style={
              isPending ? undefined : { transform: `rotate(${(pull / MAX_PULL) * 270}deg)` }
            }
          />
        </span>
      </div>

      <div
        style={{
          transform: `translateY(${offset}px)`,
          transition: pull > 0 ? 'none' : 'transform 200ms ease-out',
        }}
      >
        {children}
      </div>

      <span role="status" aria-live="polite" className="sr-only">
        {isPending ? 'Atualizando' : ''}
      </span>
    </>
  )
}
