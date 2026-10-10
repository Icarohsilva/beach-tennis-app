'use client'
// app/(admin)/admin/torneios/[id]/MoveEntryControl.tsx
// "Mudar categoria": passa a inscrição para outro torneio da arena. As travas
// (chave sorteada, formato, gênero, vaga, quem já está lá) ficam no servidor,
// em features/torneios/moveEntryActions.ts.
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRightLeft } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { startNavigation } from '@/components/ui/NavigationProgress'
import { moveEntryToTournament } from '@/features/torneios/moveEntryActions'

export interface MoveTarget {
  id: string
  name: string
}

interface Props {
  entryId: string
  /** Quem está sendo movido, como aparece na confirmação ("Ana e Bia"). */
  who: string
  currentName: string
  targets: MoveTarget[]
}

export function MoveEntryControl({ entryId, who, currentName, targets }: Props) {
  const [open, setOpen] = useState(false)
  const [targetId, setTargetId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const { confirm, dialog } = useConfirm()
  const router = useRouter()

  async function submit() {
    const target = targets.find((t) => t.id === targetId)
    if (!target) return
    const { ok } = await confirm({
      title: 'Mudar de categoria?',
      message: `A inscrição de ${who} sai de "${currentName}" e entra em "${target.name}".\nPagamento, comprovante e camisa vão junto.`,
      confirmLabel: 'Mudar categoria',
    })
    if (!ok) return
    setError(null)
    startTransition(async () => {
      const res = await moveEntryToTournament(entryId, target.id)
      if (res.error) {
        setError(res.error)
        return
      }
      const notices = res.notices ?? []
      const next = await confirm({
        title: `Inscrição movida para "${target.name}"`,
        message: notices.length > 0 ? notices.join('\n') : `A inscrição de ${who} já aparece na lista de "${target.name}".`,
        confirmLabel: 'Abrir a nova categoria',
        cancelLabel: 'Continuar aqui',
      })
      if (next.ok) {
        startNavigation()
        router.push(`/admin/torneios/${target.id}`)
      } else {
        router.refresh()
      }
    })
  }

  if (!open) {
    return (
      <div className="mt-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
          <ArrowRightLeft className="h-3.5 w-3.5" aria-hidden />
          Mudar categoria
        </Button>
        {dialog}
      </div>
    )
  }

  return (
    <div className="mt-2 space-y-2">
      <select
        value={targetId}
        onChange={(e) => setTargetId(e.target.value)}
        aria-label="Categoria de destino"
        className="w-full min-w-0 rounded-lg border border-surface-border bg-surface px-2 py-1.5 text-xs text-white focus:border-brand-500 focus:outline-none"
      >
        <option value="">Mover para…</option>
        {targets.map((t) => (
          <option key={t.id} value={t.id}>{t.name}</option>
        ))}
      </select>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={submit} disabled={!targetId || pending}>
          {pending ? 'Movendo…' : 'Mover'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={() => { setOpen(false); setTargetId(''); setError(null) }}
        >
          Cancelar
        </Button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {dialog}
    </div>
  )
}
