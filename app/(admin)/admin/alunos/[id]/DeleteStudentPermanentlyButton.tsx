'use client'
// app/(admin)/admin/alunos/[id]/DeleteStudentPermanentlyButton.tsx
// Zona de risco: exclusão permanente (bloqueia login + anonimiza a
// identidade — ver features/aulas/studentIdentityActions.ts). Só existe
// quando o cadastro já está inativo nesta academia (canPermanentlyDelete);
// exige digitar o nome do aluno para confirmar, porque "tem certeza?" sozinho
// é fraco demais para uma ação que não tem volta.
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { permanentlyDeleteStudent } from '@/features/aulas/studentIdentityActions'

interface Props {
  studentId: string
  fullName: string
}

export function DeleteStudentPermanentlyButton({ studentId, fullName }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const canConfirm = confirmText.trim() === fullName.trim()

  function handleDelete() {
    if (!canConfirm) return
    setError(null)
    startTransition(async () => {
      const res = await permanentlyDeleteStudent(studentId)
      if (res.error) {
        setError(res.error)
        return
      }
      router.refresh()
    })
  }

  if (!open) {
    return (
      <div className="rounded-xl border border-red-900/50 bg-red-950/20 p-4">
        <p className="text-sm font-semibold text-white">Excluir permanentemente</p>
        <p className="mt-1 text-xs text-slate-400">
          Bloqueia o login e apaga o nome, telefone e ficha médica deste aluno — em todas as
          academias, se ele tiver mais de um vínculo. Presença, pagamentos, créditos e pontos
          da Liga continuam guardados, só que sem nome ligado a eles. Não tem volta: ele só
          consegue acessar de novo criando um cadastro novo.
        </p>
        <Button variant="danger" size="sm" className="mt-3" onClick={() => setOpen(true)}>
          Excluir permanentemente
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-3 rounded-xl border border-red-800/50 bg-red-950/40 px-4 py-3">
      <p className="text-sm font-semibold text-white">
        Para confirmar, digite o nome completo do aluno: <span className="text-red-300">{fullName}</span>
      </p>
      <input
        value={confirmText}
        onChange={(e) => setConfirmText(e.target.value)}
        placeholder={fullName}
        className="w-full bg-surface border border-surface-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-red-500"
      />
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="danger" size="sm" loading={isPending} disabled={!canConfirm} onClick={handleDelete}>
          Confirmar exclusão permanente
        </Button>
        <button
          type="button"
          onClick={() => {
            setOpen(false)
            setConfirmText('')
            setError(null)
          }}
          className="text-xs text-slate-400 underline hover:text-white"
        >
          Cancelar
        </button>
      </div>
    </div>
  )
}
