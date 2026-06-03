'use client'
import { useState, useTransition } from 'react'
import { generateSessionsForExistingClass, generateWeeklyBookings } from '@/features/aulas/adminActions'

export function GenerateSessionsButton({ classId }: { classId: string }) {
  const [msg, setMsg] = useState<string | null>(null)
  const [skipped, setSkipped] = useState<string[]>([])
  const [isPending, start] = useTransition()

  function handleClick() {
    setMsg(null)
    setSkipped([])
    start(async () => {
      // 1. Generate sessions for 90 days
      const sessResult = await generateSessionsForExistingClass(classId)
      if (sessResult.error) { setMsg(`Erro: ${sessResult.error}`); return }

      // 2. Create bookings + deduct credits for enrolled students (next 14 days)
      const bookResult = await generateWeeklyBookings(classId)
      if (bookResult.error) { setMsg(`Erro: ${bookResult.error}`); return }

      const booked = bookResult.booked ?? []
      const skip = bookResult.skipped ?? []
      setSkipped(skip)

      let text = `${sessResult.count} sessões geradas.`
      if (booked.length > 0) text += ` ${booked.length} aluno(s) confirmado(s).`
      if (skip.length > 0) text += ` ⚠️ ${skip.length} sem crédito.`
      setMsg(text)
    })
  }

  return (
    <div className="mt-2">
      <button
        onClick={handleClick}
        disabled={isPending}
        className="text-xs text-brand-400 hover:text-brand-300 underline disabled:opacity-50"
      >
        {isPending ? 'Gerando...' : 'Gerar semana'}
      </button>
      {msg && (
        <p className={`text-xs mt-1 ${skipped.length > 0 ? 'text-yellow-400' : 'text-green-400'}`}>
          {msg}
        </p>
      )}
      {skipped.length > 0 && (
        <div className="mt-1 p-2 bg-red-950/40 border border-red-800/50 rounded-lg">
          <p className="text-xs text-red-400 font-semibold mb-1">Sem crédito — não confirmados:</p>
          <ul className="space-y-0.5">
            {skipped.map((name) => (
              <li key={name} className="text-xs text-red-300">• {name}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
