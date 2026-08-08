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
    liga_points_self_checkin: number
    liga_points_cancel_in_time: number
    liga_points_waitlist_accept: number
    liga_points_early_booking: number
    liga_points_profile_complete: number
    liga_points_dayuse: number
  }
}

/** Fontes extras: rótulo e explicação do porquê aquilo vale ponto. */
const EXTRAS: { key: string; label: string; hint: string }[] = [
  { key: 'selfCheckin', label: 'Confirmar presença no app', hint: 'poupa a chamada do professor' },
  { key: 'cancelInTime', label: 'Cancelar a tempo', hint: 'libera a vaga para a fila' },
  { key: 'waitlistAccept', label: 'Pegar vaga da fila', hint: 'enche a aula que ia rodar vazia' },
  { key: 'earlyBooking', label: 'Agendar com 2+ dias', hint: 'você sabe a lotação antes' },
  { key: 'profileComplete', label: 'Cadastro completo', hint: 'uma vez: telefone, emergência e modalidade' },
  { key: 'dayUse', label: 'Reservar day use', hint: 'puxa receita de quadra ociosa' },
]

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
  selfCheckin: 'Confirmar presença no app',
  cancelInTime: 'Cancelar a tempo',
  waitlistAccept: 'Pegar vaga da fila',
  earlyBooking: 'Agendar com 2+ dias',
  profileComplete: 'Cadastro completo',
  dayUse: 'Reservar day use',
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
  // Um estado só para as seis fontes extras: seis useState repetidos seriam ruído.
  const [extras, setExtras] = useState<Record<string, string>>({
    selfCheckin: String(settings.liga_points_self_checkin),
    cancelInTime: String(settings.liga_points_cancel_in_time),
    waitlistAccept: String(settings.liga_points_waitlist_accept),
    earlyBooking: String(settings.liga_points_early_booking),
    profileComplete: String(settings.liga_points_profile_complete),
    dayUse: String(settings.liga_points_dayuse),
  })
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(null)

    const nums = {
      attendance, streak, entry, win, promote, demote,
      kudosCap, kudosGiven, kudosReceived, ...extras,
    }
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
        liga_points_self_checkin: parseInt(extras.selfCheckin, 10),
        liga_points_cancel_in_time: parseInt(extras.cancelInTime, 10),
        liga_points_waitlist_accept: parseInt(extras.waitlistAccept, 10),
        liga_points_early_booking: parseInt(extras.earlyBooking, 10),
        liga_points_profile_complete: parseInt(extras.profileComplete, 10),
        liga_points_dayuse: parseInt(extras.dayUse, 10),
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

        <div className="border-t border-surface-border pt-4">
          <p className="text-sm font-medium text-slate-300">Pontos por ajudar a academia</p>
          <p className="mt-1 text-xs text-slate-400">
            Comportamento que facilita a sua operação. Zere o que não quiser premiar: peso zero
            desliga a fonte.
          </p>
          <div className="mt-3 space-y-2">
            {EXTRAS.map((extra) => (
              <div key={extra.key} className="flex items-center gap-3">
                <span className="min-w-0 flex-1">
                  <span className="block text-xs text-slate-300">{extra.label}</span>
                  <span className="block text-[11px] text-slate-500">{extra.hint}</span>
                </span>
                <Input
                  type="number"
                  min="0"
                  className="w-20 shrink-0"
                  value={extras[extra.key]}
                  onChange={(e) =>
                    setExtras((prev) => ({ ...prev, [extra.key]: e.target.value }))
                  }
                />
              </div>
            ))}
          </div>
        </div>

        <Button type="submit" variant="primary" loading={pending}>
          Salvar Liga
        </Button>
      </form>
    </Card>
  )
}
