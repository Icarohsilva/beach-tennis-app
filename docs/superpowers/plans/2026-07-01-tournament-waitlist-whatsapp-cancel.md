# Tournament Waitlist, WhatsApp & Cancel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add max-player limits with auto-promotion waitlist, WhatsApp payment links for admin, and a cancel-for-non-payment admin action to the tournament module.

**Architecture:** `entry_status` column (`confirmed | waitlist | offered`) on `tournament_entries` + lazy expiry via `expireAndPromote` helper called on every entry removal. Pure functions in `lib/torneios/waitlist.ts` for testability; two new Server Actions; UI changes in admin detail page, public tournament page, and CreateTournamentForm.

**Tech Stack:** Next.js 14 App Router · TypeScript · Supabase (Postgres) · Vitest · Tailwind CSS

---

## File Map

| File | Action |
|---|---|
| `supabase/migrations/20260701000100_tournament_waitlist.sql` | Create |
| `lib/torneios/waitlist.ts` | Create |
| `lib/torneios/waitlist.test.ts` | Create |
| `types/index.ts` | Modify |
| `features/torneios/actions.ts` | Modify (4 passes) |
| `app/(admin)/admin/torneios/[id]/CancelForNonPaymentButton.tsx` | Create |
| `app/(admin)/admin/torneios/[id]/page.tsx` | Modify |
| `app/(public)/t/[id]/ConfirmWaitlistButton.tsx` | Create |
| `app/(public)/t/[id]/page.tsx` | Modify |
| `app/(admin)/admin/torneios/CreateTournamentForm.tsx` | Modify |

---

## Task 1: SQL Migration

**Files:**
- Create: `supabase/migrations/20260701000100_tournament_waitlist.sql`

> ⚠️ **This migration is applied manually by the user** in Supabase SQL Editor. Do NOT run `supabase db push`. Just write the file.

- [ ] **Step 1: Create migration file**

```sql
-- supabase/migrations/20260701000100_tournament_waitlist.sql
-- Adiciona limite de vagas ao torneio
ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS max_players integer;
-- null = sem limite de vagas

-- Adiciona status de entrada e prazo da oferta
ALTER TABLE tournament_entries
  ADD COLUMN IF NOT EXISTS entry_status text NOT NULL DEFAULT 'confirmed'
    CHECK (entry_status IN ('confirmed', 'waitlist', 'offered')),
  ADD COLUMN IF NOT EXISTS offer_expires_at timestamptz;
-- offer_expires_at só preenchido quando entry_status = 'offered'
-- Entradas existentes recebem entry_status = 'confirmed' pelo DEFAULT (sem backfill necessário)
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260701000100_tournament_waitlist.sql
git commit -m "feat: migration tournament waitlist columns (apply manually)"
```

Expected: commit succeeds. **Remind the user to apply in Supabase SQL Editor before running the app.**

---

## Task 2: Pure Functions TDD

**Files:**
- Create: `lib/torneios/waitlist.ts`
- Create: `lib/torneios/waitlist.test.ts`

- [ ] **Step 1: Write the failing tests first**

Create `lib/torneios/waitlist.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { availableSlots, isOfferExpired, buildWhatsAppUrl } from './waitlist'

describe('availableSlots', () => {
  it('retorna Infinity quando maxPlayers é null (sem limite)', () => {
    expect(availableSlots(10, null)).toBe(Infinity)
  })
  it('retorna 0 quando torneio está cheio', () => {
    expect(availableSlots(16, 16)).toBe(0)
  })
  it('não retorna negativo quando excede o limite', () => {
    expect(availableSlots(17, 16)).toBe(0)
  })
  it('retorna número de vagas restantes', () => {
    expect(availableSlots(12, 16)).toBe(4)
  })
  it('retorna maxPlayers quando não há inscritos', () => {
    expect(availableSlots(0, 8)).toBe(8)
  })
})

describe('isOfferExpired', () => {
  it('retorna false quando offerExpiresAt é null', () => {
    expect(isOfferExpired(null)).toBe(false)
  })
  it('retorna false quando a oferta é no futuro', () => {
    const future = new Date(Date.now() + 60_000).toISOString()
    expect(isOfferExpired(future)).toBe(false)
  })
  it('retorna true quando a oferta está no passado', () => {
    const past = new Date(Date.now() - 60_000).toISOString()
    expect(isOfferExpired(past)).toBe(true)
  })
})

describe('buildWhatsAppUrl', () => {
  it('adiciona DDI 55 quando ausente', () => {
    const url = buildWhatsAppUrl('11987654321', 'Olá')
    expect(url).toContain('wa.me/5511987654321')
  })
  it('não duplica DDI 55 quando já presente', () => {
    const url = buildWhatsAppUrl('5511987654321', 'Olá')
    expect(url).toContain('wa.me/5511987654321')
    expect(url).not.toContain('555511987654321')
  })
  it('remove formatação (parênteses, hífens, espaços)', () => {
    const url = buildWhatsAppUrl('(11) 98765-4321', 'Mensagem')
    expect(url).toContain('wa.me/5511987654321')
  })
  it('codifica a mensagem corretamente no query string', () => {
    const url = buildWhatsAppUrl('11987654321', 'Olá mundo!')
    expect(url).toContain(encodeURIComponent('Olá mundo!'))
  })
})
```

- [ ] **Step 2: Run tests to verify they fail (module not found)**

```bash
npm run test:run -- lib/torneios/waitlist.test.ts
```

Expected: FAIL — `Cannot find module './waitlist'`

- [ ] **Step 3: Implement the pure functions**

Create `lib/torneios/waitlist.ts`:

```ts
// lib/torneios/waitlist.ts

/**
 * Quantas vagas ainda disponíveis.
 * confirmedCount = COUNT(entry_status IN ('confirmed', 'offered'))
 * Retorna Infinity quando maxPlayers é null (sem limite).
 */
export function availableSlots(
  confirmedCount: number,
  maxPlayers: number | null,
): number {
  if (maxPlayers === null) return Infinity
  return Math.max(0, maxPlayers - confirmedCount)
}

/**
 * Retorna true se a oferta de vaga já venceu.
 */
export function isOfferExpired(offerExpiresAt: string | null): boolean {
  if (!offerExpiresAt) return false
  return new Date(offerExpiresAt) < new Date()
}

/**
 * Monta URL do WhatsApp com mensagem pré-preenchida.
 * Remove caracteres não numéricos e adiciona DDI 55 se ausente.
 */
export function buildWhatsAppUrl(phone: string, message: string): string {
  const digits = phone.replace(/\D/g, '')
  const intl = digits.startsWith('55') ? digits : `55${digits}`
  return `https://wa.me/${intl}?text=${encodeURIComponent(message)}`
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run test:run -- lib/torneios/waitlist.test.ts
```

Expected: all 9 tests PASS

- [ ] **Step 5: Commit**

```bash
git add lib/torneios/waitlist.ts lib/torneios/waitlist.test.ts
git commit -m "feat: pure functions waitlist.ts (availableSlots, isOfferExpired, buildWhatsAppUrl)"
```

---

## Task 3: TypeScript Types

**Files:**
- Modify: `types/index.ts`

- [ ] **Step 1: Add `max_players` to `Tournament` interface**

In `types/index.ts`, find the `Tournament` interface (around line 281). After `pix_key: string | null`, add:

```ts
  max_players: number | null
```

The end of the `Tournament` interface should look like:

```ts
  entry_price_cents: number | null
  pix_key: string | null
  max_players: number | null
}
```

- [ ] **Step 2: Add `entry_status` and `offer_expires_at` to `TournamentEntry` interface**

In `types/index.ts`, find the `TournamentEntry` interface (around line 308). After `receipt_url: string | null`, add:

```ts
  entry_status: 'confirmed' | 'waitlist' | 'offered'
  offer_expires_at: string | null
```

The end of `TournamentEntry` should look like:

```ts
  payment_status: 'free' | 'pending' | 'paid'
  discount_pct: number
  final_price_cents: number
  receipt_url: string | null
  entry_status: 'confirmed' | 'waitlist' | 'offered'
  offer_expires_at: string | null
}
```

- [ ] **Step 3: Run build check to confirm no type errors**

```bash
npm run build 2>&1 | head -30
```

Expected: no new errors from types/index.ts

- [ ] **Step 4: Commit**

```bash
git add types/index.ts
git commit -m "feat: add max_players to Tournament, entry_status/offer_expires_at to TournamentEntry"
```

---

## Task 4: Actions — `expireAndPromote` + modify `registerForTournament`, `registerExternal`, `createTournament`

**Files:**
- Modify: `features/torneios/actions.ts`

### 4a: Add import for `availableSlots`

- [ ] **Step 1: Add import at top of actions.ts**

After the existing imports in `features/torneios/actions.ts`, add:

```ts
import { availableSlots } from '@/lib/torneios/waitlist'
```

Exact location — after line:
```ts
import { computeEntryDiscount, applyDiscount } from '@/lib/torneios/entryDiscount'
```

Add:
```ts
import { availableSlots } from '@/lib/torneios/waitlist'
```

### 4b: Add `expireAndPromote` internal helper

- [ ] **Step 2: Add `expireAndPromote` after the existing helper functions (after `computePaymentFields`, before `createTournament`)**

Insert this block after `computePaymentFields` ends (around line 79), before the `// --- createTournament` comment:

```ts
// ---------------------------------------------------------------------------
// expireAndPromote — helper interno
// Chama toda action que remove uma entry. Expira ofertas vencidas e promove
// a lista de espera para o número de vagas disponíveis.
// ---------------------------------------------------------------------------

async function expireAndPromote(
  adminClient: ReturnType<typeof createAdminClient>,
  tournamentId: string,
  maxPlayers: number | null,
): Promise<void> {
  if (!maxPlayers) return // sem limite, nada a fazer

  // 1. Expirar entradas 'offered' com prazo vencido → volta para 'waitlist'
  await adminClient
    .from('tournament_entries')
    .update({ entry_status: 'waitlist', offer_expires_at: null })
    .eq('tournament_id', tournamentId)
    .eq('entry_status', 'offered')
    .lt('offer_expires_at', new Date().toISOString())

  // 2. Contar vagas ocupadas (confirmed + offered restantes)
  const { count: occupiedCount } = await adminClient
    .from('tournament_entries')
    .select('id', { count: 'exact', head: true })
    .eq('tournament_id', tournamentId)
    .in('entry_status', ['confirmed', 'offered'])

  const available = maxPlayers - (occupiedCount ?? 0)
  if (available <= 0) return

  // 3. Promover os N mais antigos da fila para 'offered'
  const offerExpiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
  const { data: toPromote } = await adminClient
    .from('tournament_entries')
    .select('id')
    .eq('tournament_id', tournamentId)
    .eq('entry_status', 'waitlist')
    .order('created_at', { ascending: true })
    .limit(available)

  if (!toPromote?.length) return

  await adminClient
    .from('tournament_entries')
    .update({ entry_status: 'offered', offer_expires_at: offerExpiresAt })
    .in('id', toPromote.map((e) => e.id))
}
```

### 4c: Modify `registerForTournament`

- [ ] **Step 3: Update tournament select to include `max_players`**

In `registerForTournament`, change the tournament select from:
```ts
.select('id, status, level, category, participant_type, entry_price_cents, pix_key')
```
to:
```ts
.select('id, status, level, category, participant_type, entry_price_cents, pix_key, max_players')
```

- [ ] **Step 4: Add capacity check before INSERT in `registerForTournament`**

After the duplicate-check block (after `if ((dupCount ?? 0) > 0) ...`), and before the `dupla_fixa` partner logic, add:

```ts
  // Verificar capacidade
  const { count: occupiedCount } = await adminClient
    .from('tournament_entries')
    .select('id', { count: 'exact', head: true })
    .eq('tournament_id', tournamentId)
    .in('entry_status', ['confirmed', 'offered'])

  const slots = availableSlots(occupiedCount ?? 0, (tournament.max_players as number | null))
  const entryStatus = slots > 0 ? 'confirmed' : 'waitlist'
```

- [ ] **Step 5: Modify the INSERT in `registerForTournament` to handle waitlist**

Replace the current insert block:
```ts
  const paymentFields = await computePaymentFields(
    adminClient,
    user.id,
    orgId,
    (tournament.entry_price_cents as number | null),
    (tournament.pix_key as string | null),
  )

  const { error: insertErr } = await adminClient
    .from('tournament_entries')
    .insert({
      organization_id: orgId,
      tournament_id: tournamentId,
      player_id: user.id,
      partner_id: partner,
      payment_status: paymentFields.payment_status,
      discount_pct: paymentFields.discount_pct,
      final_price_cents: paymentFields.final_price_cents,
    })
  if (insertErr) return { error: 'Erro ao realizar inscrição. Tente novamente.' }
  return {}
```

With:
```ts
  let insertPayload: {
    organization_id: string
    tournament_id: string
    player_id: string
    partner_id: string | null
    entry_status: 'confirmed' | 'waitlist'
    payment_status: 'free' | 'pending'
    discount_pct: number
    final_price_cents: number
  }

  if (entryStatus === 'waitlist') {
    // Jogador vai para a fila de espera — sem cobrança por enquanto
    insertPayload = {
      organization_id: orgId,
      tournament_id: tournamentId,
      player_id: user.id,
      partner_id: partner,
      entry_status: 'waitlist',
      payment_status: 'free',
      discount_pct: 0,
      final_price_cents: 0,
    }
  } else {
    const paymentFields = await computePaymentFields(
      adminClient,
      user.id,
      orgId,
      (tournament.entry_price_cents as number | null),
      (tournament.pix_key as string | null),
    )
    insertPayload = {
      organization_id: orgId,
      tournament_id: tournamentId,
      player_id: user.id,
      partner_id: partner,
      entry_status: 'confirmed',
      payment_status: paymentFields.payment_status,
      discount_pct: paymentFields.discount_pct,
      final_price_cents: paymentFields.final_price_cents,
    }
  }

  const { error: insertErr } = await adminClient
    .from('tournament_entries')
    .insert(insertPayload)
  if (insertErr) return { error: 'Erro ao realizar inscrição. Tente novamente.' }
  return {}
```

### 4d: Modify `registerExternal`

- [ ] **Step 6: Update tournament select and add capacity check in `registerExternal`**

In `registerExternal`, change:
```ts
  const { data: tournament } = await adminClient
    .from('tournaments')
    .select('id, organization_id, status, entry_price_cents, pix_key')
```
to:
```ts
  const { data: tournament } = await adminClient
    .from('tournaments')
    .select('id, organization_id, status, entry_price_cents, pix_key, max_players')
```

After the duplicate check (`if ((dup ?? 0) > 0)`), add capacity check and modify INSERT similarly to `registerForTournament`:

```ts
  // Verificar capacidade
  const { count: occupiedCount } = await adminClient
    .from('tournament_entries')
    .select('id', { count: 'exact', head: true })
    .eq('tournament_id', tournamentId)
    .in('entry_status', ['confirmed', 'offered'])

  const slots = availableSlots(occupiedCount ?? 0, (tournament.max_players as number | null))
  const entryStatus = slots > 0 ? 'confirmed' : 'waitlist'

  let insertPayload: {
    organization_id: string
    tournament_id: string
    player_id: string
    partner_id: null
    entry_status: 'confirmed' | 'waitlist'
    payment_status: 'free' | 'pending'
    discount_pct: number
    final_price_cents: number
  }

  if (entryStatus === 'waitlist') {
    insertPayload = {
      organization_id: tournament.organization_id as string,
      tournament_id: tournamentId,
      player_id: user.id,
      partner_id: null,
      entry_status: 'waitlist',
      payment_status: 'free',
      discount_pct: 0,
      final_price_cents: 0,
    }
  } else {
    const paymentFields = await computePaymentFields(
      adminClient,
      user.id,
      tournament.organization_id as string,
      (tournament.entry_price_cents as number | null),
      (tournament.pix_key as string | null),
    )
    insertPayload = {
      organization_id: tournament.organization_id as string,
      tournament_id: tournamentId,
      player_id: user.id,
      partner_id: null,
      entry_status: 'confirmed',
      payment_status: paymentFields.payment_status,
      discount_pct: paymentFields.discount_pct,
      final_price_cents: paymentFields.final_price_cents,
    }
  }
```

Replace the existing `insert` block (the old `computePaymentFields` + `insert`) with:

```ts
  const { error: insertErr } = await adminClient
    .from('tournament_entries')
    .insert(insertPayload)
  if (insertErr) return { error: 'Erro ao realizar inscrição. Tente novamente.' }

  revalidatePath(`/t/${tournamentId}`)
  revalidatePath(`/admin/torneios/${tournamentId}`)
  return {}
```

### 4e: Modify `createTournament`

- [ ] **Step 7: Add `max_players` parameter to `createTournament`**

Change the input type signature:
```ts
export async function createTournament(input: {
  name: string
  date: string
  sport: string
  category: TournamentCategory
  participant_type: ParticipantType
  format: TournamentFormat
  level: StudentLevel
  scoring: ScoringConfig
  cover_image_url?: string | null
  entry_price_cents?: number | null
  pix_key?: string | null
  max_players?: number | null  // ← add this
}): Promise<{ error?: string; id?: string }>
```

In the `insert` call inside `createTournament`, after `pix_key: input.pix_key ?? null,` add:

```ts
      max_players: input.max_players ?? null,
```

### 4f: Fix `generateBracket` to only include confirmed entries

- [ ] **Step 8: Filter `generateBracket` entries to `confirmed` only**

In `generateBracket`, find:
```ts
  const { data: entriesRaw } = await adminClient
    .from('tournament_entries')
    .select('player_id')
    .eq('tournament_id', tournamentId)
    .eq('organization_id', orgId)
```

Add `.eq('entry_status', 'confirmed')`:
```ts
  const { data: entriesRaw } = await adminClient
    .from('tournament_entries')
    .select('player_id')
    .eq('tournament_id', tournamentId)
    .eq('organization_id', orgId)
    .eq('entry_status', 'confirmed')
```

- [ ] **Step 9: Run build check**

```bash
npm run build 2>&1 | head -40
```

Expected: no new TypeScript errors

- [ ] **Step 10: Commit**

```bash
git add features/torneios/actions.ts
git commit -m "feat: expireAndPromote helper + capacity check in registerForTournament/registerExternal + max_players in createTournament"
```

---

## Task 5: Actions — `removeEntry` mod + new `cancelEntryForNonPayment`

**Files:**
- Modify: `features/torneios/actions.ts`

### 5a: Modify `removeEntry`

- [ ] **Step 1: Update tournament select in `removeEntry` to include `max_players`**

In `removeEntry`, change:
```ts
  const { data: tournament } = await adminClient
    .from('tournaments')
    .select('status')
    .eq('id', tournamentId)
    .eq('organization_id', orgId)
    .single()
```
to:
```ts
  const { data: tournament } = await adminClient
    .from('tournaments')
    .select('status, max_players')
    .eq('id', tournamentId)
    .eq('organization_id', orgId)
    .single()
```

- [ ] **Step 2: Add `expireAndPromote` call at the end of `removeEntry`**

At the very end of `removeEntry`, replace:
```ts
  return {}
}
```
with:
```ts
  // Promover lista de espera se houver limite de vagas
  await expireAndPromote(adminClient, tournamentId, (tournament.max_players as number | null))

  revalidatePath(`/admin/torneios/${tournamentId}`)
  revalidatePath(`/t/${tournamentId}`)
  return {}
}
```

### 5b: Add `cancelEntryForNonPayment`

- [ ] **Step 3: Add new `cancelEntryForNonPayment` action after `removeEntry`**

After `removeEntry` ends and before the `// --- updateTournamentStatus` comment, add:

```ts
// ---------------------------------------------------------------------------
// cancelEntryForNonPayment — admin cancela inscrição por falta de pagamento
// ---------------------------------------------------------------------------

export async function cancelEntryForNonPayment(
  entryId: string,
): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const adminClient = createAdminClient()
  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  // Verificar role admin
  const { data: membership } = await adminClient
    .from('memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .single()
  if (membership?.role !== 'admin') return { error: 'Sem permissão.' }

  // Buscar entry
  const { data: entry } = await adminClient
    .from('tournament_entries')
    .select('id, tournament_id, player_id, payment_status, final_price_cents, created_at')
    .eq('id', entryId)
    .eq('organization_id', orgId)
    .single()
  if (!entry) return { error: 'Inscrição não encontrada.' }

  // Só faz sentido cancelar pagamento pendente
  if (entry.payment_status !== 'pending') {
    return { error: 'Só é possível cancelar inscrições com pagamento pendente.' }
  }

  const tournamentId = entry.tournament_id as string
  const target = entry.player_id as string

  // Reversal de desconto: recalcula entradas PENDING do mesmo jogador na mesma semana
  if ((entry.final_price_cents as number) > 0) {
    const { data: orgRow } = await adminClient
      .from('organizations')
      .select('tournament_discount_2_pct, tournament_discount_3_pct')
      .eq('id', orgId)
      .single()
    const discount2 = (orgRow?.tournament_discount_2_pct as number | null) ?? 30
    const discount3 = (orgRow?.tournament_discount_3_pct as number | null) ?? 50

    const { start, end } = getWeekBounds(new Date(entry.created_at as string))

    type PendingRow = {
      id: string
      tournament: { entry_price_cents: number } | { entry_price_cents: number }[] | null
    }
    const { data: pendingRaw } = await adminClient
      .from('tournament_entries')
      .select('id, tournament:tournaments!inner(entry_price_cents)')
      .eq('player_id', target)
      .eq('organization_id', orgId)
      .eq('payment_status', 'pending')
      .gt('final_price_cents', 0)
      .neq('id', entryId) // excluir a própria entry que será deletada
      .gte('created_at', start.toISOString())
      .lte('created_at', end.toISOString())
      .order('created_at', { ascending: true })

    const pending = (pendingRaw ?? []) as unknown as PendingRow[]

    for (let i = 0; i < pending.length; i++) {
      const tData = pending[i].tournament
      const tRow = Array.isArray(tData) ? (tData[0] ?? null) : tData
      if (!tRow) continue
      const priceCents = tRow.entry_price_cents as number
      const newDiscountPct = computeEntryDiscount(i, discount2, discount3)
      const newFinalPrice = applyDiscount(priceCents, newDiscountPct)
      await adminClient
        .from('tournament_entries')
        .update({ discount_pct: newDiscountPct, final_price_cents: newFinalPrice })
        .eq('id', pending[i].id)
    }
  }

  // Deletar entry
  const { error: delErr } = await adminClient
    .from('tournament_entries')
    .delete()
    .eq('id', entryId)
    .eq('organization_id', orgId)
  if (delErr) return { error: 'Erro ao cancelar inscrição. Tente novamente.' }

  // Buscar max_players e promover lista de espera
  const { data: tournament } = await adminClient
    .from('tournaments')
    .select('max_players')
    .eq('id', tournamentId)
    .single()

  await expireAndPromote(adminClient, tournamentId, (tournament?.max_players as number | null) ?? null)

  revalidatePath(`/admin/torneios/${tournamentId}`)
  return {}
}
```

- [ ] **Step 4: Run build check**

```bash
npm run build 2>&1 | head -40
```

Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add features/torneios/actions.ts
git commit -m "feat: removeEntry calls expireAndPromote + new cancelEntryForNonPayment action"
```

---

## Task 6: Action — `confirmWaitlistOffer`

**Files:**
- Modify: `features/torneios/actions.ts`

- [ ] **Step 1: Add import for `isOfferExpired`**

Update the waitlist import at the top of `actions.ts`:
```ts
import { availableSlots, isOfferExpired } from '@/lib/torneios/waitlist'
```

- [ ] **Step 2: Add `confirmWaitlistOffer` action**

After `cancelEntryForNonPayment` (and before `updateTournamentStatus`), add:

```ts
// ---------------------------------------------------------------------------
// confirmWaitlistOffer — jogador aceita a oferta de vaga aberta para ele
// ---------------------------------------------------------------------------

export async function confirmWaitlistOffer(
  tournamentId: string,
): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const adminClient = createAdminClient()

  // Buscar entry do usuário com entry_status = 'offered' nesse torneio
  const { data: entry } = await adminClient
    .from('tournament_entries')
    .select('id, offer_expires_at, payment_status, created_at')
    .eq('tournament_id', tournamentId)
    .eq('player_id', user.id)
    .eq('entry_status', 'offered')
    .maybeSingle()

  if (!entry) return { error: 'Você não tem uma oferta de vaga ativa.' }

  // Verificar expiração
  if (isOfferExpired(entry.offer_expires_at as string | null)) {
    const { data: t } = await adminClient
      .from('tournaments')
      .select('max_players')
      .eq('id', tournamentId)
      .single()
    await expireAndPromote(adminClient, tournamentId, (t?.max_players as number | null) ?? null)
    return { error: 'Sua oferta de vaga expirou. Você voltou para a lista de espera.' }
  }

  // Buscar dados do torneio para determinar payment_status
  const { data: tournament } = await adminClient
    .from('tournaments')
    .select('entry_price_cents, pix_key, organization_id')
    .eq('id', tournamentId)
    .single()
  if (!tournament) return { error: 'Torneio não encontrado.' }

  const isPaid =
    (tournament.entry_price_cents as number | null ?? 0) > 0 &&
    !!(tournament.pix_key)

  let paymentStatus: 'free' | 'pending' = 'free'
  let finalPriceCents = 0
  let discountPct = 0

  if (isPaid) {
    const paymentFields = await computePaymentFields(
      adminClient,
      user.id,
      tournament.organization_id as string,
      tournament.entry_price_cents as number | null,
      tournament.pix_key as string | null,
    )
    paymentStatus = paymentFields.payment_status
    finalPriceCents = paymentFields.final_price_cents
    discountPct = paymentFields.discount_pct
  }

  const { error: updateErr } = await adminClient
    .from('tournament_entries')
    .update({
      entry_status: 'confirmed',
      offer_expires_at: null,
      payment_status: paymentStatus,
      final_price_cents: finalPriceCents,
      discount_pct: discountPct,
    })
    .eq('id', entry.id)

  if (updateErr) return { error: 'Erro ao confirmar inscrição. Tente novamente.' }

  revalidatePath(`/t/${tournamentId}`)
  revalidatePath(`/admin/torneios/${tournamentId}`)
  return {}
}
```

- [ ] **Step 3: Run build check**

```bash
npm run build 2>&1 | head -40
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add features/torneios/actions.ts
git commit -m "feat: new confirmWaitlistOffer action"
```

---

## Task 7: `CancelForNonPaymentButton` Client Component

**Files:**
- Create: `app/(admin)/admin/torneios/[id]/CancelForNonPaymentButton.tsx`

- [ ] **Step 1: Create the component**

```tsx
'use client'
// app/(admin)/admin/torneios/[id]/CancelForNonPaymentButton.tsx
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { cancelEntryForNonPayment } from '@/features/torneios/actions'

interface Props {
  entryId: string
}

export function CancelForNonPaymentButton({ entryId }: Props) {
  const [confirming, setConfirming] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  function handleConfirm() {
    setError(null)
    startTransition(async () => {
      const result = await cancelEntryForNonPayment(entryId)
      if (result.error) {
        setError(result.error)
        setConfirming(false)
      } else {
        router.refresh()
      }
    })
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-2 mt-2">
        <span className="text-xs text-red-400">Tem certeza?</span>
        <button
          onClick={handleConfirm}
          disabled={isPending}
          className="text-xs bg-red-700 hover:bg-red-600 text-white rounded px-2 py-1 disabled:opacity-60 transition-colors"
        >
          {isPending ? 'Cancelando...' : 'Sim'}
        </button>
        <button
          onClick={() => setConfirming(false)}
          disabled={isPending}
          className="text-xs text-slate-400 hover:text-white rounded px-2 py-1 transition-colors"
        >
          Não
        </button>
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>
    )
  }

  return (
    <div className="mt-2">
      <button
        onClick={() => setConfirming(true)}
        className="text-xs bg-red-700 hover:bg-red-600 text-white rounded px-2 py-1 transition-colors"
      >
        Cancelar por falta de pagamento
      </button>
      {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
    </div>
  )
}
```

- [ ] **Step 2: Run build check**

```bash
npm run build 2>&1 | head -20
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add "app/(admin)/admin/torneios/[id]/CancelForNonPaymentButton.tsx"
git commit -m "feat: CancelForNonPaymentButton admin component"
```

---

## Task 8: Admin Detail Page — Three Sections + WhatsApp + Capacity

**Files:**
- Modify: `app/(admin)/admin/torneios/[id]/page.tsx`

This task rewrites the Inscrições section. Read the current page carefully before editing.

### 8a: Add imports

- [ ] **Step 1: Add new imports at top of admin detail page**

After the existing import for `ConfirmPaymentButton`, add:
```ts
import { CancelForNonPaymentButton } from './CancelForNonPaymentButton'
import { buildWhatsAppUrl } from '@/lib/torneios/waitlist'
```

### 8b: Update entries query

- [ ] **Step 2: Update the `tournament_entries` select to include new fields**

Replace:
```ts
  const { data: entriesRaw } = await adminClient
    .from('tournament_entries')
    .select(`id, player_id, partner_id, seed, created_at,
      payment_status, discount_pct, final_price_cents, receipt_url,
      player:profiles!tournament_entries_player_id_fkey(id, full_name, gender),
      partner:profiles!tournament_entries_partner_id_fkey(id, full_name)`)
    .eq('tournament_id', params.id)
    .order('created_at', { ascending: true })
```

With:
```ts
  const { data: entriesRaw } = await adminClient
    .from('tournament_entries')
    .select(`id, player_id, partner_id, seed, created_at,
      payment_status, discount_pct, final_price_cents, receipt_url,
      entry_status, offer_expires_at,
      player:profiles!tournament_entries_player_id_fkey(id, full_name, gender, phone),
      partner:profiles!tournament_entries_partner_id_fkey(id, full_name)`)
    .eq('tournament_id', params.id)
    .order('created_at', { ascending: true })
```

- [ ] **Step 3: Update the `EntryRow` type to include new fields**

Replace the existing `EntryRow` type:
```ts
  type EntryRow = {
    id: string; player_id: string; partner_id: string | null; seed: number | null; created_at: string
    payment_status: 'free' | 'pending' | 'paid'
    discount_pct: number
    final_price_cents: number
    receipt_url: string | null
    player: { id: string; full_name: string; gender: string | null } | { id: string; full_name: string; gender: string | null }[] | null
    partner: { id: string; full_name: string } | { id: string; full_name: string }[] | null
  }
```

With:
```ts
  type EntryRow = {
    id: string; player_id: string; partner_id: string | null; seed: number | null; created_at: string
    payment_status: 'free' | 'pending' | 'paid'
    discount_pct: number
    final_price_cents: number
    receipt_url: string | null
    entry_status: 'confirmed' | 'waitlist' | 'offered'
    offer_expires_at: string | null
    player: { id: string; full_name: string; gender: string | null; phone: string | null } | { id: string; full_name: string; gender: string | null; phone: string | null }[] | null
    partner: { id: string; full_name: string } | { id: string; full_name: string }[] | null
  }
```

### 8c: Add helper and variables before JSX

- [ ] **Step 4: Add helper function and capacity variables after `allPlayers` computation**

After `const allPlayers = entries.map(...)...` and before `return (`, add:

```ts
  // Separar entradas por status
  const confirmedEntries = entries.filter((e) => e.entry_status === 'confirmed')
  const offeredEntries = entries.filter((e) => e.entry_status === 'offered')
  const waitlistEntries = entries.filter((e) => e.entry_status === 'waitlist')
  const maxPlayers = (t as unknown as { max_players: number | null }).max_players

  // Helper: tempo restante até expiração da oferta
  function formatTimeUntil(isoDate: string): string {
    const ms = new Date(isoDate).getTime() - Date.now()
    if (ms <= 0) return 'Expirada'
    const hours = Math.floor(ms / (1000 * 60 * 60))
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60))
    return `${hours}h ${minutes}m`
  }
```

### 8d: Rewrite the Inscrições section JSX

- [ ] **Step 5: Replace the `{/* Inscrições */}` section**

Replace the entire `<section>` block that starts with `{/* Inscrições */}` through its closing `</section>` with:

```tsx
      {/* Inscrições */}
      <section>
        <h2 className="text-lg font-semibold text-white mb-3">
          {maxPlayers
            ? `Inscrições — ${confirmedEntries.length + offeredEntries.length} / ${maxPlayers} vagas`
            : `Inscrições (${confirmedEntries.length} confirmados)`}
        </h2>

        {/* ① Confirmados */}
        {confirmedEntries.length > 0 && (
          <div className="mb-4">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Confirmados</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {confirmedEntries.map((entry) => {
                const p = normalizeProf(entry.player)
                const pt = normalizeProf(entry.partner)
                const lvl = levelByPlayer.get(entry.player_id)
                const waUrl = entry.payment_status === 'pending' && p?.phone
                  ? buildWhatsAppUrl(
                      p.phone,
                      `Olá ${p.full_name}! Sua inscrição no torneio ${t.name} aguarda pagamento de R$ ${(entry.final_price_cents / 100).toFixed(2).replace('.', ',')} via PIX para a chave ${t.pix_key}. Envie o comprovante pelo app. Obrigado!`,
                    )
                  : null
                return (
                  <Card key={entry.id}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white font-medium">{p?.full_name ?? entry.player_id}</p>
                        {pt && <p className="text-xs text-slate-400">Parceiro: {pt.full_name}</p>}
                        {entry.payment_status === 'pending' && (
                          <p className="text-xs text-yellow-400 mt-0.5">
                            Aguardando: R$ {(entry.final_price_cents / 100).toFixed(2).replace('.', ',')}
                            {entry.discount_pct > 0 && ` (${entry.discount_pct}% desc.)`}
                          </p>
                        )}
                        {entry.payment_status === 'paid' && (
                          <p className="text-xs text-green-400 mt-0.5">
                            Pago: R$ {(entry.final_price_cents / 100).toFixed(2).replace('.', ',')}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1.5 shrink-0">
                        {lvl && <Badge variant="level">{lvl.toUpperCase()}</Badge>}
                        {entry.payment_status === 'free' && (
                          <span className="text-xs text-slate-500 bg-surface rounded px-1.5 py-0.5">Gratuito</span>
                        )}
                        {entry.payment_status === 'paid' && (
                          <span className="text-xs text-green-400 bg-green-900/30 rounded px-1.5 py-0.5">✓ Pago</span>
                        )}
                        {entry.payment_status === 'pending' && (
                          <span className="text-xs text-yellow-400 bg-yellow-900/30 rounded px-1.5 py-0.5">⏳ Pendente</span>
                        )}
                      </div>
                    </div>
                    {receiptSignedUrls[entry.id] && (
                      <div className="mt-2">
                        <a
                          href={receiptSignedUrls[entry.id]}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-brand-400 hover:text-brand-300"
                        >
                          📎 Ver comprovante
                        </a>
                      </div>
                    )}
                    {entry.payment_status === 'pending' && (
                      <div className="mt-2 flex flex-wrap gap-2 items-center">
                        <ConfirmPaymentButton entryId={entry.id} />
                        {waUrl && (
                          <a
                            href={waUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-green-400 hover:text-green-300"
                          >
                            📱 Cobrar via WhatsApp
                          </a>
                        )}
                      </div>
                    )}
                    {entry.payment_status === 'pending' && (
                      <CancelForNonPaymentButton entryId={entry.id} />
                    )}
                  </Card>
                )
              })}
            </div>
          </div>
        )}

        {/* ② Ofertas pendentes */}
        {offeredEntries.length > 0 && (
          <div className="mb-4">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Vaga oferecida</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {offeredEntries.map((entry) => {
                const p = normalizeProf(entry.player)
                const expiresAt = entry.offer_expires_at as string | null
                const expired = expiresAt && new Date(expiresAt) < new Date()
                const waUrl = p?.phone
                  ? buildWhatsAppUrl(
                      p.phone,
                      `Olá ${p.full_name}! Uma vaga abriu no torneio ${t.name}. Acesse ${shareUrl} e confirme sua inscrição em até 48h.`,
                    )
                  : null
                return (
                  <Card key={entry.id}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white font-medium">{p?.full_name ?? entry.player_id}</p>
                        {expired ? (
                          <span className="text-xs text-slate-400 bg-slate-800 rounded px-1.5 py-0.5 mt-1 inline-block">
                            Expirada — será reprocessada na próxima ação
                          </span>
                        ) : (
                          <span className="text-xs text-yellow-400 bg-yellow-900/30 rounded px-1.5 py-0.5 mt-1 inline-block">
                            Vaga oferecida · Expira em {expiresAt ? formatTimeUntil(expiresAt) : '?'}
                          </span>
                        )}
                      </div>
                    </div>
                    {waUrl && (
                      <div className="mt-2">
                        <a
                          href={waUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-green-400 hover:text-green-300"
                        >
                          📱 Notificar via WhatsApp
                        </a>
                      </div>
                    )}
                  </Card>
                )
              })}
            </div>
          </div>
        )}

        {/* ③ Lista de espera */}
        {waitlistEntries.length > 0 && (
          <div className="mb-4">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Lista de espera</p>
            <div className="space-y-1">
              {waitlistEntries.map((entry, idx) => {
                const p = normalizeProf(entry.player)
                return (
                  <div key={entry.id} className="flex items-center gap-3 py-1.5 px-3 bg-surface-card rounded-lg border border-surface-border">
                    <span className="text-xs text-slate-500 font-mono w-6">#{idx + 1}</span>
                    <span className="text-sm text-white flex-1">{p?.full_name ?? entry.player_id}</span>
                    <span className="text-xs text-slate-500">
                      {new Date(entry.created_at).toLocaleDateString('pt-BR')}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {entries.length === 0 && (
          <p className="text-slate-400 text-sm">Nenhuma inscrição ainda.</p>
        )}
      </section>
```

- [ ] **Step 6: Run build check**

```bash
npm run build 2>&1 | head -40
```

Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add "app/(admin)/admin/torneios/[id]/page.tsx"
git commit -m "feat: admin tournament page — 3 entry sections + WhatsApp links + capacity counter"
```

---

## Task 9: `ConfirmWaitlistButton` Client Component

**Files:**
- Create: `app/(public)/t/[id]/ConfirmWaitlistButton.tsx`

- [ ] **Step 1: Create the component**

```tsx
'use client'
// app/(public)/t/[id]/ConfirmWaitlistButton.tsx
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { confirmWaitlistOffer } from '@/features/torneios/actions'

interface Props {
  tournamentId: string
}

export function ConfirmWaitlistButton({ tournamentId }: Props) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  function handleConfirm() {
    setError(null)
    startTransition(async () => {
      const result = await confirmWaitlistOffer(tournamentId)
      if (result.error) {
        setError(result.error)
      } else {
        router.refresh()
      }
    })
  }

  return (
    <div>
      <button
        onClick={handleConfirm}
        disabled={isPending}
        className="block w-full bg-gradient-to-r from-green-700 to-green-600 text-white text-center rounded-xl py-3 text-base font-semibold hover:from-green-600 hover:to-green-500 transition-all disabled:opacity-60"
      >
        {isPending ? 'Confirmando...' : '✅ Confirmar vaga'}
      </button>
      {error && <p className="text-xs text-red-400 mt-2 text-center">{error}</p>}
    </div>
  )
}
```

- [ ] **Step 2: Run build check**

```bash
npm run build 2>&1 | head -20
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add "app/(public)/t/[id]/ConfirmWaitlistButton.tsx"
git commit -m "feat: ConfirmWaitlistButton public component"
```

---

## Task 10: Public Tournament Page — Waitlist States + Capacity + Filtered List

**Files:**
- Modify: `app/(public)/t/[id]/page.tsx`

### 10a: Add `ConfirmWaitlistButton` import

- [ ] **Step 1: Add import**

After the existing import for `ShareButton`, add:
```ts
import { ConfirmWaitlistButton } from './ConfirmWaitlistButton'
```

### 10b: Update tournament and entry queries

- [ ] **Step 2: Add `max_players` to tournament select**

In `PublicTournamentPage`, change the tournament select:
```ts
    .select('id, name, date, sport, category, level, status, cover_image_url, winner1_id, winner2_id, winner3_id, entry_price_cents, pix_key')
```
to:
```ts
    .select('id, name, date, sport, category, level, status, cover_image_url, winner1_id, winner2_id, winner3_id, entry_price_cents, pix_key, max_players')
```

- [ ] **Step 3: Update `TRow` type to include `max_players`**

```ts
  type TRow = {
    id: string; name: string; date: string; sport: string; category: string
    level: string; status: string; cover_image_url: string | null
    winner1_id: string | null; winner2_id: string | null; winner3_id: string | null
    entry_price_cents: number | null; pix_key: string | null
    max_players: number | null
  }
```

- [ ] **Step 4: Filter public entries list to `confirmed` only**

Change the `tournament_entries` query for the public players list:
```ts
  const { data: entriesRaw } = await adminClient
    .from('tournament_entries')
    .select('player_id, player:profiles!tournament_entries_player_id_fkey(id, full_name)')
    .eq('tournament_id', params.id)
    .order('created_at', { ascending: true })
```
to:
```ts
  const { data: entriesRaw } = await adminClient
    .from('tournament_entries')
    .select('player_id, player:profiles!tournament_entries_player_id_fkey(id, full_name)')
    .eq('tournament_id', params.id)
    .eq('entry_status', 'confirmed')
    .order('created_at', { ascending: true })
```

- [ ] **Step 5: Update user entry select to include new fields**

Change:
```ts
      const { data: entryRaw } = await adminClient
        .from('tournament_entries')
        .select('payment_status, receipt_url, final_price_cents, discount_pct')
        .eq('tournament_id', params.id)
        .eq('player_id', user.id)
        .maybeSingle()
      userEntry = entryRaw as UserEntryData
```
to:
```ts
      const { data: entryRaw } = await adminClient
        .from('tournament_entries')
        .select('payment_status, receipt_url, final_price_cents, discount_pct, entry_status, offer_expires_at, created_at')
        .eq('tournament_id', params.id)
        .eq('player_id', user.id)
        .maybeSingle()
      userEntry = entryRaw as UserEntryData
```

- [ ] **Step 6: Update `UserEntryData` type**

Replace:
```ts
  type UserEntryData = { payment_status: 'free' | 'pending' | 'paid'; receipt_url: string | null; final_price_cents: number; discount_pct: number } | null
```
with:
```ts
  type UserEntryData = {
    payment_status: 'free' | 'pending' | 'paid'
    receipt_url: string | null
    final_price_cents: number
    discount_pct: number
    entry_status: 'confirmed' | 'waitlist' | 'offered'
    offer_expires_at: string | null
    created_at: string
  } | null
```

### 10c: Add waitlist position query

- [ ] **Step 7: Add waitlist position query after `userEntry` is set**

After `const isRegistered = userEntry !== null`, add:

```ts
  // Posição na lista de espera
  let waitlistPosition: number | null = null
  if (userEntry?.entry_status === 'waitlist') {
    const { count: pos } = await adminClient
      .from('tournament_entries')
      .select('id', { count: 'exact', head: true })
      .eq('tournament_id', params.id)
      .eq('entry_status', 'waitlist')
      .lte('created_at', userEntry.created_at)
    waitlistPosition = pos ?? null
  }
```

### 10d: Update JSX — CTA and capacity counter

- [ ] **Step 8: Add capacity counter above the CTA block**

Add `isOpen` capacity counter — inside the `{isOpen && (...)}` CTA block, add at the top (before the price/PIX section):

```tsx
          {/* Contador de vagas */}
          {t.max_players && (
            <p className="text-slate-400 text-xs text-center">
              {players.length} / {t.max_players} inscritos
            </p>
          )}
```

- [ ] **Step 9: Add new CTA states for waitlist and offered**

Replace the existing `isRegistered && userEntry ? (...)` block in the CTA section. The full replacement:

```tsx
          {isRegistered && userEntry ? (
            <>
              {/* Jogador confirmado */}
              {userEntry.entry_status === 'confirmed' && (
                <>
                  {userEntry.payment_status === 'paid' && (
                    <span className="block bg-green-800/40 text-green-400 text-sm px-3 py-2 rounded-xl font-semibold w-full text-center">
                      ✓ Pagamento confirmado
                    </span>
                  )}
                  {userEntry.payment_status === 'pending' && (
                    <div className="space-y-3">
                      <span className="block bg-yellow-800/40 text-yellow-400 text-sm px-3 py-2 rounded-xl font-semibold w-full text-center">
                        ⏳ Aguardando confirmação do pagamento
                      </span>
                      <div className="bg-surface rounded-lg px-3 py-2">
                        <p className="text-slate-400 text-xs font-semibold uppercase tracking-wide mb-0.5">Valor a pagar</p>
                        <p className="text-white text-lg font-bold">
                          R$ {(userEntry.final_price_cents / 100).toFixed(2).replace('.', ',')}
                          {userEntry.discount_pct > 0 && (
                            <span className="text-green-400 text-sm font-normal ml-2">({userEntry.discount_pct}% de desconto)</span>
                          )}
                        </p>
                        <p className="text-slate-400 text-xs font-semibold uppercase tracking-wide mt-2 mb-0.5">Chave PIX</p>
                        <p className="text-white text-sm font-mono break-all">{t.pix_key}</p>
                      </div>
                      {user && (
                        <ReceiptUploadButton
                          tournamentId={t.id}
                          userId={user.id}
                          hasExistingReceipt={!!userEntry.receipt_url}
                        />
                      )}
                    </div>
                  )}
                  {userEntry.payment_status === 'free' && (
                    <span className="block bg-green-800/40 text-green-400 text-sm px-3 py-2 rounded-xl font-semibold w-full text-center">
                      ✓ Você está inscrito
                    </span>
                  )}
                </>
              )}

              {/* Na lista de espera */}
              {userEntry.entry_status === 'waitlist' && (
                <span className="block bg-slate-800/60 text-slate-300 text-sm px-3 py-2 rounded-xl font-semibold w-full text-center">
                  🕐 Você está na lista de espera{waitlistPosition !== null ? ` — posição ${waitlistPosition}` : ''}
                </span>
              )}

              {/* Vaga oferecida */}
              {userEntry.entry_status === 'offered' && (
                <>
                  {userEntry.offer_expires_at && new Date(userEntry.offer_expires_at) > new Date() ? (
                    <div className="space-y-3">
                      <span className="block bg-green-900/40 text-green-300 text-sm px-3 py-2 rounded-xl font-semibold w-full text-center">
                        🎉 Vaga disponível! Confirme até {new Date(userEntry.offer_expires_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <ConfirmWaitlistButton tournamentId={t.id} />
                    </div>
                  ) : (
                    <span className="block bg-slate-800/60 text-slate-400 text-sm px-3 py-2 rounded-xl font-semibold w-full text-center">
                      ⏰ Sua oferta de vaga expirou. Você voltou para a fila.
                    </span>
                  )}
                </>
              )}
            </>
          ) : user ? (
            <RegisterExternalButton
              tournamentId={t.id}
              isPaid={isPaid}
              finalPriceCents={isPaid ? (t.entry_price_cents ?? 0) : undefined}
            />
          ) : (
            <div>
              <Link
                href={`/login?next=/t/${t.id}`}
                className="block w-full bg-gradient-to-r from-orange-600 to-orange-500 text-white text-center rounded-xl py-3 text-base font-semibold hover:from-orange-500 hover:to-orange-400 transition-all"
              >
                {isPaid ? `Inscrever-se — ${formattedPrice}` : 'Inscrever-se'}
              </Link>
              <p className="text-slate-500 text-xs text-center mt-2">
                Precisa de uma conta?{' '}
                <Link href={`/t/${t.id}/cadastrar`} className="text-brand-500 hover:underline">
                  Cadastre-se grátis
                </Link>
              </p>
            </div>
          )}
```

- [ ] **Step 10: Run build check**

```bash
npm run build 2>&1 | head -40
```

Expected: no errors

- [ ] **Step 11: Commit**

```bash
git add "app/(public)/t/[id]/page.tsx"
git commit -m "feat: public tournament page — waitlist/offered states, capacity counter, confirmed-only player list"
```

---

## Task 11: `CreateTournamentForm` — max_players Field

**Files:**
- Modify: `app/(admin)/admin/torneios/CreateTournamentForm.tsx`

- [ ] **Step 1: Add `maxPlayers` state**

After `const [pixKey, setPixKey] = useState<string>('')`, add:
```ts
  const [maxPlayers, setMaxPlayers] = useState<string>('')
```

- [ ] **Step 2: Parse `maxPlayers` in `handleSubmit`**

After the `pixKey.trim() || null` line in `handleSubmit`, and before `createTournament(...)`, add:

```ts
      const parsedMax = parseInt(maxPlayers, 10)
      const maxPlayersValue: number | null =
        maxPlayers.trim() && !isNaN(parsedMax) && parsedMax >= 2
          ? parsedMax
          : null
```

- [ ] **Step 3: Pass `max_players` to `createTournament`**

In the `createTournament({...})` call, after `pix_key: pixKey.trim() || null,`, add:
```ts
        max_players: maxPlayersValue,
```

- [ ] **Step 4: Reset `maxPlayers` on success**

In the success block (where `setPixKey('')` is called), add:
```ts
        setMaxPlayers('')
```

- [ ] **Step 5: Add the form field after the PIX field**

After the `</div>` that closes the PIX field wrapper (after the `<p className="text-xs text-slate-500">CPF, email...`), add:

```tsx
      <Input
        label="Limite de vagas"
        type="number"
        min="2"
        placeholder="Sem limite (deixe vazio)"
        value={maxPlayers}
        onChange={(e) => setMaxPlayers(e.target.value)}
      />
```

- [ ] **Step 6: Run build check**

```bash
npm run build 2>&1 | head -20
```

Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add "app/(admin)/admin/torneios/CreateTournamentForm.tsx"
git commit -m "feat: CreateTournamentForm — max_players field"
```

---

## Task 12: Final Verification

- [ ] **Step 1: Run all tests**

```bash
npm run test:run
```

Expected: all tests PASS including the 9 new tests in `lib/torneios/waitlist.test.ts`

- [ ] **Step 2: Run full production build**

```bash
npm run build
```

Expected: ✓ Compiled successfully, no TypeScript errors

- [ ] **Step 3: Verify acceptance criteria (manual checklist)**

| # | Critério | Como verificar |
|---|---|---|
| 1 | Torneio sem `max_players`: comportamento idêntico ao atual | Criar torneio sem limite → inscrever → não vai para waitlist |
| 2 | Torneio com `max_players = 2`, 2 inscritos: 3º vai para waitlist | Criar torneio limitado → inscrever 3 pessoas → 3ª vê posição |
| 3 | Admin remove inscrito → `expireAndPromote` promove 1º da fila para `offered` | Remover inscrito → 1º da waitlist vira offered no admin |
| 4 | Jogador em `offered` acessa `/t/[id]` → vê botão "Confirmar vaga" | Logar como jogador offered → vê CTA verde |
| 5 | Após 48h: `confirmWaitlistOffer` retorna erro e jogador volta para `waitlist` | Mockar data expirada → confirmar → recebe mensagem de erro |
| 6 | WhatsApp link aparece em entrada `pending` com telefone cadastrado | Admin → entrada pending com phone → link 📱 aparece |
| 7 | Cancelar por falta de pagamento → entry removida, reversal, próximo da fila promovido | Admin → "Cancelar por falta de pagamento" → Sim → entry removida |
| 8 | Lista de espera exibida no admin com posições | Entradas waitlist aparecem na seção ③ com #1, #2... |

- [ ] **Step 4: Final commit (if any clean-up needed)**

```bash
git add -p  # stage only specific changes
git commit -m "chore: final verification cleanup"
```

---

## Post-Deploy Checklist

1. **Aplicar migration manualmente** no Supabase SQL Editor (o arquivo `supabase/migrations/20260701000100_tournament_waitlist.sql`). Isso precisa acontecer ANTES de fazer o deploy.
2. Após o deploy, testar o fluxo completo em produção com um torneio de teste.
