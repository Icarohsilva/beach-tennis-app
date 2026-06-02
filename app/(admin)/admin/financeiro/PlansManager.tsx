'use client'
// app/(admin)/financeiro/PlansManager.tsx
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { togglePlanActive, updatePlanPrice, createPlan } from './adminActions'
import type { CreatePlanData } from './adminActions'
import type { SubscriptionPlan } from '@/types'

interface PlansManagerProps {
  plans: SubscriptionPlan[]
}

interface EditState {
  price_monthly: string
  price_quarterly: string
  price_annual: string
}

const emptyCreateForm: CreatePlanData = {
  name: '',
  description: '',
  classes_per_week: 2,
  credits_per_month: 8,
  price_monthly: 0,
  price_quarterly: 0,
  price_annual: 0,
}

export function PlansManager({ plans: initialPlans }: PlansManagerProps) {
  const router = useRouter()
  const [plans, setPlans] = useState(initialPlans)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValues, setEditValues] = useState<EditState>({ price_monthly: '', price_quarterly: '', price_annual: '' })
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  // Create plan form state
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [createForm, setCreateForm] = useState<CreatePlanData>(emptyCreateForm)
  const [createError, setCreateError] = useState<string | null>(null)
  const [createPending, startCreateTransition] = useTransition()

  function startEdit(plan: SubscriptionPlan) {
    setEditingId(plan.id)
    setEditValues({
      price_monthly: String(plan.price_monthly),
      price_quarterly: String(plan.price_quarterly),
      price_annual: String(plan.price_annual),
    })
    setError(null)
    setSuccess(null)
  }

  function cancelEdit() {
    setEditingId(null)
    setError(null)
  }

  function handleToggle(planId: string, current: boolean) {
    setError(null)
    setSuccess(null)
    startTransition(async () => {
      const result = await togglePlanActive(planId, !current)
      if (result.error) {
        setError(result.error)
      } else {
        setPlans((prev) =>
          prev.map((p) => (p.id === planId ? { ...p, is_active: !current } : p)),
        )
        setSuccess(`Plano ${!current ? 'ativado' : 'desativado'} com sucesso.`)
      }
    })
  }

  function handleSavePrice(planId: string) {
    const monthly = parseFloat(editValues.price_monthly)
    const quarterly = parseFloat(editValues.price_quarterly)
    const annual = parseFloat(editValues.price_annual)

    if (isNaN(monthly) || isNaN(quarterly) || isNaN(annual)) {
      setError('Por favor, insira valores numéricos válidos.')
      return
    }

    setError(null)
    startTransition(async () => {
      const result = await updatePlanPrice(planId, {
        price_monthly: monthly,
        price_quarterly: quarterly,
        price_annual: annual,
      })
      if (result.error) {
        setError(result.error)
      } else {
        setPlans((prev) =>
          prev.map((p) =>
            p.id === planId
              ? { ...p, price_monthly: monthly, price_quarterly: quarterly, price_annual: annual }
              : p,
          ),
        )
        setEditingId(null)
        setSuccess('Preços atualizados com sucesso.')
      }
    })
  }

  function handleCreatePlan() {
    setCreateError(null)
    startCreateTransition(async () => {
      const result = await createPlan(createForm)
      if (result.error) {
        setCreateError(result.error)
      } else {
        setShowCreateForm(false)
        setCreateForm(emptyCreateForm)
        router.refresh()
      }
    })
  }

  function cancelCreate() {
    setShowCreateForm(false)
    setCreateForm(emptyCreateForm)
    setCreateError(null)
  }

  function formatCurrency(amount: number) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(amount)
  }

  return (
    <div className="space-y-3">
      {/* "+ Novo Plano" button */}
      {!showCreateForm && (
        <div>
          <Button size="sm" variant="primary" onClick={() => setShowCreateForm(true)}>
            + Novo Plano
          </Button>
        </div>
      )}

      {/* Create plan form */}
      {showCreateForm && (
        <Card>
          <p className="text-xs text-slate-400 font-medium uppercase tracking-wide mb-3">Novo Plano</p>
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Nome *</label>
                <Input
                  type="text"
                  placeholder="Ex: Plano Básico"
                  value={createForm.name}
                  onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Descrição (opcional)</label>
                <Input
                  type="text"
                  placeholder="Breve descrição"
                  value={createForm.description ?? ''}
                  onChange={(e) => setCreateForm((f) => ({ ...f, description: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Aulas/semana</label>
                <Input
                  type="number"
                  min="1"
                  step="1"
                  value={createForm.classes_per_week}
                  onChange={(e) => setCreateForm((f) => ({ ...f, classes_per_week: parseInt(e.target.value) || 0 }))}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Créditos/mês</label>
                <Input
                  type="number"
                  min="1"
                  step="1"
                  value={createForm.credits_per_month}
                  onChange={(e) => setCreateForm((f) => ({ ...f, credits_per_month: parseInt(e.target.value) || 0 }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Mensal (R$)</label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={createForm.price_monthly}
                  onChange={(e) => setCreateForm((f) => ({ ...f, price_monthly: parseFloat(e.target.value) || 0 }))}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Trimestral (R$)</label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={createForm.price_quarterly}
                  onChange={(e) => setCreateForm((f) => ({ ...f, price_quarterly: parseFloat(e.target.value) || 0 }))}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Anual (R$)</label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={createForm.price_annual}
                  onChange={(e) => setCreateForm((f) => ({ ...f, price_annual: parseFloat(e.target.value) || 0 }))}
                />
              </div>
            </div>
            {createError && (
              <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                {createError}
              </p>
            )}
            <div className="flex gap-2">
              <Button size="sm" variant="primary" loading={createPending} onClick={handleCreatePlan}>
                Criar Plano
              </Button>
              <Button size="sm" variant="ghost" onClick={cancelCreate} disabled={createPending}>
                Cancelar
              </Button>
            </div>
          </div>
        </Card>
      )}

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

      {plans.map((plan) => (
        <Card key={plan.id}>
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-white font-semibold text-sm">{plan.name}</h3>
                <Badge variant={plan.is_active ? 'success' : 'danger'}>
                  {plan.is_active ? 'Ativo' : 'Inativo'}
                </Badge>
              </div>
              {plan.description && (
                <p className="text-xs text-slate-400 mt-0.5">{plan.description}</p>
              )}
              <p className="text-xs text-slate-400 mt-1">
                {plan.classes_per_week}x/semana · {plan.credits_per_month} créditos/mês
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              <Button
                size="sm"
                variant={plan.is_active ? 'danger' : 'secondary'}
                loading={pending}
                onClick={() => handleToggle(plan.id, plan.is_active)}
              >
                {plan.is_active ? 'Desativar' : 'Ativar'}
              </Button>
              {editingId !== plan.id && (
                <Button size="sm" variant="ghost" onClick={() => startEdit(plan)}>
                  Preços
                </Button>
              )}
            </div>
          </div>

          {editingId === plan.id ? (
            <div className="space-y-3 pt-3 border-t border-surface-border">
              <p className="text-xs text-slate-400 font-medium uppercase tracking-wide">Editar preços</p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Mensal (R$)</label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={editValues.price_monthly}
                    onChange={(e) => setEditValues((v) => ({ ...v, price_monthly: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Trimestral (R$)</label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={editValues.price_quarterly}
                    onChange={(e) => setEditValues((v) => ({ ...v, price_quarterly: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Anual (R$)</label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={editValues.price_annual}
                    onChange={(e) => setEditValues((v) => ({ ...v, price_annual: e.target.value }))}
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  loading={pending}
                  onClick={() => handleSavePrice(plan.id)}
                >
                  Salvar
                </Button>
                <Button size="sm" variant="ghost" onClick={cancelEdit} disabled={pending}>
                  Cancelar
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2 text-xs pt-2 border-t border-surface-border">
              <div>
                <span className="text-slate-400">Mensal</span>
                <p className="text-white font-medium">{formatCurrency(plan.price_monthly)}</p>
              </div>
              <div>
                <span className="text-slate-400">Trimestral</span>
                <p className="text-white font-medium">{formatCurrency(plan.price_quarterly)}</p>
              </div>
              <div>
                <span className="text-slate-400">Anual</span>
                <p className="text-white font-medium">{formatCurrency(plan.price_annual)}</p>
              </div>
            </div>
          )}
        </Card>
      ))}

      {plans.length === 0 && !showCreateForm && (
        <p className="text-sm text-slate-400">Nenhum plano cadastrado.</p>
      )}
    </div>
  )
}
