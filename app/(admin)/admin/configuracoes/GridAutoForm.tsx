'use client'
import { useState, useTransition } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { updateSystemSettings } from '@/features/financeiro/actions'

const DAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
const SELECT_CLS = 'w-full bg-surface border border-surface-border rounded-lg px-3 py-2 text-sm text-white disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-brand-500'

interface Props {
  settings: { grid_auto_enabled: boolean; grid_auto_day: number; grid_auto_hour: number }
}

export function GridAutoForm({ settings }: Props) {
  const [enabled, setEnabled] = useState(settings.grid_auto_enabled)
  const [day, setDay] = useState(settings.grid_auto_day)
  const [hour, setHour] = useState(settings.grid_auto_hour)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    start(async () => {
      const r = await updateSystemSettings({
        grid_auto_enabled: enabled,
        grid_auto_day: day,
        grid_auto_hour: hour,
      })
      if (r.error) setError(r.error)
      else setSuccess('Geração automática salva.')
    })
  }

  return (
    <Card>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>}
        {success && <p className="text-sm text-green-400 bg-green-500/10 border border-green-500/30 rounded-lg px-3 py-2">{success}</p>}

        <label className="flex items-center gap-2 text-sm text-slate-300 font-medium">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="w-4 h-4 accent-brand-500" />
          Gerar a grade da próxima semana automaticamente
        </label>
        <p className="text-xs text-slate-400">
          Quando ligado, o sistema gera as sessões da semana e reserva os alunos fixos no dia e hora escolhidos. Desligado, use os botões “Gerar” na grade.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-sm text-slate-300 font-medium">Dia</label>
            <select
              value={day}
              onChange={(e) => setDay(Number(e.target.value))}
              disabled={!enabled}
              className={SELECT_CLS}
            >
              {DAYS.map((d, i) => (
                <option key={i} value={i}>{d}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-sm text-slate-300 font-medium">Hora</label>
            <select
              value={hour}
              onChange={(e) => setHour(Number(e.target.value))}
              disabled={!enabled}
              className={SELECT_CLS}
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
              ))}
            </select>
          </div>
        </div>

        <Button type="submit" variant="primary" loading={pending}>Salvar geração automática</Button>
      </form>
    </Card>
  )
}
