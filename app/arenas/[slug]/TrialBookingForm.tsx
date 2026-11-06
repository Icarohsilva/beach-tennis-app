'use client'
// app/arenas/[slug]/TrialBookingForm.tsx
// A grade da semana (a mesma que os alunos veem, com vaga ou "Lotado") e o
// formulário da experimental. Quem não está logado cria a conta aqui mesmo; quem
// está, só informa o CPF.

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { createTrialBooking } from './actions'
import { formatTime } from '@/lib/utils/dateHelpers'
import { formatDocument } from '@/lib/validation/documento'
import { formatWhatsApp } from '@/lib/utils/phone'
import { hasOpenSlot, type TrialDay, type TrialSlot } from '@/lib/arenas/trialSchedule'
import { cn } from '@/lib/utils/cn'

interface TrialBookingFormProps {
  organizationId: string
  days: TrialDay[]
  /** Nome de quem está logado, ou null para visitante (o form vira cadastro). */
  viewerName: string | null
  /** Volta para esta página depois do login. */
  loginHref: string
}

const WEEKDAY = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

function dayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const wd = WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
  return `${wd}, ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`
}

const GENDER_TAG = { F: 'Feminino', M: 'Masculino' } as const

export function TrialBookingForm({ organizationId, days, viewerName, loginHref }: TrialBookingFormProps) {
  const firstOpen = days.flatMap((d) => d.slots).find((s) => !s.full)
  const [selected, setSelected] = useState<TrialSlot | null>(firstOpen ?? null)
  const [form, setForm] = useState({ name: '', email: '', phone: '', cpf: '', password: '' })
  const [gender, setGender] = useState<'M' | 'F' | null>(null)
  const [error, setError] = useState<{ text: string; login?: boolean } | null>(null)
  const [done, setDone] = useState<{ slot: TrialSlot; createdAccount: boolean } | null>(null)
  const [isPending, startTransition] = useTransition()
  const loggedIn = viewerName !== null
  const anyOpen = hasOpenSlot(days)

  const set = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }))

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!selected) {
      setError({ text: 'Escolha um horário.' })
      return
    }
    const slot = selected
    startTransition(async () => {
      const result = await createTrialBooking({
        organizationId,
        sessionId: slot.id,
        cpf: form.cpf,
        ...(loggedIn ? {} : { name: form.name, email: form.email, phone: form.phone, password: form.password, gender }),
      })
      if ('error' in result) {
        setError({ text: result.error, login: result.loginRequired })
        return
      }
      setDone({ slot, createdAccount: result.createdAccount })
    })
  }

  if (done) {
    return (
      <div className="space-y-3 py-6 text-center">
        <div className="text-4xl">🎾</div>
        <h2 className="text-lg font-bold text-white">Aula experimental marcada!</h2>
        <p className="text-sm text-slate-300">
          {done.slot.className} · {dayLabel(done.slot.date)} · {formatTime(done.slot.startTime)}–
          {formatTime(done.slot.endTime)}
        </p>
        <p className="text-sm text-slate-400">
          {done.createdAccount
            ? 'Sua conta foi criada. A aula já está na sua agenda do app: entre com seu e-mail e a senha que você escolheu.'
            : 'A aula já está na sua agenda do app.'}
        </p>
        <Link href="/home" className="inline-block">
          <Button variant="primary">Abrir minha agenda</Button>
        </Link>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <p className="mb-2 text-sm font-medium text-slate-300">Escolha um horário</p>
        <div className="max-h-80 space-y-4 overflow-y-auto pr-1">
          {days.map((day) => (
            <div key={day.date}>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {dayLabel(day.date)}
              </p>
              <div className="space-y-2">
                {day.slots.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    disabled={s.full}
                    aria-pressed={selected?.id === s.id}
                    onClick={() => setSelected(s)}
                    className={cn(
                      'w-full rounded-xl border px-4 py-3 text-left transition-colors',
                      s.full
                        ? 'cursor-not-allowed border-surface-border bg-surface/60 opacity-60'
                        : selected?.id === s.id
                          ? 'border-brand-500 bg-brand-500/10'
                          : 'border-surface-border bg-surface-card hover:border-slate-500',
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-white">
                          {formatTime(s.startTime)}–{formatTime(s.endTime)}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-slate-400">
                          {s.className}
                          {s.genderRestriction ? ` · ${GENDER_TAG[s.genderRestriction]}` : ''}
                        </p>
                      </div>
                      <span
                        className={cn(
                          'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
                          s.full ? 'bg-red-500/15 text-red-300' : 'bg-emerald-500/15 text-emerald-300',
                        )}
                      >
                        {s.full ? 'Lotado' : s.spotsLeft === 1 ? '1 vaga' : `${s.spotsLeft} vagas`}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {!anyOpen ? (
        <p className="rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm text-slate-400">
          Todos os horários estão lotados. Fale com a arena para combinar uma data.
        </p>
      ) : (
        <>
          <div className="space-y-3">
            {loggedIn ? (
              <p className="text-sm text-slate-400">
                Marcando como <span className="font-medium text-white">{viewerName}</span>.
              </p>
            ) : (
              <>
                <Input label="Nome completo" value={form.name} onChange={set('name')} autoComplete="name" required />
                <Input label="E-mail" type="email" value={form.email} onChange={set('email')} autoComplete="email" required />
                <Input
                  label="WhatsApp"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="(31) 99999-9999"
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: formatWhatsApp(e.target.value) }))}
                  required
                />
                <div>
                  <p className="mb-1.5 text-sm font-medium text-slate-300">Sexo</p>
                  <div className="grid grid-cols-2 gap-2">
                    {(['F', 'M'] as const).map((g) => (
                      <Button
                        key={g}
                        type="button"
                        variant={gender === g ? 'primary' : 'secondary'}
                        onClick={() => setGender(g)}
                        aria-pressed={gender === g}
                      >
                        {GENDER_TAG[g]}
                      </Button>
                    ))}
                  </div>
                </div>
              </>
            )}
            <Input
              label="CPF"
              inputMode="numeric"
              placeholder="000.000.000-00"
              value={form.cpf}
              onChange={(e) => setForm((f) => ({ ...f, cpf: formatDocument(e.target.value).slice(0, 14) }))}
              hint="Uma aula experimental por pessoa nesta arena."
              required
            />
            {!loggedIn && (
              <Input
                label="Crie uma senha"
                type="password"
                value={form.password}
                onChange={set('password')}
                autoComplete="new-password"
                minLength={6}
                hint="Com ela você entra no app e vê a aula na sua agenda."
                required
              />
            )}
          </div>

          {error && (
            <p className="text-sm text-red-400">
              {error.text}{' '}
              {error.login && (
                <Link href={loginHref} className="font-medium text-brand-400 underline">
                  Entrar
                </Link>
              )}
            </p>
          )}

          <Button type="submit" variant="primary" size="lg" loading={isPending} disabled={!selected} className="w-full">
            Marcar aula experimental
          </Button>

          <p className="text-center text-xs text-slate-500">
            {loggedIn
              ? 'A aula entra na sua agenda do app.'
              : 'Ao marcar, você cria sua conta no app da arena e concorda com os termos de uso.'}
            {!loggedIn && (
              <>
                {' '}Já tem conta?{' '}
                <Link href={loginHref} className="text-brand-400">
                  Entrar
                </Link>
              </>
            )}
          </p>
        </>
      )}
    </form>
  )
}
