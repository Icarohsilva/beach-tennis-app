'use client'
import { useState, useTransition } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { updateSystemSettings } from '@/features/financeiro/actions'
import { formatDate, formatTime } from '@/lib/utils/dateHelpers'

/** Última execução em horário de parede BRT, ou null quando nunca rodou. */
function ultimaExecucaoBrt(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  // -03:00 fixo, igual ao resto do app (Brasília sem horário de verão).
  const brt = new Date(d.getTime() - 3 * 60 * 60 * 1000)
  const dia = `${brt.getUTCFullYear()}-${String(brt.getUTCMonth() + 1).padStart(2, '0')}-${String(brt.getUTCDate()).padStart(2, '0')}`
  const hora = `${String(brt.getUTCHours()).padStart(2, '0')}:${String(brt.getUTCMinutes()).padStart(2, '0')}`
  return `${formatDate(dia)} às ${formatTime(hora)}`
}

const DAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
const SELECT_CLS = 'w-full bg-surface border border-surface-border rounded-lg px-3 py-2 text-sm text-white disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-brand-500'

interface Props {
  settings: {
    grid_auto_enabled: boolean
    grid_auto_day: number
    grid_auto_hour: number
    /** ISO da última geração automática concluída. null = nunca rodou. */
    grid_auto_last_run?: string | null
  }
}

export function GridAutoForm({ settings }: Props) {
  const [enabled, setEnabled] = useState(settings.grid_auto_enabled)
  const [day, setDay] = useState(settings.grid_auto_day)
  const [hour, setHour] = useState(settings.grid_auto_hour)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const ultima = ultimaExecucaoBrt(settings.grid_auto_last_run)

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
          Quando ligado, o sistema gera as sessões dos <strong>próximos 7 dias</strong> (a
          partir de amanhã) e reserva os alunos fixos. Desligado, use os botões “Gerar” na
          grade.
        </p>
        {/* O dia e a hora são um ALVO, não um horário de execução: a checagem roda
            uma vez por dia, então a geração sai na primeira passada depois do
            alvo. Dizer isso evita a leitura de que "13h" significa 13h em ponto. */}
        <p className="text-xs text-slate-400">
          O dia e a hora são o alvo a partir do qual a geração pode acontecer — a checagem
          roda uma vez por dia, então ela sai na primeira passada depois desse alvo, não no
          minuto exato.
        </p>
        <p className="text-xs text-slate-400">
          Última geração automática:{' '}
          <strong className={ultima ? 'text-slate-200' : 'text-amber-400'}>
            {ultima ?? 'nunca rodou'}
          </strong>
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
