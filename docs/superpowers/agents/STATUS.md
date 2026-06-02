# Agent Status Board

All agents write their final status here when complete.
Orchestrator reads this to know when to proceed with merging.

| Agent | Branch | Status | Notes |
|-------|--------|--------|-------|
| agent-00-db | - | pending | DB migration: UNIQUE constraint on class_sessions |
| agent-01-sessions | worktree-agent-a05a335ad1cd2204d | done | Task 1: auto-generate class_sessions |
| agent-02-edit-class | - | pending | Task 2: edit class page + layout fix |
| agent-03-mobile-nav | - | pending | Task 3: admin mobile navigation |
| agent-04-cancel-booking | - | pending | Task 4: student cancel booking UI |
| agent-05-start-class | - | pending | Task 5: start class / bulk attendance |
| agent-06-credits | - | pending | Task 6: subscription initial credits |
| agent-07-dayuse | - | pending | Task 7: day use text + unlimited capacity |
| agent-08-stale-data | - | pending | Task 8: revalidatePath after enrollment |
| agent-09-dependents | - | pending | Task 9: guardian adds dependents + plan for dependent |
| agent-10-plans | - | pending | Task 10: create/edit plans via admin UI |

## File Conflict Map (for orchestrator)

These files are touched by multiple agents — orchestrator must merge manually:

| File | Agents |
|------|--------|
| `features/aulas/class-form-actions.ts` | agent-01, agent-02 |
| `features/aulas/adminActions.ts` | agent-01, agent-08, agent-09 |
| `app/(admin)/admin/grade/page.tsx` | agent-01, agent-02 |
| `features/financeiro/actions.ts` | agent-06, agent-09 |
