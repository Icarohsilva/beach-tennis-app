# TODO: Agent 03 — Admin Mobile Navigation

**Branch:** `fix/task-03-mobile-nav`
**Issues fixed:** #6 (no mobile menu in admin panel)

## Root Cause
Admin layout `aside` has `hidden md:flex` — on mobile there is ZERO navigation.
Users get stuck on sub-pages with no way back.

## Tasks

- [ ] Read full plan: `docs/superpowers/plans/2026-06-01-15-correcoes-e-melhorias.md` (Task 3)
- [ ] Read current `app/(admin)/layout.tsx`
- [ ] Create `components/ui/AdminMobileNav.tsx` — client component with hamburger menu
  - Fixed topbar (z-50) showing "Painel Admin" + ☰ icon
  - Dropdown with all admin nav links + Logout
  - Close on link click
- [ ] Modify `app/(admin)/layout.tsx`:
  - Import `AdminMobileNav`
  - Add `flex-col md:flex-row` to outer div
  - Render `<AdminMobileNav links={navLinks} />` (pass links as array)
  - Add `mt-14 md:mt-0` to `<main>` to avoid overlap with mobile topbar
- [ ] Test in browser at mobile viewport (check DevTools responsive mode)
- [ ] Run `npm run build` — must pass
- [ ] Commit: `git commit -m "feat: adicionar navegação mobile ao painel admin"`

## Completion

When done, update `docs/superpowers/agents/STATUS.md` row for agent-03-mobile-nav.
