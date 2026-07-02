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

  function runTour(markOnFinish: boolean) {
    const steps = getTourSteps(variant).map((s) => ({
      element: s.element,
      popover: {
        title: s.popover.title,
        description: s.popover.description,
      },
    }))

    const d: Driver = driver({
      showProgress: true,
      nextBtnText: 'Próximo',
      prevBtnText: 'Voltar',
      doneBtnText: 'Concluir',
      steps,
      onDestroyed: () => {
        if (markOnFinish) void markTourSeen(variant)
      },
    })
    d.drive()
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
