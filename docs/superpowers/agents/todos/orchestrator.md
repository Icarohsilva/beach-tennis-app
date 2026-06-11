# TODO: Orchestrator Agent — Merge All Branches

**Branch:** `release/all-fixes` (create from main)
**Role:** Wait for all task agents, merge all branches, resolve conflicts, verify build, deploy.

## Pre-flight Check

- [ ] Read `docs/superpowers/agents/STATUS.md` — confirm all agents show `done`
- [ ] List all fix branches: `git branch -a | grep fix/`

## Merge Strategy

Merge branches in this order (to minimize conflicts):

### Wave 1 — No conflicts (merge directly)
- [ ] `git merge fix/task-03-mobile-nav --no-edit`
- [ ] `git merge fix/task-04-cancel-booking --no-edit`
- [ ] `git merge fix/task-05-start-class --no-edit`
- [ ] `git merge fix/task-06-credits --no-edit`
- [ ] `git merge fix/task-07-dayuse --no-edit`
- [ ] `git merge fix/task-10-plans --no-edit`

### Wave 2 — Files touched by multiple agents (handle conflicts)

**Conflict files:**
- `features/aulas/class-form-actions.ts` → agents 01, 02
- `features/aulas/adminActions.ts` → agents 01, 08, 09
- `app/(admin)/admin/grade/page.tsx` → agents 01, 02
- `features/financeiro/actions.ts` → agents 06, 09

For each conflict: keep ALL changes from both sides (additive merges).

- [ ] `git merge fix/task-01-sessions` (resolve conflicts in class-form-actions.ts, adminActions.ts, grade/page.tsx)
- [ ] `git merge fix/task-02-edit-class` (resolve conflicts in class-form-actions.ts, grade/page.tsx)
- [ ] `git merge fix/task-08-stale-data` (resolve conflicts in adminActions.ts)
- [ ] `git merge fix/task-09-dependents` (resolve conflicts in adminActions.ts, financeiro/actions.ts)

### DB Migration
- [ ] Confirm `supabase/migrations/20260601000000_class_sessions_unique.sql` exists
- [ ] Apply: `npx supabase db push` (if credentials available)

## Verification
- [ ] `npm run lint` — must pass
- [ ] `npm run build` — must pass with 0 errors
- [ ] `npm run test:run` — all tests must pass

## Final
- [ ] `git push origin release/all-fixes`
- [ ] Update `docs/superpowers/agents/STATUS.md` — orchestrator: done

## Conflict Resolution Guide

When resolving conflicts in the same file:
- KEEP all new functions added by each agent
- KEEP all modifications made by each agent
- If two agents modified the SAME function — apply both change sets manually

Example: `adminActions.ts`
- agent-01 ADDS `generateSessionsForExistingClass` (new function at end)
- agent-08 MODIFIES `cancelEnrollment` (adds revalidatePath)
- agent-09 ADDS `addDependentSelf` (new function at end)
→ Result: file has all three changes
