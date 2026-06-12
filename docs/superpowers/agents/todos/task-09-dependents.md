# TODO: Agent 09 — Dependents Self-Service + Plan for Dependents

**Branch:** `fix/task-09-dependents`
**Issues fixed:** #3 (responsável deve vincular dependentes), #14 (definir planos para dependentes)

## Tasks

### Part A: Guardian adds their own dependents (#3)

- [ ] Read `features/aulas/adminActions.ts`
- [ ] Add `addDependentSelf(name, level)` server action (NO requireAdmin — any authenticated user):
  - Gets current user via `createClient()`
  - Checks caller is NOT a dependent (would create circular dependency)
  - Inserts into `profiles`: `{ full_name, level, role: 'student', is_dependent: true, parent_id: user.id, payment_type: 'subscriber', credits_balance: 0, contract_active: false }`
  - Calls `revalidatePath('/perfil')`
- [ ] Read `app/(dashboard)/perfil/page.tsx`
- [ ] In perfil page server component: fetch dependents for current user:
  ```typescript
  const { data: dependents } = await supabase
    .from('profiles').select('id, full_name, level')
    .eq('parent_id', user.id).eq('is_dependent', true)
  ```
- [ ] Create `features/aulas/DependentsSection.tsx` client component:
  - Shows list of current dependents with level badge
  - Form to add new: name input + level select + "Adicionar" button
  - Calls `addDependentSelf` from `./adminActions`
  - Optimistic add to list on success
- [ ] Import and render `<DependentsSection>` in perfil page (only for non-dependents)
- [ ] Only show section if `!profile.is_dependent`

### Part B: Admin assigns plan to dependent (#14)

- [ ] Read `features/financeiro/actions.ts`
- [ ] Add `adminSubscribeStudentToPlan(studentId, planId)` server action:
  - Requires admin role check
  - Same logic as `subscribeToPlan` but for any studentId
  - Grants initial credits (same as Task 6 logic)
  - Handles is_dependent: payer_id = parent_id
  - Calls `revalidatePath(\`/admin/alunos/${studentId}\`)`
- [ ] Read `app/(admin)/admin/alunos/[id]/page.tsx`
- [ ] Read `app/(admin)/admin/alunos/[id]/StudentProfileClient.tsx`
- [ ] In the admin aluno page server component: fetch available active plans
- [ ] Add plan subscription UI to StudentProfileClient:
  - New section "Plano de Assinatura" visible for all students (including dependents)
  - Select dropdown of available plans + "Assinar" button
  - Calls `adminSubscribeStudentToPlan`
  - Shows current active plan if exists

### Final

- [ ] Run `npm run build` — must pass
- [ ] Commit: `git commit -m "feat: responsável adiciona dependentes; admin associa plano a dependente"`

## Completion

When done, update `docs/superpowers/agents/STATUS.md` row for agent-09-dependents.
