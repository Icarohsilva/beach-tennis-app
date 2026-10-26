'use client'
// app/(admin)/admin/torneios/[id]/editar/TournamentDrawRulesCard.tsx
// Regra de gênero do sorteio do Super. Uma por torneio:
//   • livre: todos jogam com todos (método do círculo);
//   • sem dupla masculina: todo homem joga com uma mulher;
//   • confrontos do mesmo tipo: MM x MM, FF x FF ou misto x misto, nunca dupla
//     masculina contra mista (o "3 homens e 1 mulher").
// As regras moram em lib/torneios/schedule/americanoMixed.ts.
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { updateTournamentDrawRules, type DrawGenderRule } from '@/features/torneios/configActions'
import { cn } from '@/lib/utils/cn'

const OPTIONS: { value: DrawGenderRule; label: string; hint: string }[] = [
  {
    value: 'free',
    label: 'Livre',
    hint: 'Todos jogam com todos, independente do sexo.',
  },
  {
    value: 'same_type',
    label: 'Confrontos do mesmo tipo',
    hint: 'Dupla masculina contra masculina, feminina contra feminina e mista contra mista. Nunca 3 homens e 1 mulher na quadra. Ideal com o mesmo número de homens e mulheres.',
  },
  {
    value: 'no_male_pairs',
    label: 'Não permitir dupla masculina',
    hint: 'Todo homem joga com uma mulher de parceira. Jogos: misto x misto, misto x feminino e feminino x feminino.',
  },
]

export function TournamentDrawRulesCard({
  tournamentId,
  initialRule,
  hasMatches,
}: {
  tournamentId: string
  initialRule: DrawGenderRule
  hasMatches: boolean
}) {
  const router = useRouter()
  const [rule, setRule] = useState<DrawGenderRule>(initialRule)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const dirty = rule !== initialRule

  function save() {
    setError(null)
    setMessage(null)
    startTransition(async () => {
      const r = await updateTournamentDrawRules(tournamentId, { rule })
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
          No Super o parceiro muda a cada rodada. A regra vale para o sorteio de todas as rodadas e
          usa o sexo do cadastro de cada atleta.
        </p>
      </div>

      <div className="space-y-2" role="radiogroup" aria-label="Regra do sorteio">
        {OPTIONS.map((o) => (
          <label
            key={o.value}
            className={cn(
              'flex cursor-pointer items-start gap-2 rounded-lg border bg-surface px-3 py-2',
              rule === o.value ? 'border-brand-500' : 'border-surface-border',
            )}
          >
            <input
              type="radio"
              name="draw-rule"
              value={o.value}
              checked={rule === o.value}
              onChange={() => { setRule(o.value); setMessage(null) }}
              className="mt-0.5 h-4 w-4 shrink-0 accent-brand-500"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-slate-200">{o.label}</span>
              <span className="block text-xs text-slate-500">{o.hint}</span>
            </span>
          </label>
        ))}
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {message && <p className="text-sm text-green-400">{message}</p>}

      <Button size="sm" loading={isPending} disabled={!dirty} onClick={save}>
        Salvar
      </Button>
    </Card>
  )
}
