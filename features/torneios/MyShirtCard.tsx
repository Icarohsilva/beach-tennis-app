'use client'
// features/torneios/MyShirtCard.tsx
// "Falta o tamanho da sua camisa" — para quem se inscreveu ANTES de o torneio
// passar a dar camisa.
//
// Existe porque ligar a camisa depois deixa todo mundo que já entrou sem
// tamanho, e a alternativa era o admin perguntar um por um no grupo — que é
// exatamente o trabalho que este recurso veio matar. O aluno resolve sozinho,
// na mesma tela em que vê o torneio.
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { ShirtFields } from './ShirtFields'
import { setEntryShirt } from './configActions'
import { suggestShirtName } from '@/lib/torneios/shirt'

export function MyShirtCard({
  entryId,
  askName = false,
  myName = '',
}: {
  entryId: string
  /** A camisa é estampada (shirtConfig().name). */
  askName?: boolean
  /** Nome do cadastro, para sugerir o primeiro nome na estampa. */
  myName?: string
}) {
  const router = useRouter()
  const [size, setSize] = useState('')
  const [name, setName] = useState(() => suggestShirtName(myName))
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [isPending, startTransition] = useTransition()

  function save() {
    setError(null)
    startTransition(async () => {
      const r = await setEntryShirt(entryId, { size, name: askName ? name : undefined })
      if (r.error) { setError(r.error); return }
      setSaved(true)
      router.refresh()
    })
  }

  if (saved) {
    return (
      <div className="rounded-xl border border-green-700/40 bg-green-900/20 px-3 py-2">
        <p className="text-sm font-semibold text-green-300">✓ Tamanho registrado</p>
      </div>
    )
  }

  return (
    <div className="space-y-2 rounded-xl border border-brand-500/40 bg-brand-500/10 p-3">
      <div>
        <p className="text-sm font-semibold text-brand-200">Falta a sua camisa</p>
        <p className="mt-0.5 text-xs text-slate-300">
          Este torneio dá camisa e você se inscreveu antes disso. Informe o tamanho para a
          arena conseguir encomendar a sua.
        </p>
      </div>
      <ShirtFields
        size={size}
        onSize={setSize}
        name={name}
        onName={setName}
        askName={askName}
      />
      <Button
        size="sm"
        loading={isPending}
        disabled={!size || (askName && !name.trim())}
        onClick={save}
      >
        Salvar
      </Button>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}
