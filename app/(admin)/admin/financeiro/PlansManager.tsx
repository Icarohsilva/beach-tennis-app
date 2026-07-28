'use client'
// app/(admin)/admin/financeiro/PlansManager.tsx
// Planos + editor de periodicidades: cada plano tem até 5 opções de cobrança
// (mensal→anual), cada uma com preço próprio e toggle.
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { togglePlanActive, createPlan, updatePlan, saveBillingOption } from './adminActions'
import type { CreatePlanData } from './adminActions'
import { PlanFormFields } from './PlanFormFields'
import { PERIODICITIES, PERIODICITY_LABELS } from '@/lib/billing/periodicity'
import type { SubscriptionPlan, PlanBillingOption, Periodicity } from '@/types'

interface PlansManagerProps {
  plans: SubscriptionPlan[]
  options: PlanBillingOption[]
}

const emptyCreateForm: CreatePlanData = {
  name: '',
  description: '',
  classes_per_week: 2,
  cycle: 'monthly',
  max_classes_per_day: 2,
  refund_on_late_cancel: true,
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(amount)
}

export function PlansManager({ plans, options }: PlansManagerProps) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const [showCreateForm, setShowCreateForm] = useState(false)
  const [createForm, setCreateForm] = useState<CreatePlanData>(emptyCreateForm)

  const [editingPlanId, setEditingPlanId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<CreatePlanData>(emptyCreateForm)

  // Edição por (planId, periodicity): preço em texto + habilitado.
  const [editing, setEditing] = useState<{
    planId: string
    periodicity: Periodicity
    price: string
    enabled: boolean
  } | null>(null)

  function optionFor(planId: string, periodicity: Periodicity): PlanBillingOption | undefined {
    return options.find((o) => o.plan_id === planId && o.periodicity === periodicity)
  }

  function handleToggle(planId: string, current: boolean) {
    setError(null)
    setSuccess(null)
    startTransition(async () => {
      const result = await togglePlanActive(planId, !current)
      if (result.error) setError(result.error)
      else {
        setSuccess(`Plano ${!current ? 'ativado' : 'desativado'} com sucesso.`)
        router.refresh()
      }
    })
  }

  function handleCreatePlan() {
    setError(null)
    startTransition(async () => {
      const result = await createPlan(createForm)
      if (result.error) setError(result.error)
      else {
        setShowCreateForm(false)
        setCreateForm(emptyCreateForm)
        setSuccess('Plano criado. Agora habilite as periodicidades e preços.')
        router.refresh()
      }
    })
  }

  function handleUpdatePlan() {
    if (!editingPlanId) return
    setError(null)
    startTransition(async () => {
      const result = await updatePlan({ id: editingPlanId, ...editForm })
      if (result.error) setError(result.error)
      else {
        setEditingPlanId(null)
        setSuccess('Plano atualizado com sucesso.')
        router.refresh()
      }
    })
  }

  function handleSaveOption() {
    if (!editing) return
    const price = parseFloat(editing.price)
    if (isNaN(price)) {
      setError('Preço inválido.')
      return
    }
    setError(null)
    startTransition(async () => {
      const result = await saveBillingOption(editing.planId, editing.periodicity, price, editing.enabled)
      if (result.error) setError(result.error)
      else {
        setEditing(null)
        setSuccess('Periodicidade salva.')
        router.refresh()
      }
    })
  }

  return (
    <div className="space-y-3">
      {!showCreateForm && (
        <div>
          <Button size="sm" variant="primary" onClick={() => setShowCreateForm(true)}>
            + Novo Plano
          </Button>
        </div>
      )}

      {showCreateForm && (
        <Card>
          <p className="text-xs text-slate-400 font-medium uppercase tracking-wide mb-3">Novo Plano</p>
          <div className="space-y-3">
            <PlanFormFields value={createForm} onChange={setCreateForm} />
            <div className="flex gap-2">
              <Button size="sm" variant="primary" loading={pending} onClick={handleCreatePlan}>
                Criar Plano
              </Button>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => { setShowCreateForm(false); setCreateForm(emptyCreateForm) }}>
                Cancelar
              </Button>
            </div>
          </div>
        </Card>
      )}

      {error && (
        <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>
      )}
      {success && (
        <p className="text-sm text-green-400 bg-green-500/10 border border-green-500/30 rounded-lg px-3 py-2">{success}</p>
      )}

      {plans.map((plan) => (
        <Card key={plan.id}>
          {editingPlanId === plan.id ? (
            <div className="space-y-3 mb-3 pb-3 border-b border-surface-border">
              <PlanFormFields value={editForm} onChange={setEditForm} />
              <div className="flex gap-2">
                <Button size="sm" variant="primary" loading={pending} onClick={handleUpdatePlan}>
                  Salvar
                </Button>
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => setEditingPlanId(null)}>
                  Cancelar
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-white font-semibold text-sm">{plan.name}</h3>
                  <Badge variant={plan.is_active ? 'success' : 'danger'}>
                    {plan.is_active ? 'Ativo' : 'Inativo'}
                  </Badge>
                </div>
                {plan.description && <p className="text-xs text-slate-400 mt-0.5">{plan.description}</p>}
                <p className="text-xs text-slate-400 mt-1">
                  {plan.classes_per_week}x/semana
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => {
                    setEditingPlanId(plan.id)
                    setEditForm({
                      name: plan.name,
                      description: plan.description ?? undefined,
                      classes_per_week: plan.classes_per_week,
                      cycle: plan.cycle,
                      max_classes_per_day: plan.max_classes_per_day,
                      refund_on_late_cancel: plan.refund_on_late_cancel,
                    })
                  }}
                >
                  Editar
                </Button>
                <Button
                  size="sm"
                  variant={plan.is_active ? 'danger' : 'secondary'}
                  loading={pending}
                  onClick={() => handleToggle(plan.id, plan.is_active)}
                >
                  {plan.is_active ? 'Desativar' : 'Ativar'}
                </Button>
              </div>
            </div>
          )}

          {/* Periodicidades */}
          <div className="space-y-2 pt-3 border-t border-surface-border">
            <p className="text-xs text-slate-400 font-medium uppercase tracking-wide">Periodicidades</p>
            {PERIODICITIES.map((periodicity) => {
              const opt = optionFor(plan.id, periodicity)
              const isEditing = editing?.planId === plan.id && editing?.periodicity === periodicity
              return (
                <div key={periodicity} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-white w-24 shrink-0">{PERIODICITY_LABELS[periodicity]}</span>
                  {isEditing ? (
                    <div className="flex items-center gap-2 flex-1 justify-end">
                      <div className="max-w-[110px]">
                        <Input
                          type="number" min="0" step="0.01"
                          value={editing.price}
                          onChange={(e) => setEditing((s) => (s ? { ...s, price: e.target.value } : s))}
                        />
                      </div>
                      <label className="flex items-center gap-1 text-xs text-slate-400">
                        <input
                          type="checkbox"
                          checked={editing.enabled}
                          onChange={(e) => setEditing((s) => (s ? { ...s, enabled: e.target.checked } : s))}
                        />
                        À venda
                      </label>
                      <Button size="sm" variant="primary" loading={pending} onClick={handleSaveOption}>
                        Salvar
                      </Button>
                      <Button size="sm" variant="ghost" disabled={pending} onClick={() => setEditing(null)}>
                        Cancelar
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      {opt ? (
                        <>
                          <span className="text-white font-medium">{formatCurrency(opt.price)}</span>
                          <Badge variant={opt.is_enabled ? 'success' : 'default'}>
                            {opt.is_enabled ? 'À venda' : 'Oculto'}
                          </Badge>
                        </>
                      ) : (
                        <span className="text-slate-500 text-xs">Não configurado</span>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setEditing({
                            planId: plan.id,
                            periodicity,
                            price: opt ? String(opt.price) : '',
                            enabled: opt ? opt.is_enabled : true,
                          })
                        }
                      >
                        Editar
                      </Button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </Card>
      ))}

      {plans.length === 0 && !showCreateForm && (
        <p className="text-sm text-slate-400">Nenhum plano cadastrado.</p>
      )}
    </div>
  )
}
