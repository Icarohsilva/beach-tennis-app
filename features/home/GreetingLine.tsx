// features/home/GreetingLine.tsx
'use client'
import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { greetingFor } from '@/lib/utils/agenda'

/**
 * Saudação e data do topo. Ambas dependem do relógio de quem olha — o servidor
 * roda em UTC e erraria o período do dia —, então o texto se completa depois da
 * hidratação, partindo de um "Olá" neutro que já é válido sozinho.
 */
export function GreetingLine({ name }: { name: string }) {
  const [clock, setClock] = useState<{ greeting: string; date: string } | null>(null)

  useEffect(() => {
    const now = new Date()
    setClock({
      greeting: greetingFor(now.getHours()),
      date: format(now, "EEEE, d 'de' MMMM", { locale: ptBR }),
    })
  }, [])

  return (
    <div suppressHydrationWarning>
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/70">
        {clock?.date ?? ' '}
      </p>
      <h1 className="mt-1 text-2xl font-extrabold leading-tight text-white">
        {clock ? `${clock.greeting}, ` : 'Olá, '}
        {name}
      </h1>
    </div>
  )
}
