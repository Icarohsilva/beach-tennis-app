'use client'
// app/arenas/[slug]/TrialBookingForm.tsx

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { createTrialBooking } from './actions'
import { formatDate, formatTime } from '@/lib/utils/dateHelpers'
import type { TrialSessionOption } from '@/lib/arenas/sessions'

interface TrialBookingFormProps {
  organizationId: string
  sessions: TrialSessionOption[]
}

export function TrialBookingForm({ organizationId, sessions }: TrialBookingFormProps) {
  const [selectedSessionId, setSelectedSessionId] = useState<string>(sessions[0]?.id ?? '')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!selectedSessionId) {
      setError('Selecione uma sessão.')
      return
    }

    startTransition(async () => {
      const result = await createTrialBooking(organizationId, selectedSessionId, name, email, phone)
      if (result.error) {
        setError(result.error)
        return
      }
      setSuccess(true)
    })
  }

  if (success) {
    return (
      <div className="text-center py-6 space-y-3">
        <div className="text-4xl">🎾</div>
        <h2 className="text-white font-bold text-lg">Agendamento confirmado!</h2>
        <p className="text-slate-400 text-sm">
          Enviamos as instruções para o seu e-mail. Nos vemos por aí!
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label className="block text-sm font-medium text-slate-300 mb-2">Escolha uma sessão</label>
        <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
          {sessions.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSelectedSessionId(s.id)}
              className={[
                'w-full text-left px-4 py-3 rounded-xl border transition-colors',
                selectedSessionId === s.id
                  ? 'border-brand-500 bg-brand-500/10'
                  : 'border-surface-border bg-surface-card hover:border-slate-500',
              ].join(' ')}
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-white text-sm font-medium">{s.class_name}</p>
                  <p className="text-slate-400 text-xs mt-0.5">
                    {formatDate(s.session_date)} · {formatTime(s.start_time)}–{formatTime(s.end_time)}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <Badge variant="level">{s.level.toUpperCase()}</Badge>
                  <span className="text-xs text-slate-500">{s.spots_left} vagas</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <Input
          label="Nome completo"
          placeholder="Seu nome"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <Input
          label="E-mail"
          type="email"
          placeholder="seu@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <Input
          label="Telefone / WhatsApp"
          type="tel"
          placeholder="(11) 99999-9999"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          required
        />
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      <Button type="submit" variant="primary" size="lg" loading={isPending} className="w-full">
        Agendar aula gratuita
      </Button>

      <p className="text-xs text-slate-500 text-center">
        Ao agendar você concorda com os termos de uso. Primeira aula gratuita.
      </p>
    </form>
  )
}
