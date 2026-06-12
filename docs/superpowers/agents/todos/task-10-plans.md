# TODO: Agent 10 — Plans CRUD via Admin UI

**Branch:** `fix/task-10-plans`
**Issues fixed:** #15 (criar e editar planos via app)

## Root Cause
`PlansManager.tsx` only has toggle active and update price.
No UI to create new plans. Admin must use DB directly.

## Tasks

- [ ] Read `app/(admin)/admin/financeiro/adminActions.ts`
- [ ] Read `app/(admin)/admin/financeiro/PlansManager.tsx`
- [ ] Add `createPlan(data: CreatePlanData)` to `adminActions.ts`:
  - Requires admin role check
  - Validates: name not empty, credits_per_month >= 1, prices >= 0
  - Inserts into `subscription_plans` with `is_active: true`
  - Calls `revalidatePath('/admin/financeiro')`
- [ ] Add `CreatePlanForm` inline or as component in `PlansManager.tsx`:
  - Toggled by "+ Novo Plano" button
  - Fields: name, description (optional), classes_per_week, credits_per_month, price_monthly, price_quarterly, price_annual
  - On success: close form + `router.refresh()`
  - On error: show error message
- [ ] Import `createPlan` from `./adminActions` in PlansManager
- [ ] Import `useRouter` from `next/navigation` in PlansManager
- [ ] Run `npm run build` — must pass
- [ ] Commit: `git commit -m "feat: criar novos planos de assinatura via admin"`

## Types
```typescript
export interface CreatePlanData {
  name: string
  description?: string
  classes_per_week: number
  credits_per_month: number
  price_monthly: number
  price_quarterly: number
  price_annual: number
}
```

## Completion

When done, update `docs/superpowers/agents/STATUS.md` row for agent-10-plans.
