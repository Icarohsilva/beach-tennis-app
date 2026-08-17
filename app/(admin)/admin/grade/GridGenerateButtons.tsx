'use client'
import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/Button'
import { generateGridWeek, generateGridDay, generateGridClass } from '@/features/aulas/gridActions'

function feedback(r: {
  error?: string
  sessionsCreated?: number
  sessionsReopened?: number
  reservados?: number
  aConfirmar?: number
  semPlano?: number
  semCota?: number
  comPendenciaCheckin?: number
}): string {
  if (r.error) return `Erro: ${r.error}`
  const parts = [`${r.sessionsCreated ?? 0} sessões`, `${r.reservados ?? 0} reservados`]
  // Reabertura precisa aparecer: gerar agora DESFAZ cancelamento, e o admin tem
  // de sair da ação sabendo que uma aula que ele havia cancelado voltou.
  if ((r.sessionsReopened ?? 0) > 0) {
    parts.push(`${r.sessionsReopened} ${r.sessionsReopened === 1 ? 'aula reaberta' : 'aulas reabertas'}`)
  }
  if ((r.aConfirmar ?? 0) > 0) parts.push(`${r.aConfirmar} a confirmar`)
  if ((r.semPlano ?? 0) > 0) parts.push(`${r.semPlano} sem plano`)
  if ((r.semCota ?? 0) > 0) parts.push(`${r.semCota} sem cota`)
  if ((r.comPendenciaCheckin ?? 0) > 0) {
    parts.push(`🔒 ${r.comPendenciaCheckin} com pendência de check-in`)
  }
  return parts.join(' · ')
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

/**
 * Botão "Gerar aula" — vai no rodapé do card de UMA turma, ao lado de "Excluir
 * turma".
 *
 * Gera só a próxima aula daquela turma, ao contrário do "Gerar" do cabeçalho do
 * dia, que faz todas as turmas daquele dia da semana. É também o caminho de volta
 * de uma aula cancelada, sem esperar a geração automática.
 *
 * A mensagem vai embaixo (e não ao lado, como no cabeçalho do dia) porque o
 * rodapé do card já tem três elementos: no celular de 320px o texto do resultado
 * na mesma linha empurraria os botões para fora.
 */
export function GenerateClassButton({ classId }: { classId: string }) {
  const [msg, setMsg] = useState<string | null>(null)
  const [isPending, start] = useTransition()
  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <button
        type="button"
        disabled={isPending}
        onClick={() => start(async () => setMsg(feedback(await generateGridClass(classId))))}
        className="text-xs text-brand-400 hover:text-brand-300 underline disabled:opacity-50"
      >
        {isPending ? 'Gerando…' : 'Gerar aula'}
      </button>
      {msg && <span className="text-right text-xs text-slate-400">{msg}</span>}
    </span>
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
