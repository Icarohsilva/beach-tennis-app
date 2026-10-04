'use client'
// components/ui/NavigationProgress.tsx
// Barra no topo da tela entre o clique num link e a página nova aparecer.
//
// O loading.tsx de cada página cobre a maior parte da espera, mas não toda: o
// Next só mostra aquele esqueleto depois de buscar o pedaço da rota, e uma
// troca de filtro (?status=...) na mesma página não monta loading nenhum. Nos
// dois casos o clique ficava sem resposta visível. A barra começa no próprio
// clique, sem esperar o servidor, e o "Carregando…" escrito aparece se a espera
// passar de um instante, para quem não percebe uma linha fina no topo.
//
// Começa por um listener de clique no documento (pega todo <a>/<Link> sem
// mexer em cada um) e termina quando o endereço muda. Navegação por código
// (router.push) avisa com startNavigation().
import { useEffect, useRef, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'

const START_EVENT = 'arenahub:navigation-start'
/** Abaixo disso a troca é rápida o bastante para o chip só piscar. */
const LABEL_DELAY_MS = 300
/** Rede de segurança: navegação que não muda o endereço (erro, redirect para a mesma página). */
const MAX_VISIBLE_MS = 15_000

/** Para quem navega com router.push: chame logo antes. */
export function startNavigation() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(START_EVENT))
}

/** O clique vai trocar de página dentro do app? (decide se a barra começa). */
function isInternalNavigation(e: MouseEvent): boolean {
  if (e.defaultPrevented || e.button !== 0) return false
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false
  const anchor = (e.target as Element | null)?.closest?.('a')
  if (!anchor || !anchor.href) return false
  if (anchor.target && anchor.target !== '_self') return false
  if (anchor.hasAttribute('download')) return false
  const url = new URL(anchor.href, window.location.href)
  if (url.origin !== window.location.origin) return false
  // Mesma página (ou só a âncora #): o endereço não muda e a barra nunca terminaria.
  return url.pathname + url.search !== window.location.pathname + window.location.search
}

export function NavigationProgress() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [active, setActive] = useState(false)
  const [showLabel, setShowLabel] = useState(false)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  function clearTimers() {
    timers.current.forEach(clearTimeout)
    timers.current = []
  }

  useEffect(() => {
    function start() {
      clearTimers()
      setActive(true)
      setShowLabel(false)
      timers.current.push(setTimeout(() => setShowLabel(true), LABEL_DELAY_MS))
      timers.current.push(setTimeout(() => setActive(false), MAX_VISIBLE_MS))
    }
    function onClick(e: MouseEvent) {
      if (isInternalNavigation(e)) start()
    }
    // Captura, não bolha: o <Link> do Next chama preventDefault no próprio
    // onClick (ele navega pelo router), e na bolha TODO link chegaria aqui como
    // "cancelado". Um onClick que cancele a navegação de verdade é raro, e o
    // pior caso é a barra sumir pelo MAX_VISIBLE_MS.
    document.addEventListener('click', onClick, true)
    window.addEventListener(START_EVENT, start)
    return () => {
      document.removeEventListener('click', onClick, true)
      window.removeEventListener(START_EVENT, start)
      clearTimers()
    }
  }, [])

  // Endereço novo = a navegação chegou.
  useEffect(() => {
    clearTimers()
    setActive(false)
    setShowLabel(false)
  }, [pathname, searchParams])

  if (!active) return null

  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-1 overflow-hidden bg-brand-500/20">
        <div className="h-full w-1/3 animate-nav-progress rounded-full bg-gradient-to-r from-brand-400 to-brand-600" />
      </div>
      {showLabel && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed left-1/2 top-3 z-[100] flex -translate-x-1/2 items-center gap-2 rounded-full border border-surface-border bg-surface-card px-3 py-1.5 text-xs font-medium text-slate-200 shadow-lg"
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-500" aria-hidden />
          Carregando…
        </div>
      )}
    </>
  )
}
