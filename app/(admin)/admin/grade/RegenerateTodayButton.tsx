// app/(admin)/admin/grade/RegenerateTodayButton.tsx
'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { generateGridDay } from '@/features/aulas/gridActions'

/**
 * Re-roda a geração/reserva do dia-da-semana informado (reserva quem virou elegível).
 * Escopo: regenera/reconcilia TODAS as turmas da organização nesse dia-da-semana,
 * não apenas a turma da chamada onde o botão está renderizado.
 */
export function RegenerateTodayButton({ dayOfWeek }: { dayOfWeek: number }) {
  const router = useRouter()
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, start] = useTransition()
  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        size="sm" variant="secondary" loading={pending}
        onClick={() => start(async () => {
          const r = await generateGridDay(dayOfWeek)
          setMsg(r.error ? `Erro: ${r.error}` : `Dia regerado: ${r.reservados ?? 0} reservados no dia.`)
          router.refresh()
        })}
      >
        Regerar hoje
      </Button>
      {msg && <span className="text-xs text-slate-400">{msg}</span>}
    </div>
  )
}
