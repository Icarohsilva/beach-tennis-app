'use client'
// app/(admin)/admin/torneios/[id]/editar/TournamentContentForm.tsx
import { useState, useTransition } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { MarkdownDoc } from '@/components/docs/MarkdownDoc'
import { updateTournamentContent } from '@/features/torneios/configActions'
import { brtLocalToIso, isoToBrtLocalInput } from '@/lib/torneios/matchTime'
import type { ResolvedText } from '@/lib/torneios/content'

interface OwnContent {
  description: string | null
  rules: string | null
  venue: string | null
  start_time: string | null
  registration_deadline: string | null
}

interface Props {
  tournamentId: string
  tournamentDate: string
  own: OwnContent
  resolved: { description: ResolvedText | null; rules: ResolvedText | null; venue: ResolvedText | null }
}

/**
 * Um textarea/input que pode herdar do evento: vazio mostra o texto herdado
 * como placeholder + um "Ver texto herdado", e ganha "Voltar a usar o do
 * evento" quando o próprio torneio tem valor que sobrescreve.
 */
function InheritableField({
  label,
  value,
  onChange,
  resolved,
  onClearToInherit,
  multiline,
  disabled,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  resolved: ResolvedText | null
  onClearToInherit: () => void
  multiline?: boolean
  disabled?: boolean
}) {
  const isOverriding = value.trim().length > 0
  const inheritedFromEvent = !isOverriding && resolved?.origin === 'event'

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <label className="text-sm font-medium text-slate-300">{label}</label>
        {isOverriding && resolved && (
          <button
            type="button"
            onClick={onClearToInherit}
            disabled={disabled}
            className="text-xs text-brand-400 hover:text-brand-300"
          >
            Voltar a usar o do evento
          </button>
        )}
      </div>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={
            inheritedFromEvent
              ? `Herdado do evento ${resolved?.sourceName} — escreva aqui só para sobrescrever`
              : undefined
          }
          rows={5}
          disabled={disabled}
          className="w-full resize-none rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent disabled:opacity-50"
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={
            inheritedFromEvent
              ? `Herdado do evento ${resolved?.sourceName} — escreva aqui só para sobrescrever`
              : undefined
          }
          disabled={disabled}
          className="w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent disabled:opacity-50"
        />
      )}
      {inheritedFromEvent && (
        <details className="text-xs text-slate-500">
          <summary className="cursor-pointer hover:text-slate-300">Ver texto herdado</summary>
          <div className="mt-2 rounded-lg border border-surface-border bg-surface-card/60 p-3">
            <MarkdownDoc content={resolved!.text} />
          </div>
        </details>
      )}
    </div>
  )
}

export function TournamentContentForm({ tournamentId, tournamentDate, own, resolved }: Props) {
  const [description, setDescription] = useState(own.description ?? '')
  const [rules, setRules] = useState(own.rules ?? '')
  const [venue, setVenue] = useState(own.venue ?? '')
  const [startTime, setStartTime] = useState((own.start_time ?? '').slice(0, 5))
  const [deadlineLocal, setDeadlineLocal] = useState(
    own.registration_deadline ? isoToBrtLocalInput(own.registration_deadline) : '',
  )
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [isPending, startTransition] = useTransition()

  function save() {
    setError(null)
    setSaved(false)
    const deadlineIso = deadlineLocal ? brtLocalToIso(deadlineLocal) : null
    if (deadlineLocal && !deadlineIso) {
      setError('Prazo de inscrição inválido.')
      return
    }
    startTransition(async () => {
      const res = await updateTournamentContent(tournamentId, {
        description,
        rules,
        venue,
        start_time: startTime ? `${startTime}:00` : null,
        registration_deadline: deadlineIso,
      })
      if (res.error) setError(res.error)
      else setSaved(true)
    })
  }

  return (
    <Card>
      <h2 className="mb-4 text-sm font-semibold text-white">Conteúdo público</h2>
      <div className="space-y-4">
        <InheritableField
          label="Descrição"
          value={description}
          onChange={setDescription}
          resolved={resolved.description}
          onClearToInherit={() => setDescription('')}
          multiline
          disabled={isPending}
        />
        <InheritableField
          label="Regulamento (markdown)"
          value={rules}
          onChange={setRules}
          resolved={resolved.rules}
          onClearToInherit={() => setRules('')}
          multiline
          disabled={isPending}
        />
        <InheritableField
          label="Local"
          value={venue}
          onChange={setVenue}
          resolved={resolved.venue}
          onClearToInherit={() => setVenue('')}
          disabled={isPending}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Horário"
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            disabled={isPending}
          />
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-slate-300">Prazo de inscrição</label>
            <input
              type="datetime-local"
              value={deadlineLocal}
              onChange={(e) => setDeadlineLocal(e.target.value)}
              disabled={isPending}
              className="w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent disabled:opacity-50"
            />
            <p className="text-xs text-slate-500">
              Vazio = inscrição só fecha quando você trocar o status. Não pode ser depois de {tournamentDate}.
            </p>
          </div>
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}
        {saved && !error && <p className="text-sm text-green-400">Salvo.</p>}

        <div className="flex justify-end">
          <Button onClick={save} loading={isPending}>
            Salvar
          </Button>
        </div>
      </div>
    </Card>
  )
}
