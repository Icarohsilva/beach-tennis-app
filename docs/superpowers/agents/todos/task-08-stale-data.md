# TODO: Agent 08 — Stale Data Fix (revalidatePath)

**Branch:** `fix/task-08-stale-data`
**Issues fixed:** #10 (aulas do aluno não aparecem sem recarregar a página)

## Root Cause
`enrollStudentInClass` and `cancelEnrollment` in `features/aulas/adminActions.ts`
do NOT call `revalidatePath`. Next.js caches the student profile page, so changes
only appear after a manual F5.

## Tasks

- [ ] Read `features/aulas/adminActions.ts` fully
- [ ] Confirm `revalidatePath` is imported from `'next/cache'` (add import if missing)
- [ ] In `enrollStudentInClass(studentId, classId)`:
  - After successful insert, add:
    ```typescript
    revalidatePath(`/admin/alunos/${studentId}`)
    revalidatePath('/admin/alunos')
    ```
- [ ] In `cancelEnrollment(enrollmentId)`:
  - Before the update, fetch `enrollment.student_id`:
    ```typescript
    const { data: enrollment } = await adminClient
      .from('enrollments').select('student_id').eq('id', enrollmentId).single()
    ```
  - After successful update, add:
    ```typescript
    if (enrollment) revalidatePath(`/admin/alunos/${enrollment.student_id}`)
    revalidatePath('/admin/alunos')
    ```
- [ ] Run `npm run build` — must pass
- [ ] Commit: `git commit -m "fix: revalidar cache da página do aluno após matrícula/cancelamento"`

## Completion

When done, update `docs/superpowers/agents/STATUS.md` row for agent-08-stale-data.
