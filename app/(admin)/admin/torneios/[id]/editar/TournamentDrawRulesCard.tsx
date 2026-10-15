'use client'
// app/(admin)/admin/torneios/[id]/editar/TournamentDrawRulesCard.tsx
// Regra do sorteio do Super: "Não permitir dupla masculina". Ligada, todo homem
// joga com uma mulher de parceira em todas as rodadas. A regra mora em
// lib/torneios/schedule/americanoMixed.ts; aqui é só a chave.
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { updateTournamentDrawRules } from '@/features/torneios/configActions'

export function TournamentDrawRulesCard({
  tournamentId,
  initialNoMalePairs,
  hasMatches,
}: {
  tournamentId: string
  initialNoMalePairs: boolean
  hasMatches: boolean
}) {
  const router = useRouter()
  const [noMalePairs, setNoMalePairs] = useState(initialNoMalePairs)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const dirty = noMalePairs !== initialNoMalePairs

  function save() {
    setError(null)
    setMessage(null)
    startTransition(async () => {
      const r = await updateTournamentDrawRules(tournamentId, { noMalePairs })
      if (r.error) { setError(r.error); return }
      setMessage(
        hasMatches
          ? 'Salvo. As rodadas já sorteadas não mudam: use "Sortear de novo" na tela do torneio (só enquanto nenhum placar foi lançado).'
          : 'Salvo. A regra vale quando você gerar a chave.',
      )
      router.refresh()
    })
  }

  return (
    <Card className="space-y-3">
      <div>
        <h2 className="text-base font-semibold text-white">Sorteio das duplas</h2>
        <p className="mt-0.5 text-xs text-slate-400">
          No Super o parceiro muda a cada rodada. Esta regra vale para o sorteio de todas as rodadas.
        </p>
      </div>

      <label className="flex items-start gap-2 rounded-lg border border-surface-border bg-surface px-3 py-2">
        <input
          type="checkbox"
          checked={noMalePairs}
          onChange={(e) => { setNoMalePairs(e.target.checked); setMessage(null) }}
          className="mt-0.5 h-4 w-4 accent-brand-500"
        />
        <span className="min-w-0">
          <span className="block text-sm font-medium text-slate-200">Não permitir dupla masculina</span>
          <span className="block text-xs text-slate-500">
            Todo homem joga com uma mulher de parceira. Jogos possíveis: misto x misto, misto x
            feminino e feminino x feminino. Usa o gênero do cadastro de cada atleta.
          </span>
        </span>
      </label>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {message && <p className="text-sm text-green-400">{message}</p>}

      <Button size="sm" loading={isPending} disabled={!dirty} onClick={save}>
        Salvar
      </Button>
    </Card>
  )
}
