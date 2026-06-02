# Agent Status Board

All agents write their final status here when complete.
Orchestrator reads this to know when to proceed with merging.

| Agent | Branch | Status | Notes |
|-------|--------|--------|-------|
| agent-00-db | worktree-agent-ab279bd2cde9686d1 | done | DB migration: UNIQUE constraint on class_sessions |
| agent-01-sessions | worktree-agent-a05a335ad1cd2204d | done | Task 1: auto-generate class_sessions |
| agent-02-edit-class | worktree-agent-adfc48bce6d9ed03f | done | Task 2: edit class page + layout fix |
| agent-03-mobile-nav | worktree-agent-af155e68054cbd1c5 | done | Task 3: admin mobile navigation |
| agent-04-cancel-booking | worktree-agent-a3fda574e84110064 | done | Task 4: student cancel booking UI |
| agent-05-start-class | worktree-agent-a4b069f2bb3955e9a | done | Task 5: start class / bulk attendance |
| agent-06-credits | worktree-agent-a554efa262114eadb | done | Task 6: subscription initial credits |
| agent-07-dayuse | worktree-agent-af88b05f60a104b4c | done | Task 7: day use text + unlimited capacity |
| agent-08-stale-data | worktree-agent-a8f324c3d1bf3b00c | done | Task 8: revalidatePath after enrollment |
| agent-09-dependents | worktree-agent-a0f22289f7406e93d | done | Task 9: guardian adds dependents + plan for dependent |
| agent-10-plans | worktree-agent-a7de1cb2b99710b9d | done | Task 10: create/edit plans via admin UI |

## File Conflict Map (for orchestrator)

These files are touched by multiple agents — orchestrator must merge manually:

| File | Agents |
|------|--------|
| `features/aulas/class-form-actions.ts` | agent-01, agent-02 |
| `features/aulas/adminActions.ts` | agent-01, agent-08, agent-09 |
| `app/(admin)/admin/grade/page.tsx` | agent-01, agent-02 |
| `features/financeiro/actions.ts` | agent-06, agent-09 |
