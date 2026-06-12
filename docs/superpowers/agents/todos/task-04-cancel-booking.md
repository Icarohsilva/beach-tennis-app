# TODO: Agent 04 — Student Cancel Booking

**Branch:** `fix/task-04-cancel-booking`
**Issues fixed:** #5 (aluno não consegue remover nome de uma aula)

## Root Cause
`cancelBooking(bookingId)` exists in `features/aulas/actions.ts` but
`features/aulas/SessionList.tsx` is read-only with no cancel button.

## Tasks

- [ ] Read full plan: `docs/superpowers/plans/2026-06-01-15-correcoes-e-melhorias.md` (Task 4)
- [ ] Read current `features/aulas/SessionList.tsx`
- [ ] Read current `features/aulas/actions.ts` (to understand `cancelBooking` signature)
- [ ] Convert `SessionList.tsx` to `'use client'` component
- [ ] Add `showCancelButton?: boolean` prop (default false)
- [ ] Add optimistic state: when cancel clicked, immediately show "Cancelado"
- [ ] Wire cancel button to call `cancelBooking(booking.id)` from `./actions`
- [ ] Show error inline if cancel fails
- [ ] Modify `app/(dashboard)/aulas/page.tsx`: pass `showCancelButton={true}` to SessionList
- [ ] Run `npm run build` — must pass
- [ ] Commit: `git commit -m "feat: permitir aluno cancelar reserva diretamente na lista de sessões"`

## Completion

When done, update `docs/superpowers/agents/STATUS.md` row for agent-04-cancel-booking.
