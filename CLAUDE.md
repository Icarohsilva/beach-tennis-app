# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # start dev server on localhost:3000
npm run build        # production build
npm run lint         # ESLint via next lint
npm run test         # vitest watch mode
npm run test:run     # vitest single run (CI)

# run a single test file
npm run test:run -- lib/utils/creditRules.test.ts
```

## Architecture

**Stack:** Next.js 14 App Router · TypeScript · Tailwind CSS · Supabase · Vitest · Vercel

Academy/school management app for any activity with classes and students — beach tennis, padel, crossfit, pilates, football schools, etc. (in Portuguese). Core module: class scheduling and attendance. Secondary: payments/subscriptions, social community, tournaments.

### Route Groups

| Route Group | Protection | Purpose |
|---|---|---|
| `app/(auth)/` | Public | Login, cadastro, recuperar-senha |
| `app/(dashboard)/` | Authenticated (cookie) + server-side user check | Student-facing UI with `BottomNav` |
| `app/(admin)/` | Authenticated + role=admin check | Admin panel with sidebar |
| `app/experimental/` | Public | Trial class booking (no login needed) |

**Two-tier route protection:** [middleware.ts](middleware.ts) is Edge Runtime — it checks for a `sb-*-auth-token` cookie only (no Supabase import, no async). Real auth validation happens in each layout Server Component via `createClient()`. Admin role check uses `createAdminClient()` (service role key, bypasses RLS).

### Supabase Clients

- [lib/supabase/client.ts](lib/supabase/client.ts) — `createClient()` for Client Components (uses `createBrowserClient`)
- [lib/supabase/server.ts](lib/supabase/server.ts) — `createClient()` for Server Components/layouts; `createAdminClient()` for admin role checks and service-level writes (bypasses RLS)

Never import `@supabase/supabase-js` directly — always use the wrappers above.

### Business Logic Utilities

| File | Purpose |
|---|---|
| [lib/utils/creditRules.ts](lib/utils/creditRules.ts) | `canCancelWithRefund()`, `getMakeupCreditExpiry()` — 5h cancellation window |
| [lib/utils/dateHelpers.ts](lib/utils/dateHelpers.ts) | `getDatesForDayOfWeekInMonth()`, `formatDate()`, `formatTime()` (pt-BR locale via date-fns) |
| [lib/utils/cn.ts](lib/utils/cn.ts) | `cn(...classes)` — clsx + tailwind-merge |
| [lib/checkin/selfCheckin.ts](lib/checkin/selfCheckin.ts) | `resolveSelfCheckinStatus()`, `selfCheckinWindow()`, `haversineMeters()` — geofence e janela (1h antes do início → 1h depois do fim) da confirmação de presença pelo aluno |

These have Vitest unit tests co-located (`.test.ts` files).

### Data Model Key Points

All types are in [types/index.ts](types/index.ts). Key invariants:

- `profiles.credits_balance` is a **cached** value — source of truth is the `credit_transactions` table
- `classes` = recurring schedule templates; `class_sessions` = specific dated instances of a class
- `enrollments` = fixed weekly schedule; `session_bookings` = per-session bookings (extra, makeup)
- Students with `memberships.partner: 'wellhub' | 'totalpass'` get check-ins via webhook (not manual). O eixo parceiro saiu de `payment_type` na migração `20260715000000_membership_partner_axis.sql` — `payment_type` hoje só distingue `subscriber` de `per_class`
- Dependents (`is_dependent: true`) link to a `parent_id` who handles payment
- Presença tem três origens (`attendance.source`): `manual` (professor na chamada), `wellhub`/`totalpass` (webhook do parceiro) e `self` (aluno confirma pelo app). A confirmação do aluno é gravada em `self_checkins` com a evidência de GPS e só vira `attendance` quando `validated`; `pending` espera o professor aprovar. Ver [docs/superpowers/specs/2026-08-03-confirmacao-presenca-aluno-design.md](docs/superpowers/specs/2026-08-03-confirmacao-presenca-aluno-design.md)

Migrations live in `supabase/migrations/` and must be applied via `supabase db push`.

### Design System

Dark theme with orange brand. Key Tailwind tokens:

```
bg-surface        #0c1220  (page background)
bg-surface-card   #151e31  (cards/panels)
border-surface-border  #26334d
text-brand-500    #f97316  (primary orange)
Gradiente de marca: bg-gradient-to-br from-brand-600 to-brand-800 (headers/CTAs de destaque)
```

UI primitives live in [components/ui/](components/ui/): `Button`, `Card`, `Badge`, `Input`, `BottomNav`. Always use these rather than raw HTML elements for consistency.

### Planned but Not Yet Implemented

The `features/` directory (aulas, financeiro, torneios) and most dashboard pages are planned for Plan 2+. Most `app/(dashboard)/` pages currently show placeholder text. The spec is at [docs/superpowers/specs/2026-05-31-beach-tennis-app-design.md](docs/superpowers/specs/2026-05-31-beach-tennis-app-design.md). Comunidade (`features/comunidade/`) já está implementada (feed social), mas saiu do menu do aluno em favor de "Vídeo" — ver [docs/superpowers/specs/2026-07-31-video-cameras-iframe-design.md](docs/superpowers/specs/2026-07-31-video-cameras-iframe-design.md).
