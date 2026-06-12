# TODO: Agent 00 — DB Migrations

**Branch:** `fix/db-migrations`
**Issues fixed:** Prerequisite for Task 1 (session generation upsert)

## Tasks

- [ ] Create migration file `supabase/migrations/20260601000000_class_sessions_unique.sql`
- [ ] Write SQL: `ALTER TABLE class_sessions ADD CONSTRAINT class_sessions_class_id_session_date_key UNIQUE (class_id, session_date);`
- [ ] Verify no duplicate (class_id, session_date) pairs exist before applying
- [ ] Apply migration via `npx supabase db push` or write instructions if credentials missing
- [ ] Update this file status
- [ ] Commit: `git commit -m "feat: add UNIQUE constraint on class_sessions(class_id, session_date)"`

## Completion

When done, update `docs/superpowers/agents/STATUS.md`:
- Set agent-00-db status to `done`
- Set Branch to your branch name
