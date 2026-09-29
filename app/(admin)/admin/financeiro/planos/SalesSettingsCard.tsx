'use client'
// app/(admin)/admin/financeiro/planos/SalesSettingsCard.tsx
import { useState, useTransition } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { updateSalesSettings } from '../adminActions'
import type { SalesSettingsData } from '../adminActions'
import { DAY_USE_PARTNERS, PARTNER_LABEL, type DayUsePartner } from '@/lib/dayuse/partnerCheckin'

export function SalesSettingsCard({ initial }: { initial: SalesSettingsData }) {
  const [form, setForm] = useState<SalesSettingsData>(initial)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function togglePartner(partner: DayUsePartner, on: boolean) {
    setForm((f) => ({
      ...f,
      day_use_partners: on
        ? [...f.day_use_partners.filter((p) => p !== partner), partner]
        : f.day_use_partners.filter((p) => p !== partner),
    }))
  }

  function handleSave() {
    setError(null)
    setSuccess(null)
    startTransition(async () => {
      const result = await updateSalesSettings(form)
      if (result.error) setError(result.error)
      else setSuccess('Configurações salvas.')
    })
  }

  return (
    <Card>
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Aula avulsa (R$ por crédito)</label>
            <Input
              type="number" min="0" step="0.01"
              value={form.single_class_price}
              onChange={(e) => setForm((f) => ({ ...f, single_class_price: parseFloat(e.target.value) || 0 }))}
            />
            <label className="flex items-center gap-2 mt-2 text-sm text-slate-400">
              <input
                type="checkbox"
                checked={form.single_class_sale_enabled}
                onChange={(e) => setForm((f) => ({ ...f, single_class_sale_enabled: e.target.checked }))}
              />
              Vender aula avulsa pelo app
            </label>
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Day use (R$)</label>
            <Input
              type="number" min="0" step="0.01"
              value={form.day_use_price}
              onChange={(e) => setForm((f) => ({ ...f, day_use_price: parseFloat(e.target.value) || 0 }))}
            />
            <label className="flex items-center gap-2 mt-2 text-sm text-slate-400">
              <input
                type="checkbox"
                checked={form.day_use_sale_enabled}
                onChange={(e) => setForm((f) => ({ ...f, day_use_sale_enabled: e.target.checked }))}
              />
              Cobrar day use pelo app
            </label>
            {/* Parceiro aceito aparece como opção na reserva do day use pago, e
                a lista do day use mostra ao quiosque quem vem por ele. */}
            <p className="mt-3 text-xs text-slate-400">Aceitar no day use</p>
            {DAY_USE_PARTNERS.map((partner) => (
              <label key={partner} className="flex items-center gap-2 mt-1 text-sm text-slate-400">
                <input
                  type="checkbox"
                  checked={form.day_use_partners.includes(partner)}
                  onChange={(e) => togglePartner(partner, e.target.checked)}
                />
                {PARTNER_LABEL[partner]}
              </label>
            ))}
            <p className="mt-1 text-xs text-slate-500">
              O aluno escolhe o parceiro ao reservar e não paga pelo app. O quiosque valida o
              check-in na lista do day use.
            </p>
          </div>
        </div>
        {error && (
          <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>
        )}
        {success && (
          <p className="text-sm text-green-400 bg-green-500/10 border border-green-500/30 rounded-lg px-3 py-2">{success}</p>
        )}
        <Button size="sm" variant="primary" loading={pending} onClick={handleSave}>
          Salvar
        </Button>
      </div>
    </Card>
  )
}
