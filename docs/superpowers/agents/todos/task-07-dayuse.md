# TODO: Agent 07 — Day Use Fixes

**Branch:** `fix/task-07-dayuse`
**Issues fixed:** #2 (day use mostra "sem créditos" — não é grátis), #9 (day use deve ser ilimitado)

## Tasks

### Fix #2: Remove "sem usar créditos" text

- [ ] Read `app/(dashboard)/agendar/page.tsx`
- [ ] Find the Day Use link card (line ~122-130)
- [ ] Change subtitle from `"Reservar quadra sem usar créditos →"` to `"Reserve uma quadra avulsa →"`
- [ ] Day Use will have a cost in the future, so don't imply it's free

### Fix #9: Remove capacity limit

- [ ] Read `features/dayuse/actions.ts`
- [ ] In `bookDayUse`: remove the block that fetches booking count and checks against capacity
- [ ] The slot existence check (`slot` fetch) can be simplified to just check `id` exists
- [ ] Keep duplicate booking check (error code 23505) — user shouldn't book same slot twice
- [ ] The `capacity` field in `DayUseSlot` can remain as informational (don't remove from DB type)

### Final

- [ ] Run `npm run build` — must pass
- [ ] Commit: `git commit -m "fix: day use com participantes ilimitados e texto sem implicar gratuidade"`

## Completion

When done, update `docs/superpowers/agents/STATUS.md` row for agent-07-dayuse.
