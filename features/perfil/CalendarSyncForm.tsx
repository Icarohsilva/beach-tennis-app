'use client'
// features/perfil/CalendarSyncForm.tsx
import { useState, useTransition } from 'react'
import {
  enableCalendarSync,
  disableCalendarSync,
  regenerateCalendarToken,
} from './calendarSyncActions'

interface Props {
  enabled: boolean
  /** URL já pronta (feedUrl(token)) quando a academia já tinha token gerado. */
  url: string | null
}

export function CalendarSyncForm({ enabled, url }: Props) {
  const [checked, setChecked] = useState(enabled)
  const [feedUrl, setFeedUrl] = useState(url)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [pending, startTransition] = useTransition()

  function handleToggle(next: boolean) {
    setChecked(next)
    setError(null)
    startTransition(async () => {
      if (next) {
        const result = await enableCalendarSync()
        if (result.error) {
          setError(result.error)
          setChecked(false)
          return
        }
        if (result.url) setFeedUrl(result.url)
        return
      }

      const result = await disableCalendarSync()
      if (result.error) {
        setError(result.error)
        // Desfaz o toggle: a tela não pode dizer que salvou quando não salvou.
        setChecked(true)
      }
    })
  }

  function handleRegenerate() {
    setError(null)
    startTransition(async () => {
      const result = await regenerateCalendarToken()
      if (result.error) {
        setError(result.error)
        return
      }
      if (result.url) setFeedUrl(result.url)
    })
  }

  async function copy() {
    if (!feedUrl) return
    await navigator.clipboard.writeText(feedUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-red-400">{error}</p>}

      <label className="flex items-start gap-2 text-sm text-slate-300">
        <input
          type="checkbox"
          checked={checked}
          disabled={pending}
          onChange={(e) => handleToggle(e.target.checked)}
          className="mt-1 w-4 h-4 accent-brand-500"
        />
        <span>
          Sincronizar minha agenda
          <span className="block text-xs text-slate-500">
            Suas aulas aparecem sozinhas no seu calendário (Google, Outlook, Apple ou
            Android) — sem precisar adicionar de novo a cada aula.
          </span>
        </span>
      </label>

      {checked && feedUrl && (
        <div className="rounded-xl border border-surface-border bg-surface p-3 space-y-3">
          <div>
            <div className="bg-surface-card border border-surface-border rounded-lg px-3 py-2 text-xs text-slate-300 break-all">
              {feedUrl}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={copy}
                className="text-xs font-semibold text-brand-500 hover:underline"
              >
                {copied ? 'Copiado!' : 'Copiar link'}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={handleRegenerate}
                className="text-xs text-slate-400 hover:text-slate-300 underline disabled:opacity-50"
              >
                Gerar novo link
              </button>
            </div>
          </div>

          <div className="text-xs text-slate-500 space-y-1">
            <p className="font-semibold text-slate-400">Como assinar:</p>
            <p>
              <b>Google Agenda:</b> Configurações → Adicionar agenda → Por URL → cole o
              link.
            </p>
            <p>
              <b>Outlook:</b> Adicionar calendário → Assinar da web → cole o link.
            </p>
            <p>
              <b>Apple/iOS:</b> Ajustes → Calendário → Contas → Adicionar Conta → Outro →
              Calendário Assinado → cole o link.
            </p>
            <p className="pt-1">
              A atualização não é instantânea — cada app decide de quanto em quanto tempo
              busca de novo (geralmente entre 15 minutos e algumas horas).
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
