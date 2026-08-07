// features/aulas/AddStudentToSession.tsx
'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import type { AddStudentReason } from '@/types'

export interface AddableStudent {
  id: string
  full_name: string
  /** true quando o aluno não tem plano, parceiro nem crédito: entra devendo. */
  wouldOweDebt: boolean
  /** Pendências de check-in de parceiro em aberto. */
  openMissedCheckins: number
}

interface Props {
  sessionId: string
  students: AddableStudent[]
  onAdd: (
    sessionId: string,
    studentId: string,
    reason: AddStudentReason,
    force?: boolean,
  ) => Promise<{ error?: string; quotaBlocked?: boolean; missedBlocked?: boolean }>
}

const REASONS: { value: AddStudentReason; label: string; hint: string }[] = [
  { value: 'experimental', label: 'Aula experimental', hint: 'Grátis, sem cobrança.' },
  { value: 'on_spot', label: 'Pagou na hora', hint: 'Entra no relatório como recebido.' },
  { value: 'open', label: 'Deixar em aberto', hint: 'Vira pendência a cobrar.' },
]

export function AddStudentToSession({ sessionId, students, onAdd }: Props) {
  const [studentId, setStudentId] = useState('')
  const [reason, setReason] = useState<AddStudentReason>('experimental')
  const [error, setError] = useState<string | null>(null)
  // Duas negações furáveis pelo mesmo force. Guardadas separadas porque o texto do
  // botão precisa dizer o que está sendo furado.
  const [quotaBlocked, setQuotaBlocked] = useState(false)
  const [missedBlocked, setMissedBlocked] = useState(false)
  const [isPending, startTransition] = useTransition()

  const selected = students.find((s) => s.id === studentId)
  // O motivo só faz sentido para quem entraria devendo. Quem tem plano, parceiro
  // ou crédito já tem a aula paga — perguntar seria ruído (spec §6).
  const needsReason = selected?.wouldOweDebt ?? false

  function handleSelectStudent(id: string) {
    setStudentId(id)
    setReason('experimental')
    setError(null)
    setQuotaBlocked(false)
    setMissedBlocked(false)
  }

  function handleAdd(force = false) {
    if (!studentId) return
    setError(null)
    startTransition(async () => {
      const result = await onAdd(sessionId, studentId, needsReason ? reason : 'open', force)
      if (result.error) {
        setError(result.error)
        setQuotaBlocked(!!result.quotaBlocked)
        setMissedBlocked(!!result.missedBlocked)
      } else {
        setStudentId('')
        setReason('experimental')
        setQuotaBlocked(false)
        setMissedBlocked(false)
      }
    })
  }

  if (students.length === 0) return null

  return (
    <Card>
      <h2 className="text-sm font-semibold text-white mb-3">Adicionar aluno</h2>

      <select
        value={studentId}
        onChange={(e) => handleSelectStudent(e.target.value)}
        className="w-full bg-surface border border-surface-border rounded-lg px-3 py-2 text-sm text-white mb-3"
      >
        <option value="">Selecione um aluno…</option>
        {students.map((s) => (
          <option key={s.id} value={s.id}>
            {s.full_name}
            {s.wouldOweDebt ? ' · sem plano/crédito' : ''}
            {s.openMissedCheckins > 0 ? ` · ${s.openMissedCheckins} pendência(s) de check-in` : ''}
          </option>
        ))}
      </select>

      {needsReason && (
        <div className="space-y-2 mb-3">
          <p className="text-xs text-yellow-400">
            ⚠️ Este aluno não tem plano, Wellhub/TotalPass nem crédito.
          </p>
          {REASONS.map((r) => (
            <label
              key={r.value}
              className="flex items-start gap-2 text-xs text-slate-300 cursor-pointer"
            >
              <input
                type="radio"
                name="reason"
                value={r.value}
                checked={reason === r.value}
                onChange={() => setReason(r.value)}
                className="mt-0.5"
              />
              <span>
                <span className="text-white font-medium">{r.label}</span>
                <span className="text-slate-400"> · {r.hint}</span>
              </span>
            </label>
          ))}
        </div>
      )}

      {error && <p className="text-xs text-red-400 mb-2">{error}</p>}

      {quotaBlocked || missedBlocked ? (
        <Button
          size="sm"
          variant="danger"
          loading={isPending}
          onClick={() => handleAdd(true)}
          className="w-full"
        >
          {missedBlocked ? 'Adicionar mesmo com pendência' : 'Adicionar mesmo assim'}
        </Button>
      ) : (
        <Button
          size="sm"
          loading={isPending}
          disabled={!studentId || isPending}
          onClick={() => handleAdd(false)}
          className="w-full"
        >
          Adicionar à aula
        </Button>
      )}
    </Card>
  )
}
