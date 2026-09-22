'use client'
// app/(admin)/admin/torneios/[id]/editar/TournamentShirtsCard.tsx
// Ligar a camisa num torneio que JÁ EXISTE.
//
// A chave nasceu só no formulário de criação, e a decisão de dar camisa quase
// sempre vem depois — quando a arena fecha o patrocínio, com gente já inscrita.
// Sem esta tela o recurso só servia para torneio criado do zero.
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { updateTournamentShirts } from '@/features/torneios/configActions'

export function TournamentShirtsCard({
  tournamentId,
  initialSizes,
  initialNames,
}: {
  tournamentId: string
  initialSizes: boolean
  initialNames: boolean
}) {
  const router = useRouter()
  const [sizes, setSizes] = useState(initialSizes)
  const [names, setNames] = useState(initialNames)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function save() {
    setError(null)
    setMessage(null)
    startTransition(async () => {
      const r = await updateTournamentShirts(tournamentId, { sizes, names })
      if (r.error) { setError(r.error); return }
      // Ligar a camisa com gente já dentro deixa buraco na planilha. Dizer
      // quantos faltam AQUI é o que evita o admin descobrir isso na confecção.
      setMessage(
        r.missing
          ? `Salvo. ${r.missing} inscrito(s) já confirmado(s) estão sem tamanho — preencha na lista de inscritos ou peça a eles pelo app.`
          : 'Salvo.',
      )
      router.refresh()
    })
  }

  return (
    <Card className="space-y-3">
      <div>
        <h2 className="text-base font-semibold text-white">Camisa</h2>
        <p className="mt-0.5 text-xs text-slate-400">
          Ligada, a inscrição passa a pedir o tamanho e a planilha de encomenda aparece na
          tela do torneio.
        </p>
      </div>

      <label className="flex items-start gap-2 rounded-lg border border-surface-border bg-surface px-3 py-2">
        <input
          type="checkbox"
          checked={sizes}
          onChange={(e) => setSizes(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-brand-500"
        />
        <span className="min-w-0">
          <span className="block text-sm font-medium text-slate-200">Este torneio dá camisa</span>
          <span className="block text-xs text-slate-500">Pede o tamanho na inscrição.</span>
        </span>
      </label>

      {sizes && (
        <label className="ml-6 flex items-start gap-2 rounded-lg border border-surface-border bg-surface px-3 py-2">
          <input
            type="checkbox"
            checked={names}
            onChange={(e) => setNames(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-brand-500"
          />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-slate-200">Com nome estampado</span>
            <span className="block text-xs text-slate-500">
              Pede também o nome que vai na camisa — o primeiro nome ou o apelido.
            </span>
          </span>
        </label>
      )}

      <Button size="sm" loading={isPending} onClick={save}>
        Salvar
      </Button>

      {error && <p className="text-xs text-red-400">{error}</p>}
      {message && <p className="text-xs text-green-400">{message}</p>}
    </Card>
  )
}
