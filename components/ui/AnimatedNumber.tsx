// components/ui/AnimatedNumber.tsx
'use client'
import { useEffect, useRef, useState } from 'react'

interface AnimatedNumberProps {
  value: number
  /** Duração da contagem em ms. */
  duration?: number
  /** Texto colado depois do número (ex.: '%'). */
  suffix?: string
  className?: string
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)

/**
 * Conta de 0 até `value` ao montar. O primeiro render (servidor e hidratação)
 * já mostra o valor final — a contagem só começa depois, no efeito, para não
 * divergir do HTML do servidor nem piscar layout.
 */
export function AnimatedNumber({ value, duration = 900, suffix = '', className }: AnimatedNumberProps) {
  const [display, setDisplay] = useState(value)
  const frame = useRef<number>()

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setDisplay(value)
      return
    }

    const start = performance.now()
    const tick = (now: number) => {
      const progress = Math.min((now - start) / duration, 1)
      setDisplay(Math.round(easeOut(progress) * value))
      if (progress < 1) frame.current = requestAnimationFrame(tick)
    }
    frame.current = requestAnimationFrame(tick)

    return () => {
      if (frame.current) cancelAnimationFrame(frame.current)
    }
  }, [value, duration])

  return (
    <span className={className}>
      {display}
      {suffix}
    </span>
  )
}
