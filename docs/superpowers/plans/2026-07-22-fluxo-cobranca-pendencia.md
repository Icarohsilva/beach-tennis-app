# Fluxo de cobrança e pendência — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar o ciclo da dívida criada na Spec 1 — aluno vê e quita (Mercado Pago ou PIX+comprovante), admin vê quem deve, cobra e dá baixa.

**Architecture:** Migration aditiva em `payments` (comprovante + auditoria da baixa). Regra de bloqueio vira lógica pura testável (`lib/utils/debtRules.ts`) consumida pelo caller de `resolveClassAccess`. Comprovante reusa o bucket `payment-receipts` dos torneios (a convenção de path faz a RLS existente cobrir). Webhook do MP ganha um branch para quitar dívida SEM conceder crédito.

**Tech Stack:** Next.js 14 App Router, TypeScript, Supabase, Vitest. Spec: [docs/superpowers/specs/2026-07-22-fluxo-cobranca-pendencia-design.md](../specs/2026-07-22-fluxo-cobranca-pendencia-design.md).

**Ambiente:** usar o **PowerShell tool** para `npm run test:run` / `build` / `lint` (o Bash tool quebra o worker pool do Vitest nesta máquina).

---

## Descoberta que muda o desenho (verificada no código, não assumida)

O branch `per_class` do webhook (`app/api/webhooks/mercadopago/checkoutHandlers.ts:72`) chama `record_checkout_credit_purchase`, que **marca pago E concede crédito**. Isso é correto para *compra de créditos* (`buySingleClassCredits`), mas seria **errado para quitar dívida** — o aluno ganharia crédito que não comprou.

Distinção entre os dois casos, ambos `type='per_class'`:

| | `session_id` | `credits_qty` |
|---|---|---|
| Compra de créditos | `null` | 1..20 |
| **Dívida de aula** | **não nulo** | `null` |

Por isso a Task 4 adiciona um branch por `session_id`, e precisa incluir `session_id` no `select` da linha 45 (hoje ausente).

---

## File Structure

**Create:**
- `supabase/migrations/20260722000000_payment_receipt_and_settlement.sql`
- `lib/utils/debtRules.ts` (+ `.test.ts`) — lógica pura de bloqueio/agregação
- `features/financeiro/debtQueries.ts` (+ `.test.ts`) — agregação de devedores por aluno
- `features/financeiro/debtActions.ts` — server actions (aluno + admin)
- `app/(admin)/admin/financeiro/cobranca/page.tsx`
- `app/(admin)/admin/financeiro/cobranca/DebtorRow.tsx`
- `app/(admin)/admin/financeiro/cobranca/ChargeButton.tsx`
- `features/financeiro/DebtSection.tsx` — bloco do aluno (server)
- `features/financeiro/DebtReceiptUpload.tsx` — upload do comprovante (client)
- `features/financeiro/PayDebtButton.tsx` — checkout MP (client)

**Modify:**
- `features/aulas/actions.ts` — cálculo de `hasOpenDebt`
- `app/api/webhooks/mercadopago/checkoutHandlers.ts` — branch de dívida
- `app/(admin)/admin/financeiro/page.tsx` — card Inadimplentes soma os dois
- `app/(admin)/admin/financeiro/FinanceiroSubnav.tsx` — aba Cobrança
- `app/(admin)/admin/configuracoes/page.tsx` + novo form — pix/carência
- `features/financeiro/actions.ts` — `updateSystemSettings` aceita as chaves novas
- `app/(dashboard)/financeiro/page.tsx` — bloco de pendência do aluno

**Limitação conhecida do v1 (documentar, não resolver):** pagamento e comprovante são **por pendência** (o `external_reference` do MP mapeia 1:1 com uma linha de `payments`, e o path do comprovante é `{payment_id}/...`). Quitar várias de uma vez existe só no lado do admin ("quitar todas"). Consolidar N pendências num pagamento só é follow-up.

---

### Task 1: Migration — comprovante e auditoria da baixa

**Files:** Create `supabase/migrations/20260722000000_payment_receipt_and_settlement.sql`

- [ ] **Step 1: Escrever a migration**

```sql
-- supabase/migrations/20260722000000_payment_receipt_and_settlement.sql
-- Comprovante PIX + auditoria da baixa manual (spec 2026-07-22 §1).
-- Aditiva: nenhum enum alterado. "Aguardando confirmação" é estado DERIVADO
-- (status='pending' AND receipt_url is not null), justamente para não precisar
-- de `alter type payment_status add value` (que exige statement isolado e já
-- causou problema neste projeto).
-- settled_method: como a pendência foi quitada. Baixa manual do admin usa
-- 'dinheiro' | 'pix' | 'maquininha' | 'outro'; a baixa automática do webhook
-- grava 'mercadopago'. settled_by fica null na automática (não houve admin).
alter table payments
  add column if not exists receipt_url text,
  add column if not exists receipt_uploaded_at timestamptz,
  add column if not exists settled_by uuid references profiles(id),
  add column if not exists settled_method text;

-- Devedores por academia: pendências de aula (session_id não nulo) com valor.
create index if not exists idx_payments_org_pending_session
  on payments (organization_id, status, session_id)
  where status = 'pending' and session_id is not null;
```

- [ ] **Step 2: Verify (não aplicar)**

Run: `node -e "const s=require('fs').readFileSync('supabase/migrations/20260722000000_payment_receipt_and_settlement.sql','utf8'); ['receipt_url','receipt_uploaded_at','settled_by','settled_method'].forEach(c=>{if(!s.includes(c))throw new Error('faltou '+c)}); console.log('ok')"`
Expected: `ok`

**NÃO aplicar** — migrations neste projeto são aplicadas manualmente pelo usuário.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260722000000_payment_receipt_and_settlement.sql
git commit -m "feat(db): comprovante e auditoria de baixa em payments"
```

---

### Task 2: Lógica pura de dívida

**Files:** Create `lib/utils/debtRules.ts`, `lib/utils/debtRules.test.ts`

- [ ] **Step 1: Test**

```ts
// lib/utils/debtRules.test.ts
import { describe, it, expect } from 'vitest'
import { isBlockingDebt, summarizeDebts, type DebtRow } from './debtRules'

const NOW = new Date('2026-07-22T12:00:00Z')
const row = (over: Partial<DebtRow> = {}): DebtRow => ({
  id: 'p1', amount: 30, createdAt: '2026-07-01T10:00:00Z', receiptUrl: null, ...over,
})

describe('isBlockingDebt', () => {
  it('R$ 0 nunca bloqueia (academia sem preço configurado)', () => {
    expect(isBlockingDebt(row({ amount: 0 }), 7, NOW)).toBe(false)
  })
  it('dentro da carência não bloqueia', () => {
    expect(isBlockingDebt(row({ createdAt: '2026-07-20T10:00:00Z' }), 7, NOW)).toBe(false)
  })
  it('passada a carência, com valor, bloqueia', () => {
    expect(isBlockingDebt(row({ createdAt: '2026-07-01T10:00:00Z' }), 7, NOW)).toBe(true)
  })
  it('carência 0 bloqueia na hora', () => {
    expect(isBlockingDebt(row({ createdAt: '2026-07-22T09:00:00Z' }), 0, NOW)).toBe(true)
  })
  it('comprovante enviado NÃO desbloqueia (só a baixa do admin)', () => {
    expect(isBlockingDebt(row({ receiptUrl: 'p1/u1/receipt.jpg' }), 7, NOW)).toBe(true)
  })
})

describe('summarizeDebts', () => {
  it('soma total, conta e acha a mais antiga', () => {
    const s = summarizeDebts(
      [row({ id: 'a', amount: 30, createdAt: '2026-07-01T10:00:00Z' }),
       row({ id: 'b', amount: 20, createdAt: '2026-07-10T10:00:00Z' })],
      7, NOW,
    )
    expect(s.total).toBe(50)
    expect(s.count).toBe(2)
    expect(s.oldestAt).toBe('2026-07-01T10:00:00Z')
    expect(s.isBlocked).toBe(true)
  })
  it('só pendências dentro da carência → não bloqueado', () => {
    const s = summarizeDebts([row({ createdAt: '2026-07-21T10:00:00Z' })], 7, NOW)
    expect(s.isBlocked).toBe(false)
    expect(s.total).toBe(30)
  })
  it('marca aguardando conferência quando há comprovante', () => {
    const s = summarizeDebts([row({ receiptUrl: 'x' })], 7, NOW)
    expect(s.awaitingReview).toBe(1)
  })
  it('lista vazia', () => {
    const s = summarizeDebts([], 7, NOW)
    expect(s).toEqual({ total: 0, count: 0, oldestAt: null, isBlocked: false, awaitingReview: 0 })
  })
})
```

- [ ] **Step 2: Rodar (falha)** — `npm run test:run -- lib/utils/debtRules.test.ts` → FAIL

- [ ] **Step 3: Implementar**

```ts
// lib/utils/debtRules.ts
// Puro: decide o que bloqueia e resume a dívida do aluno (spec 2026-07-22 §2).
// Bloqueio exige TRÊS coisas — ter valor, ter passado a carência, e a pendência
// ser de aula. O filtro por aula (session_id) fica na query; aqui entram só as
// linhas já filtradas.

export interface DebtRow {
  id: string
  amount: number
  createdAt: string // ISO
  receiptUrl: string | null
}

export interface DebtSummary {
  total: number
  count: number
  oldestAt: string | null
  isBlocked: boolean
  /** Quantas já têm comprovante aguardando conferência do admin. */
  awaitingReview: number
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Uma pendência bloqueia quando tem valor E já passou a carência.
 *
 * `amount > 0` conserta um furo real: ensureClassDebt grava amount 0 quando a
 * academia não configurou single_class_price — como o bloqueio olhava só
 * existência, essas dívidas de R$ 0 travavam o aluno para sempre.
 *
 * Comprovante enviado NÃO desbloqueia (decisão do usuário): só a baixa do admin.
 */
export function isBlockingDebt(debt: DebtRow, graceDays: number, now: Date): boolean {
  if (debt.amount <= 0) return false
  const graceEndsAt = new Date(debt.createdAt).getTime() + graceDays * DAY_MS
  return now.getTime() >= graceEndsAt
}

export function summarizeDebts(debts: DebtRow[], graceDays: number, now: Date): DebtSummary {
  if (debts.length === 0) {
    return { total: 0, count: 0, oldestAt: null, isBlocked: false, awaitingReview: 0 }
  }
  let total = 0
  let oldestAt: string | null = null
  let isBlocked = false
  let awaitingReview = 0
  for (const d of debts) {
    total += d.amount
    if (oldestAt === null || d.createdAt < oldestAt) oldestAt = d.createdAt
    if (isBlockingDebt(d, graceDays, now)) isBlocked = true
    if (d.receiptUrl) awaitingReview++
  }
  return { total: Math.round(total * 100) / 100, count: debts.length, oldestAt, isBlocked, awaitingReview }
}
```

- [ ] **Step 4: Rodar (passa)** e **Step 5: Commit**

```bash
git add lib/utils/debtRules.ts lib/utils/debtRules.test.ts
git commit -m "feat(cobranca): logica pura de bloqueio e resumo de divida"
```

---

### Task 3: Bloqueio usa a regra nova (corrige o R$ 0)

**Files:** Modify `features/aulas/actions.ts`

Hoje (`features/aulas/actions.ts:188-200`) o cálculo é `count` de pendentes com `session_id` não nulo — qualquer uma bloqueia, inclusive R$ 0.

- [ ] **Step 1: Trocar o cálculo**

Substituir o bloco do `debtCount` por:

```ts
  // Dívida aberta = payments pendente COM session_id. O filtro de session_id é
  // essencial: compra de crédito abandonada no checkout também fica 'pending',
  // mas com session_id null — sem o filtro ela bloquearia o aluno para sempre
  // (spec §4). Desde 2026-07-22, ter pendência não basta: precisa ter valor e
  // ter passado a carência (spec cobrança §2) — senão uma dívida de R$ 0
  // (academia sem preço configurado) travava o aluno indefinidamente.
  const { data: debtRows } = await adminClient
    .from('payments')
    .select('id, amount, created_at, receipt_url')
    .eq('student_id', user.id)
    .eq('organization_id', orgId)
    .eq('status', 'pending')
    .not('session_id', 'is', null)

  const graceDays = await getDebtGraceDays(adminClient, orgId)
  const debtSummary = summarizeDebts(
    ((debtRows ?? []) as { id: string; amount: number; created_at: string; receipt_url: string | null }[])
      .map((r) => ({ id: r.id, amount: Number(r.amount), createdAt: r.created_at, receiptUrl: r.receipt_url })),
    graceDays,
    new Date(),
  )

  const decision = resolveClassAccess({
    partner: profile.partner,
    hasActivePlan,
    creditsBalance: profile.credits_balance,
    hasOpenDebt: debtSummary.isBlocked,
  })
```

Imports a adicionar no topo do arquivo:
```ts
import { summarizeDebts } from '@/lib/utils/debtRules'
import { getDebtGraceDays } from '@/features/financeiro/debtQueries'
```

`resolveClassAccess` **não muda** — continua puro, recebendo um booleano.

- [ ] **Step 2: Mensagem com rota de saída**

No `if ('denied' in decision)` logo abaixo, quando o motivo for `blocked_by_debt`, retornar mensagem que diz o valor e para onde ir:

```ts
      error: `Você tem R$ ${debtSummary.total.toFixed(2).replace('.', ',')} em aberto. Regularize em Financeiro para voltar a agendar.`,
```

(manter o resto do tratamento de `denied` como está)

- [ ] **Step 3: Verify** — `npm run build`, `npm run test:run` (PowerShell). Nenhum teste existente deve quebrar: `accessRules.test.ts` testa a função pura, que não mudou.

- [ ] **Step 4: Commit**

```bash
git add features/aulas/actions.ts
git commit -m "fix(cobranca): divida so bloqueia com valor e apos a carencia"
```

---

### Task 4: Webhook do MP quita dívida SEM conceder crédito

**Files:** Modify `app/api/webhooks/mercadopago/checkoutHandlers.ts`

- [ ] **Step 1: Incluir `session_id` no select**

Na query da linha ~45, adicionar `session_id`:

```ts
    .select('id, organization_id, student_id, status, type, amount, credits_qty, dayuse_booking_id, session_id')
```

E adicionar `session_id: string | null` ao tipo `PaymentRow`.

- [ ] **Step 2: Branch de dívida ANTES do branch de compra de crédito**

Inserir imediatamente antes do `if (pay.type === 'per_class')` existente:

```ts
  // Quitação de DÍVIDA de aula (session_id não nulo) — distinta da COMPRA de
  // créditos, que também é type='per_class' mas tem session_id null e
  // credits_qty preenchido. Aqui NÃO se concede crédito: o aluno está pagando
  // uma aula que já assistiu. Usar o record_checkout_credit_purchase daqui
  // daria crédito que ele não comprou.
  if (pay.type === 'per_class' && pay.session_id) {
    const { error: updErr } = await admin
      .from('payments')
      .update({
        status: 'paid',
        paid_at: new Date().toISOString(),
        gateway_payment_id: gatewayPaymentId,
        settled_method: 'mercadopago',
      })
      .eq('id', pay.id)
      .eq('status', 'pending') // idempotente: reentrega do MP não reescreve
    if (updErr) {
      throw new Error(`[webhook/mp] baixa de divida falhou: ${updErr.message}`)
    }
    return
  }
```

- [ ] **Step 3: Verify** — `npm run build`, `npm run test:run` (PowerShell).

- [ ] **Step 4: Commit**

```bash
git add app/api/webhooks/mercadopago/checkoutHandlers.ts
git commit -m "fix(cobranca): webhook quita divida sem conceder credito"
```

---

### Task 5: Configuração (PIX + carência)

**Files:** Modify `features/financeiro/actions.ts`, `app/(admin)/admin/configuracoes/page.tsx`; Create `app/(admin)/admin/configuracoes/CobrancaForm.tsx`

- [ ] **Step 1: `updateSystemSettings` aceita as chaves novas**

Em `features/financeiro/actions.ts`, estender o tipo do parâmetro com `pix_key?: string`, `pix_key_owner?: string`, `debt_block_grace_days?: number`, e validar: `debt_block_grace_days` inteiro 0..90. O restante da serialização (`String(value)`) já funciona.

- [ ] **Step 2: `CobrancaForm.tsx`**

Client component no mesmo padrão do `GridAutoForm.tsx` (ler para copiar o estilo: `Card`, `useState`/`useTransition`, banners de erro/sucesso, `SELECT_CLS`): campos **Chave PIX** (texto), **Nome do beneficiário** (texto) e **Carência antes de bloquear (dias)** (number, 0..90, padrão 7).

- [ ] **Step 3: Renderizar na página de configurações**

Ler `pix_key`, `pix_key_owner`, `debt_block_grace_days` do `map` de settings (padrões `''`, `''`, `7`) e renderizar `<CobrancaForm settings={...} />` abaixo do `<GridAutoForm>`.

- [ ] **Step 4: Verify + Commit**

```bash
git add features/financeiro/actions.ts "app/(admin)/admin/configuracoes/CobrancaForm.tsx" "app/(admin)/admin/configuracoes/page.tsx"
git commit -m "feat(cobranca): config de chave PIX e carencia de bloqueio"
```

---

### Task 6: Consultas de dívida (agregação por aluno)

**Files:** Create `features/financeiro/debtQueries.ts`, `features/financeiro/debtQueries.test.ts`

- [ ] **Step 1: Implementar**

```ts
// features/financeiro/debtQueries.ts
// Consultas de dívida compartilhadas: o cálculo de bloqueio (features/aulas),
// a tela de cobrança do admin e o bloco do aluno leem daqui.
import type { createAdminClient } from '@/lib/supabase/server'
import { summarizeDebts, type DebtRow, type DebtSummary } from '@/lib/utils/debtRules'

type AdminClient = ReturnType<typeof createAdminClient>

export const DEFAULT_GRACE_DAYS = 7

/** Carência configurada da academia (system_settings), com padrão seguro. */
export async function getDebtGraceDays(client: AdminClient, orgId: string): Promise<number> {
  const { data } = await client
    .from('system_settings')
    .select('value')
    .eq('organization_id', orgId)
    .eq('key', 'debt_block_grace_days')
    .maybeSingle()
  const n = Number((data as { value: string } | null)?.value)
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_GRACE_DAYS
}

export interface DebtorRow {
  studentId: string
  fullName: string
  summary: DebtSummary
  debts: (DebtRow & { sessionDate: string | null })[]
}

/** Devedores de aula avulsa da academia, agregados por aluno. */
export async function getOrgDebtors(client: AdminClient, orgId: string): Promise<DebtorRow[]> {
  const { data: rowsRaw } = await client
    .from('payments')
    .select('id, student_id, amount, created_at, receipt_url, session_id, class_sessions(session_date)')
    .eq('organization_id', orgId)
    .eq('status', 'pending')
    .not('session_id', 'is', null)
    .order('created_at', { ascending: true })

  type Row = {
    id: string; student_id: string; amount: number; created_at: string
    receipt_url: string | null
    class_sessions: { session_date: string } | { session_date: string }[] | null
  }
  const rows = (rowsRaw ?? []) as unknown as Row[]
  if (rows.length === 0) return []

  const graceDays = await getDebtGraceDays(client, orgId)
  const now = new Date()

  const ids = Array.from(new Set(rows.map((r) => r.student_id)))
  const { data: profs } = await client.from('profiles').select('id, full_name').in('id', ids)
  const nameById = new Map(
    ((profs ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name]),
  )

  const byStudent = new Map<string, (DebtRow & { sessionDate: string | null })[]>()
  for (const r of rows) {
    const cls = Array.isArray(r.class_sessions) ? r.class_sessions[0] : r.class_sessions
    const list = byStudent.get(r.student_id) ?? []
    list.push({
      id: r.id,
      amount: Number(r.amount),
      createdAt: r.created_at,
      receiptUrl: r.receipt_url,
      sessionDate: cls?.session_date ?? null,
    })
    byStudent.set(r.student_id, list)
  }

  return Array.from(byStudent.entries())
    .map(([studentId, debts]) => ({
      studentId,
      fullName: nameById.get(studentId) ?? 'Aluno',
      summary: summarizeDebts(debts, graceDays, now),
      debts,
    }))
    // Aguardando conferência primeiro (o admin precisa agir), depois maior dívida.
    .sort((a, b) =>
      b.summary.awaitingReview - a.summary.awaitingReview || b.summary.total - a.summary.total,
    )
}
```

- [ ] **Step 2: Test** — fake client no padrão de `enrollmentRoster.test.ts`: cobrir agregação por aluno, ordenação (aguardando conferência primeiro), e `getDebtGraceDays` caindo no padrão quando a chave não existe ou é inválida.

- [ ] **Step 3: Verify + Commit**

```bash
git add features/financeiro/debtQueries.ts features/financeiro/debtQueries.test.ts
git commit -m "feat(cobranca): consultas de devedores agregadas por aluno"
```

---

### Task 7: Server actions da cobrança

**Files:** Create `features/financeiro/debtActions.ts`

- [ ] **Step 1: Implementar as actions**

Arquivo `'use server'` com:

- `markDebtPaid(paymentId: string, method: string)` — admin-only (`requireOwner()`); valida `method` em `['dinheiro','pix','maquininha','outro']`; update `status='paid'`, `paid_at`, `settled_by` (admin logado), `settled_method`; escopado por `organization_id`; `revalidatePath('/admin/financeiro/cobranca')`.
- `markAllDebtsPaid(studentId: string, method: string)` — mesma coisa para todas as pendências de aula do aluno naquela org.
- `approveDebtReceipt(paymentId: string)` — atalho: chama a mesma baixa com `settled_method='pix'`.
- `rejectDebtReceipt(paymentId: string, reason: string)` — limpa `receipt_url`/`receipt_uploaded_at` e **notifica o aluno** (`notifyUsers`, canais `['inapp','push']`) com o motivo. Sem isso o aluno não entende por que segue bloqueado.
- `chargeDebt(studentId: string, channels: NotificationChannel[])` — admin dispara a cobrança: monta a mensagem com nome da academia + total em aberto e chama `notifyUsers`. Best-effort.
- `submitDebtReceipt(paymentId: string, receiptPath: string)` — **aluno**: valida que o path começa com `${paymentId}/` e que a pendência é dele e está `pending`; grava `receipt_url` + `receipt_uploaded_at`. Espelha `updateEntryReceipt` (`features/torneios/actions.ts:1233`), incluindo a validação de prefixo.
- `payDebtCheckout(paymentId: string)` — **aluno**: cria preferência MP para a pendência EXISTENTE (não insere linha nova — diferente de `buySingleClassCredits`), com `external_reference: paymentId`. Reusar `getConnectedMpToken`, `mpCreatePreference`, `computeMarketplaceFee`, `getSiteUrl` de `features/financeiro/checkoutActions.ts` (ler esse arquivo, linhas 174-251, para copiar o padrão exato de `notification_url`/`back_urls`/`marketplace_fee`).

- [ ] **Step 2: Verify + Commit**

```bash
git add features/financeiro/debtActions.ts
git commit -m "feat(cobranca): actions de baixa, comprovante, cobranca e checkout"
```

---

### Task 8: Tela de cobrança do admin

**Files:** Create `app/(admin)/admin/financeiro/cobranca/page.tsx`, `DebtorRow.tsx`, `ChargeButton.tsx`; Modify `FinanceiroSubnav.tsx`

- [ ] **Step 1: `page.tsx`** — server component, `requireOwner()`, duas seções:
  - **Aulas avulsas em aberto:** `getOrgDebtors()` → uma `DebtorRow` por aluno (nome, total, nº de aulas, mais antiga, situação: Em aberto / Bloqueado / Aguardando conferência).
  - **Assinaturas vencidas:** reusar o cálculo que já existe em `app/(admin)/admin/financeiro/page.tsx` (extrair para `debtQueries.ts` se ficar duplicado) + `ChargeButton`.
- [ ] **Step 2: `DebtorRow.tsx`** (client) — expande para as pendências individuais; ações **Dar baixa** (escolhe método), **Quitar todas**, **Ver comprovante** (link assinado do bucket privado; aprovar/rejeitar), **Cobrar**.
- [ ] **Step 3: `ChargeButton.tsx`** (client) — seleção de canais (in-app, e-mail, push, WhatsApp) e disparo via `chargeDebt`.
- [ ] **Step 4:** adicionar a aba "Cobrança" no `FinanceiroSubnav.tsx`.
- [ ] **Step 5: Verify + Commit**

```bash
git add "app/(admin)/admin/financeiro/cobranca" "app/(admin)/admin/financeiro/FinanceiroSubnav.tsx"
git commit -m "feat(cobranca): tela de cobranca do admin com baixa e disparo"
```

---

### Task 9: Card "Inadimplentes" soma os dois

**Files:** Modify `app/(admin)/admin/financeiro/page.tsx`

- [ ] **Step 1:** somar `getOrgDebtors().length` (devedores de aula) ao cálculo atual de assinaturas vencidas; o subtítulo passa a explicar as duas origens; o card vira link para `/admin/financeiro/cobranca`.
- [ ] **Step 2: Verify + Commit**

```bash
git add "app/(admin)/admin/financeiro/page.tsx"
git commit -m "feat(cobranca): card de inadimplentes soma aula avulsa e assinatura"
```

---

### Task 10: Aluno vê e quita

**Files:** Create `features/financeiro/DebtSection.tsx`, `DebtReceiptUpload.tsx`, `PayDebtButton.tsx`; Modify `app/(dashboard)/financeiro/page.tsx`

- [ ] **Step 1: `DebtSection.tsx`** (server) — lista as pendências do aluno com valor, data da aula e estado; mostra o resumo (`summarizeDebts`) e, se bloqueado, o aviso; se dentro da carência, "bloqueia em X dias".
- [ ] **Step 2: `PayDebtButton.tsx`** (client) — chama `payDebtCheckout(paymentId)` e redireciona para `initPoint`. Só renderiza se a academia tem MP conectado.
- [ ] **Step 3: `DebtReceiptUpload.tsx`** (client) — **espelhar `app/(public)/t/[id]/ReceiptUploadButton.tsx`**: mesmo bucket `payment-receipts`, mesmo mapa MIME→ext, `upsert: true`, path **`${paymentId}/${userId}/receipt.${ext}`** (a convenção que faz a RLS existente cobrir), depois chama `submitDebtReceipt`. Exibe a chave PIX (`pix_key`/`pix_key_owner`) e, após envio, "aguardando confirmação — você continua bloqueado até a academia conferir".
- [ ] **Step 4:** renderizar `<DebtSection />` no topo de `app/(dashboard)/financeiro/page.tsx`.
- [ ] **Step 5: Verify + Commit**

```bash
git add features/financeiro/DebtSection.tsx features/financeiro/DebtReceiptUpload.tsx features/financeiro/PayDebtButton.tsx "app/(dashboard)/financeiro/page.tsx"
git commit -m "feat(cobranca): aluno ve pendencia e quita por MP ou PIX"
```

---

### Task 11: Verificação end-to-end

- [ ] **Step 1:** `npm run test:run`, `npm run build`, `npm run lint` (PowerShell).
- [ ] **Step 2: Caçar regressão do bloqueio** — `grep -rn "hasOpenDebt" --include=*.ts features/ lib/` : o único lugar que calcula deve ser `features/aulas/actions.ts` (via `summarizeDebts`); `adminActions.ts` segue passando `false` de propósito (admin ignora bloqueio).
- [ ] **Step 3: Relatar** — o que foi verificado de fato. Não exercitar contra o banco (é produção). Lembrar o usuário: **aplicar a migration** desta spec + as 4 pendentes; **configurar `pix_key`** senão a trilha PIX não aparece.

---

## Ordem e dependências

```
1 (migration) ─┐
2 (debtRules) ─┼─ fundacionais
5 (config)    ─┘
3 (bloqueio) ── usa 2, 6(getDebtGraceDays)
4 (webhook)  ── independente
6 (queries)  ── usa 2
7 (actions)  ── usa 6
8 (tela admin) ── usa 6,7
9 (card)     ── usa 6
10 (aluno)   ── usa 6,7
11 (verificacao) ── todas
```

Nota: a Task 3 importa `getDebtGraceDays` da Task 6 — implementar a 6 antes da 3, ou criar o helper na 2. **Ordem sugerida: 1, 2, 6, 3, 4, 5, 7, 8, 9, 10, 11.**

## Cobertura do spec

| Spec § | Task |
|---|---|
| §1 modelo de dados / comprovante | 1, 10 |
| §2 regra de bloqueio | 2, 3 |
| §3 aluno vê e paga | 10 |
| §4 tela do admin | 8, 9 |
| §5 cobrança manual 4 canais | 7, 8 |
| §6 risco do webhook | 4 |
