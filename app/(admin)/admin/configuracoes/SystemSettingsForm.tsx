'use client'
// app/(admin)/configuracoes/SystemSettingsForm.tsx
import { useState, useTransition } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { updateSystemSettings } from '@/features/financeiro/actions'

interface SystemSettingsFormProps {
  settings: {
    credit_expiry_days: number
    cancellation_window_hours: number
    default_checkin_target: number
  }
}

export function SystemSettingsForm({ settings }: SystemSettingsFormProps) {
  const [creditExpiryDays, setCreditExpiryDays] = useState(String(settings.credit_expiry_days))
  const [cancellationWindowHours, setCancellationWindowHours] = useState(
    String(settings.cancellation_window_hours),
  )
  const [defaultCheckinTarget, setDefaultCheckinTarget] = useState(
    String(settings.default_checkin_target),
  )
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(null)

    const expiry = parseInt(creditExpiryDays, 10)
    const window = parseInt(cancellationWindowHours, 10)
    const checkinTarget = parseInt(defaultCheckinTarget, 10)

    if (isNaN(expiry) || expiry < 1) {
      setError('Validade dos créditos deve ser um número inteiro positivo.')
      return
    }
    if (isNaN(window) || window < 0) {
      setError('Janela de cancelamento deve ser um número inteiro não-negativo.')
      return
    }
    if (isNaN(checkinTarget) || checkinTarget < 0) {
      setError('Meta mensal de check-ins deve ser um número inteiro não-negativo.')
      return
    }

    startTransition(async () => {
      const result = await updateSystemSettings({
        credit_expiry_days: expiry,
        cancellation_window_hours: window,
        default_checkin_target: checkinTarget,
      })
      if (result.error) {
        setError(result.error)
      } else {
        setSuccess('Configurações salvas com sucesso.')
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
          <label className="text-sm text-slate-300 font-medium">
            Validade dos créditos de reposição (dias)
          </label>
          <p className="text-xs text-slate-400">
            Número de dias até expirar um crédito de reposição após ser gerado. Padrão: 30
          </p>
          <Input
            type="number"
            min="1"
            value={creditExpiryDays}
            onChange={(e) => setCreditExpiryDays(e.target.value)}
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm text-slate-300 font-medium">
            Janela de cancelamento com reposição (horas)
          </label>
          <p className="text-xs text-slate-400">
            Número de horas antes da aula em que o cancelamento ainda gera crédito. Padrão: 5
          </p>
          <Input
            type="number"
            min="0"
            value={cancellationWindowHours}
            onChange={(e) => setCancellationWindowHours(e.target.value)}
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm text-slate-300 font-medium">
            Meta mensal de check-ins (Wellhub/TotalPass)
          </label>
          <p className="text-xs text-slate-400">
            Meta padrão de check-ins no mês para alunos de parceiro. Pode ser ajustada por aluno no
            cadastro. Padrão: 12
          </p>
          <Input
            type="number"
            min="0"
            value={defaultCheckinTarget}
            onChange={(e) => setDefaultCheckinTarget(e.target.value)}
          />
        </div>

        <Button type="submit" variant="primary" loading={pending}>
          Salvar configurações
        </Button>
      </form>
    </Card>
  )
}
