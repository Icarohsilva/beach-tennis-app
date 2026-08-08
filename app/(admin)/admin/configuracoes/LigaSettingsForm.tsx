'use client'
// app/(admin)/admin/configuracoes/LigaSettingsForm.tsx
import { useState, useTransition } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { updateSystemSettings } from '@/features/financeiro/actions'

interface Props {
  settings: {
    liga_enabled: boolean
    liga_points_attendance: number
    liga_points_streak_week: number
    liga_points_tournament_entry: number
    liga_points_tournament_win: number
    liga_promote_count: number
    liga_demote_count: number
    liga_kudos_weekly_cap: number
    liga_points_kudos_given: number
    liga_points_kudos_received: number
  }
}

const FIELD_LABEL: Record<string, string> = {
  attendance: 'Presença',
  streak: 'Sequência (semana)',
  entry: 'Inscrição em torneio',
  win: 'Vitória em torneio',
  promote: 'Sobem de divisão',
  demote: 'Descem de divisão',
  kudosCap: 'Elogios que pontuam por semana',
  kudosGiven: 'Pontos por elogiar',
  kudosReceived: 'Pontos por ser elogiado',
}

export function LigaSettingsForm({ settings }: Props) {
  const [enabled, setEnabled] = useState(settings.liga_enabled)
  const [attendance, setAttendance] = useState(String(settings.liga_points_attendance))
  const [streak, setStreak] = useState(String(settings.liga_points_streak_week))
  const [entry, setEntry] = useState(String(settings.liga_points_tournament_entry))
  const [win, setWin] = useState(String(settings.liga_points_tournament_win))
  const [promote, setPromote] = useState(String(settings.liga_promote_count))
  const [demote, setDemote] = useState(String(settings.liga_demote_count))
  const [kudosCap, setKudosCap] = useState(String(settings.liga_kudos_weekly_cap))
  const [kudosGiven, setKudosGiven] = useState(String(settings.liga_points_kudos_given))
  const [kudosReceived, setKudosReceived] = useState(String(settings.liga_points_kudos_received))
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(null)

    const nums = { attendance, streak, entry, win, promote, demote, kudosCap, kudosGiven, kudosReceived }
    for (const [key, raw] of Object.entries(nums)) {
      const n = parseInt(raw, 10)
      if (isNaN(n) || n < 0) {
        setError(`Valor inválido em "${FIELD_LABEL[key] ?? key}": use um inteiro não-negativo.`)
        return
      }
    }

    startTransition(async () => {
      const result = await updateSystemSettings({
        liga_enabled: enabled,
        liga_points_attendance: parseInt(attendance, 10),
        liga_points_streak_week: parseInt(streak, 10),
        liga_points_tournament_entry: parseInt(entry, 10),
        liga_points_tournament_win: parseInt(win, 10),
        liga_promote_count: parseInt(promote, 10),
        liga_demote_count: parseInt(demote, 10),
        liga_kudos_weekly_cap: parseInt(kudosCap, 10),
        liga_points_kudos_given: parseInt(kudosGiven, 10),
        liga_points_kudos_received: parseInt(kudosReceived, 10),
      })
      if (result.error) setError(result.error)
      else setSuccess('Configuração da Liga salva.')
    })
  }

  return (
    <Card>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
            {error}
          </p>
        )}
        {success && (
          <p className="text-sm text-green-400 bg-green-500/10 border border-green-500/30 rounded-lg px-3 py-2">
            {success}
          </p>
        )}

        <label className="flex items-start gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="mt-1 w-4 h-4 accent-brand-500"
          />
          <span>
            Ativar a Liga
            <span className="block text-xs text-slate-500">
              Antes de ligar, defina a modalidade das suas turmas na Grade: turma sem modalidade
              não pontua.
            </span>
          </span>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-sm text-slate-300 font-medium">{FIELD_LABEL.attendance}</label>
            <Input
              type="number"
              min="0"
              value={attendance}
              onChange={(e) => setAttendance(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm text-slate-300 font-medium">{FIELD_LABEL.streak}</label>
            <Input
              type="number"
              min="0"
              value={streak}
              onChange={(e) => setStreak(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm text-slate-300 font-medium">{FIELD_LABEL.entry}</label>
            <Input type="number" min="0" value={entry} onChange={(e) => setEntry(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-sm text-slate-300 font-medium">{FIELD_LABEL.win}</label>
            <Input type="number" min="0" value={win} onChange={(e) => setWin(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-sm text-slate-300 font-medium">{FIELD_LABEL.promote}</label>
            <Input
              type="number"
              min="0"
              value={promote}
              onChange={(e) => setPromote(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm text-slate-300 font-medium">{FIELD_LABEL.demote}</label>
            <Input
              type="number"
              min="0"
              value={demote}
              onChange={(e) => setDemote(e.target.value)}
            />
          </div>
        </div>
        <p className="text-xs text-slate-400">
          O bônus de sequência cresce até 4x e estabiliza, para que quem começou agora ainda tenha
          chance na temporada.
        </p>

        <div className="border-t border-surface-border pt-4">
          <p className="text-sm font-medium text-slate-300">Elogios entre alunos</p>
          <p className="mt-1 text-xs text-slate-400">
            Receber vale mais que dar de propósito: o incentivo tem que ser <em>ser elogiável</em>,
            não distribuir elogio. O teto semanal limita quantos elogios seus ainda pontuam por
            semana; acima dele o elogio continua aparecendo, só não vale ponto.
          </p>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-slate-300">{FIELD_LABEL.kudosCap}</label>
              <Input type="number" min="0" value={kudosCap} onChange={(e) => setKudosCap(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-300">{FIELD_LABEL.kudosGiven}</label>
              <Input type="number" min="0" value={kudosGiven} onChange={(e) => setKudosGiven(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-300">{FIELD_LABEL.kudosReceived}</label>
              <Input type="number" min="0" value={kudosReceived} onChange={(e) => setKudosReceived(e.target.value)} />
            </div>
          </div>
        </div>

        <Button type="submit" variant="primary" loading={pending}>
          Salvar Liga
        </Button>
      </form>
    </Card>
  )
}
