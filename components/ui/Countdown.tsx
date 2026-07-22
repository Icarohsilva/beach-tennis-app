// components/ui/Countdown.tsx
'use client'
import { useEffect, useState } from 'react'
import { countdownLabel } from '@/lib/utils/agenda'

interface CountdownProps {
  /** Início, sem fuso: 'YYYY-MM-DDTHH:MM:SS' — lido no relógio do aluno. */
  startsAt: string
  /** Fim, mesmo formato. Enquanto corre, mostra "acontecendo agora". */
  endsAt?: string
  className?: string
}

/**
 * Contagem regressiva viva até a aula. O relógio só existe no cliente, então o
 * servidor renderiza um traço e o texto aparece na hidratação — sem divergência
 * entre os dois HTMLs.
 */
export function Countdown({ startsAt, endsAt, className }: CountdownProps) {
  const [text, setText] = useState<string | null>(null)

  useEffect(() => {
    const startMs = new Date(startsAt).getTime()
    const endMs = endsAt ? new Date(endsAt).getTime() : null
    if (Number.isNaN(startMs)) return

    const update = () => setText(countdownLabel(startMs, endMs, Date.now()))
    update()
    const id = setInterval(update, 30_000)
    return () => clearInterval(id)
  }, [startsAt, endsAt])

  return (
    <span className={className} suppressHydrationWarning>
      {text ?? '—'}
    </span>
  )
}
