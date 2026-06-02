'use client'
import { useState, useTransition } from 'react'
import { generateSessionsForExistingClass } from '@/features/aulas/adminActions'

export function GenerateSessionsButton({ classId }: { classId: string }) {
  const [msg, setMsg] = useState<string | null>(null)
  const [isPending, start] = useTransition()

  function handleClick() {
    start(async () => {
      const result = await generateSessionsForExistingClass(classId)
      if (result.error) setMsg(`Erro: ${result.error}`)
      else setMsg(`${result.count} sessões geradas`)
      setTimeout(() => setMsg(null), 3000)
    })
  }

  return (
    <div className="mt-2">
      <button
        onClick={handleClick}
        disabled={isPending}
        className="text-xs text-brand-400 hover:text-brand-300 underline disabled:opacity-50"
      >
        {isPending ? 'Gerando...' : 'Gerar sessões (90 dias)'}
      </button>
      {msg && <p className="text-xs text-green-400 mt-1">{msg}</p>}
    </div>
  )
}
