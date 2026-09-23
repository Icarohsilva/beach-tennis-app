'use client'
// app/(admin)/admin/torneios/[id]/editar/TournamentLevelCard.tsx
// Nível de um torneio já criado.
//
// O formulário de criação gravava 'iniciante' fixo, então todo torneio antigo
// nasceu Iniciante — inclusive o Avançado, que a página do evento mostrava com
// o chip "Iniciante". Este card conserta os que já existem.
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { updateTournamentLevel } from '@/features/torneios/configActions'
import { LEVEL_ORDER, levelLabel } from '@/lib/torneios/sportProfile'
import type { StudentLevel } from '@/types'

const SELECT_CLS =
  'w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-brand-500'

export function TournamentLevelCard({
  tournamentId,
  initialLevel,
  sport,
}: {
  tournamentId: string
  initialLevel: StudentLevel
  sport: string | null
}) {
  const router = useRouter()
  const [level, setLevel] = useState<StudentLevel>(initialLevel)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [isPending, startTransition] = useTransition()

  function save() {
    setError(null)
    setSaved(false)
    startTransition(async () => {
      const r = await updateTournamentLevel(tournamentId, level)
      if (r.error) { setError(r.error); return }
      setSaved(true)
      router.refresh()
    })
  }

  return (
    <Card className="space-y-3">
      <div>
        <h2 className="text-base font-semibold text-white">Nível</h2>
        <p className="mt-0.5 text-xs text-slate-400">
          É o chip que aparece no card do torneio e o filtro da vitrine.
        </p>
      </div>
      <select
        value={level}
        onChange={(e) => { setLevel(e.target.value as StudentLevel); setSaved(false) }}
        className={SELECT_CLS}
      >
        {LEVEL_ORDER.map((l) => (
          <option key={l} value={l}>{levelLabel(l, sport)}</option>
        ))}
      </select>
      <Button size="sm" loading={isPending} disabled={level === initialLevel && !saved} onClick={save}>
        Salvar
      </Button>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {saved && <p className="text-xs text-green-400">Salvo.</p>}
    </Card>
  )
}
