'use client'
// features/checkin/SelfPartnerForm.tsx
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { selfSetPartnerId } from '@/features/checkin/actions'
import type { CheckinPartner } from '@/types'

interface Props {
  currentPartner: CheckinPartner | null
  currentPartnerId: string | null
  isActiveSubscriber: boolean
}

export function SelfPartnerForm({ currentPartner, currentPartnerId, isActiveSubscriber }: Props) {
  const router = useRouter()
  const [partner, setPartner] = useState<CheckinPartner>(currentPartner ?? 'wellhub')
  const [partnerId, setPartnerId] = useState(currentPartnerId ?? '')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  if (isActiveSubscriber) {
    return (
      <p className="text-sm text-slate-300">
        Você tem um plano mensalista ativo. Para acessar via Wellhub ou TotalPass, fale com o
        professor.
      </p>
    )
  }

  function handleSave() {
    setError(null)
    setSuccess(null)
    const trimmed = partnerId.trim()
    if (!trimmed) {
      setError('Informe o seu ID do parceiro.')
      return
    }
    startTransition(async () => {
      const res = await selfSetPartnerId(partner, trimmed)
      if (res.error) {
        setError(res.error)
        return
      }
      setSuccess('Vínculo salvo. Seus check-ins serão registrados automaticamente.')
      router.refresh()
    })
  }

  return (
    <div className="space-y-3">
      {currentPartner && (
        <p className="text-xs text-slate-400">
          Vínculo atual:{' '}
          <span className="text-brand-500 font-medium capitalize">{currentPartner}</span>
          {currentPartnerId ? ` · ID ${currentPartnerId}` : ''}
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-slate-400 mb-1 block">Parceiro</label>
          <select
            value={partner}
            onChange={(e) => setPartner(e.target.value as CheckinPartner)}
            className="w-full bg-surface-card border border-surface-border rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-500"
          >
            <option value="wellhub">Wellhub</option>
            <option value="totalpass">TotalPass</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-slate-400 mb-1 block">Seu ID no parceiro</label>
          <Input
            type="text"
            placeholder="ID do parceiro"
            value={partnerId}
            onChange={(e) => setPartnerId(e.target.value)}
          />
        </div>
      </div>
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
      <Button size="sm" variant="primary" loading={pending} onClick={handleSave}>
        Salvar
      </Button>
    </div>
  )
}
