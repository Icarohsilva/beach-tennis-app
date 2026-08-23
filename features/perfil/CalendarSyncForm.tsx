'use client'
// features/perfil/CalendarSyncForm.tsx
// Vincular a agenda em UM toque.
//
// A primeira versão mostrava a URL do feed e mandava o aluno se virar
// ("Configurações → Adicionar agenda → Por URL → cole o link"): 4-5 passos
// dentro de um app que não é o nosso, no celular, e muita gente desistia ali.
// Agora cada botão faz o caminho inteiro — liga a sincronização (gerando o
// token na primeira vez) e abre o app de calendário já pedindo confirmação.
//
// Copiar o link continua existindo, mas como saída para quem usa um app fora
// dos três — não como o caminho normal.
import { useState, useTransition } from 'react'
import {
  enableCalendarSync,
  disableCalendarSync,
  regenerateCalendarToken,
} from './calendarSyncActions'
import {
  appleSubscribeUrl,
  googleSubscribeUrl,
  outlookSubscribeUrl,
} from '@/lib/aulas/calendarSubscribeLinks'

interface Props {
  enabled: boolean
  /** URL do feed quando a academia já gerou token; null antes da 1a ativação. */
  url: string | null
  /** Nome com que a agenda aparece na lista do aluno. */
  calendarName: string
}

type Provider = 'google' | 'apple' | 'outlook'

const PROVIDERS: { id: Provider; label: string }[] = [
  { id: 'google', label: 'Google Agenda' },
  { id: 'apple', label: 'iPhone / Apple' },
  { id: 'outlook', label: 'Outlook' },
]

export function CalendarSyncForm({ enabled, url, calendarName }: Props) {
  const [active, setActive] = useState(enabled)
  const [feedUrl, setFeedUrl] = useState(url)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [pending, startTransition] = useTransition()

  function subscribeUrl(provider: Provider, feed: string): string {
    if (provider === 'google') return googleSubscribeUrl(feed)
    if (provider === 'apple') return appleSubscribeUrl(feed)
    return outlookSubscribeUrl(feed, calendarName)
  }

  /**
   * Ativa (se preciso) e manda para o app de calendário, num toque só.
   *
   * `location.href` e não `window.open`: o bloqueador de pop-up barra
   * `window.open` disparado depois de um `await` — o clique já "esfriou" —, e o
   * botão simplesmente não faria nada em parte dos iPhones. Navegação na
   * própria aba passa.
   */
  function handleSubscribe(provider: Provider) {
    setError(null)
    startTransition(async () => {
      let feed = feedUrl
      if (!feed || !active) {
        const result = await enableCalendarSync()
        if (result.error) {
          setError(result.error)
          return
        }
        feed = result.url ?? feed
        if (feed) setFeedUrl(feed)
        setActive(true)
      }
      if (!feed) {
        setError('Não foi possível gerar seu link. Tente de novo.')
        return
      }
      window.location.href = subscribeUrl(provider, feed)
    })
  }

  function handleDisable() {
    setError(null)
    startTransition(async () => {
      const result = await disableCalendarSync()
      if (result.error) {
        setError(result.error)
        return
      }
      setActive(false)
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

      <p className="text-sm text-slate-300">
        Suas aulas no seu calendário
        <span className="block text-xs text-slate-500">
          Aula nova, cancelada ou remarcada aparece sozinha — você vincula uma vez e
          pronto.
        </span>
      </p>

      {/* Empilhado no celular (o padrão do CLAUDE.md para "lado longo numa
          linha só"), lado a lado só a partir de sm. Medido: com os três em
          linha, abaixo de ~480px o rótulo quebra em duas linhas dentro do
          botão — o defeito de rótulo-viborneando que o CLAUDE.md descreve.
          Empilhado o alvo de toque ocupa a largura inteira, que é o que se
          quer no celular de qualquer forma. */}
      <div className="flex flex-col gap-2 sm:flex-row">
        {PROVIDERS.map((p) => (
          <button
            key={p.id}
            type="button"
            disabled={pending}
            onClick={() => handleSubscribe(p.id)}
            className="flex-1 rounded-xl border border-surface-border bg-surface-card px-3 py-2.5 text-sm font-semibold text-white transition-colors hover:border-brand-500/60 disabled:opacity-50"
          >
            {p.label}
          </button>
        ))}
      </div>

      {active && (
        <p className="text-xs text-green-400">
          ✓ Agenda vinculada. Toque num app acima para adicionar em outro também.
        </p>
      )}

      <div className="space-y-1 pt-1 text-xs text-slate-500">
        <p>
          A atualização não é imediata: cada app de calendário decide de quanto em
          quanto tempo busca as aulas novas.
        </p>
        {feedUrl && (
          <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1">
            <button
              type="button"
              onClick={copy}
              className="font-semibold text-brand-500 hover:underline"
            >
              {copied ? 'Link copiado!' : 'Usa outro app? Copiar link'}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={handleRegenerate}
              className="text-slate-400 underline hover:text-slate-300 disabled:opacity-50"
            >
              Gerar novo link
            </button>
            {active && (
              <button
                type="button"
                disabled={pending}
                onClick={handleDisable}
                className="text-slate-400 underline hover:text-slate-300 disabled:opacity-50"
              >
                Desativar
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
