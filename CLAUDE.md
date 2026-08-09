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

**Identidade/academia vem sempre dos helpers memoizados** de `lib/supabase/server.ts` (`getAuthUser`, `getMemberships`, `getActiveOrgId`, `getActiveMembership`, `getCurrentOrg`, `getStaffContext`). Eles são embrulhados em `requestCache` ([lib/utils/requestCache.ts](lib/utils/requestCache.ts)), então a cascata inteira custa 1 `auth.getUser()` + 1 select por request em vez de ~10. Nunca chame `supabase.auth.getUser()` direto numa página ou layout — some com o ganho. Em server action o valor congela no primeiro acesso do request: para reler algo que a própria action acabou de escrever, vá direto na tabela.

**Toda leitura de lista que cresce com o tamanho da academia passa por `fetchAllPages`** ([lib/supabase/paginate.ts](lib/supabase/paginate.ts)). O Supabase hospedado corta qualquer resposta em 1.000 linhas (`max_rows`), inclusive para a service role, e devolve `error: null` — a query "dá certo" com resultado errado. Use `chunk(ids, IN_CHUNK_SIZE)` para `.in(...)` com muitos ids (a lista vai na URL). Leitura com teto natural (uma sessão, um aluno, 20 notificações) pode usar `.select()` direto. Para contar, use `{ count: 'exact', head: true }` — nunca `select('id')` + `.length`, que trafega a tabela para contar no Node.

Crons varrem a base inteira: usam `fetchAllPages`, `mapWithConcurrency` ([lib/utils/concurrency.ts](lib/utils/concurrency.ts)) com orçamento de tempo, e respondem `truncated: true` quando não terminaram — o que sobrar fica para a próxima passada (todas as operações são idempotentes).

### Business Logic Utilities

| File | Purpose |
|---|---|
| [lib/utils/creditRules.ts](lib/utils/creditRules.ts) | `canCancelWithRefund()`, `getMakeupCreditExpiry()` — 5h cancellation window |
| [lib/utils/dateHelpers.ts](lib/utils/dateHelpers.ts) | `getDatesForDayOfWeekInMonth()`, `formatDate()`, `formatTime()` (pt-BR locale via date-fns) |
| [lib/utils/cn.ts](lib/utils/cn.ts) | `cn(...classes)` — clsx + tailwind-merge |
| [lib/checkin/selfCheckin.ts](lib/checkin/selfCheckin.ts) | `resolveSelfCheckinStatus()`, `selfCheckinWindow()`, `haversineMeters()` — geofence e janela (1h antes do início → 1h depois do fim) da confirmação de presença pelo aluno |
| [lib/liga/](lib/liga/) | `divisions.ts` (promoção/rebaixamento), `streak.ts` (semanas seguidas), `points.ts` (pesos), `sportForPoints.ts` (qual esporte a presença credita) e `medals.ts` (catálogo de medalhas) — regras puras da Liga |

These have Vitest unit tests co-located (`.test.ts` files).

### Data Model Key Points

All types are in [types/index.ts](types/index.ts). Key invariants:

- `memberships.credits_balance` is a **cached** value — source of truth is the `credit_transactions` table (a coluna saiu de `profiles` em `20260624000100_drop_profiles_per_org_columns.sql`: crédito é por-academia)
- Liga: `liga_points` é o extrato (verdade) e `liga_standings` é cache de posição, mesmo par ledger→cache do crédito. Escrita **só** pelas RPCs `liga_award_points` / `liga_revoke_points` (atômicas, `security definer`), nunca por update direto
- `classes` = recurring schedule templates; `class_sessions` = specific dated instances of a class
- `enrollments` = fixed weekly schedule; `session_bookings` = per-session bookings (extra, makeup)
- Students with `memberships.partner: 'wellhub' | 'totalpass'` get check-ins via webhook (not manual). O eixo parceiro saiu de `payment_type` na migração `20260715000000_membership_partner_axis.sql` — `payment_type` hoje só distingue `subscriber` de `per_class`
- Dependents (`is_dependent: true`) link to a `parent_id` who handles payment
- Presença tem três origens (`attendance.source`): `manual` (professor na chamada), `wellhub`/`totalpass` (webhook do parceiro) e `self` (aluno confirma pelo app). A confirmação do aluno é gravada em `self_checkins` com a evidência de GPS e só vira `attendance` quando `validated`; `pending` espera o professor aprovar. Ver [docs/superpowers/specs/2026-08-03-confirmacao-presenca-aluno-design.md](docs/superpowers/specs/2026-08-03-confirmacao-presenca-aluno-design.md)

- RLS: policy nenhuma chama `auth.uid()` cru nem `is_org_admin(coluna)` — as duas rodam **por linha**. A forma correta é `(select auth.uid())` e `organization_id in (select auth_admin_org_ids())`, que viram InitPlan (uma avaliação por statement). A migração `20260809000000_escala_rls_e_indices.sql` converteu as existentes e a verificação está no cabeçalho dela; policy nova já deve nascer assim. Medido em 300k linhas: 1.320ms → 44ms.

Migrations live in `supabase/migrations/` and must be applied via `supabase db push`.

### Capacidade e limites de plano

`/super-admin/capacidade` responde "quando preciso subir de plano?" com data, não palpite. O cron diário `capacity-snapshot` grava um retrato (linhas e bytes por tabela, orgs, alunos, MAU, tamanho do banco) em `capacity_snapshots`; a página projeta por mínimos quadrados quando cada teto é cruzado. Regras puras e testadas em [lib/plataforma/capacity.ts](lib/plataforma/capacity.ts).

O que o painel **não** mede está listado nele mesmo (`LIMITES_EXTERNOS`): CPU/RAM da instância e queries caras ficam no painel do Supabase, invocações e GB-hrs no da Vercel. Os tetos em `LIMITES` vêm dos planos publicados e envelhecem — confira o pricing antes de decidir por eles.

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

The `features/` directory (aulas, financeiro, torneios) and most dashboard pages are planned for Plan 2+. Most `app/(dashboard)/` pages currently show placeholder text. The spec is at [docs/superpowers/specs/2026-05-31-beach-tennis-app-design.md](docs/superpowers/specs/2026-05-31-beach-tennis-app-design.md). Comunidade (`features/comunidade/`) já está implementada (feed social), mas saiu do menu do aluno — ver [docs/superpowers/specs/2026-07-31-video-cameras-iframe-design.md](docs/superpowers/specs/2026-07-31-video-cameras-iframe-design.md).

A aba "Vídeo" virou **Liga** (`/liga`; `/video` redireciona), com o vídeo como bloco interno. As quatro fases de [docs/superpowers/specs/2026-08-02-liga-gamificacao-aluno-design.md](docs/superpowers/specs/2026-08-02-liga-gamificacao-aluno-design.md) estão implementadas: motor de pontos e divisões, medalhas, elogios + comunidade e mural de fotos. A Liga nasce desligada por academia (`system_settings.liga_enabled`).

- Medalha (`liga_medals`) **não dá ponto** e o catálogo vive em código (`lib/liga/medals.ts`), não em tabela: acrescentar medalha é deploy, e a passada diária do cron `liga-streak` concede retroativamente a quem já cumpre o critério.
- Elogio (`liga_kudos`) é a única parte fraudável do sistema. As travas moram no **banco** (`unique (org, from, to, iso_week)`) e em `lib/liga/kudos.ts`; receber vale mais que dar de propósito. Elogio barrado pela trava é gravado assim mesmo, só sem ponto.
- O feed (`features/comunidade/`) voltou ao menu como **seção da Liga**; `/comunidade` redireciona. `posts.is_pinned` é o mural de comunicados do admin.
- Fotos de torneio (`tournament_photos`) vão para um bucket **privado**, servidas por URL assinada — ao contrário de `tournament-images` (capa, pública). Upload só por server action de admin.
- Três crons: `liga-streak` (diário), `liga-season-close` (dia 1º) e `liga-season-alert` (diário, dispara só a 2 dias do fim da temporada).
- Fontes extras de ponto (`features/liga/extraPoints.ts`) premiam comportamento que ajuda a academia: self check-in, cancelar dentro da janela, pegar vaga da fila, agendar com antecedência, cadastro completo (uma vez na vida) e day use. Todas best-effort — a Liga falhando nunca derruba a operação de origem.
- Premiação: `liga_prizes` é o que a academia **promete** (editável enquanto a temporada roda) e `liga_prize_awards` é o que ela **deve**, congelado no fechamento. Sem essa separação, reescrever o prêmio em janeiro mudaria retroativamente o que alguém ganhou em dezembro.
