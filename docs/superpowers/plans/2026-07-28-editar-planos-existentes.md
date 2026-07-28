# Editar planos já cadastrados — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir editar `name`, `description`, `classes_per_week`, `cycle`, `max_classes_per_day` e `refund_on_late_cancel` de um plano já criado, direto na tela `/admin/financeiro/planos` — hoje só é possível criar (`createPlan`) ou ativar/desativar (`togglePlanActive`).

**Architecture:** Nova server action `updatePlan` (mesma validação de `createPlan`, `.update()` em vez de `.insert()`). Os 5 campos do formulário são extraídos para um componente controlado `PlanFormFields` (sem estado próprio), reusado tanto pelo formulário de criação quanto pelo modo de edição inline em cada card de `PlansManager.tsx`.

**Tech Stack:** TypeScript · Next.js 14 App Router (Server Actions + Client Component) · Tailwind CSS · Supabase

**Spec:** [`docs/superpowers/specs/2026-07-28-editar-planos-existentes-design.md`](../specs/2026-07-28-editar-planos-existentes-design.md)

---

## Escopo deste plano

Editável: os 6 campos básicos do plano listados acima. Preço por periodicidade continua em `saveBillingOption` (inalterado); ativar/desativar continua em `togglePlanActive` (inalterado). **Sem validação contra matrículas existentes** ao reduzir `classes_per_week` — decisão deliberada (ver spec, seção "Escopo"): `resolveQuota`'s `max()` já garante que a fixa do aluno nunca é barrada.

## Ambiente

Rode os testes com a ferramenta **PowerShell**, não Bash — `vitest` via Bash falha aleatoriamente neste ambiente com `"config" undefined`.

`app/(admin)/admin/financeiro/adminActions.ts` e `PlansManager.tsx` não têm arquivo de teste próprio hoje (nem `createPlan`, que segue o mesmo padrão, tem). Este plano segue a mesma convenção — cada task verifica com `npm run test:run` (suíte inteira, sem regressão) e `npx tsc --noEmit`, não com testes novos.

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `app/(admin)/admin/financeiro/adminActions.ts` (mod) | `updatePlan` — nova server action |
| `app/(admin)/admin/financeiro/PlanFormFields.tsx` (novo) | Campos do formulário de plano, controlado, sem estado próprio |
| `app/(admin)/admin/financeiro/PlansManager.tsx` (mod) | Usa `PlanFormFields` no formulário de criação; ganha modo de edição inline por card |

---

### Task 1: `updatePlan` — nova server action

**Files:**
- Modify: `app/(admin)/admin/financeiro/adminActions.ts:49-91`

- [ ] **Step 1: Ler o arquivo atual**

Run: `Get-Content "app/(admin)/admin/financeiro/adminActions.ts" | Select-Object -First 91`
Expected: confirmar que `CreatePlanData` e `createPlan` estão exatamente como abaixo (se algo mudou desde este plano ter sido escrito, adapte os próximos steps ao que você encontrar em vez de sobrescrever cegamente):

```ts
export interface CreatePlanData {
  name: string
  description?: string
  classes_per_week: number
  cycle: 'weekly' | 'monthly'
  max_classes_per_day: number
  refund_on_late_cancel: boolean
}

export async function createPlan(data: CreatePlanData): Promise<{ error?: string; planId?: string }> {
  try {
    const { adminClient, orgId } = await assertAdmin()

    if (!data.name.trim()) return { error: 'Nome é obrigatório.' }
    if (data.cycle !== 'weekly' && data.cycle !== 'monthly') {
      return { error: 'Ciclo da cota inválido.' }
    }
    if (!Number.isInteger(data.max_classes_per_day) || data.max_classes_per_day <= 0) {
      return { error: 'Máximo de aulas por dia deve ser um número inteiro positivo.' }
    }

    const { data: plan, error } = await adminClient
      .from('subscription_plans')
      .insert({
        name: data.name.trim(),
        description: data.description?.trim() || null,
        classes_per_week: data.classes_per_week,
        cycle: data.cycle,
        max_classes_per_day: data.max_classes_per_day,
        refund_on_late_cancel: data.refund_on_late_cancel,
        is_active: true,
        organization_id: orgId,
      })
      .select('id')
      .single()

    if (error || !plan) return { error: error?.message ?? 'Erro ao criar plano.' }
    revalidatePath('/admin/financeiro/planos')
    return { planId: plan.id as string }
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}
```

- [ ] **Step 2: Adicionar `UpdatePlanData` e `updatePlan` logo depois de `createPlan`**

```ts
export interface UpdatePlanData extends CreatePlanData {
  id: string
}

export async function updatePlan(data: UpdatePlanData): Promise<{ error?: string }> {
  try {
    const { adminClient, orgId } = await assertAdmin()

    if (!data.name.trim()) return { error: 'Nome é obrigatório.' }
    if (data.cycle !== 'weekly' && data.cycle !== 'monthly') {
      return { error: 'Ciclo da cota inválido.' }
    }
    if (!Number.isInteger(data.max_classes_per_day) || data.max_classes_per_day <= 0) {
      return { error: 'Máximo de aulas por dia deve ser um número inteiro positivo.' }
    }

    const { error } = await adminClient
      .from('subscription_plans')
      .update({
        name: data.name.trim(),
        description: data.description?.trim() || null,
        classes_per_week: data.classes_per_week,
        cycle: data.cycle,
        max_classes_per_day: data.max_classes_per_day,
        refund_on_late_cancel: data.refund_on_late_cancel,
      })
      .eq('id', data.id)
      .eq('organization_id', orgId)

    if (error) return { error: 'Erro ao atualizar plano.' }
    revalidatePath('/admin/financeiro/planos')
    return {}
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}
```

A validação é idêntica à de `createPlan` — mesma mensagem, mesma regra. Isso é intencional: os dois formulários (criar/editar) devem rejeitar exatamente os mesmos valores inválidos.

- [ ] **Step 3: Verificar**

Run: `npx tsc --noEmit`
Expected: nenhum erro novo em `adminActions.ts` (os erros pré-existentes em `lib/branding/*.test.ts`, `lib/torneios/schedule/americano.test.ts` e `types/index.test.ts` não são deste arquivo — ignore).

Run: `npm run test:run`
Expected: PASS — nenhuma regressão (este arquivo não tem teste próprio, então isto só confirma que nada mais quebrou).

- [ ] **Step 4: Commit**

```bash
git add "app/(admin)/admin/financeiro/adminActions.ts"
git commit -m "feat(planos): adiciona updatePlan para editar plano ja criado"
```

---

### Task 2: `PlanFormFields` — extrair os campos do formulário

**Files:**
- Create: `app/(admin)/admin/financeiro/PlanFormFields.tsx`
- Modify: `app/(admin)/admin/financeiro/PlansManager.tsx:111-190`

- [ ] **Step 1: Criar o componente**

```tsx
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
```

- [ ] **Step 2: Trocar o JSX inline do formulário de criação pelo componente**

Em `PlansManager.tsx`, o bloco `{showCreateForm && (...)}` (linhas ~111-190) tem hoje um `<div className="space-y-3">` com os 5 campos inline, seguido do bloco de botões Criar/Cancelar. Substitua o conteúdo do `<div className="space-y-3">` (tudo entre ele e o `<div className="flex gap-2">` dos botões) por:

```tsx
            <PlanFormFields value={createForm} onChange={setCreateForm} />
```

O resultado deve ficar assim (compare com o arquivo atual e ajuste só a parte dos campos — o `<Card>`, o título "Novo Plano" e os botões Criar/Cancelar continuam exatamente iguais):

```tsx
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
```

- [ ] **Step 3: Adicionar o import**

No topo de `PlansManager.tsx`, junto dos outros imports locais:

```ts
import { PlanFormFields } from './PlanFormFields'
```

- [ ] **Step 4: Verificar**

Run: `npx tsc --noEmit`
Expected: nenhum erro novo.

Run: `npm run test:run`
Expected: PASS — nenhuma regressão.

Esta task é um refactor puro (extração), sem mudança de comportamento — o formulário de criação deve continuar com exatamente a mesma aparência e função de antes. Se você tiver acesso ao navegador (via `preview_start`, nunca Bash) e conseguir logar como admin, navegue a `/admin/financeiro/planos`, clique em "+ Novo Plano" e confirme com `read_page` que os 5 campos aparecem como antes. Se esbarrar em tela de login sem credenciais disponíveis, pule esta verificação visual e confie em `tsc` + revisão de código — isso já aconteceu nas tasks anteriores deste tipo neste projeto.

- [ ] **Step 5: Commit**

```bash
git add "app/(admin)/admin/financeiro/PlanFormFields.tsx" "app/(admin)/admin/financeiro/PlansManager.tsx"
git commit -m "refactor(planos): extrai PlanFormFields do formulario de criacao"
```

---

### Task 3: Modo de edição inline por card

**Files:**
- Modify: `app/(admin)/admin/financeiro/PlansManager.tsx`

**Nota de design:** o estado de edição usa DOIS campos separados — `editingPlanId: string | null` (qual plano está em edição) e `editForm: CreatePlanData` (os valores do formulário, sem `id`) — em vez de um único `UpdatePlanData | null`. Isso é deliberado: `PlanFormFields.onChange` é tipado `(next: CreatePlanData) => void`, e `React.Dispatch<SetStateAction<UpdatePlanData | null>>` não é atribuível a esse tipo (o parâmetro que `onChange` aceitaria teria que cobrir `CreatePlanData`, mas o setter de um estado `UpdatePlanData | null` só aceita `UpdatePlanData | null | função`, e `CreatePlanData` sozinho não satisfaz `UpdatePlanData` porque falta `id`). Com `editForm: CreatePlanData`, `setEditForm` tem o tipo exato que `PlanFormFields` espera — mesmo padrão que `createForm`/`setCreateForm` já usa hoje, comprovado que compila. O `id` é anexado só na hora de chamar `updatePlan`, no `handleUpdatePlan`.

- [ ] **Step 1: Importar `updatePlan`**

No topo do arquivo, troque a linha:

```ts
import { togglePlanActive, createPlan, saveBillingOption } from './adminActions'
```

por:

```ts
import { togglePlanActive, createPlan, updatePlan, saveBillingOption } from './adminActions'
```

(o import de `CreatePlanData` na linha abaixo não muda — não precisamos importar `UpdatePlanData` neste arquivo, já que nenhuma variável é tipada com ele explicitamente.)

- [ ] **Step 2: Adicionar o estado de edição**

Logo abaixo de `const [createForm, setCreateForm] = useState<CreatePlanData>(emptyCreateForm)`, adicione:

```ts
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<CreatePlanData>(emptyCreateForm)
```

- [ ] **Step 3: Adicionar `handleUpdatePlan`**

Logo depois de `handleCreatePlan` (antes de `handleSaveOption`):

```ts
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
```

- [ ] **Step 4: Trocar o header do card por uma versão com modo de edição**

O bloco atual (dentro de `{plans.map((plan) => (`):

```tsx
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
              {plan.description && <p className="text-xs text-slate-400 mt-0.5">{plan.description}</p>}
              <p className="text-xs text-slate-400 mt-1">
                {plan.classes_per_week}x/semana
              </p>
            </div>
            <Button
              size="sm"
              variant={plan.is_active ? 'danger' : 'secondary'}
              loading={pending}
              onClick={() => handleToggle(plan.id, plan.is_active)}
            >
              {plan.is_active ? 'Desativar' : 'Ativar'}
            </Button>
          </div>
```

Vira (o `.map((plan) => (` continua igual — retorno implícito, sem `return` explícito, sem mexer no fechamento do `.map` no fim do arquivo):

```tsx
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
```

O restante do card (bloco "Periodicidades", já existente) e o fechamento `</Card>` / `))}` no fim do arquivo **não mudam** — só o conteúdo do header, mostrado acima, foi substituído.

- [ ] **Step 5: Verificar**

Run: `npx tsc --noEmit`
Expected: nenhum erro novo. Se aparecer um erro de tipo em `onChange={setEditForm}` ou `onClick={handleUpdatePlan}`, releia o Step 2 — o mais provável é `editForm` ter ficado tipado errado (deve ser `CreatePlanData`, não `UpdatePlanData`).

Run: `npm run test:run`
Expected: PASS — nenhuma regressão.

Run: `npm run lint`
Expected: sem warnings novos (pode falhar por completo com um conflito de plugin `@next/next` pré-existente neste tipo de ambiente — se isso acontecer, confirme manualmente que não há import não usado e siga).

- [ ] **Step 6: Verificar no navegador (se possível)**

Com `preview_start` (nunca Bash), navegue a `/admin/financeiro/planos`. Clique em "Editar" num plano, confirme com `read_page` que os campos aparecem preenchidos com os valores atuais do plano, mude "Aulas/semana", clique Salvar, e confirme que o card volta ao modo leitura com o valor novo. Clique "Editar" em outro plano e confirme que o primeiro card volta ao modo leitura sem salvar (troca de `editingPlanId` descarta a edição anterior — comportamento aceito, mesmo padrão do estado `editing` de periodicidade já existente no arquivo). Se esbarrar em tela de login sem credenciais disponíveis (como aconteceu nas últimas tasks de UI deste tipo de projeto), pule esta etapa e confie em `tsc` + revisão de código.

- [ ] **Step 7: Commit**

```bash
git add "app/(admin)/admin/financeiro/PlansManager.tsx"
git commit -m "feat(planos): edicao inline de plano ja criado"
```

---

## Fora deste plano

- Validação/aviso sobre alunos que ficariam com mais fixas do que o novo `classes_per_week` permite.
- Edição de preço por periodicidade (já existe, `saveBillingOption`).
- Qualquer mudança em `togglePlanActive`.
