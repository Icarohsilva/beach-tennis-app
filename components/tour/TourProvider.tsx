'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { driver, type Driver } from 'driver.js'
import 'driver.js/dist/driver.css'
import { getTourSteps } from '@/lib/tour/steps'
import { shouldAutoStart, type TourVariant } from '@/lib/tour/autostart'
import { markTourSeen } from '@/lib/tour/actions'

export function TourProvider({
  variant,
  seenAt,
}: {
  variant: TourVariant
  seenAt: string | null
}) {
  const pathname = usePathname()
  const startedRef = useRef(false)

  // Resolve o alvo VISÍVEL. O mesmo data-tour existe no menu lateral (desktop,
  // hidden no mobile) e na lista do menu hambúrguer (mobile). getClientRects()
  // ignora elementos display:none e lida corretamente com position:fixed.
  function resolveVisible(selector: string): HTMLElement {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>(selector))
    return nodes.find((n) => n.getClientRects().length > 0) ?? nodes[0]
  }

  function runTour(markOnFinish: boolean) {
    const isMobile =
      typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches
    // No mobile o menu admin fica no hambúrguer: abrimos a lista antes de guiar.
    const needsMobileMenu = variant === 'admin' && isMobile

    const steps = getTourSteps(variant).map((s) => ({
      element: s.element ? () => resolveVisible(s.element!) : undefined,
      popover: {
        title: s.popover.title,
        description: s.popover.description,
      },
    }))

    const start = () => {
      const d: Driver = driver({
        showProgress: true,
        nextBtnText: 'Próximo',
        prevBtnText: 'Voltar',
        doneBtnText: 'Concluir',
        steps,
        onDestroyed: () => {
          if (needsMobileMenu) window.dispatchEvent(new Event('tour:admin-menu-close'))
          if (markOnFinish) void markTourSeen(variant)
        },
      })
      d.drive()
    }

    if (needsMobileMenu) {
      window.dispatchEvent(new Event('tour:admin-menu-open'))
      // dá um tick pro dropdown renderar antes de destacar o 1º item
      setTimeout(start, 150)
    } else {
      start()
    }
  }

  // Auto-start no primeiro login (uma vez por montagem).
  useEffect(() => {
    if (startedRef.current) return
    if (shouldAutoStart(variant, pathname, seenAt)) {
      startedRef.current = true
      // pequeno atraso para garantir que os alvos já montaram
      const t = setTimeout(() => runTour(true), 400)
      return () => clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, seenAt, variant])

  // Replay via evento do HelpButton (não marca como visto — já foi).
  useEffect(() => {
    const handler = () => runTour(false)
    window.addEventListener('tour:replay', handler)
    return () => window.removeEventListener('tour:replay', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant])

  return null
}
