'use client'
// features/liga/KudosCard.tsx
// Elogiar um colega e ver os últimos elogios da academia (spec §Fase 3).
import { useState, useTransition } from 'react'
import { Heart, Send } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { PlayerAvatar } from '@/features/torneios/PlayerAvatar'
import { cn } from '@/lib/utils/cn'
import {
  KUDOS_CATEGORIES,
  KUDOS_CATEGORY_LABEL,
  MAX_KUDOS_MESSAGE,
  type KudosCategory,
} from '@/lib/liga/kudos'
import { sendLigaKudos } from './kudosActions'
import type { KudosView } from './queries'

interface Props {
  peers: { id: string; name: string }[]
  recent: KudosView[]
  sport: string
  /** Quantos elogios ainda pontuam por semana, para explicar o teto ao aluno. */
  weeklyCap: number
}

const SELECT_CLS =
  'w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-brand-500'

export function KudosCard({ peers, recent, sport, weeklyCap }: Props) {
  const [open, setOpen] = useState(false)
  const [toStudentId, setToStudentId] = useState('')
  const [category, setCategory] = useState<KudosCategory>('evoluiu')
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setOk(null)
    if (!toStudentId) {
      setError('Escolha o colega.')
      return
    }

    startTransition(async () => {
      const result = await sendLigaKudos({ toStudentId, sport, category, message })
      if (result.error) {
        setError(result.error)
        return
      }
      setMessage('')
      setToStudentId('')
      setOpen(false)
      // Sinceridade sobre a trava: o elogio foi enviado de qualquer jeito, mas quem
      // passou do teto precisa saber por que não vieram os pontos.
      setOk(
        result.earnedPoints
          ? 'Elogio enviado. Ele ganhou pontos por isso.'
          : `Elogio enviado. Esse não valeu ponto: você já usou seus ${weeklyCap} da semana ou vocês se elogiaram na mesma semana.`,
      )
    })
  }

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs tracking-wide text-slate-400">ELOGIOS DA GALERA</p>
        {peers.length > 0 && (
          <button
            onClick={() => {
              setOpen((v) => !v)
              setOk(null)
            }}
            className="inline-flex items-center gap-1 rounded-full border border-brand-500/40 bg-brand-500/10 px-2.5 py-1 text-[11px] font-semibold text-brand-500 transition-colors hover:bg-brand-500/20"
          >
            <Heart className="h-3 w-3" />
            {open ? 'Fechar' : 'Elogiar alguém'}
          </button>
        )}
      </div>

      {ok && (
        <p className="mb-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
          {ok}
        </p>
      )}

      {open && (
        <form onSubmit={handleSubmit} className="mb-4 space-y-3">
          {error && (
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
              {error}
            </p>
          )}

          <select
            value={toStudentId}
            onChange={(e) => setToStudentId(e.target.value)}
            className={SELECT_CLS}
          >
            <option value="">Quem você quer elogiar?</option>
            {peers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          <div className="flex flex-wrap gap-1.5">
            {KUDOS_CATEGORIES.map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() => setCategory(c.value)}
                title={c.hint}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-[11px] transition-colors',
                  category === c.value
                    ? 'border-brand-500 bg-brand-500/15 text-brand-400'
                    : 'border-surface-border text-slate-400 hover:text-slate-200',
                )}
              >
                {c.label}
              </button>
            ))}
          </div>

          <div>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value.slice(0, MAX_KUDOS_MESSAGE))}
              rows={2}
              placeholder="Escreva o recado. Ele vai aparecer para a academia."
              className="w-full resize-none rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
            <p className="mt-1 text-right text-[10px] text-slate-600">
              {message.length}/{MAX_KUDOS_MESSAGE}
            </p>
          </div>

          <Button type="submit" variant="primary" loading={pending} className="w-full">
            <Send className="mr-1.5 h-3.5 w-3.5" />
            Enviar elogio
          </Button>
        </form>
      )}

      {recent.length === 0 ? (
        <p className="text-sm text-slate-400">
          Ninguém elogiou ninguém ainda. Puxe o primeiro: quem recebe ganha mais ponto que quem
          dá.
        </p>
      ) : (
        <ul className="space-y-2.5">
          {recent.map((k) => (
            <li key={k.id} className="flex items-start gap-2.5">
              <PlayerAvatar name={k.fromName} size="sm" tone={k.fromMe ? 'brand' : 'slate'} />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-slate-400">
                  <span className={cn(k.fromMe && 'font-semibold text-brand-400')}>
                    {k.fromMe ? 'Você' : k.fromName.split(' ')[0]}
                  </span>{' '}
                  elogiou{' '}
                  <span className={cn('text-slate-300', k.toMe && 'font-semibold text-brand-400')}>
                    {k.toMe ? 'você' : k.toName.split(' ')[0]}
                  </span>
                  {': '}
                  <span className="text-slate-500">
                    {KUDOS_CATEGORY_LABEL[k.category as KudosCategory] ?? k.category}
                  </span>
                </p>
                <p className="text-sm text-slate-200">{k.message}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
