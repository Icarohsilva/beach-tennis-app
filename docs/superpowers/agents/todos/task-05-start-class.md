# TODO: Agent 05 — Start Class / Bulk Attendance

**Branch:** `fix/task-05-start-class`
**Issues fixed:** #4 (iniciar aula com chamada/confirmação)

## Root Cause
Session detail page shows per-student attendance but has no "start class" UX.
Needs: bulk toggle (present/absent), "mark all present" button, confirm all at once.

## Tasks

- [ ] Read full plan: `docs/superpowers/plans/2026-06-01-15-correcoes-e-melhorias.md` (Task 5)
- [ ] Read `app/(admin)/admin/grade/[sessionId]/page.tsx`
- [ ] Read `features/aulas/actions.ts` (existing `markAttendance`)
- [ ] Add `markAttendanceBulk(sessionId, allStudentIds, presentIds)` to end of `features/aulas/actions.ts`
  - Upsert attendance for all students (present/absent)
  - Update session status to 'completed'
  - Call `revalidatePath(\`/admin/grade/${sessionId}\`)`
  - Check caller is admin
- [ ] Create `features/aulas/StartClassClient.tsx` — client component:
  - Button "Iniciar Aula" (shows when session not completed)
  - List of students with present/absent toggle (click to flip)
  - "Marcar todos presentes" button
  - "Confirmar Chamada" button → calls markAttendanceBulk
  - Shows success state when done
- [ ] Import and render `<StartClassClient>` in `app/(admin)/admin/grade/[sessionId]/page.tsx`
  - Pass sessionId, students array, isCompleted flag
- [ ] Run `npm run build` — must pass
- [ ] Commit: `git commit -m "feat: fluxo de iniciar aula com chamada em lote"`

## Completion

When done, update `docs/superpowers/agents/STATUS.md` row for agent-05-start-class.
