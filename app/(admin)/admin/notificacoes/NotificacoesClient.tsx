'use client'
// app/(admin)/notificacoes/NotificacoesClient.tsx

import { useState, useTransition } from 'react'
import { Send, CheckCircle } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { sendNotification } from '@/features/comunidade/actions'
import type { StudentLevel, PaymentType } from '@/types'

type FilterMode = 'all' | 'by_level' | 'by_plan' | 'pwa_only'
type Channel = 'push' | 'email' | 'whatsapp'

const LEVELS: { value: StudentLevel; label: string }[] = [
  { value: 'iniciante', label: 'Iniciante' },
  { value: 'D', label: 'Nível D' },
  { value: 'C', label: 'Nível C' },
  { value: 'B', label: 'Nível B' },
  { value: 'A', label: 'Nível A' },
]

const PAYMENT_TYPES: { value: PaymentType; label: string }[] = [
  { value: 'subscriber', label: 'Assinante' },
  { value: 'per_class', label: 'Por aula' },
  { value: 'wellhub', label: 'Wellhub' },
  { value: 'totalpass', label: 'TotalPass' },
]

const NOTIFICATION_TYPES = [
  { value: 'announcement', label: 'Anúncio' },
  { value: 'event', label: 'Evento' },
  { value: 'reminder', label: 'Lembrete' },
  { value: 'alert', label: 'Alerta' },
]

export function NotificacoesClient() {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [notifType, setNotifType] = useState('announcement')
  const [filterMode, setFilterMode] = useState<FilterMode>('all')
  const [filterValue, setFilterValue] = useState('')
  const [channels, setChannels] = useState<Channel[]>(['email', 'whatsapp'])
  const [error, setError] = useState<string | null>(null)
  const [successCount, setSuccessCount] = useState<number | null>(null)
  const [isPending, startTransition] = useTransition()

  function toggleChannel(channel: Channel) {
    setChannels((prev) =>
      prev.includes(channel) ? prev.filter((c) => c !== channel) : [...prev, channel],
    )
  }

  function handleSubmit() {
    setError(null)
    setSuccessCount(null)

    if (!title.trim() || !body.trim()) {
      setError('Título e mensagem são obrigatórios.')
      return
    }

    if (channels.length === 0) {
      setError('Selecione pelo menos um canal de envio.')
      return
    }

    if ((filterMode === 'by_level' || filterMode === 'by_plan') && !filterValue) {
      setError('Selecione um valor para o filtro.')
      return
    }

    startTransition(async () => {
      const result = await sendNotification({
        title: title.trim(),
        body: body.trim(),
        type: notifType,
        filterMode,
        filterValue: filterValue || undefined,
        channels,
      })

      if (result?.error) {
        setError(result.error)
      } else {
        setSuccessCount(result?.sentCount ?? 0)
        setTitle('')
        setBody('')
        setNotifType('announcement')
        setFilterMode('all')
        setFilterValue('')
        setChannels(['email', 'whatsapp'])
      }
    })
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Notificações</h1>
        <p className="text-slate-400 mt-1 text-sm">
          Envie notificações para alunos segmentados por nível, plano ou dispositivo.
        </p>
      </div>

      {successCount !== null && (
        <div className="flex items-center gap-3 bg-green-500/10 border border-green-500/30 rounded-xl px-4 py-3">
          <CheckCircle size={20} className="text-green-400 flex-shrink-0" />
          <p className="text-green-400 text-sm">
            Notificação enviada para <strong>{successCount}</strong>{' '}
            {successCount === 1 ? 'aluno' : 'alunos'} com sucesso!
          </p>
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      <Card>
        <div className="space-y-5">
          {/* Notification type */}
          <div>
            <label className="text-sm font-medium text-slate-300 block mb-2">Tipo</label>
            <div className="flex flex-wrap gap-2">
              {NOTIFICATION_TYPES.map((t) => (
                <button
                  key={t.value}
                  onClick={() => setNotifType(t.value)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    notifType === t.value
                      ? 'bg-brand-600 text-white'
                      : 'bg-surface border border-surface-border text-slate-400 hover:text-white hover:border-brand-600/50'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Title */}
          <Input
            label="Título"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ex: Torneio de duplas neste sábado!"
            disabled={isPending}
          />

          {/* Body */}
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-slate-300">Mensagem</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Detalhes da notificação…"
              rows={4}
              disabled={isPending}
              className="w-full resize-none rounded-lg bg-surface border border-surface-border px-3 py-2 text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent disabled:opacity-50 text-sm"
            />
          </div>

          {/* Channels */}
          <div>
            <label className="text-sm font-medium text-slate-300 block mb-2">Canais</label>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  { value: 'push' as Channel, label: 'Push (PWA)', description: 'App / navegador', disabled: false },
                  { value: 'email' as Channel, label: 'E-mail', description: 'Via Resend', disabled: false },
                  { value: 'whatsapp' as Channel, label: 'WhatsApp', description: 'Via Z-API', disabled: false },
                ] as const
              ).map((c) => (
                <button
                  key={c.value}
                  onClick={() => { if (!c.disabled) toggleChannel(c.value) }}
                  disabled={c.disabled}
                  className={`flex flex-col items-start px-3 py-2 rounded-lg text-sm transition-colors border ${
                    c.disabled
                      ? 'bg-surface border-surface-border text-slate-600 opacity-50 cursor-not-allowed'
                      : channels.includes(c.value)
                      ? 'bg-brand-600/20 border-brand-600 text-brand-400'
                      : 'bg-surface border-surface-border text-slate-400 hover:border-brand-600/50 hover:text-white'
                  }`}
                >
                  <span className="font-medium">{c.label}</span>
                  <span className="text-xs opacity-70">{c.description}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Filter mode */}
          <div>
            <label className="text-sm font-medium text-slate-300 block mb-2">Destinatários</label>
            <div className="flex flex-col gap-2">
              {(
                [
                  { value: 'all' as FilterMode, label: 'Todos os alunos ativos', disabled: false },
                  { value: 'by_level' as FilterMode, label: 'Por nível', disabled: false },
                  { value: 'by_plan' as FilterMode, label: 'Por tipo de plano', disabled: false },
                  { value: 'pwa_only' as FilterMode, label: 'Somente alunos com PWA instalado (em breve)', disabled: true },
                ] as const
              ).map((f) => (
                <label
                  key={f.value}
                  className={`flex items-center gap-3 group ${f.disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  <input
                    type="radio"
                    name="filterMode"
                    value={f.value}
                    checked={filterMode === f.value}
                    disabled={f.disabled}
                    onChange={() => {
                      if (f.disabled) return
                      setFilterMode(f.value)
                      setFilterValue('')
                    }}
                    className="accent-brand-600"
                  />
                  <span className="text-sm text-slate-300 group-hover:text-white transition-colors">
                    {f.label}
                  </span>
                </label>
              ))}
            </div>

            {/* Filter value selector */}
            {filterMode === 'by_level' && (
              <div className="mt-3 flex flex-wrap gap-2">
                {LEVELS.map((l) => (
                  <button
                    key={l.value}
                    onClick={() => setFilterValue(l.value)}
                    className={`px-3 py-1.5 rounded-lg text-sm transition-colors border ${
                      filterValue === l.value
                        ? 'bg-brand-600 border-brand-600 text-white'
                        : 'bg-surface border-surface-border text-slate-400 hover:text-white hover:border-brand-600/50'
                    }`}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            )}

            {filterMode === 'by_plan' && (
              <div className="mt-3 flex flex-wrap gap-2">
                {PAYMENT_TYPES.map((pt) => (
                  <button
                    key={pt.value}
                    onClick={() => setFilterValue(pt.value)}
                    className={`px-3 py-1.5 rounded-lg text-sm transition-colors border ${
                      filterValue === pt.value
                        ? 'bg-brand-600 border-brand-600 text-white'
                        : 'bg-surface border-surface-border text-slate-400 hover:text-white hover:border-brand-600/50'
                    }`}
                  >
                    {pt.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Preview */}
          {(title || body) && (
            <div className="bg-surface rounded-xl border border-surface-border p-4 space-y-1">
              <p className="text-xs text-slate-500 uppercase tracking-wide font-medium mb-2">
                Pré-visualização
              </p>
              <div className="flex items-start gap-2">
                <Badge variant="level">{notifType}</Badge>
              </div>
              {title && <p className="text-white font-semibold text-sm">{title}</p>}
              {body && <p className="text-slate-300 text-sm">{body}</p>}
            </div>
          )}
        </div>
      </Card>

      {/* Submit */}
      <div className="flex justify-end">
        <Button
          onClick={handleSubmit}
          disabled={isPending || !title.trim() || !body.trim() || channels.length === 0}
          loading={isPending}
          size="lg"
        >
          <Send size={16} className="mr-2" />
          Enviar notificação
        </Button>
      </div>
    </div>
  )
}
