// features/home/NextClassSpotlight.tsx
'use client'
import { useEffect, useState } from 'react'
import { NextClassCard } from './NextClassCard'

export interface SpotlightCandidate {
  id: string
  className: string
  /** 'YYYY-MM-DD' */
  date: string
  /** 'HH:MM:SS' */
  start: string
  end: string
  booked: number
  capacity: number
  state: 'booked' | 'available'
}

/**
 * Escolhe qual aula vai no card de destaque. Quem decide é o relógio do aluno:
 * o servidor não sabe o fuso dele e mostraria como "próxima" uma aula que já
 * terminou. Os candidatos chegam ordenados; aqui só descartamos os que passaram.
 */
export function NextClassSpotlight({
  candidates,
  todayISO,
}: {
  candidates: SpotlightCandidate[]
  todayISO: string
}) {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    const now = Date.now()
    const next = candidates.findIndex((c) => new Date(`${c.date}T${c.end}`).getTime() > now)
    setIndex(next === -1 ? candidates.length : next)
  }, [candidates])

  const pick = candidates[index]
  if (!pick) return null

  return (
    <NextClassCard
      className_={pick.className}
      date={pick.date}
      startTime={pick.start}
      endTime={pick.end}
      booked={pick.booked}
      capacity={pick.capacity}
      state={pick.state}
      href="/agendar"
      isToday={pick.date === todayISO}
    />
  )
}
