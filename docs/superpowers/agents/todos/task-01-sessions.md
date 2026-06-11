# TODO: Agent 01 — Session Auto-Generation

**Branch:** `fix/task-01-sessions`
**Issues fixed:** #11 (aula de hoje não aparece), #12 (experimental sem turmas), #13 (aluno não se vincula)

## Root Cause
`createClass` only inserts into `classes`. No `class_sessions` rows ever created.
All booking, experimental, and today's view depend on `class_sessions` existing.

## Tasks

- [ ] Read full plan: `docs/superpowers/plans/2026-06-01-15-correcoes-e-melhorias.md` (Task 1)
- [ ] Add `import { eachDayOfInterval, getDay, format } from 'date-fns'` to `features/aulas/class-form-actions.ts`
- [ ] Export `buildSessionRows(classId, dayOfWeek, fromDateStr, toDateStr)` pure function
- [ ] Write test in `features/aulas/class-form-actions.test.ts`
- [ ] Run test: `npm run test:run -- features/aulas/class-form-actions.test.ts` (must pass)
- [ ] Modify `createClass` to call `buildSessionRows` for next 90 days after insert
- [ ] Add `generateSessionsForExistingClass(classId)` to `features/aulas/adminActions.ts`
- [ ] Add `import { buildSessionRows } from './class-form-actions'` to adminActions.ts
- [ ] Create `app/(admin)/admin/grade/GenerateSessionsButton.tsx` (client component)
- [ ] Modify `app/(admin)/admin/grade/page.tsx` to import and render `GenerateSessionsButton` in each weekly class card
- [ ] Run `npm run build` — must pass with 0 errors
- [ ] Commit: `git commit -m "feat: gerar class_sessions automaticamente ao criar turma e para turmas existentes"`

## Completion

When done, update `docs/superpowers/agents/STATUS.md` row for agent-01-sessions.
