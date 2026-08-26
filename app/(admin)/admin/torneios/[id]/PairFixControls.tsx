'use client'
// app/(admin)/admin/torneios/[id]/PairFixControls.tsx
// Consertar dupla fixa: escolher/trocar parceiro, remover parceiro (a
// inscrição sobrevive incompleta) e promover o parceiro a titular. Só
// aparece com o torneio 'open' — features/torneios/entryFixActions.ts
// recusa depois que a chave é sorteada.
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { swapEntryPartner, clearEntryPartner, promotePartnerToPlayer } from '@/features/torneios/entryFixActions'

interface Candidate { id: string; full_name: string }

interface Props {
  entryId: string
  hasPartner: boolean
  candidates: Candidate[]
}

type Mode = 'idle' | 'choosing'

export function PairFixControls({ entryId, hasPartner, candidates }: Props) {
  const [mode, setMode] = useState<Mode>('idle')
  const [candidateId, setCandidateId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function confirmSwap() {
    if (!candidateId) return
    setError(null)
    startTransition(async () => {
      const res = await swapEntryPartner(entryId, candidateId)
      if (res.error) setError(res.error)
      else {
        setMode('idle')
        setCandidateId('')
        router.refresh()
      }
    })
  }

  function clear() {
    if (!confirm('Remover o parceiro desta inscrição? Ela fica incompleta até alguém escolher um novo.')) return
    setError(null)
    startTransition(async () => {
      const res = await clearEntryPartner(entryId)
      if (res.error) setError(res.error)
      else router.refresh()
    })
  }

  function promote() {
    if (!confirm('O titular sai e o parceiro assume a inscrição no lugar dele. Continuar?')) return
    setError(null)
    startTransition(async () => {
      const res = await promotePartnerToPlayer(entryId)
      if (res.error) setError(res.error)
      else router.refresh()
    })
  }

  if (mode === 'choosing') {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select
          value={candidateId}
          onChange={(e) => setCandidateId(e.target.value)}
          className="bg-surface border border-surface-border rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-brand-500"
        >
          <option value="">Selecione um aluno...</option>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>{c.full_name}</option>
          ))}
        </select>
        <button
          onClick={confirmSwap}
          disabled={isPending || !candidateId}
          className="text-xs bg-green-700 hover:bg-green-600 text-white px-3 py-1.5 rounded-lg disabled:opacity-60"
        >
          {isPending ? 'Salvando...' : 'Confirmar'}
        </button>
        <button
          onClick={() => { setMode('idle'); setCandidateId(''); setError(null) }}
          className="text-xs text-slate-400 hover:text-slate-300"
        >
          Cancelar
        </button>
        {error && <p className="w-full text-xs text-red-400">{error}</p>}
      </div>
    )
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-3">
      <button
        onClick={() => setMode('choosing')}
        disabled={isPending}
        className="text-xs text-brand-400 hover:text-brand-300"
      >
        {hasPartner ? '🔄 Trocar parceiro' : '👤 Escolher parceiro'}
      </button>
      {hasPartner && (
        <>
          <button onClick={clear} disabled={isPending} className="text-xs text-slate-400 hover:text-slate-300">
            Remover parceiro
          </button>
          <button onClick={promote} disabled={isPending} className="text-xs text-slate-400 hover:text-slate-300">
            Promover parceiro a titular
          </button>
        </>
      )}
      {error && <p className="w-full text-xs text-red-400">{error}</p>}
    </div>
  )
}
