'use client'
// features/home/SpotlightRow.tsx
// "Sua próxima aula" e "Sua frequência" na mesma linha.
//
// Quem decide o layout tem de ser quem sabe se existe próxima aula, e isso só o
// cliente sabe (o relógio do aluno é que descarta a aula que já acabou). Por
// isso o par mora aqui: sem aula à frente, a frequência ocupa a linha inteira em
// vez de ficar meia página com um buraco do lado.
import { useEffect, useState, type ReactNode } from 'react'
import { NextClassCard } from './NextClassCard'
import { SessionModal } from './SessionModal'
import type { AgendaSession } from './agendaTypes'

export function SpotlightRow({
  candidates,
  todayISO,
  children,
}: {
  /** Aulas do aluno em ordem, já filtradas pelo servidor. */
  candidates: AgendaSession[]
  todayISO: string
  /** O card de frequência, renderizado no servidor. */
  children: ReactNode
}) {
  // Começa fora da lista: no primeiro passo do servidor não há relógio do aluno,
  // e mostrar a aula de ontem por um quadro é pior que aparecer um quadro depois.
  const [index, setIndex] = useState(candidates.length)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const now = Date.now()
    const next = candidates.findIndex((c) => new Date(`${c.date}T${c.end}`).getTime() > now)
    setIndex(next === -1 ? candidates.length : next)
  }, [candidates])

  const pick = candidates[index]
  if (!pick) return <>{children}</>

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <NextClassCard
        className_={pick.className}
        date={pick.date}
        startTime={pick.start}
        endTime={pick.end}
        booked={pick.booked}
        capacity={pick.capacity}
        state={pick.mine || pick.fixed ? 'booked' : 'available'}
        isToday={pick.date === todayISO}
        onOpen={() => setOpen(true)}
      />
      {children}

      {/* A MESMA ficha da agenda: quem vai, fila de espera, entrar/sair e a
          confirmação de presença. Duplicar um modal só para este card daria
          duas verdades sobre a mesma aula. */}
      {open && (
        <SessionModal
          session={pick}
          isToday={pick.date === todayISO}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  )
}
