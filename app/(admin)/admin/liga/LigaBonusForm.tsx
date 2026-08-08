'use client'
// app/(admin)/admin/liga/LigaBonusForm.tsx
import { useState, useTransition } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { awardLigaBonus } from '@/features/liga/adminActions'
import { sportLabel } from '@/lib/arenas/sports'

const SELECT_CLS =
  'w-full bg-surface border border-surface-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-brand-500'

interface Props {
  students: { id: string; name: string }[]
  sports: string[]
}

export function LigaBonusForm({ students, sports }: Props) {
  const [studentId, setStudentId] = useState('')
  const [sport, setSport] = useState(sports[0] ?? '')
  const [points, setPoints] = useState('20')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(null)

    if (!studentId) {
      setError('Escolha um aluno.')
      return
    }
    const parsed = parseInt(points, 10)
    if (isNaN(parsed) || parsed === 0) {
      setError('Pontos devem ser um inteiro diferente de zero.')
      return
    }
    if (!note.trim()) {
      setError('Descreva o motivo, o aluno vê esse texto no extrato.')
      return
    }

    startTransition(async () => {
      const result = await awardLigaBonus({ studentId, sport, points: parsed, note })
      if (result.error) setError(result.error)
      else {
        setSuccess('Bônus lançado.')
        setNote('')
      }
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

        <div className="space-y-1">
          <label className="text-sm text-slate-300 font-medium">Aluno</label>
          <select
            value={studentId}
            onChange={(e) => setStudentId(e.target.value)}
            className={SELECT_CLS}
          >
            <option value="">Selecione...</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-sm text-slate-300 font-medium">Modalidade</label>
          <select value={sport} onChange={(e) => setSport(e.target.value)} className={SELECT_CLS}>
            {sports.map((s) => (
              <option key={s} value={s}>
                {sportLabel(s)}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-sm text-slate-300 font-medium">Pontos</label>
          <p className="text-xs text-slate-400">
            Use número negativo para descontar. Máximo 500 por lançamento.
          </p>
          <Input type="number" value={points} onChange={(e) => setPoints(e.target.value)} />
        </div>

        <div className="space-y-1">
          <label className="text-sm text-slate-300 font-medium">Motivo</label>
          <p className="text-xs text-slate-400">
            Aparece no extrato do aluno. Ex.: &quot;Destaque da aula de quinta&quot;.
          </p>
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Destaque da aula de quinta"
          />
        </div>

        <Button type="submit" variant="primary" loading={pending}>
          Lançar bônus
        </Button>
      </form>
    </Card>
  )
}
