'use client'
import { useState, useTransition } from 'react'
import { deleteClass } from '@/features/aulas/adminActions'

export function DeleteClassButton({ classId, className }: { classId: string; className: string }) {
  const [confirm, setConfirm] = useState(false)
  const [isPending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  if (confirm) {
    return (
      <div className="mt-2 space-y-1">
        <p className="text-xs text-red-400">Excluir &quot;{className}&quot; e remover todos os alunos?</p>
        <div className="flex gap-2">
          <button
            disabled={isPending}
            onClick={() =>
              start(async () => {
                const r = await deleteClass(classId)
                if (r.error) { setError(r.error); setConfirm(false) }
              })
            }
            className="text-xs text-red-400 hover:text-red-300 underline disabled:opacity-50"
          >
            {isPending ? 'Excluindo...' : 'Confirmar exclusão'}
          </button>
          <button onClick={() => setConfirm(false)} className="text-xs text-slate-400 hover:text-white underline">
            Cancelar
          </button>
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    )
  }

  return (
    <button
      onClick={() => setConfirm(true)}
      className="text-xs text-red-500/60 hover:text-red-400 underline mt-1"
    >
      Excluir turma
    </button>
  )
}
