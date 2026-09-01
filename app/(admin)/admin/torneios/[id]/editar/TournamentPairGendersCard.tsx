'use client'
// app/(admin)/admin/torneios/[id]/editar/TournamentPairGendersCard.tsx
// Quem pode entrar (e, em dupla fixa, com quem pode parear) por gênero.
//
// createTournament já deriva o valor inicial da categoria — "Masculino" nasce
// só-MM, "Feminino" só-FF. Este card é para o torneio que nasceu antes dessa
// regra existir, ou para o caso raro de mudar a formação depois. Sem
// inscrição ainda: mudar a regra com gente já inscrita fica bloqueado no
// servidor (poderia deixar alguém fora do que passaria a valer).
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { updateTournamentPairGenders } from '@/features/torneios/configActions'
import { PAIR_PRESETS, pairGendersLabel } from '@/lib/torneios/pairRules'
import type { PairGenders } from '@/types'

interface Props {
  tournamentId: string
  allowedPairGenders: PairGenders[]
  participantType: 'individual' | 'dupla_fixa' | 'dupla_revezando'
  hasEntries: boolean
}

export function TournamentPairGendersCard({
  tournamentId,
  allowedPairGenders,
  participantType,
  hasEntries,
}: Props) {
  const [selected, setSelected] = useState(() => pairGendersLabel(allowedPairGenders))
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  const preset = PAIR_PRESETS.find((p) => p.label === selected) ?? PAIR_PRESETS[0]
  const dirty = pairGendersLabel(allowedPairGenders) !== selected

  function handleSave() {
    setError(null)
    setSuccess(false)
    startTransition(async () => {
      const result = await updateTournamentPairGenders(tournamentId, preset.allowed)
      if (result.error) setError(result.error)
      else {
        setSuccess(true)
        router.refresh()
      }
    })
  }

  return (
    <Card>
      <h2 className="text-base font-semibold text-white mb-1">Quem pode entrar</h2>
      <p className="text-xs text-slate-400 mb-4">
        {participantType === 'dupla_fixa'
          ? 'Formação da dupla aceita neste torneio.'
          : 'Gênero admitido na inscrição (aqui não há parceiro fixo para formar par).'}
      </p>

      {hasEntries ? (
        <p className="text-sm text-slate-300">
          <strong className="font-semibold text-white">{pairGendersLabel(allowedPairGenders)}</strong>
          <span className="block mt-1 text-xs text-slate-500">
            Já tem inscrição neste torneio — para trocar a regra, revise as inscrições antes.
          </span>
        </p>
      ) : (
        <div className="space-y-3">
          <select
            value={selected}
            onChange={(e) => { setSelected(e.target.value); setSuccess(false) }}
            className="w-full rounded-lg bg-surface-card border border-surface-border px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            {PAIR_PRESETS.map((p) => (
              <option key={p.label} value={p.label}>{p.label}</option>
            ))}
          </select>
          <p className="text-xs text-slate-500">{preset.hint}</p>

          {error && <p className="text-sm text-red-400">{error}</p>}
          {success && !dirty && <p className="text-sm text-green-400">Salvo.</p>}

          <Button size="sm" loading={isPending} disabled={!dirty} onClick={handleSave}>
            Salvar
          </Button>
        </div>
      )}
    </Card>
  )
}
