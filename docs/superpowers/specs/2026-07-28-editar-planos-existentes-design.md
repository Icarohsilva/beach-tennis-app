# Editar planos já cadastrados — Design

**Goal:** Hoje só é possível criar um plano (`createPlan`) ou ativar/desativar (`togglePlanActive`) e editar preço por periodicidade (`saveBillingOption`). Não existe forma de corrigir `classes_per_week`, `cycle`, `max_classes_per_day` ou `refund_on_late_cancel` de um plano já criado. Isso bloqueia a adoção da cota: os planos cadastrados antes da feature têm esses campos decorativos ou no default da migração, e a academia precisa revisá-los antes de ligar `quota_enforcement_enabled`.

**Contexto:** Segue direto o plano [`2026-07-28-cota-de-aulas-por-plano.md`](../plans/2026-07-28-cota-de-aulas-por-plano.md) (já mergeado em `main`), que deliberadamente só implementou criação de plano com os campos de cota (Task 11), sem editor.

## Escopo

Editável: `name`, `description`, `classes_per_week`, `cycle`, `max_classes_per_day`, `refund_on_late_cancel` — todos os campos básicos do plano. Preço por periodicidade continua em `saveBillingOption`, inalterado. Ativar/desativar continua em `togglePlanActive`, inalterado.

**Fora do escopo:** nenhuma validação contra matrículas existentes. Se o admin reduzir `classes_per_week` abaixo do que algum aluno já tem de fixa, a edição salva normalmente — a cota é derivada e `resolveQuota`'s `max(classesPerWeek × cycleWeeks, fixedSessionsInCycle)` já garante que a fixa do aluno nunca é barrada, mesmo com o plano "estourado". Isso só importa quando `quota_enforcement_enabled = true`; adicionar uma checagem aqui duplicaria uma garantia que já existe em outra camada.

## Arquitetura

### 1. `updatePlan` — nova server action

Em `app/(admin)/admin/financeiro/adminActions.ts`, ao lado de `createPlan`:

```ts
export interface UpdatePlanData extends CreatePlanData {
  id: string
}

export async function updatePlan(data: UpdatePlanData): Promise<{ error?: string }>
```

Mesma validação de `createPlan` (nome obrigatório, `cycle` ∈ `['weekly','monthly']`, `max_classes_per_day` inteiro positivo — os mesmos guards já existem em `createPlan`, `updatePlan` reusa a mesma lógica, não duplica silenciosamente com texto diferente). Em vez de `.insert()`, faz:

```ts
await adminClient
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
```

`revalidatePath('/admin/financeiro/planos')` ao final, igual `createPlan`.

### 2. `PlanFormFields` — componente de campos compartilhado

Novo arquivo `app/(admin)/admin/financeiro/PlanFormFields.tsx` (fica junto de `PlansManager.tsx`, não em `components/ui/`, porque é específico deste formulário, não um primitivo reutilizável no app todo). Componente controlado, sem estado próprio:

```ts
interface PlanFormFieldsProps {
  value: CreatePlanData
  onChange: (next: CreatePlanData) => void
}
```

Renderiza os 5 campos (nome, descrição, aulas/semana, ciclo, teto diário, checkbox de reembolso) exatamente como hoje estão no formulário de criação — é uma extração, não um redesenho. Usado tanto pelo formulário de "Novo Plano" quanto pelo card em modo edição.

### 3. `PlansManager.tsx` — modo edição por card

- Novo estado: `const [editingPlan, setEditingPlan] = useState<UpdatePlanData | null>(null)`.
- Cada card de plano ganha um botão "Editar" ao lado do botão Ativar/Desativar existente.
- Ao clicar: `setEditingPlan({ id: plan.id, name: plan.name, description: plan.description ?? undefined, classes_per_week: plan.classes_per_week, cycle: plan.cycle, max_classes_per_day: plan.max_classes_per_day, refund_on_late_cancel: plan.refund_on_late_cancel })`.
- Quando `editingPlan?.id === plan.id`, o card renderiza `<PlanFormFields value={editingPlan} onChange={setEditingPlan} />` + botões Salvar/Cancelar, no lugar da exibição read-only (nome, badge, descrição, "Nx/semana").
- Salvar chama `updatePlan(editingPlan)`; sucesso limpa `editingPlan` e mostra a mensagem de sucesso já usada pelo formulário de criação (mesmo padrão de `error`/`success` state).
- Cancelar só limpa `editingPlan`, sem chamar a action.
- O formulário de "Novo Plano" (`showCreateForm`) passa a usar `<PlanFormFields value={createForm} onChange={setCreateForm} />` internamente, no lugar do JSX que hoje está inline — mesma aparência, sem duplicação.

## Fluxo de dados

Editar → `editingPlan` populado com os valores atuais → admin edita nos mesmos inputs do formulário de criação → Salvar → `updatePlan` valida e grava → `revalidatePath` → Server Component busca os planos de novo → `editingPlan` volta a `null` → card mostra os valores novos.

## Tratamento de erro

Idêntico ao fluxo de criação: validação client-side (mesmas mensagens) roda antes da chamada; erro do server aparece na mesma área `{error && <p className="text-sm text-red-400 ...">}` que o formulário de criação já usa, compartilhada entre os dois fluxos (um único `error`/`success` state no componente, não um por card).

## Testes

Sem teste dedicado — consistente com `createPlan`/`PlansManager.tsx` hoje, que não têm teste próprio neste arquivo. `npm run test:run` roda a suíte inteira para confirmar que nada quebrou; `npx tsc --noEmit` confirma que não há erro novo.

## Fora deste design

- Validação/aviso sobre alunos que ficariam acima do novo `classes_per_week` — decisão deliberada de não implementar (ver Escopo).
- Edição de preço por periodicidade — já existe (`saveBillingOption`), inalterado.
- Qualquer mudança em `togglePlanActive`.
