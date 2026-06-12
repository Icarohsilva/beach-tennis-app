# TODO: Agent 02 — Edit Class + Layout Fix

**Branch:** `fix/task-02-edit-class`
**Issues fixed:** #1 (não é possível editar turma), #8 (datas sobrepostas no layout)

## Tasks

- [ ] Read full plan: `docs/superpowers/plans/2026-06-01-15-correcoes-e-melhorias.md` (Task 2)
- [ ] Add `updateClass(classId, data)` server action to `features/aulas/class-form-actions.ts`
- [ ] Create `features/aulas/EditClassForm.tsx` client component (pre-filled form)
- [ ] Create directory `app/(admin)/admin/grade/[classId]/editar/`
- [ ] Create `app/(admin)/admin/grade/[classId]/editar/page.tsx` — fetches class, renders EditClassForm
- [ ] Modify `app/(admin)/admin/grade/page.tsx` weekly cards: split name+badges row / time row / vagas row (separate lines, fixes #8)
- [ ] Add "Editar" link on each weekly class card linking to `/admin/grade/[c.id]/editar`
- [ ] Run `npm run build` — must pass with 0 errors
- [ ] Commit: `git commit -m "feat: editar turma existente e corrigir layout de cards na grade semanal"`

## Layout Fix Detail (#8)
The weekly card currently has name+badges+time+vagas all competing on same lines.
New structure (3 rows):
1. `name` + badges (KIDS, level)
2. `start_time – end_time`
3. `enrolled/max vagas` (right-aligned, color-coded)

## Completion

When done, update `docs/superpowers/agents/STATUS.md` row for agent-02-edit-class.
