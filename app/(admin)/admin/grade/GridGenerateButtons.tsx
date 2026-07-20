'use client'
import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/Button'
import { generateGridWeek, generateGridDay } from '@/features/aulas/gridActions'

function feedback(r: { error?: string; sessionsCreated?: number; studentsBooked?: number }): string {
  if (r.error) return `Erro: ${r.error}`
  return `${r.sessionsCreated ?? 0} sessões geradas · ${r.studentsBooked ?? 0} alunos reservados.`
}

/** Botão "Gerar semana toda" — vai no topo da grade. */
export function GenerateWeekButton() {
  const [msg, setMsg] = useState<string | null>(null)
  const [isPending, start] = useTransition()
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant="secondary"
        loading={isPending}
        onClick={() => start(async () => setMsg(feedback(await generateGridWeek())))}
      >
        Gerar semana
      </Button>
      {msg && <span className="text-xs text-slate-400">{msg}</span>}
    </div>
  )
}

/** Botão "Gerar [dia]" — vai no cabeçalho de cada dia da grade. */
export function GenerateDayButton({ dayOfWeek }: { dayOfWeek: number }) {
  const [msg, setMsg] = useState<string | null>(null)
  const [isPending, start] = useTransition()
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={isPending}
        onClick={() => start(async () => setMsg(feedback(await generateGridDay(dayOfWeek))))}
        className="text-xs text-brand-400 hover:text-brand-300 underline disabled:opacity-50"
      >
        {isPending ? 'Gerando…' : 'Gerar'}
      </button>
      {msg && <span className="text-xs text-slate-400">{msg}</span>}
    </span>
  )
}
