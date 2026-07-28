'use client'
// app/(admin)/admin/financeiro/PlanFormFields.tsx
// Campos básicos de um plano (nome, descrição, aulas/semana, ciclo, teto
// diário, reembolso tardio) — controlado, sem estado próprio. Compartilhado
// entre o formulário de criação e o modo de edição inline em PlansManager.
import { Input } from '@/components/ui/Input'
import type { CreatePlanData } from './adminActions'

interface PlanFormFieldsProps {
  value: CreatePlanData
  onChange: (next: CreatePlanData) => void
}

export function PlanFormFields({ value, onChange }: PlanFormFieldsProps) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="text-xs text-slate-400 mb-1 block">Nome *</label>
          <Input
            type="text"
            placeholder="Ex: Plano 2x/semana"
            value={value.name}
            onChange={(e) => onChange({ ...value, name: e.target.value })}
          />
        </div>
        <div>
          <label className="text-xs text-slate-400 mb-1 block">Descrição (opcional)</label>
          <Input
            type="text"
            placeholder="Breve descrição"
            value={value.description ?? ''}
            onChange={(e) => onChange({ ...value, description: e.target.value })}
          />
        </div>
      </div>
      <div>
        <label className="text-xs text-slate-400 mb-1 block">Aulas/semana</label>
        <Input
          type="number" min="1" step="1"
          value={value.classes_per_week}
          onChange={(e) => onChange({ ...value, classes_per_week: parseInt(e.target.value) || 0 })}
        />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="text-xs text-slate-400 mb-1 block">Ciclo da cota</label>
          <select
            value={value.cycle}
            onChange={(e) => onChange({ ...value, cycle: e.target.value as 'weekly' | 'monthly' })}
            className="w-full bg-surface-card border border-surface-border rounded-lg px-3 py-2 text-white text-sm"
          >
            <option value="monthly">Mensal — remaneja aulas dentro do mês</option>
            <option value="weekly">Semanal — zera todo domingo</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-slate-400 mb-1 block">Máximo de aulas por dia</label>
          <Input
            type="number"
            min="1"
            step="1"
            value={value.max_classes_per_day}
            onChange={(e) =>
              onChange({ ...value, max_classes_per_day: Math.max(1, parseInt(e.target.value) || 1) })
            }
          />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-300">
        <input
          type="checkbox"
          checked={value.refund_on_late_cancel}
          onChange={(e) => onChange({ ...value, refund_on_late_cancel: e.target.checked })}
        />
        Cancelamento fora do prazo devolve a aula
      </label>
    </div>
  )
}
