# Tournament Payment & Discount Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar cobrança de inscrição por PIX com aprovação manual pelo admin, desconto progressivo para multi-torneio na mesma semana calendário, e cadastro avulso sem convite para jogadores externos.

**Architecture:** Novas colunas em `tournaments` (preço + PIX), `tournament_entries` (status pagamento + desconto) e `organizations` (percentuais de desconto). Lógica de desconto em funções puras testáveis. Actions do servidor computam desconto na inscrição e revertem em cancelamentos. Admin confirma pagamento manualmente; comprovante é upload do jogador para bucket privado `payment-receipts`.

**Tech Stack:** Next.js 14 App Router · TypeScript · Supabase (Postgres + Storage) · Vitest · Tailwind CSS

---

## Mapa de arquivos

| Arquivo | Ação |
|---|---|
| `supabase/migrations/20260630000100_tournament_entry_payment.sql` | Criar — novas colunas DB |
| `supabase/migrations/20260630000200_payment_receipts_bucket.sql` | Criar — bucket storage |
| `lib/utils/weekHelpers.ts` | Criar — `getWeekBounds` (BRT Mon-Sun) |
| `lib/utils/weekHelpers.test.ts` | Criar — testes TDD |
| `lib/torneios/entryDiscount.ts` | Criar — `computeEntryDiscount` + `applyDiscount` |
| `lib/torneios/entryDiscount.test.ts` | Criar — testes TDD |
| `types/index.ts` | Modificar — Tournament + TournamentEntry + Organization |
| `features/torneios/actions.ts` | Modificar — 5 actions atualizadas + 3 novas |
| `app/(public)/t/[id]/page.tsx` | Modificar — seção preço + PIX + comprovante + link cadastro |
| `app/(public)/t/[id]/RegisterExternalButton.tsx` | Modificar — aceita `isPaid` prop |
| `app/(public)/t/[id]/ReceiptUploadButton.tsx` | Criar — upload comprovante |
| `app/(public)/t/[id]/cadastrar/page.tsx` | Criar — wrapper Server Component |
| `app/(public)/t/[id]/cadastrar/TournamentSignupForm.tsx` | Criar — form cadastro avulso |
| `app/(admin)/admin/torneios/[id]/page.tsx` | Modificar — badges status + signed URLs |
| `app/(admin)/admin/torneios/[id]/ConfirmPaymentButton.tsx` | Criar — botão confirmar |
| `app/(admin)/admin/torneios/CreateTournamentForm.tsx` | Modificar — campos preço + PIX |
| `app/(admin)/admin/configuracoes/page.tsx` | Modificar — seção desconto torneios |
| `app/(admin)/admin/configuracoes/TournamentDiscountForm.tsx` | Criar — form percentuais |

---

### Task 1: Migration — colunas de pagamento

**Files:**
- Create: `supabase/migrations/20260630000100_tournament_entry_payment.sql`

- [ ] **Step 1: Criar arquivo de migration**

```sql
-- supabase/migrations/20260630000100_tournament_entry_payment.sql

-- tournaments: preço e chave PIX (ambos null = gratuito)
ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS entry_price_cents integer,
  ADD COLUMN IF NOT EXISTS pix_key text;

-- tournament_entries: campos de pagamento
ALTER TABLE tournament_entries
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'free'
    CHECK (payment_status IN ('free', 'pending', 'paid')),
  ADD COLUMN IF NOT EXISTS discount_pct numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS final_price_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS receipt_url text;

-- organizations: percentuais de desconto configuráveis
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS tournament_discount_2_pct integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS tournament_discount_3_pct integer NOT NULL DEFAULT 50;
```

- [ ] **Step 2: Verificar sintaxe**

```bash
# Confirma que o arquivo existe e não tem erros de sintaxe óbvios
cat supabase/migrations/20260630000100_tournament_entry_payment.sql
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260630000100_tournament_entry_payment.sql
git commit -m "feat(migration): colunas de pagamento em tournaments, entries e organizations"
```

---

### Task 2: Migration — bucket payment-receipts

**Files:**
- Create: `supabase/migrations/20260630000200_payment_receipts_bucket.sql`

- [ ] **Step 1: Criar arquivo de migration**

```sql
-- supabase/migrations/20260630000200_payment_receipts_bucket.sql

-- Bucket privado para comprovantes de pagamento de torneio.
-- Path convention: {tournament_id}/{user_id}/receipt.{ext}
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'payment-receipts',
  'payment-receipts',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Jogador só faz upload para o próprio path ({tournament_id}/{user_id}/...)
DROP POLICY IF EXISTS "receipts_upload" ON storage.objects;
CREATE POLICY "receipts_upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'payment-receipts'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

-- Jogador lê apenas os próprios comprovantes
DROP POLICY IF EXISTS "receipts_read_own" ON storage.objects;
CREATE POLICY "receipts_read_own" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'payment-receipts'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

-- Admin lê qualquer comprovante via service role (createAdminClient bypassa RLS)
-- Nenhuma policy adicional necessária para service role.
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260630000200_payment_receipts_bucket.sql
git commit -m "feat(migration): bucket payment-receipts para comprovantes de pagamento"
```

---

### Task 3: TypeScript types

**Files:**
- Modify: `types/index.ts`

- [ ] **Step 1: Adicionar campos em `Tournament` (após `winner3_partner_id`)**

Localizar o bloco da interface `Tournament` (linhas 279–302) e adicionar após `winner3_partner_id`:

```ts
  entry_price_cents: number | null
  pix_key: string | null
```

- [ ] **Step 2: Adicionar campos em `TournamentEntry` (após `created_at`)**

Localizar a interface `TournamentEntry` (linhas 304–312) e adicionar após `created_at`:

```ts
  payment_status: 'free' | 'pending' | 'paid'
  discount_pct: number
  final_price_cents: number
  receipt_url: string | null
```

- [ ] **Step 3: Adicionar campos em `Organization` (após `no_number`)**

Localizar a interface `Organization` (linhas 83–107) e adicionar após `no_number: boolean`:

```ts
  tournament_discount_2_pct: number
  tournament_discount_3_pct: number
```

- [ ] **Step 4: Verificar build de tipos**

```bash
npm run build 2>&1 | head -30
```

Esperado: sem erros de tipo nos novos campos.

- [ ] **Step 5: Commit**

```bash
git add types/index.ts
git commit -m "feat(types): entry_price_cents, pix_key, payment_status, discount_pct em Tournament/Entry/Org"
```

---

### Task 4: Funções puras — weekHelpers + entryDiscount (TDD)

**Files:**
- Create: `lib/utils/weekHelpers.ts`
- Create: `lib/utils/weekHelpers.test.ts`
- Create: `lib/torneios/entryDiscount.ts`
- Create: `lib/torneios/entryDiscount.test.ts`

- [ ] **Step 1: Escrever testes de weekHelpers**

```ts
// lib/utils/weekHelpers.test.ts
import { describe, it, expect } from 'vitest'
import { getWeekBounds } from './weekHelpers'

describe('getWeekBounds', () => {
  it('quarta-feira retorna segunda a domingo da mesma semana (BRT)', () => {
    // 2026-06-24 Wed 12:00 UTC = 09:00 BRT
    const { start, end } = getWeekBounds(new Date('2026-06-24T12:00:00Z'))
    // Segunda 2026-06-22 00:00 BRT = 03:00 UTC
    expect(start.toISOString()).toBe('2026-06-22T03:00:00.000Z')
    // Domingo 2026-06-28 23:59:59.999 BRT = segunda 02:59:59.999 UTC
    expect(end.toISOString()).toBe('2026-06-29T02:59:59.999Z')
  })

  it('segunda-feira retorna a mesma semana', () => {
    // 2026-06-22 Mon 10:00 UTC = 07:00 BRT (segunda)
    const { start, end } = getWeekBounds(new Date('2026-06-22T10:00:00Z'))
    expect(start.toISOString()).toBe('2026-06-22T03:00:00.000Z')
    expect(end.toISOString()).toBe('2026-06-29T02:59:59.999Z')
  })

  it('domingo BRT retorna a semana atual (não a próxima)', () => {
    // 2026-06-28 Sun 20:00 UTC = 17:00 BRT (domingo)
    const { start, end } = getWeekBounds(new Date('2026-06-28T20:00:00Z'))
    expect(start.toISOString()).toBe('2026-06-22T03:00:00.000Z')
    expect(end.toISOString()).toBe('2026-06-29T02:59:59.999Z')
  })

  it('segunda 01:00 UTC é ainda domingo BRT (semana anterior)', () => {
    // 2026-06-22 Mon 01:00 UTC = 2026-06-21 22:00 BRT (domingo da semana anterior)
    const { start, end } = getWeekBounds(new Date('2026-06-22T01:00:00Z'))
    expect(start.toISOString()).toBe('2026-06-15T03:00:00.000Z')
    expect(end.toISOString()).toBe('2026-06-22T02:59:59.999Z')
  })
})
```

- [ ] **Step 2: Rodar testes — devem falhar**

```bash
npm run test:run -- lib/utils/weekHelpers.test.ts
```

Esperado: FAIL — `Cannot find module './weekHelpers'`

- [ ] **Step 3: Implementar weekHelpers**

```ts
// lib/utils/weekHelpers.ts

/**
 * Retorna início (segunda 00:00 BRT) e fim (domingo 23:59:59.999 BRT) da semana
 * ISO que contém `date`, como objetos Date em UTC.
 * BRT = UTC-3 (não ajusta horário de verão — aceitável para agendamento de torneios).
 */
export function getWeekBounds(date: Date): { start: Date; end: Date } {
  const BRT_OFFSET_MS = 3 * 60 * 60 * 1000 // 3h em ms

  // Converte para BRT subtraindo o offset
  const brtDate = new Date(date.getTime() - BRT_OFFSET_MS)

  // getUTCDay() em brtDate já reflete o dia BRT (0=Dom, 1=Seg, ..., 6=Sáb)
  const dayOfWeek = brtDate.getUTCDay()
  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1

  // Segunda-feira 00:00:00 BRT
  const mondayBRT = new Date(brtDate)
  mondayBRT.setUTCDate(mondayBRT.getUTCDate() - daysFromMonday)
  mondayBRT.setUTCHours(0, 0, 0, 0)

  // Converte de volta para UTC somando o offset
  const start = new Date(mondayBRT.getTime() + BRT_OFFSET_MS)

  // Domingo 23:59:59.999 BRT = start + 7 dias - 1ms
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000 - 1)

  return { start, end }
}
```

- [ ] **Step 4: Rodar testes — devem passar**

```bash
npm run test:run -- lib/utils/weekHelpers.test.ts
```

Esperado: PASS — 4 testes verdes

- [ ] **Step 5: Escrever testes de entryDiscount**

```ts
// lib/torneios/entryDiscount.test.ts
import { describe, it, expect } from 'vitest'
import { computeEntryDiscount, applyDiscount } from './entryDiscount'

describe('computeEntryDiscount', () => {
  it('primeiro torneio da semana: sem desconto', () => {
    expect(computeEntryDiscount(0, 30, 50)).toBe(0)
  })
  it('segundo torneio: aplica discount2Pct', () => {
    expect(computeEntryDiscount(1, 30, 50)).toBe(30)
  })
  it('terceiro torneio: aplica discount3Pct', () => {
    expect(computeEntryDiscount(2, 30, 50)).toBe(50)
  })
  it('quarto torneio: ainda discount3Pct', () => {
    expect(computeEntryDiscount(3, 30, 50)).toBe(50)
  })
  it('percentuais customizados funcionam', () => {
    expect(computeEntryDiscount(1, 20, 40)).toBe(20)
    expect(computeEntryDiscount(2, 20, 40)).toBe(40)
  })
  it('weeklyPaidCount negativo trata como zero', () => {
    expect(computeEntryDiscount(-1, 30, 50)).toBe(0)
  })
})

describe('applyDiscount', () => {
  it('0% desconto retorna preço cheio', () => {
    expect(applyDiscount(10000, 0)).toBe(10000)
  })
  it('30% em R$100 = R$70 (7000 centavos)', () => {
    expect(applyDiscount(10000, 30)).toBe(7000)
  })
  it('50% em R$100 = R$50 (5000 centavos)', () => {
    expect(applyDiscount(10000, 50)).toBe(5000)
  })
  it('arredonda para o centavo mais próximo', () => {
    // 333 * 0.9 = 299.7 → 300
    expect(applyDiscount(333, 10)).toBe(300)
  })
})
```

- [ ] **Step 6: Rodar testes — devem falhar**

```bash
npm run test:run -- lib/torneios/entryDiscount.test.ts
```

Esperado: FAIL — `Cannot find module './entryDiscount'`

- [ ] **Step 7: Implementar entryDiscount**

```ts
// lib/torneios/entryDiscount.ts

/**
 * Calcula o percentual de desconto para uma nova inscrição em torneio pago.
 * @param weeklyPaidCount - nº de entradas pagas/pendentes do jogador nesta semana ANTES desta
 * @param discount2Pct   - configuração da academia: desconto no 2º torneio
 * @param discount3Pct   - configuração da academia: desconto no 3º+ torneio
 */
export function computeEntryDiscount(
  weeklyPaidCount: number,
  discount2Pct: number,
  discount3Pct: number,
): number {
  if (weeklyPaidCount <= 0) return 0
  if (weeklyPaidCount === 1) return discount2Pct
  return discount3Pct
}

/**
 * Aplica um percentual de desconto a um preço em centavos.
 * Resultado arredondado para o inteiro mais próximo.
 */
export function applyDiscount(priceCents: number, discountPct: number): number {
  return Math.round(priceCents * (100 - discountPct) / 100)
}
```

- [ ] **Step 8: Rodar todos os testes novos**

```bash
npm run test:run -- lib/utils/weekHelpers.test.ts lib/torneios/entryDiscount.test.ts
```

Esperado: PASS — 10 testes verdes

- [ ] **Step 9: Commit**

```bash
git add lib/utils/weekHelpers.ts lib/utils/weekHelpers.test.ts lib/torneios/entryDiscount.ts lib/torneios/entryDiscount.test.ts
git commit -m "feat: getWeekBounds (BRT) + computeEntryDiscount/applyDiscount (TDD)"
```

---

### Task 5: Actions — registrar com pagamento e desconto

**Files:**
- Modify: `features/torneios/actions.ts`

Esta task atualiza `registerExternal`, `registerForTournament` e `createTournament` para suportar campos de pagamento. Também adiciona `confirmEntryPayment` e `updateEntryReceipt`.

- [ ] **Step 1: Adicionar imports no topo de actions.ts**

Adicionar após os imports existentes:

```ts
import { getWeekBounds } from '@/lib/utils/weekHelpers'
import { computeEntryDiscount, applyDiscount } from '@/lib/torneios/entryDiscount'
```

- [ ] **Step 2: Atualizar `createTournament` — aceitar e gravar novos campos**

Localizar a função `createTournament` e atualizar o tipo de input (após `cover_image_url`):

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
}): Promise<{ error?: string; id?: string }>
```

No bloco `.insert({...})`, adicionar após `cover_image_url`:

```ts
      entry_price_cents: input.entry_price_cents ?? null,
      pix_key: input.pix_key ?? null,
```

- [ ] **Step 3: Adicionar helper `computePaymentFields` dentro de actions.ts (antes das funções exportadas)**

Coloca logo após as funções `shuffle` e `modalityFromParticipant`:

```ts
// Calcula os campos de pagamento para uma nova inscrição.
// Retorna payment_status, discount_pct e final_price_cents.
async function computePaymentFields(
  adminClient: ReturnType<typeof createAdminClient>,
  playerId: string,
  orgId: string,
  entryPriceCents: number | null,
  pixKey: string | null,
): Promise<{ payment_status: 'free' | 'pending'; discount_pct: number; final_price_cents: number }> {
  const isPaid = (entryPriceCents ?? 0) > 0 && !!pixKey
  if (!isPaid) return { payment_status: 'free', discount_pct: 0, final_price_cents: 0 }

  // Ler configurações de desconto da academia
  const { data: orgRow } = await adminClient
    .from('organizations')
    .select('tournament_discount_2_pct, tournament_discount_3_pct')
    .eq('id', orgId)
    .single()
  const discount2 = (orgRow?.tournament_discount_2_pct as number | null) ?? 30
  const discount3 = (orgRow?.tournament_discount_3_pct as number | null) ?? 50

  // Contar inscrições pagas nesta semana calendário (BRT)
  const { start, end } = getWeekBounds(new Date())
  const { count: weeklyCount } = await adminClient
    .from('tournament_entries')
    .select('id', { count: 'exact', head: true })
    .eq('player_id', playerId)
    .eq('organization_id', orgId)
    .in('payment_status', ['pending', 'paid'])
    .gt('final_price_cents', 0)
    .gte('created_at', start.toISOString())
    .lte('created_at', end.toISOString())

  const discountPct = computeEntryDiscount(weeklyCount ?? 0, discount2, discount3)
  const finalPriceCents = applyDiscount(entryPriceCents!, discountPct)

  return { payment_status: 'pending', discount_pct: discountPct, final_price_cents: finalPriceCents }
}
```

- [ ] **Step 4: Atualizar `registerForTournament` — ler preço/PIX e gravar campos de pagamento**

Na query do torneio, adicionar `entry_price_cents, pix_key` ao select:

```ts
  const { data: tournament, error: tErr } = await adminClient
    .from('tournaments')
    .select('id, status, level, category, participant_type, entry_price_cents, pix_key')
    .eq('id', tournamentId)
    .eq('organization_id', orgId)
    .single()
```

Antes do `.insert(...)` final (após todas as validações de elegibilidade), adicionar:

```ts
  const paymentFields = await computePaymentFields(
    adminClient,
    user.id,
    orgId,
    (tournament.entry_price_cents as number | null),
    (tournament.pix_key as string | null),
  )
```

E atualizar o objeto `.insert({...})`:

```ts
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
```

- [ ] **Step 5: Atualizar `registerExternal` — mesmo tratamento**

Na query do torneio, adicionar `entry_price_cents, pix_key` ao select:

```ts
  const { data: tournament } = await adminClient
    .from('tournaments')
    .select('id, organization_id, status, entry_price_cents, pix_key')
    .eq('id', tournamentId)
    .single()
```

Antes do insert, adicionar:

```ts
  const paymentFields = await computePaymentFields(
    adminClient,
    user.id,
    tournament.organization_id as string,
    (tournament.entry_price_cents as number | null),
    (tournament.pix_key as string | null),
  )
```

E atualizar o insert:

```ts
  const { error: insertErr } = await adminClient
    .from('tournament_entries')
    .insert({
      organization_id: tournament.organization_id,
      tournament_id: tournamentId,
      player_id: user.id,
      partner_id: null,
      payment_status: paymentFields.payment_status,
      discount_pct: paymentFields.discount_pct,
      final_price_cents: paymentFields.final_price_cents,
    })
```

- [ ] **Step 6: Adicionar `confirmEntryPayment` no final de actions.ts**

```ts
// ---------------------------------------------------------------------------
// confirmEntryPayment — admin confirma recebimento do PIX
// ---------------------------------------------------------------------------

export async function confirmEntryPayment(
  entryId: string,
): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const adminClient = createAdminClient()
  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  const { data: membership } = await adminClient
    .from('memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .single()
  if (membership?.role !== 'admin') return { error: 'Sem permissão.' }

  const { data: entry, error: entryErr } = await adminClient
    .from('tournament_entries')
    .select('id, tournament_id, payment_status')
    .eq('id', entryId)
    .eq('organization_id', orgId)
    .single()
  if (entryErr || !entry) return { error: 'Inscrição não encontrada.' }
  if (entry.payment_status !== 'pending') {
    return { error: 'Esta inscrição não está aguardando pagamento.' }
  }

  const { error: updateErr } = await adminClient
    .from('tournament_entries')
    .update({ payment_status: 'paid' })
    .eq('id', entryId)
  if (updateErr) return { error: 'Erro ao confirmar pagamento. Tente novamente.' }

  revalidatePath(`/admin/torneios/${entry.tournament_id as string}`)
  return {}
}
```

- [ ] **Step 7: Adicionar `updateEntryReceipt` no final de actions.ts**

```ts
// ---------------------------------------------------------------------------
// updateEntryReceipt — jogador salva path do comprovante após upload
// ---------------------------------------------------------------------------

export async function updateEntryReceipt(
  tournamentId: string,
  receiptPath: string,
): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const adminClient = createAdminClient()
  const { error } = await adminClient
    .from('tournament_entries')
    .update({ receipt_url: receiptPath })
    .eq('tournament_id', tournamentId)
    .eq('player_id', user.id)
  if (error) return { error: 'Erro ao salvar comprovante. Tente novamente.' }
  return {}
}
```

- [ ] **Step 8: Verificar build**

```bash
npm run build 2>&1 | head -40
```

Esperado: sem erros de tipo.

- [ ] **Step 9: Commit**

```bash
git add features/torneios/actions.ts
git commit -m "feat(actions): pagamento e desconto em registerForTournament/External + confirmEntryPayment + updateEntryReceipt"
```

---

### Task 6: Action — removeEntry com reversal de desconto + updateTournamentDiscountSettings

**Files:**
- Modify: `features/torneios/actions.ts`

- [ ] **Step 1: Atualizar `removeEntry` — buscar entry antes de deletar**

Dentro da função `removeEntry`, ANTES do bloco de delete, adicionar a leitura da entrada:

```ts
  // Busca dados do entry antes de deletar (para reversal de desconto)
  const { data: deletedEntry } = await adminClient
    .from('tournament_entries')
    .select('final_price_cents, created_at, payment_status')
    .eq('tournament_id', tournamentId)
    .eq('player_id', target)
    .eq('organization_id', orgId)
    .single()
```

Após o bloco de delete (após `if (delErr)`), adicionar o reversal:

```ts
  // Reversal de desconto: recalcula entradas PENDING do mesmo jogador na mesma semana
  if (deletedEntry && (deletedEntry.final_price_cents as number) > 0) {
    const { data: orgRow } = await adminClient
      .from('organizations')
      .select('tournament_discount_2_pct, tournament_discount_3_pct')
      .eq('id', orgId)
      .single()
    const discount2 = (orgRow?.tournament_discount_2_pct as number | null) ?? 30
    const discount3 = (orgRow?.tournament_discount_3_pct as number | null) ?? 50

    const { start, end } = getWeekBounds(new Date(deletedEntry.created_at as string))

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
```

- [ ] **Step 2: Adicionar `updateTournamentDiscountSettings` no final de actions.ts**

```ts
// ---------------------------------------------------------------------------
// updateTournamentDiscountSettings — admin configura percentuais de desconto
// ---------------------------------------------------------------------------

export async function updateTournamentDiscountSettings(
  discount2Pct: number,
  discount3Pct: number,
): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const adminClient = createAdminClient()
  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  const { data: membership } = await adminClient
    .from('memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .single()
  if (membership?.role !== 'admin') return { error: 'Sem permissão.' }

  if (
    !Number.isInteger(discount2Pct) || discount2Pct < 0 || discount2Pct > 100 ||
    !Number.isInteger(discount3Pct) || discount3Pct < 0 || discount3Pct > 100
  ) {
    return { error: 'Percentuais devem ser inteiros entre 0 e 100.' }
  }

  const { error: updateErr } = await adminClient
    .from('organizations')
    .update({
      tournament_discount_2_pct: discount2Pct,
      tournament_discount_3_pct: discount3Pct,
    })
    .eq('id', orgId)
  if (updateErr) return { error: 'Erro ao salvar configurações. Tente novamente.' }
  return {}
}
```

- [ ] **Step 3: Verificar build**

```bash
npm run build 2>&1 | head -40
```

- [ ] **Step 4: Rodar todos os testes**

```bash
npm run test:run
```

Esperado: todos os testes existentes passam (163+).

- [ ] **Step 5: Commit**

```bash
git add features/torneios/actions.ts
git commit -m "feat(actions): removeEntry com reversal de desconto + updateTournamentDiscountSettings"
```

---

### Task 7: Cadastro avulso — /t/[id]/cadastrar

**Files:**
- Create: `app/(public)/t/[id]/cadastrar/page.tsx`
- Create: `app/(public)/t/[id]/cadastrar/TournamentSignupForm.tsx`

- [ ] **Step 1: Criar page.tsx (Server Component wrapper)**

```tsx
// app/(public)/t/[id]/cadastrar/page.tsx
import { TournamentSignupForm } from './TournamentSignupForm'

interface PageProps { params: { id: string } }

export default function TournamentCadastroPage({ params }: PageProps) {
  return <TournamentSignupForm tournamentId={params.id} />
}
```

- [ ] **Step 2: Criar TournamentSignupForm.tsx (Client Component)**

```tsx
// app/(public)/t/[id]/cadastrar/TournamentSignupForm.tsx
'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'

interface Props { tournamentId: string }

export function TournamentSignupForm({ tournamentId }: Props) {
  const router = useRouter()
  const [form, setForm] = useState({ full_name: '', email: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [confirmEmail, setConfirmEmail] = useState(false)

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.full_name.trim()) { setError('Informe seu nome completo.'); return }
    setLoading(true)
    setError('')
    const supabase = createClient()
    // Sem org_invite_code nos metadados → handle_new_user cria profiles sem membership
    const { data, error: signUpErr } = await supabase.auth.signUp({
      email: form.email,
      password: form.password,
      options: { data: { full_name: form.full_name.trim() } },
    })
    if (signUpErr) {
      const msg = signUpErr.message.toLowerCase()
      if (msg.includes('already registered') || msg.includes('already exists') || msg.includes('user already')) {
        setError('Esse email já tem uma conta. Faça login.')
      } else if (msg.includes('password')) {
        setError('A senha precisa ter pelo menos 6 caracteres.')
      } else {
        setError('Não foi possível criar a conta. Tente novamente.')
      }
      setLoading(false)
      return
    }
    if (data.session) {
      router.push(`/t/${tournamentId}`)
      router.refresh()
      return
    }
    setConfirmEmail(true)
    setLoading(false)
  }

  if (confirmEmail) {
    return (
      <div style={{ maxWidth: 420, margin: '40px auto', padding: '0 16px' }}>
        <Card>
          <div className="h-1.5 -mx-4 -mt-4 mb-6 rounded-t-xl bg-gradient-to-r from-brand-500 to-brand-700" />
          <div className="text-center py-4">
            <div className="text-4xl mb-4">📧</div>
            <h2 className="text-lg font-semibold text-white mb-2">Confirme seu email</h2>
            <p className="text-slate-400 text-sm mb-4">
              Enviamos um link para <span className="text-brand-400">{form.email}</span>.
              Clique no link para ativar sua conta e depois volte para se inscrever.
            </p>
            <Link href={`/t/${tournamentId}`} className="text-brand-400 text-sm hover:text-brand-300">
              ← Voltar ao torneio
            </Link>
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 420, margin: '40px auto', padding: '0 16px' }}>
      <Card>
        <div className="h-1.5 -mx-4 -mt-4 mb-6 rounded-t-xl bg-gradient-to-r from-brand-500 to-brand-700" />
        <h2 className="text-lg font-semibold text-white mb-1">Criar conta para jogar</h2>
        <p className="text-slate-400 text-sm mb-6">
          Sem convite necessário. Só para participar do torneio.
        </p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Input label="Nome completo" value={form.full_name} onChange={set('full_name')} required />
          <Input label="Email" type="email" value={form.email} onChange={set('email')} required />
          <Input label="Senha" type="password" value={form.password} onChange={set('password')} required minLength={6} />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <Button type="submit" loading={loading} size="lg" className="w-full">Criar conta</Button>
        </form>
        <div className="mt-4 text-center text-sm text-slate-400">
          Já tem conta?{' '}
          <Link href={`/login?next=/t/${tournamentId}`} className="text-brand-400 hover:text-brand-300">
            Entrar
          </Link>
        </div>
      </Card>
    </div>
  )
}
```

- [ ] **Step 3: Verificar build**

```bash
npm run build 2>&1 | head -40
```

- [ ] **Step 4: Commit**

```bash
git add app/"(public)"/t/"[id]"/cadastrar/page.tsx app/"(public)"/t/"[id]"/cadastrar/TournamentSignupForm.tsx
git commit -m "feat: página /t/[id]/cadastrar para cadastro avulso sem convite"
```

---

### Task 8: Página pública — seção de pagamento + comprovante

**Files:**
- Modify: `app/(public)/t/[id]/page.tsx`
- Modify: `app/(public)/t/[id]/RegisterExternalButton.tsx`
- Create: `app/(public)/t/[id]/ReceiptUploadButton.tsx`

- [ ] **Step 1: Criar ReceiptUploadButton.tsx**

```tsx
// app/(public)/t/[id]/ReceiptUploadButton.tsx
'use client'
import { useState, useTransition } from 'react'
import { createClient } from '@/lib/supabase/client'
import { updateEntryReceipt } from '@/features/torneios/actions'

interface Props {
  tournamentId: string
  userId: string
  hasExistingReceipt: boolean
}

export function ReceiptUploadButton({ tournamentId, userId, hasExistingReceipt }: Props) {
  const [isPending, startTransition] = useTransition()
  const [uploaded, setUploaded] = useState(hasExistingReceipt)
  const [error, setError] = useState<string | null>(null)

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    startTransition(async () => {
      const supabase = createClient()
      const ext = file.name.split('.').pop() ?? 'jpg'
      const path = `${tournamentId}/${userId}/receipt.${ext}`
      const { error: upErr } = await supabase.storage
        .from('payment-receipts')
        .upload(path, file, { upsert: true })
      if (upErr) {
        setError('Erro ao enviar comprovante. Tente novamente.')
        return
      }
      const result = await updateEntryReceipt(tournamentId, path)
      if (result.error) setError(result.error)
      else setUploaded(true)
    })
  }

  if (uploaded) {
    return (
      <p className="text-green-400 text-sm font-medium">✓ Comprovante enviado</p>
    )
  }

  return (
    <div>
      <label className="cursor-pointer inline-block">
        <span
          className={`text-xs px-3 py-2 rounded-lg border border-surface-border text-slate-300 hover:border-brand-500 transition-colors ${isPending ? 'opacity-60' : ''}`}
          style={{ background: '#151e31' }}
        >
          {isPending ? 'Enviando...' : '📎 Anexar comprovante (opcional)'}
        </span>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={handleChange}
          disabled={isPending}
        />
      </label>
      {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
    </div>
  )
}
```

- [ ] **Step 2: Atualizar RegisterExternalButton para receber isPaid**

Substitua o conteúdo de `RegisterExternalButton.tsx`:

```tsx
// app/(public)/t/[id]/RegisterExternalButton.tsx
'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { registerExternal } from '@/features/torneios/actions'

interface Props {
  tournamentId: string
  isPaid: boolean
  finalPriceCents?: number
}

export function RegisterExternalButton({ tournamentId, isPaid, finalPriceCents }: Props) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  function handleRegister() {
    setError(null)
    startTransition(async () => {
      const result = await registerExternal(tournamentId)
      if (result.error) setError(result.error)
      else router.refresh()
    })
  }

  const label = isPaid
    ? `Confirmar inscrição${finalPriceCents !== undefined ? ` — R$ ${(finalPriceCents / 100).toFixed(2).replace('.', ',')}` : ''}`
    : 'Inscrever-se'

  return (
    <div>
      <button
        onClick={handleRegister}
        disabled={isPending}
        style={{ width: '100%' }}
        className="bg-gradient-to-r from-orange-600 to-orange-500 text-white border-none rounded-xl py-3 text-base font-semibold disabled:opacity-60 cursor-pointer hover:from-orange-500 hover:to-orange-400 transition-all"
      >
        {isPending ? 'Inscrevendo...' : label}
      </button>
      {error && <p className="text-xs text-red-400 mt-2 text-center">{error}</p>}
    </div>
  )
}
```

- [ ] **Step 3: Atualizar page.tsx da página pública**

**3a.** Adicionar import de `ReceiptUploadButton` no topo:

```tsx
import { ReceiptUploadButton } from './ReceiptUploadButton'
```

**3b.** Na query do torneio, adicionar `entry_price_cents, pix_key` ao select:

```tsx
  const { data: tournamentRaw } = await adminClient
    .from('tournaments')
    .select('id, name, date, sport, category, level, status, cover_image_url, winner1_id, winner2_id, winner3_id, entry_price_cents, pix_key')
    .eq('id', params.id)
    .not('status', 'eq', 'draft')
    .single()
```

**3c.** Atualizar o tipo `TRow`:

```tsx
  type TRow = {
    id: string; name: string; date: string; sport: string; category: string
    level: string; status: string; cover_image_url: string | null
    winner1_id: string | null; winner2_id: string | null; winner3_id: string | null
    entry_price_cents: number | null; pix_key: string | null
  }
```

**3d.** Após o bloco `let isRegistered = false`, adicionar busca do entry do usuário:

```tsx
  type UserEntryData = { payment_status: 'free' | 'pending' | 'paid'; receipt_url: string | null; final_price_cents: number; discount_pct: number } | null
  let userEntry: UserEntryData = null
  if (user && isRegistered) {
    const { data: entryRaw } = await adminClient
      .from('tournament_entries')
      .select('payment_status, receipt_url, final_price_cents, discount_pct')
      .eq('tournament_id', params.id)
      .eq('player_id', user.id)
      .single()
    userEntry = entryRaw as UserEntryData
  }
```

**3e.** Adicionar variáveis de pagamento antes do return:

```tsx
  const isPaid = (t.entry_price_cents ?? 0) > 0 && !!t.pix_key
  const formattedPrice = isPaid
    ? `R$ ${((t.entry_price_cents!) / 100).toFixed(2).replace('.', ',')}`
    : null
```

**3f.** Substituir o bloco `{/* CTA de inscrição */}` inteiro:

```tsx
      {/* CTA de inscrição */}
      {isOpen && (
        <div className="mx-3 mt-3 bg-surface-card border border-surface-border rounded-xl p-4 space-y-3">
          {/* Preço e desconto */}
          {isPaid && !isRegistered && (
            <div>
              {userEntry === null && (
                <div className="flex items-baseline gap-2 mb-1">
                  <span className="text-white text-2xl font-bold">{formattedPrice}</span>
                </div>
              )}
              <div className="bg-surface rounded-lg px-3 py-2 mt-2">
                <p className="text-slate-400 text-xs font-semibold uppercase tracking-wide mb-0.5">Chave PIX</p>
                <p className="text-white text-sm font-mono break-all">{t.pix_key}</p>
              </div>
            </div>
          )}

          {isRegistered && userEntry ? (
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
        </div>
      )}
```

- [ ] **Step 4: Verificar build**

```bash
npm run build 2>&1 | head -40
```

Esperado: sem erros.

- [ ] **Step 5: Commit**

```bash
git add app/"(public)"/t/"[id]"/page.tsx app/"(public)"/t/"[id]"/RegisterExternalButton.tsx app/"(public)"/t/"[id]"/ReceiptUploadButton.tsx
git commit -m "feat: página pública com preço PIX, comprovante e link cadastro avulso"
```

---

### Task 9: Admin — badges de pagamento + botão confirmar + receipts

**Files:**
- Create: `app/(admin)/admin/torneios/[id]/ConfirmPaymentButton.tsx`
- Modify: `app/(admin)/admin/torneios/[id]/page.tsx`

- [ ] **Step 1: Criar ConfirmPaymentButton.tsx**

```tsx
// app/(admin)/admin/torneios/[id]/ConfirmPaymentButton.tsx
'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { confirmEntryPayment } from '@/features/torneios/actions'

export function ConfirmPaymentButton({ entryId }: { entryId: string }) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  function handleConfirm() {
    setError(null)
    startTransition(async () => {
      const result = await confirmEntryPayment(entryId)
      if (result.error) setError(result.error)
      else router.refresh()
    })
  }

  return (
    <div>
      <button
        onClick={handleConfirm}
        disabled={isPending}
        className="text-xs bg-green-700 hover:bg-green-600 text-white px-3 py-1.5 rounded-lg disabled:opacity-60 transition-colors"
      >
        {isPending ? 'Confirmando...' : '✓ Confirmar pagamento'}
      </button>
      {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
    </div>
  )
}
```

- [ ] **Step 2: Atualizar query de entries na página admin**

No arquivo `app/(admin)/admin/torneios/[id]/page.tsx`, localizar a query de `entriesRaw` e adicionar os campos de pagamento ao select:

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

- [ ] **Step 3: Atualizar o tipo `EntryRow` na página admin**

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

- [ ] **Step 4: Gerar signed URLs para receipts (após buscar entries)**

Após o bloco de `entries`, adicionar:

```ts
  // Signed URLs para comprovantes (válidas por 5 min)
  const receiptSignedUrls: Record<string, string> = {}
  for (const entry of entries) {
    if (entry.receipt_url) {
      const { data: signed } = await adminClient.storage
        .from('payment-receipts')
        .createSignedUrl(entry.receipt_url as string, 300)
      if (signed?.signedUrl) receiptSignedUrls[entry.id] = signed.signedUrl
    }
  }
```

- [ ] **Step 5: Adicionar imports no topo da página admin**

```tsx
import { ConfirmPaymentButton } from './ConfirmPaymentButton'
```

- [ ] **Step 6: Atualizar o card de cada entry no bloco "Inscrições"**

Localizar o bloco `.map((entry) => {...})` dentro da seção de inscrições e substituir o conteúdo do Card:

```tsx
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
                  <div className="mt-2">
                    <ConfirmPaymentButton entryId={entry.id} />
                  </div>
                )}
              </Card>
```

- [ ] **Step 7: Verificar build**

```bash
npm run build 2>&1 | head -40
```

- [ ] **Step 8: Commit**

```bash
git add app/"(admin)"/admin/torneios/"[id]"/ConfirmPaymentButton.tsx app/"(admin)"/admin/torneios/"[id]"/page.tsx
git commit -m "feat: admin torneio com badges de pagamento, comprovantes e botão confirmar"
```

---

### Task 10: CreateTournamentForm — campos preço + PIX

**Files:**
- Modify: `app/(admin)/admin/torneios/CreateTournamentForm.tsx`

- [ ] **Step 1: Adicionar estado para preço e PIX key**

No bloco de `useState`, após `const [coverFile, setCoverFile] = useState<File | null>(null)`:

```tsx
  const [entryPrice, setEntryPrice] = useState<string>('')
  const [pixKey, setPixKey] = useState<string>('')
```

- [ ] **Step 2: Atualizar handleSubmit para passar os novos campos**

No bloco `startTransition(async () => {`, antes de `const result = await createTournament(...)`, adicionar:

```tsx
      const entryPriceCents = entryPrice.trim()
        ? Math.round(parseFloat(entryPrice.replace(',', '.')) * 100)
        : null
```

E atualizar a chamada de `createTournament`:

```tsx
      const result = await createTournament({
        name: name.trim(),
        date,
        sport,
        category,
        participant_type: participantType,
        format,
        level,
        scoring: { sets_to_win: 1, games_per_set: gamesPerSet, tiebreak_games: true },
        cover_image_url: coverImageUrl,
        entry_price_cents: entryPriceCents,
        pix_key: pixKey.trim() || null,
      })
```

Adicionar reset dos campos no bloco de sucesso (`else {`):

```tsx
        setEntryPrice('')
        setPixKey('')
```

- [ ] **Step 3: Adicionar campos no formulário (antes do campo de imagem de capa)**

Após o campo "Games por set", antes de `{/* Campo de imagem de capa */}`:

```tsx
      {/* Inscrição paga (opcional) */}
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-slate-300">Valor da inscrição (R$)</label>
        <input
          type="number"
          min="0"
          step="0.01"
          placeholder="0 = gratuito"
          value={entryPrice}
          onChange={(e) => setEntryPrice(e.target.value)}
          className="w-full rounded-lg bg-surface-card border border-surface-border px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-slate-300">Chave PIX</label>
        <input
          type="text"
          placeholder="Deixe vazio para torneio gratuito"
          value={pixKey}
          onChange={(e) => setPixKey(e.target.value)}
          className="w-full rounded-lg bg-surface-card border border-surface-border px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <p className="text-xs text-slate-500">CPF, email, telefone ou chave aleatória. Ambos os campos precisam ser preenchidos para cobrança.</p>
      </div>
```

- [ ] **Step 4: Verificar build**

```bash
npm run build 2>&1 | head -40
```

- [ ] **Step 5: Commit**

```bash
git add app/"(admin)"/admin/torneios/CreateTournamentForm.tsx
git commit -m "feat: CreateTournamentForm com campos de preço e chave PIX"
```

---

### Task 11: Configurações — seção de desconto de torneios

**Files:**
- Create: `app/(admin)/admin/configuracoes/TournamentDiscountForm.tsx`
- Modify: `app/(admin)/admin/configuracoes/page.tsx`

- [ ] **Step 1: Criar TournamentDiscountForm.tsx**

```tsx
// app/(admin)/admin/configuracoes/TournamentDiscountForm.tsx
'use client'
import { useState, useTransition } from 'react'
import { updateTournamentDiscountSettings } from '@/features/torneios/actions'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'

interface Props {
  discount2Pct: number
  discount3Pct: number
}

export function TournamentDiscountForm({ discount2Pct, discount3Pct }: Props) {
  const [d2, setD2] = useState(discount2Pct)
  const [d3, setD3] = useState(discount3Pct)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [isPending, startTransition] = useTransition()

  const selectClass = 'w-full rounded-lg bg-surface-card border border-surface-border px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-brand-500'

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSaved(false)
    startTransition(async () => {
      const result = await updateTournamentDiscountSettings(d2, d3)
      if (result.error) setError(result.error)
      else setSaved(true)
    })
  }

  return (
    <Card>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-slate-300">Desconto 2º torneio (%)</label>
            <select value={d2} onChange={(e) => setD2(Number(e.target.value))} className={selectClass}>
              {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50].map((v) => (
                <option key={v} value={v}>{v}%</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-slate-300">Desconto 3º+ torneio (%)</label>
            <select value={d3} onChange={(e) => setD3(Number(e.target.value))} className={selectClass}>
              {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50].map((v) => (
                <option key={v} value={v}>{v}%</option>
              ))}
            </select>
          </div>
        </div>
        <p className="text-xs text-slate-500">
          Aplicado quando o jogador se inscreve em múltiplos torneios pagos na mesma semana (seg–dom).
        </p>
        {error && <p className="text-xs text-red-400">{error}</p>}
        {saved && <p className="text-xs text-green-400">✓ Configuração salva</p>}
        <Button type="submit" loading={isPending} size="sm">Salvar</Button>
      </form>
    </Card>
  )
}
```

- [ ] **Step 2: Atualizar page.tsx de configurações**

Adicionar import no topo:

```tsx
import { TournamentDiscountForm } from './TournamentDiscountForm'
```

Na query de `orgRow`, adicionar os campos de desconto ao select:

```tsx
  const { data: orgRow } = await adminClient
    .from('organizations')
    .select('name, brand_color, logo_url, is_listed, cep, state, city, neighborhood, address_line, address_number, no_number, sports, whatsapp, tournament_discount_2_pct, tournament_discount_3_pct')
    .eq('id', orgId)
    .single()
```

Atualizar o tipo de `org` para incluir os novos campos:

```tsx
  const org = (orgRow ?? {}) as {
    name?: string | null
    brand_color?: string | null
    logo_url?: string | null
    is_listed?: boolean
    cep?: string | null
    state?: string | null
    city?: string | null
    neighborhood?: string | null
    address_line?: string | null
    address_number?: string | null
    no_number?: boolean
    sports?: string[] | null
    whatsapp?: string | null
    tournament_discount_2_pct?: number | null
    tournament_discount_3_pct?: number | null
  }
```

No return JSX, adicionar nova seção após `<VitrineForm .../>`:

```tsx
      <div>
        <h2 className="text-lg font-bold text-white">Torneios</h2>
        <p className="text-slate-400 text-sm mt-1">
          Desconto progressivo para inscrições múltiplas na mesma semana.
        </p>
      </div>
      <TournamentDiscountForm
        discount2Pct={org.tournament_discount_2_pct ?? 30}
        discount3Pct={org.tournament_discount_3_pct ?? 50}
      />
```

- [ ] **Step 3: Verificar build**

```bash
npm run build 2>&1 | head -40
```

- [ ] **Step 4: Commit**

```bash
git add app/"(admin)"/admin/configuracoes/TournamentDiscountForm.tsx app/"(admin)"/admin/configuracoes/page.tsx
git commit -m "feat: seção de desconto de torneios em Configurações"
```

---

### Task 12: Verificação final

**Files:** nenhum arquivo novo

- [ ] **Step 1: Rodar todos os testes**

```bash
npm run test:run
```

Esperado: PASS em todos (incluindo 10 novos testes de weekHelpers + entryDiscount).

- [ ] **Step 2: Build completo**

```bash
npm run build
```

Esperado: Build concluído sem erros.

- [ ] **Step 3: Verificar que não há referências quebradas**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Esperado: sem erros de tipo.

- [ ] **Step 4: Confirmar migrações estão listadas**

```bash
ls supabase/migrations/ | grep 20260630
```

Esperado:
```
20260630000100_tournament_entry_payment.sql
20260630000200_payment_receipts_bucket.sql
```

- [ ] **Step 5: Push para origin**

```bash
git push origin main
```

- [ ] **Step 6: Instruções para o usuário aplicar as migrations**

Aplicar no Supabase SQL Editor nesta ordem:

1. `supabase/migrations/20260630000100_tournament_entry_payment.sql`
2. `supabase/migrations/20260630000200_payment_receipts_bucket.sql`

---

## Checklist de cobertura do spec

| Requisito | Tarefa |
|---|---|
| `entry_price_cents` + `pix_key` em tournaments | Task 1, 3, 10 |
| `payment_status`, `discount_pct`, `final_price_cents`, `receipt_url` em entries | Task 1, 3 |
| `tournament_discount_2_pct`, `tournament_discount_3_pct` em organizations | Task 1, 3 |
| Bucket `payment-receipts` com policies | Task 2 |
| `computeEntryDiscount` + `applyDiscount` (TDD) | Task 4 |
| `getWeekBounds` BRT Mon-Sun (TDD) | Task 4 |
| `registerExternal` com desconto | Task 5 |
| `registerForTournament` com desconto | Task 5 |
| `confirmEntryPayment` | Task 5 |
| `updateEntryReceipt` | Task 5 |
| `removeEntry` com reversal | Task 6 |
| `updateTournamentDiscountSettings` | Task 6 |
| Cadastro avulso `/t/[id]/cadastrar` | Task 7 |
| Página pública: preço + PIX + comprovante + link cadastro | Task 8 |
| Admin: badges + comprovante (signed URL) + confirmar pagamento | Task 9 |
| CreateTournamentForm com preço + PIX | Task 10 |
| Configurações: desconto torneios | Task 11 |
