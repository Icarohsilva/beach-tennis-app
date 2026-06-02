'use client'
// features/aulas/SessionAttendees.tsx

import { useState } from 'react'

interface SessionAttendeesProps {
  attendees: string[]
  totalSpots: number
}

export function SessionAttendees({ attendees, totalSpots }: SessionAttendeesProps) {
  const [open, setOpen] = useState(false)
  const count = attendees.length

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs text-slate-400 hover:text-white transition-colors flex items-center gap-1"
      >
        <span>👥 {count}/{totalSpots} alunos</span>
        <span>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <ul className="mt-2 pl-2 space-y-1">
          {count === 0 ? (
            <li className="text-xs text-slate-500">Nenhum aluno confirmado ainda.</li>
          ) : (
            attendees.map((name, i) => (
              <li key={`${name}-${i}`} className="text-xs text-slate-300">
                {name}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
