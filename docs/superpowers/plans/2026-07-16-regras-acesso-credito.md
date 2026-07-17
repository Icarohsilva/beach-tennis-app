# Regras de Acesso e Crédito — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separar plano (= acesso ilimitado) de crédito (= pré-pagamento de aula avulsa), fazer a pendência financeira nascer na marcação de presença, ligar o check-in de parceiro a uma janela de ±1h, e implementar a expiração de crédito que hoje é só decorativa.

**Architecture:** Toda a decisão de negócio vive em funções puras testáveis (`accessRules`, `sessionWindow`, `creditLots`), e as server actions viram cascas finas que buscam dados, chamam a função pura e aplicam o resultado. A pendência reusa a tabela `payments` (`type='per_class'`, `status='pending'`, `session_id` preenchido) e é idempotente por índice único no banco, não por lógica de aplicação.

**Tech Stack:** Next.js 14 App Router · TypeScript · Supabase (Postgres + RLS) · Vitest · date-fns

**Spec:** [docs/superpowers/specs/2026-07-16-regras-acesso-credito-design.md](../specs/2026-07-16-regras-acesso-credito-design.md)

---

## Contexto para quem nunca viu este repo

Leia isto antes da Task 1. Cinco fatos que explicam por que as tasks são do jeito que são:

1. **`memberships` é a fonte da verdade por-academia.** Uma pessoa (`profiles`) pode estar em várias academias. Nível, saldo de crédito, papel, parceiro (`wellhub`/`totalpass`) — tudo vive em `memberships (user_id, organization_id)`. **Nunca** leia esses campos de `profiles`.
2. **Dois clients Supabase.** `createClient()` respeita RLS (use para saber quem é o usuário logado). `createAdminClient()` usa a service role e **ignora RLS** — por isso toda query com ele precisa de `.eq('organization_id', orgId)` explícito, senão vaza dados entre academias.
3. **`credits_balance` é cache.** A fonte da verdade é a tabela `credit_transactions`. Nunca faça `UPDATE memberships SET credits_balance` direto — sempre via a RPC `adjust_credits`, que atualiza saldo e grava a transação atomicamente.
4. **Fuso.** `session_date` é `YYYY-MM-DD` e `class.start_time` é `HH:MM:SS`, ambos em horário de Brasília. O servidor roda em UTC. Existe `sessionStartIso(sessionDate, startTime)` em `lib/utils/sessionTime.ts` que monta o instante correto ancorado em `-03:00` — **use sempre essa função**, nunca `new Date(session_date)`.
5. **Migrations são aplicadas pelo usuário.** Você escreve o `.sql` em `supabase/migrations/`; **não rode `supabase db push`** (o CLI não está autenticado neste ambiente). Ao terminar uma task com migration, avise que ela precisa ser aplicada.

**Comandos:**
- `npm run test:run -- caminho/do/arquivo.test.ts` — roda um teste
- `npm run lint` — ESLint
- `npm run build` — checa tipos

---

## Estrutura de arquivos

**Criar:**

| Arquivo | Responsabilidade |
|---|---|
| `lib/utils/accessRules.ts` | Pura. Decide se o aluno entra e a que custo. |
| `lib/utils/accessRules.test.ts` | Matriz de precedência. |
| `lib/checkin/sessionWindow.ts` | Pura. Casa um check-in à sessão dentro de ±1h. |
| `lib/checkin/sessionWindow.test.ts` | Bordas e fuso. |
| `lib/utils/creditLots.ts` | Pura. Replay FIFO do extrato → saldo válido e valor vencido. |
| `lib/utils/creditLots.test.ts` | Casos de lote. |
| `features/financeiro/classDebt.ts` | Cria a pendência na presença. Único ponto de escrita. |
| `features/financeiro/classDebt.test.ts` | Idempotência e supressões. |
| `app/api/cron/credit-expiry/route.ts` | Cron de expiração. |
| `features/aulas/AddStudentToSession.tsx` | UI: picker de aluno + seletor de motivo. |
| `supabase/migrations/20260716000100_access_rules_credit.sql` | Schema + desvinculação + notificação. |

**Modificar:**

| Arquivo | Mudança |
|---|---|
| `features/aulas/creditReconciliation.ts` | Remove toda lógica de crédito; vira só reserva. |
| `lib/utils/reconciliationOps.ts` | Remove `requiresCredit` e os campos de crédito de `ReconciliationOp`. |
| `features/aulas/adminActions.ts` | `enrollStudentInClass` exige plano/parceiro; nova action `addStudentToSession`. |
| `features/aulas/actions.ts` | `bookSession` usa `resolveClassAccess`; `markAttendance`/`markAttendanceBulk` chamam `ensureClassDebt`. |
| `lib/checkin/ingest.ts` | Janela ±1h, casamento por reserva, `ignoreDuplicates`. |
| `app/api/cron/monthly-credit-renewal/route.ts` | Deixa de renovar crédito. |
| `app/(admin)/admin/grade/page.tsx` | Alerta "sem crédito" → "sem plano ativo". |
| `app/(admin)/admin/grade/[sessionId]/page.tsx` | Alimenta o picker de adicionar aluno. |
| `vercel.json` | Registra o cron de expiração. |
| `types/index.ts` | Tipos novos. |

**Ordem:** Tasks 1–3 são funções puras sem dependência de nada (podem ir em paralelo). Task 4 é a migration. Tasks 5–12 dependem delas.

---

### Task 1: `accessRules` — a decisão de elegibilidade

**Files:**
- Create: `lib/utils/accessRules.ts`
- Test: `lib/utils/accessRules.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/utils/accessRules.test.ts
import { describe, it, expect } from 'vitest'
import { resolveClassAccess } from './accessRules'

const base = { partner: null, hasActivePlan: false, creditsBalance: 0, hasOpenDebt: false }

describe('resolveClassAccess', () => {
  it('bloqueia quem tem dívida aberta', () => {
    expect(resolveClassAccess({ ...base, hasOpenDebt: true })).toEqual({
      denied: 'blocked_by_debt',
    })
  })

  it('dívida bloqueia mesmo com plano ativo', () => {
    expect(
      resolveClassAccess({ ...base, hasOpenDebt: true, hasActivePlan: true }),
    ).toEqual({ denied: 'blocked_by_debt' })
  })

  it('dívida bloqueia mesmo com parceiro e crédito', () => {
    expect(
      resolveClassAccess({ ...base, hasOpenDebt: true, partner: 'wellhub', creditsBalance: 10 }),
    ).toEqual({ denied: 'blocked_by_debt' })
  })

  it('parceiro entra sem consumir nada', () => {
    expect(resolveClassAccess({ ...base, partner: 'wellhub' })).toEqual({ grant: 'partner' })
  })

  it('parceiro tem precedência sobre plano', () => {
    expect(
      resolveClassAccess({ ...base, partner: 'totalpass', hasActivePlan: true }),
    ).toEqual({ grant: 'partner' })
  })

  it('plano ativo entra sem consumir crédito, mesmo com saldo', () => {
    expect(
      resolveClassAccess({ ...base, hasActivePlan: true, creditsBalance: 5 }),
    ).toEqual({ grant: 'plan' })
  })

  it('sem plano e sem parceiro, com saldo, usa crédito', () => {
    expect(resolveClassAccess({ ...base, creditsBalance: 1 })).toEqual({ grant: 'credit' })
  })

  it('saldo zero gera dívida', () => {
    expect(resolveClassAccess({ ...base, creditsBalance: 0 })).toEqual({ grant: 'debt' })
  })

  it('saldo negativo gera dívida (defensivo: saldo nunca deveria ser < 0)', () => {
    expect(resolveClassAccess({ ...base, creditsBalance: -3 })).toEqual({ grant: 'debt' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- lib/utils/accessRules.test.ts`
Expected: FAIL — `Failed to resolve import "./accessRules"`

- [ ] **Step 3: Write the implementation**

```ts
// lib/utils/accessRules.ts
import type { CheckinPartner } from '@/types'

/** Como o aluno entra na aula e o que isso consome. */
export type AccessGrant =
  | 'partner' // Wellhub/TotalPass — não consome nada
  | 'plan' // assinatura vigente — não consome nada, ilimitado
  | 'credit' // debita 1 crédito na reserva
  | 'debt' // entra; pendência nasce se houver presença

export type AccessDenial = 'blocked_by_debt'

export type AccessDecision = { grant: AccessGrant } | { denied: AccessDenial }

export interface AccessInput {
  partner: CheckinPartner | null
  /** status='active' E período vigente (isSubscriptionCurrent). Ver spec §1. */
  hasActivePlan: boolean
  creditsBalance: number
  /** payments pendente com session_id não-nulo. Ver spec §4. */
  hasOpenDebt: boolean
}

/**
 * Decide o acesso do aluno a uma aula. Pura: toda busca fica no caller.
 *
 * A dívida bloqueia ANTES de tudo, inclusive quem tem plano: dívida trava o
 * aluno até a baixa. A única porta que ignora isso é a adição pelo admin, que
 * não passa por aqui.
 */
export function resolveClassAccess(input: AccessInput): AccessDecision {
  if (input.hasOpenDebt) return { denied: 'blocked_by_debt' }
  if (input.partner) return { grant: 'partner' }
  if (input.hasActivePlan) return { grant: 'plan' }
  if (input.creditsBalance >= 1) return { grant: 'credit' }
  return { grant: 'debt' }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- lib/utils/accessRules.test.ts`
Expected: PASS — 9 passed

- [ ] **Step 5: Commit**

```bash
git add lib/utils/accessRules.ts lib/utils/accessRules.test.ts
git commit -m "feat(acesso): resolveClassAccess decide elegibilidade de entrada em aula"
```

---

### Task 2: `sessionWindow` — casar check-in com a sessão

**Files:**
- Create: `lib/checkin/sessionWindow.ts`
- Test: `lib/checkin/sessionWindow.test.ts`

O caller monta `startsAt` com `sessionStartIso(session_date, start_time)` de `lib/utils/sessionTime.ts`, que ancora em `-03:00`. Esta função só compara instantes — mas os testes usam horários brasileiros reais porque é ali que o bug de fuso aparece.

- [ ] **Step 1: Write the failing test**

```ts
// lib/checkin/sessionWindow.test.ts
import { describe, it, expect } from 'vitest'
import { findSessionInWindow } from './sessionWindow'
import { sessionStartIso } from '@/lib/utils/sessionTime'

// Aula às 19:00 de Brasília = 22:00 UTC.
const aula19 = { id: 'a19', startsAt: sessionStartIso('2026-07-16', '19:00:00') }
const aula20 = { id: 'a20', startsAt: sessionStartIso('2026-07-16', '20:00:00') }

describe('findSessionInWindow', () => {
  it('casa no horário exato da aula', () => {
    expect(findSessionInWindow([aula19], '2026-07-16T22:00:00Z')).toBe('a19')
  })

  it('casa 1h antes (borda inclusiva)', () => {
    expect(findSessionInWindow([aula19], '2026-07-16T21:00:00Z')).toBe('a19')
  })

  it('casa 1h depois (borda inclusiva)', () => {
    expect(findSessionInWindow([aula19], '2026-07-16T23:00:00Z')).toBe('a19')
  })

  it('não casa 1h01 antes', () => {
    expect(findSessionInWindow([aula19], '2026-07-16T20:59:00Z')).toBeNull()
  })

  it('não casa 1h01 depois', () => {
    expect(findSessionInWindow([aula19], '2026-07-16T23:01:00Z')).toBeNull()
  })

  it('janelas sobrepostas: vence a sessão mais próxima', () => {
    // 22:40Z = 19:40 BRT. Dista 40min da de 19h e 20min da de 20h.
    expect(findSessionInWindow([aula19, aula20], '2026-07-16T22:40:00Z')).toBe('a20')
  })

  it('janelas sobrepostas: ordem da lista não afeta o resultado', () => {
    expect(findSessionInWindow([aula20, aula19], '2026-07-16T22:40:00Z')).toBe('a20')
  })

  it('empate exato escolhe a primeira da lista (determinístico)', () => {
    // 22:30Z = 19:30 BRT, exatamente entre as duas.
    expect(findSessionInWindow([aula19, aula20], '2026-07-16T22:30:00Z')).toBe('a19')
  })

  it('lista vazia devolve null', () => {
    expect(findSessionInWindow([], '2026-07-16T22:00:00Z')).toBeNull()
  })

  it('janela é configurável', () => {
    expect(findSessionInWindow([aula19], '2026-07-16T20:00:00Z', 2)).toBe('a19')
  })

  it('check-in em UTC não casa aula deslocada por fuso (regressão de 3h)', () => {
    // 19:00Z = 16:00 BRT. Se alguém tratar start_time como UTC, isto casaria.
    expect(findSessionInWindow([aula19], '2026-07-16T19:00:00Z')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- lib/checkin/sessionWindow.test.ts`
Expected: FAIL — `Failed to resolve import "./sessionWindow"`

- [ ] **Step 3: Write the implementation**

```ts
// lib/checkin/sessionWindow.ts

export interface SessionStart {
  id: string
  /** Instante ISO do início. Monte com sessionStartIso() — ancorado em BRT. */
  startsAt: string
}

const HOUR_MS = 60 * 60 * 1000

/**
 * Devolve o id da sessão cuja janela [início - windowHours, início + windowHours]
 * contém o check-in. Havendo mais de uma, a mais próxima do horário do check-in;
 * em empate exato, a primeira da lista (determinístico).
 *
 * Puro: compara instantes. O fuso é responsabilidade de quem monta `startsAt`.
 */
export function findSessionInWindow(
  sessions: SessionStart[],
  checkinAt: string,
  windowHours = 1,
): string | null {
  const at = new Date(checkinAt).getTime()
  const windowMs = windowHours * HOUR_MS

  let bestId: string | null = null
  let bestDistance = Infinity

  for (const s of sessions) {
    const distance = Math.abs(new Date(s.startsAt).getTime() - at)
    if (distance <= windowMs && distance < bestDistance) {
      bestDistance = distance
      bestId = s.id
    }
  }

  return bestId
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- lib/checkin/sessionWindow.test.ts`
Expected: PASS — 11 passed

- [ ] **Step 5: Commit**

```bash
git add lib/checkin/sessionWindow.ts lib/checkin/sessionWindow.test.ts
git commit -m "feat(checkin): findSessionInWindow casa check-in a sessao numa janela de +/-1h"
```

---

### Task 3: `creditLots` — replay FIFO para expiração

**Files:**
- Create: `lib/utils/creditLots.ts`
- Test: `lib/utils/creditLots.test.ts`

Por que replay: `credits_balance` é um `int` único e `credit_transactions` não liga um débito ao crédito que ele consumiu. Reprocessar o extrato em FIFO é a forma de descobrir quais créditos estão parados e vencidos sem mudar o schema.

- [ ] **Step 1: Write the failing test**

```ts
// lib/utils/creditLots.test.ts
import { describe, it, expect } from 'vitest'
import { replayCredits } from './creditLots'

const NOW = new Date('2026-07-16T12:00:00Z')

function tx(amount: number, createdAt: string, expiresAt: string | null = null) {
  return { amount, created_at: createdAt, expires_at: expiresAt }
}

describe('replayCredits', () => {
  it('extrato vazio devolve zero', () => {
    expect(replayCredits([], NOW)).toEqual({ validBalance: 0, expiredAmount: 0 })
  })

  it('lote vigente conta no saldo', () => {
    const txs = [tx(3, '2026-07-01T00:00:00Z', '2026-08-01T00:00:00Z')]
    expect(replayCredits(txs, NOW)).toEqual({ validBalance: 3, expiredAmount: 0 })
  })

  it('lote sem expires_at nunca expira', () => {
    const txs = [tx(2, '2020-01-01T00:00:00Z', null)]
    expect(replayCredits(txs, NOW)).toEqual({ validBalance: 2, expiredAmount: 0 })
  })

  it('lote vencido e não consumido expira', () => {
    const txs = [tx(2, '2026-05-01T00:00:00Z', '2026-06-01T00:00:00Z')]
    expect(replayCredits(txs, NOW)).toEqual({ validBalance: 0, expiredAmount: 2 })
  })

  it('FIFO: o débito consome o lote mais antigo primeiro', () => {
    const txs = [
      tx(1, '2026-05-01T00:00:00Z', '2026-06-01T00:00:00Z'), // vence antes de NOW
      tx(1, '2026-07-01T00:00:00Z', '2026-08-01T00:00:00Z'), // vigente
      tx(-1, '2026-05-10T00:00:00Z'), // consome o antigo
    ]
    // O antigo foi consumido → não expira. Sobra o vigente.
    expect(replayCredits(txs, NOW)).toEqual({ validBalance: 1, expiredAmount: 0 })
  })

  it('lote vencido já consumido não expira duas vezes', () => {
    const txs = [
      tx(2, '2026-05-01T00:00:00Z', '2026-06-01T00:00:00Z'),
      tx(-2, '2026-05-15T00:00:00Z'),
    ]
    expect(replayCredits(txs, NOW)).toEqual({ validBalance: 0, expiredAmount: 0 })
  })

  it('consumo parcial: só o resto do lote vencido expira', () => {
    const txs = [
      tx(3, '2026-05-01T00:00:00Z', '2026-06-01T00:00:00Z'),
      tx(-1, '2026-05-15T00:00:00Z'),
    ]
    expect(replayCredits(txs, NOW)).toEqual({ validBalance: 0, expiredAmount: 2 })
  })

  it('débito atravessa lotes quando o primeiro não cobre', () => {
    const txs = [
      tx(1, '2026-07-01T00:00:00Z', '2026-08-01T00:00:00Z'),
      tx(2, '2026-07-02T00:00:00Z', '2026-08-01T00:00:00Z'),
      tx(-3, '2026-07-03T00:00:00Z'),
    ]
    expect(replayCredits(txs, NOW)).toEqual({ validBalance: 0, expiredAmount: 0 })
  })

  it('processa em ordem cronológica, não na ordem da lista', () => {
    const txs = [
      tx(-1, '2026-07-03T00:00:00Z'),
      tx(1, '2026-07-01T00:00:00Z', '2026-08-01T00:00:00Z'),
    ]
    expect(replayCredits(txs, NOW)).toEqual({ validBalance: 0, expiredAmount: 0 })
  })

  it('mistura: vencido não consumido expira, vigente sobrevive', () => {
    const txs = [
      tx(2, '2026-05-01T00:00:00Z', '2026-06-01T00:00:00Z'), // vencido
      tx(5, '2026-07-01T00:00:00Z', '2026-08-01T00:00:00Z'), // vigente
      tx(-1, '2026-05-02T00:00:00Z'), // consome 1 do vencido
    ]
    // Do lote vencido sobrou 1 → expira. Vigente intacto.
    expect(replayCredits(txs, NOW)).toEqual({ validBalance: 5, expiredAmount: 1 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- lib/utils/creditLots.test.ts`
Expected: FAIL — `Failed to resolve import "./creditLots"`

- [ ] **Step 3: Write the implementation**

```ts
// lib/utils/creditLots.ts

export interface CreditTx {
  /** Positivo = concessão (lote). Negativo = consumo. */
  amount: number
  created_at: string
  /** Null = crédito que não expira (ex.: estorno de matrícula fixa). */
  expires_at: string | null
}

export interface CreditReplay {
  /** Saldo de créditos ainda válidos (não consumidos, não vencidos). */
  validBalance: number
  /** Créditos que venceram sem serem usados. */
  expiredAmount: number
}

interface Lot {
  remaining: number
  expiresAt: number | null
}

/**
 * Reprocessa o extrato em FIFO para descobrir quanto do saldo ainda vale e
 * quanto venceu sem uso. Necessário porque credits_balance é um int único e
 * credit_transactions não liga um débito ao lote que ele consumiu.
 *
 * Débitos consomem o lote mais antigo primeiro. Um lote vencido só entra em
 * expiredAmount se ainda tiver saldo no fim do replay.
 *
 * Puro: não toca no banco.
 */
export function replayCredits(transactions: CreditTx[], now: Date): CreditReplay {
  const nowMs = now.getTime()

  const chronological = [...transactions].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  )

  const lots: Lot[] = []

  for (const t of chronological) {
    if (t.amount > 0) {
      lots.push({
        remaining: t.amount,
        expiresAt: t.expires_at ? new Date(t.expires_at).getTime() : null,
      })
      continue
    }

    // Consumo: tira do lote mais antigo com saldo (FIFO).
    let toConsume = -t.amount
    for (const lot of lots) {
      if (toConsume === 0) break
      const taken = Math.min(lot.remaining, toConsume)
      lot.remaining -= taken
      toConsume -= taken
    }
  }

  let validBalance = 0
  let expiredAmount = 0
  for (const lot of lots) {
    if (lot.remaining === 0) continue
    const expired = lot.expiresAt !== null && lot.expiresAt < nowMs
    if (expired) expiredAmount += lot.remaining
    else validBalance += lot.remaining
  }

  return { validBalance, expiredAmount }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- lib/utils/creditLots.test.ts`
Expected: PASS — 10 passed

- [ ] **Step 5: Commit**

```bash
git add lib/utils/creditLots.ts lib/utils/creditLots.test.ts
git commit -m "feat(credito): replayCredits reprocessa extrato em FIFO para achar credito vencido"
```

---

### Task 4: Migration — schema, desvinculação e notificação

**Files:**
- Create: `supabase/migrations/20260716000100_access_rules_credit.sql`

Três coisas: dropa `credits_per_month`, cria o índice que garante uma dívida por (aluno, sessão), e desvincula as fixas de quem não tem plano nem parceiro (decisão do spec).

**Atenção:** as reservas futuras desses alunos são **preservadas** — o crédito delas já foi debitado; apagá-las seria confisco. Só a matrícula é desativada, o que impede a renovação nas próximas semanas.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260716000100_access_rules_credit.sql
-- Regras novas: plano = acesso ilimitado (não emite mais crédito); crédito só
-- para avulsa; matrícula fixa exige plano ou parceiro.
-- Spec: docs/superpowers/specs/2026-07-16-regras-acesso-credito-design.md

-- ── 1. Plano não emite mais crédito ──────────────────────────────────────────
-- classes_per_week PERMANECE, como texto comercial (deixa de ser regra).
alter table subscription_plans drop column if exists credits_per_month;

-- ── 2. Uma pendência por (aluno, sessão) ─────────────────────────────────────
-- Idempotência da dívida por schema, não por lógica: marcar presença duas vezes
-- não cobra duas. É também o mecanismo que faz a pré-declaração do admin
-- (experimental / pago na hora) SUPRIMIR a dívida automática.
-- O filtro session_id is not null preserva as linhas de compra de crédito
-- (session_id null, credits_qty preenchido), que não são pendência de aula.
create unique index if not exists payments_session_student_unique
  on payments (student_id, session_id)
  where session_id is not null;

-- ── 3. Desvincula fixas de quem não tem plano nem parceiro ───────────────────
-- Crédito não compra mais vaga fixa. Guarda os afetados numa temp table para
-- notificar no passo 4 (depois do update os filtros já não os encontram).
create temp table _unlinked on commit drop as
select e.id as enrollment_id, e.student_id, e.organization_id, c.name as class_name
from enrollments e
join classes c on c.id = e.class_id
join memberships m
  on m.user_id = e.student_id and m.organization_id = e.organization_id
where e.is_active
  and m.partner is null
  and not exists (
    select 1 from student_subscriptions s
    where s.student_id = e.student_id
      and s.organization_id = e.organization_id
      and s.status = 'active'
      and (s.current_period_end is null or s.current_period_end >= now())
  );

update enrollments
set is_active = false, cancelled_at = now()
where id in (select enrollment_id from _unlinked);

-- ── 4. Notifica os desvinculados (in-app) ────────────────────────────────────
-- Só in-app: notifyUsers é TypeScript e não roda dentro de migration. Um aluno
-- em várias turmas recebe uma notificação por turma — é o que ele precisa saber.
-- organization_id EXPLÍCITO: o trigger trg_set_org que auto-preenchia essa
-- coluna a partir de profiles foi removido em 20260624000000 (profiles perdeu
-- organization_id na refatoração multi-vínculo). _unlinked já carrega
-- e.organization_id, então basta propagar.
insert into notifications (organization_id, user_id, type, title, body)
select
  u.organization_id,
  u.student_id,
  'enrollment_unlinked',
  'Sua vaga fixa foi encerrada',
  'Sua vaga fixa em "' || u.class_name || '" foi encerrada porque aulas fixas agora ' ||
  'exigem um plano ativo ou Wellhub/TotalPass. Suas aulas já agendadas seguem válidas. ' ||
  'Fale com a academia para contratar um plano.'
from _unlinked u;
```

- [ ] **Step 2: Verificar a sintaxe sem aplicar**

Não existe validador offline no projeto. Releia a migration procurando por:
- `current_period_end` existe em `student_subscriptions`? Confirme:

Run: `grep -rn "current_period_end" supabase/migrations/*.sql | head -3`
Expected: aparece em `20260704000100_financeiro_gateways.sql`

- `notifications` tem exatamente as colunas `user_id`, `type`, `title`, `body`? Confirme:

Run: `grep -rn -A9 "create table notifications" supabase/migrations/001_initial_schema.sql`
Expected: `user_id`, `type`, `title`, `body`, `read`, `created_at`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260716000100_access_rules_credit.sql
git commit -m "feat(db): dropa credits_per_month, unique de pendencia e desvincula fixas sem plano"
```

- [ ] **Step 4: Avisar o usuário**

A migration **não** é aplicada por você — o CLI do Supabase não está autenticado neste ambiente. Diga ao usuário, com estas palavras:

> A migration `20260716000100_access_rules_credit.sql` precisa ser aplicada com `supabase db push`. Ela desvincula matrículas fixas de alunos sem plano/parceiro e notifica os afetados — vale conferir antes quantos são:
> `select count(*) from enrollments e join memberships m on m.user_id = e.student_id and m.organization_id = e.organization_id where e.is_active and m.partner is null and not exists (select 1 from student_subscriptions s where s.student_id = e.student_id and s.organization_id = e.organization_id and s.status = 'active' and (s.current_period_end is null or s.current_period_end >= now()));`
>
> **Importante:** só aplique esta migration DEPOIS que a Task 4.5 (abaixo) estiver mergeada e em produção. A Task 4.5 remove todo código do app que ainda referencia `subscription_plans.credits_per_month` — aplicar o drop da coluna antes disso quebra criação de plano, assinatura (self-service e admin) e o webhook de renovação do Mercado Pago.

---

### Task 4.5: Remover `credits_per_month` do código do app

Descoberta durante o code-quality review da Task 4: `credits_per_month` é referenciado por **6 arquivos vivos** que nenhuma das 15 tasks originais tocava. Dropar a coluna (Task 4) sem esta correção quebra criação de plano, as duas rotas de assinatura, e — mais grave — o webhook do Mercado Pago tem um **terceiro mecanismo de "plano concede crédito"** que o resto do plano não cobria (os outros dois eram `reconcileEnrollmentCredits`, tratado na Task 7, e o cron mensal, tratado na Task 11).

Numeração fora de sequência de propósito (4.5, não 5): é uma correção de lacuna do plano, não um passo do desenho original. Não depende de nenhuma outra task; pode rodar a qualquer momento após a Task 4, e deve ir para produção antes que a migration da Task 4 seja aplicada (ver aviso acima).

**Files:**
- Modify: `types/index.ts:260`
- Modify: `app/(admin)/admin/financeiro/adminActions.ts:49-82`
- Modify: `app/(admin)/admin/financeiro/PlansManager.tsx:21-26,133-150,181-183`
- Modify: `features/financeiro/actions.ts:36-44,80-91,141-149,184-197`
- Modify: `app/(admin)/admin/alunos/[id]/page.tsx:151-164`
- Modify: `app/(admin)/admin/alunos/[id]/StudentProfileClient.tsx:41-47,691-693`
- Modify: `features/financeiro/PlanStorefront.tsx:63-67`
- Modify: `app/api/webhooks/mercadopago/route.ts:13-25,195-241`
- Delete: `features/financeiro/PlanSelector.tsx`

**Correção feita durante a execução:** a versão original deste plano dizia para NÃO tocar em `features/financeiro/PlanSelector.tsx` (confirmado código morto: `grep -rln "PlanSelector\b"` só acha o próprio arquivo, sem teste, nunca modificado desde o commit original do módulo financeiro — substituído por `PlanStorefront.tsx`, que é o que de fato é renderizado). Isso se provou incompatível com "build sem erro": `next build` faz typecheck de todo `.tsx` do repo via `tsconfig.json` (`include: ["**/*.tsx"]`), independente de import — então zerar `credits_per_month` de `SubscriptionPlan` quebra a build através deste arquivo órfão mesmo sem nada importá-lo. O implementer escalou corretamente em vez de adivinhar. Decisão: apagar o arquivo (confirmado morto — manter vivo só para não quebrar o build seria um hack de compatibilidade regressiva para código que nada usa).

- [ ] **Step 1: `types/index.ts` — remover o campo do tipo**

```ts
export interface SubscriptionPlan {
  id: string
  organization_id: string
  name: string
  description: string | null
  classes_per_week: number
  is_active: boolean
}
```

(remove a linha `credits_per_month: number`)

- [ ] **Step 2: `app/(admin)/admin/financeiro/adminActions.ts` — criação de plano**

Remova `credits_per_month` da interface, da validação e do insert:

```ts
export interface CreatePlanData {
  name: string
  description?: string
  classes_per_week: number
}

export async function createPlan(data: CreatePlanData): Promise<{ error?: string; planId?: string }> {
  try {
    const { adminClient, orgId } = await assertAdmin()

    if (!data.name.trim()) return { error: 'Nome é obrigatório.' }

    const { data: plan, error } = await adminClient
      .from('subscription_plans')
      .insert({
        name: data.name.trim(),
        description: data.description?.trim() || null,
        classes_per_week: data.classes_per_week,
        is_active: true,
        organization_id: orgId,
      })
      .select('id')
      .single()

    if (error || !plan) return { error: error?.message ?? 'Erro ao criar plano.' }
    revalidatePath('/admin/financeiro/planos')
    return { planId: plan.id as string }
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}
```

- [ ] **Step 3: `app/(admin)/admin/financeiro/PlansManager.tsx` — formulário e exibição**

`emptyCreateForm` perde o campo:

```ts
const emptyCreateForm: CreatePlanData = {
  name: '',
  description: '',
  classes_per_week: 2,
}
```

O grid de dois campos ("Aulas/semana" + "Créditos/mês") vira um campo único — troque:

```tsx
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Aulas/semana</label>
                <Input
                  type="number" min="1" step="1"
                  value={createForm.classes_per_week}
                  onChange={(e) => setCreateForm((f) => ({ ...f, classes_per_week: parseInt(e.target.value) || 0 }))}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Créditos/mês</label>
                <Input
                  type="number" min="1" step="1"
                  value={createForm.credits_per_month}
                  onChange={(e) => setCreateForm((f) => ({ ...f, credits_per_month: parseInt(e.target.value) || 0 }))}
                />
              </div>
            </div>
```

por:

```tsx
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Aulas/semana</label>
              <Input
                type="number" min="1" step="1"
                value={createForm.classes_per_week}
                onChange={(e) => setCreateForm((f) => ({ ...f, classes_per_week: parseInt(e.target.value) || 0 }))}
              />
            </div>
```

E a linha de exibição do card do plano perde o texto de crédito:

```tsx
              <p className="text-xs text-slate-400 mt-1">
                {plan.classes_per_week}x/semana
              </p>
```

- [ ] **Step 4: `features/financeiro/actions.ts` — assinatura self-service e admin**

Em `subscribeToPlan`, o select do plano não usa `credits_per_month` para nada além do proprio select — remova:

```ts
  const { data: plan, error: planErr } = await adminClient
    .from('subscription_plans')
    .select('id, is_active, name')
    .eq('id', planId)
    .eq('organization_id', orgId)
    .single()
```

E o comentário logo antes do laço de reconciliação (por volta da linha 80) fica desatualizado após a Task 7 (que remove o grant de crédito de `reconcileEnrollmentCredits`) — nenhuma outra task toca este arquivo, então corrija aqui:

```ts
  // Reserva as sessões das matrículas ativas do aluno (não concede crédito —
  // plano é acesso ilimitado desde 2026-07).
  const { data: activeEnrolls } = await adminClient
```

Em `adminSubscribeStudentToPlan`, mesmo padrão — o select:

```ts
  const { data: plan, error: planErr } = await adminClient
    .from('subscription_plans')
    .select('id, is_active')
    .eq('id', planId)
    .eq('organization_id', orgId)
    .single()
```

E o comentário equivalente antes do laço de reconciliação dessa função, mesma correção do parágrafo acima. Também ajuste o JSDoc da função (por volta da linha 100-107), que hoje diz "Grants prorated credits by reconciling..." — troque por algo como "Reserves the student's active enrollment sessions by reconciling (does not grant credit — plan is unlimited access)."

- [ ] **Step 5: `app/(admin)/admin/alunos/[id]/page.tsx` — picker de plano na ficha do aluno**

Select explícito de colunas — remova o campo da lista e do tipo local:

```ts
  const { data: plansRaw } = await adminClient
    .from('subscription_plans')
    .select('id, name, classes_per_week, is_active')
    .eq('is_active', true)
    .eq('organization_id', orgId)
    .order('classes_per_week', { ascending: true })

  const availablePlans = (plansRaw ?? []) as {
    id: string
    name: string
    classes_per_week: number
    is_active: boolean
  }[]
```

- [ ] **Step 6: `app/(admin)/admin/alunos/[id]/StudentProfileClient.tsx` — tipo e exibição**

```ts
interface PlanSummary {
  id: string
  name: string
  classes_per_week: number
  is_active: boolean
}
```

E a linha do `<option>`:

```tsx
                {availablePlans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {p.classes_per_week}x/sem
                  </option>
                ))}
```

- [ ] **Step 7: `features/financeiro/PlanStorefront.tsx` — vitrine do aluno**

```tsx
            <p className="text-xs text-slate-400 mt-1">
              {plan.classes_per_week}x/semana
            </p>
```

(Esta tela usa `select('*')` no Server Component pai, então não quebra com erro — só passaria a exibir "undefined créditos/mês". Corrigido mesmo assim, já que o texto ficaria errado.)

- [ ] **Step 8: `app/api/webhooks/mercadopago/route.ts` — remover a renovação mensal de crédito**

Este é o mais importante: o webhook tem um bloco inteiro que concede crédito mensal na confirmação de pagamento de assinatura — um terceiro mecanismo de "plano dá crédito" que nenhuma outra task cobria. Ele precisa sumir, não só parar de referenciar a coluna dropada.

Primeiro, corrija o docstring da função no topo do arquivo (linhas 13-25), que descreve o comportamento antigo:

```ts
/**
 * Mercado Pago webhook handler.
 *
 * Security: validates x-signature header using HMAC-SHA256 with MERCADOPAGO_WEBHOOK_SECRET.
 *
 * On payment.updated / payment.created with status = 'approved':
 *   1. Find the matching payment row by gateway_payment_id
 *   2. Update payments.status = 'paid' and paid_at = now
 *
 * Assinaturas não concedem mais crédito na renovação — plano é acesso
 * ilimitado (spec: docs/superpowers/specs/2026-07-16-regras-acesso-credito-design.md).
 */
```

Depois, dentro de `handleWebhook`, remova o bloco inteiro que começa em `// If this payment is linked to a subscription, release monthly credits` e vai até o fechamento do `if (payment.subscription_id) { ... }` (a `payment.subscription_id` não aciona mais nada neste handler — o pagamento já foi marcado `paid` acima, que é tudo que este evento precisa fazer):

```ts
  if (updatePaymentErr) {
    console.error('[webhook/mercadopago] Error updating payment:', updatePaymentErr)
    return NextResponse.json({ error: 'Failed to update payment' }, { status: 500 })
  }

  // If this payment is linked to a subscription, release monthly credits
  if (payment.subscription_id) {
    const { data: sub } = await adminClient
      .from('student_subscriptions')
      .select('id, plan_id, student_id, organization_id')
      .eq('id', payment.subscription_id)
      .maybeSingle()

    if (sub) {
      const { data: plan } = await adminClient
        .from('subscription_plans')
        .select('credits_per_month')
        .eq('id', sub.plan_id)
        .maybeSingle()

      const creditsPerMonth = plan?.credits_per_month ?? 0

      if (creditsPerMonth > 0) {
        // Insert renewed transaction
        const { error: txErr } = await adminClient.from('credit_transactions').insert({
          student_id: sub.student_id,
          organization_id: sub.organization_id,
          type: 'renewed',
          amount: creditsPerMonth,
          reason: `Renovação mensal — pagamento ${gatewayPaymentId}`,
          session_id: null,
          subscription_id: sub.id,
          expires_at: null,
        })

        if (txErr) {
          console.error('[webhook/mercadopago] Error inserting credit_transaction:', txErr)
          // Payment was already marked paid — don't fail the whole webhook
        } else {
          // Update cached balance: renewal replaces, not accumulates.
          // Saldo é por-academia → grava na membership da (aluno, org da assinatura).
          await adminClient
            .from('memberships')
            .update({ credits_balance: creditsPerMonth })
            .eq('user_id', sub.student_id)
            .eq('organization_id', sub.organization_id)
        }
      }
    }
  }

  return NextResponse.json({ received: true })
}
```

por:

```ts
  if (updatePaymentErr) {
    console.error('[webhook/mercadopago] Error updating payment:', updatePaymentErr)
    return NextResponse.json({ error: 'Failed to update payment' }, { status: 500 })
  }

  // Assinatura renovada não concede mais crédito: plano é acesso ilimitado.
  // O pagamento já foi marcado 'paid' acima — é tudo que este evento faz.

  return NextResponse.json({ received: true })
}
```

`payment.subscription_id` e a variável `gatewayPaymentId` continuam usadas mais acima na função (fetch do payment, log); confirme que remover este bloco não deixa nenhum import ou variável órfã ao rodar o typecheck no Step 10.

- [ ] **Step 9: Buscar referências residuais**

Run: `grep -rln "credits_per_month" --include=*.ts --include=*.tsx . | grep -v node_modules | grep -v worktrees`
Expected: só `features/financeiro/PlanSelector.tsx` (código morto, fora de escopo — ver nota acima) e, se ainda não tiver sido tratado por outra task, `docs/` (specs/planos são documentação histórica, não precisam mudar).

- [ ] **Step 10: Verify**

Run: `npm run build`
Expected: compila sem erro. Preste atenção especial em `app/api/webhooks/mercadopago/route.ts` — confirme que não sobrou nenhuma variável (`sub`, `plan`, `creditsPerMonth`) referenciada fora do bloco removido.

Run: `npm run lint`
Expected: sem erro

Run: `npm run test:run`
Expected: toda a suíte passa (nenhum teste existente cobre estes arquivos diretamente, mas confirme que nada quebrou por efeito colateral)

- [ ] **Step 11: Commit**

```bash
git add types/index.ts "app/(admin)/admin/financeiro/adminActions.ts" "app/(admin)/admin/financeiro/PlansManager.tsx" features/financeiro/actions.ts "app/(admin)/admin/alunos/[id]/page.tsx" "app/(admin)/admin/alunos/[id]/StudentProfileClient.tsx" features/financeiro/PlanStorefront.tsx app/api/webhooks/mercadopago/route.ts
git commit -m "fix(financeiro): remove credits_per_month do codigo do app (coluna dropada na Task 4)

Fecha uma lacuna do plano original: 6 arquivos vivos referenciavam a coluna
sem nenhuma task cobri-los. O mais importante e o webhook do Mercado Pago,
que tinha um terceiro mecanismo de renovacao mensal de credito por plano
(os outros dois eram reconcileEnrollmentCredits e o cron mensal) que
nenhuma outra task tratava."
```

---

### Task 5: `ensureClassDebt` — a dívida nasce na presença

**Files:**
- Create: `features/financeiro/classDebt.ts`
- Test: `features/financeiro/classDebt.test.ts`

Ponto único de escrita da pendência. Chamado pelos três lugares que marcam presença (Tasks 6 e 9).

Não cria dívida quando: a reserva foi paga com crédito (`credit_used = true`), o aluno tem parceiro ou plano vigente, ou já existe `payments` para o par — este último garantido pelo índice único da Task 4, que é como a pré-declaração do admin suprime a dívida.

- [ ] **Step 1: Write the failing test**

```ts
// features/financeiro/classDebt.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ensureClassDebt } from './classDebt'

/**
 * Stub do client Supabase. Cada tabela devolve o que o teste configurar.
 * `inserted` acumula o que foi gravado em payments.
 */
function makeClient(opts: {
  booking?: { credit_used: boolean } | null
  membership?: { partner: string | null } | null
  subscription?: { current_period_end: string | null } | null
  price?: string | null
  insertError?: { code: string } | null
}) {
  const inserted: Record<string, unknown>[] = []

  const from = vi.fn((table: string) => {
    if (table === 'payments') {
      return {
        insert: vi.fn((row: Record<string, unknown>) => {
          if (opts.insertError) return Promise.resolve({ error: opts.insertError })
          inserted.push(row)
          return Promise.resolve({ error: null })
        }),
      }
    }

    const single = () => {
      if (table === 'session_bookings') return Promise.resolve({ data: opts.booking ?? null })
      if (table === 'memberships') return Promise.resolve({ data: opts.membership ?? null })
      if (table === 'student_subscriptions')
        return Promise.resolve({ data: opts.subscription ?? null })
      return Promise.resolve({ data: null })
    }

    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      maybeSingle: single,
      single,
      then: (resolve: (v: unknown) => void) => {
        if (table === 'system_settings') {
          const data = opts.price === null ? [] : [{ key: 'single_class_price', value: opts.price }]
          return Promise.resolve({ data }).then(resolve)
        }
        return Promise.resolve({ data: [] }).then(resolve)
      },
    }
    return builder
  })

  return { client: { from } as never, inserted }
}

const args = { orgId: 'org-1', studentId: 'stu-1', sessionId: 'ses-1' }

describe('ensureClassDebt', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('cria pendência para aluno sem plano, sem parceiro e sem crédito usado', async () => {
    const { client, inserted } = makeClient({
      booking: { credit_used: false },
      membership: { partner: null },
      subscription: null,
      price: '60',
    })

    await ensureClassDebt(client, args)

    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({
      organization_id: 'org-1',
      student_id: 'stu-1',
      session_id: 'ses-1',
      amount: 60,
      status: 'pending',
      type: 'per_class',
      gateway: 'manual',
      credits_qty: null,
    })
  })

  it('não cria pendência quando a reserva foi paga com crédito', async () => {
    const { client, inserted } = makeClient({
      booking: { credit_used: true },
      membership: { partner: null },
      subscription: null,
      price: '60',
    })

    await ensureClassDebt(client, args)
    expect(inserted).toHaveLength(0)
  })

  it('não cria pendência para aluno de parceiro', async () => {
    const { client, inserted } = makeClient({
      booking: { credit_used: false },
      membership: { partner: 'wellhub' },
      subscription: null,
      price: '60',
    })

    await ensureClassDebt(client, args)
    expect(inserted).toHaveLength(0)
  })

  it('não cria pendência para aluno com plano vigente', async () => {
    const { client, inserted } = makeClient({
      booking: { credit_used: false },
      membership: { partner: null },
      subscription: { current_period_end: '2099-01-01T00:00:00Z' },
      price: '60',
    })

    await ensureClassDebt(client, args)
    expect(inserted).toHaveLength(0)
  })

  it('cria pendência para plano com período vencido', async () => {
    const { client, inserted } = makeClient({
      booking: { credit_used: false },
      membership: { partner: null },
      subscription: { current_period_end: '2020-01-01T00:00:00Z' },
      price: '60',
    })

    await ensureClassDebt(client, args)
    expect(inserted).toHaveLength(1)
  })

  it('cria pendência com amount 0 quando o preço não está configurado', async () => {
    const { client, inserted } = makeClient({
      booking: { credit_used: false },
      membership: { partner: null },
      subscription: null,
      price: null,
    })

    await ensureClassDebt(client, args)
    expect(inserted[0]).toMatchObject({ amount: 0 })
  })

  it('violação do unique (23505) não lança — presença marcada duas vezes cobra uma', async () => {
    const { client } = makeClient({
      booking: { credit_used: false },
      membership: { partner: null },
      subscription: null,
      price: '60',
      insertError: { code: '23505' },
    })

    await expect(ensureClassDebt(client, args)).resolves.toBeUndefined()
  })

  it('erro de insert que não seja 23505 lança', async () => {
    const { client } = makeClient({
      booking: { credit_used: false },
      membership: { partner: null },
      subscription: null,
      price: '60',
      insertError: { code: '42501' },
    })

    await expect(ensureClassDebt(client, args)).rejects.toThrow()
  })

  it('sem membership não cria nada (aluno não é desta academia)', async () => {
    const { client, inserted } = makeClient({
      booking: { credit_used: false },
      membership: null,
      subscription: null,
      price: '60',
    })

    await ensureClassDebt(client, args)
    expect(inserted).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- features/financeiro/classDebt.test.ts`
Expected: FAIL — `Failed to resolve import "./classDebt"`

- [ ] **Step 3: Write the implementation**

```ts
// features/financeiro/classDebt.ts
// Ponto ÚNICO de criação da pendência de aula. Chamado por markAttendance,
// markAttendanceBulk e recordResolvedCheckin — a dívida nasce na PRESENÇA, não
// na reserva (spec §5): cancelamento e no-show nunca geram dívida, sem precisar
// de regra para apagar.
import { createAdminClient } from '@/lib/supabase/server'
import { isSubscriptionCurrent } from '@/lib/billing/periodicity'

type AdminClient = ReturnType<typeof createAdminClient>

export interface EnsureClassDebtInput {
  orgId: string
  studentId: string
  sessionId: string
}

/**
 * Cria a pendência da aula se o aluno não pagou por ela de nenhuma forma.
 *
 * Não cria quando:
 *  - a reserva consumiu crédito (credit_used = true) — já foi paga;
 *  - o aluno tem parceiro (Wellhub/TotalPass) ou plano vigente — entra de graça;
 *  - já existe payments para o par (aluno, sessão) — garantido pelo índice único
 *    payments_session_student_unique, que é também como a pré-declaração do
 *    admin (experimental / pago na hora) suprime esta dívida.
 *
 * Chame SOMENTE para presença 'present'. Marcar 'absent' não gera dívida.
 */
export async function ensureClassDebt(
  client: AdminClient,
  input: EnsureClassDebtInput,
): Promise<void> {
  const { orgId, studentId, sessionId } = input

  // 1. Reserva paga com crédito → nada a cobrar.
  const { data: booking } = await client
    .from('session_bookings')
    .select('credit_used')
    .eq('student_id', studentId)
    .eq('session_id', sessionId)
    .maybeSingle()

  if ((booking as { credit_used: boolean } | null)?.credit_used) return

  // 2. Parceiro entra de graça. Sem membership, o aluno não é desta academia.
  const { data: membership } = await client
    .from('memberships')
    .select('partner')
    .eq('user_id', studentId)
    .eq('organization_id', orgId)
    .maybeSingle()

  if (!membership) return
  if ((membership as { partner: string | null }).partner) return

  // 3. Plano vigente entra de graça. 'active' com período vencido NÃO conta —
  //    mesmo critério da reconciliação (spec §1).
  const { data: sub } = await client
    .from('student_subscriptions')
    .select('gateway, current_period_end')
    .eq('student_id', studentId)
    .eq('organization_id', orgId)
    .eq('status', 'active')
    .maybeSingle()

  if (sub && isSubscriptionCurrent(sub as { gateway: string; current_period_end: string | null }, new Date())) {
    return
  }

  // 4. Preço da avulsa. Ausente → pendência com amount 0: a academia PRECISA ver
  //    que o aluno entrou sem pagar, mesmo sem preço definido (spec §4).
  //    single_class_sale_enabled gateia a venda online, não o preço da dívida.
  const { data: settingsRaw } = await client
    .from('system_settings')
    .select('key, value')
    .eq('organization_id', orgId)
    .in('key', ['single_class_price'])

  const priceRow = ((settingsRaw ?? []) as { key: string; value: string }[]).find(
    (s) => s.key === 'single_class_price',
  )
  const amount = parseFloat(priceRow?.value ?? '0') || 0

  const { error } = await client.from('payments').insert({
    organization_id: orgId,
    student_id: studentId,
    session_id: sessionId,
    amount,
    currency: 'BRL',
    status: 'pending',
    type: 'per_class',
    gateway: 'manual',
    credits_qty: null,
  })

  // 23505 = índice único: já existe pendência ou pré-declaração do admin para
  // este par. É o caminho feliz da idempotência, não um erro.
  if (error && error.code !== '23505') {
    throw new Error(`Falha ao registrar pendência da aula: ${error.message}`)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- features/financeiro/classDebt.test.ts`
Expected: PASS — 9 passed

- [ ] **Step 5: Commit**

```bash
git add features/financeiro/classDebt.ts features/financeiro/classDebt.test.ts
git commit -m "feat(financeiro): ensureClassDebt cria pendencia de aula na marcacao de presenca"
```

---

### Task 6: Ligar `ensureClassDebt` à marcação de presença

**Files:**
- Modify: `features/aulas/actions.ts:534-572` (`markAttendance`), `features/aulas/actions.ts:582-625` (`markAttendanceBulk`)

- [ ] **Step 1: Import**

Adicione no topo de `features/aulas/actions.ts`, junto dos outros imports:

```ts
import { ensureClassDebt } from '@/features/financeiro/classDebt'
```

- [ ] **Step 2: Chamar em `markAttendance`**

Substitua o bloco final de `markAttendance` (que hoje termina em `if (upsertErr) return ...; return {}`):

```ts
  if (upsertErr) return { error: 'Erro ao registrar presença.' }

  // A dívida nasce na presença (spec §5). Só para 'present' — faltar não gera
  // cobrança. Best-effort: a pendência NUNCA derruba a marcação de presença,
  // que é a operação que o professor está fazendo.
  if (present) {
    try {
      await ensureClassDebt(adminClient, { orgId, studentId, sessionId })
    } catch (err) {
      console.error('[markAttendance] ensureClassDebt falhou', {
        sessionId, studentId, error: err instanceof Error ? err.message : String(err),
      })
      Sentry.captureException(err, { extra: { sessionId, studentId, orgId } })
    }
  }

  return {}
```

Se `features/aulas/actions.ts` ainda não importa Sentry, adicione:

```ts
import * as Sentry from '@sentry/nextjs'
```

- [ ] **Step 3: Chamar em `markAttendanceBulk`**

Substitua o bloco final de `markAttendanceBulk` (hoje: `if (error) return { error: error.message }` seguido do update de `class_sessions`):

```ts
  if (error) return { error: error.message }

  // Mesma regra do markAttendance: só quem esteve presente gera pendência.
  // Sequencial de propósito — o volume é uma turma (~15 alunos) e o índice
  // único já protege contra duplicata.
  for (const studentId of presentIds) {
    try {
      await ensureClassDebt(adminClient, { orgId, studentId, sessionId })
    } catch (err) {
      console.error('[markAttendanceBulk] ensureClassDebt falhou', {
        sessionId, studentId, error: err instanceof Error ? err.message : String(err),
      })
      Sentry.captureException(err, { extra: { sessionId, studentId, orgId } })
    }
  }

  await adminClient.from('class_sessions').update({ status: 'completed' }).eq('id', sessionId)

  const { revalidatePath } = await import('next/cache')
  revalidatePath(`/admin/grade/${sessionId}`)
  return {}
```

- [ ] **Step 4: Verify types and lint**

Run: `npm run build`
Expected: compila sem erro de tipo

Run: `npm run lint`
Expected: sem erro

- [ ] **Step 5: Commit**

```bash
git add features/aulas/actions.ts
git commit -m "feat(financeiro): marcar presenca gera pendencia para quem nao pagou a aula"
```

---

### Task 7: `reconcileEnrollmentCredits` para de mexer em crédito

**Files:**
- Modify: `features/aulas/creditReconciliation.ts`
- Modify: `lib/utils/reconciliationOps.ts`
- Modify: `lib/utils/reconciliationOps.test.ts`

Esta é a mudança central: plano não emite mais crédito. A função vira só "reserva as fixas do aluno no intervalo".

- [ ] **Step 1: Ajustar o teste de `reconciliationOps`**

`ReconciliationOp` perde `needsCredit`, `grantReason` e `debitReason` — não sobra nada além do id e da data. Substitua **todo** o conteúdo de `lib/utils/reconciliationOps.test.ts`:

```ts
// lib/utils/reconciliationOps.test.ts
import { describe, it, expect } from 'vitest'
import { buildReconciliationOps } from './reconciliationOps'

describe('buildReconciliationOps', () => {
  const sessions = [
    { id: 's1', session_date: '2026-07-20' },
    { id: 's2', session_date: '2026-07-27' },
  ]

  it('monta uma operação por sessão ainda não reservada', () => {
    expect(buildReconciliationOps(sessions, new Set())).toEqual([
      { sessionId: 's1', sessionDate: '2026-07-20' },
      { sessionId: 's2', sessionDate: '2026-07-27' },
    ])
  })

  it('pula sessões que já têm reserva', () => {
    expect(buildReconciliationOps(sessions, new Set(['s1']))).toEqual([
      { sessionId: 's2', sessionDate: '2026-07-27' },
    ])
  })

  it('todas reservadas devolve lista vazia', () => {
    expect(buildReconciliationOps(sessions, new Set(['s1', 's2']))).toEqual([])
  })

  it('lista vazia devolve lista vazia', () => {
    expect(buildReconciliationOps([], new Set())).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- lib/utils/reconciliationOps.test.ts`
Expected: FAIL — a assinatura ainda pede 4 argumentos e os objetos ainda têm `needsCredit`

- [ ] **Step 3: Simplificar `reconciliationOps.ts`**

Substitua **todo** o conteúdo de `lib/utils/reconciliationOps.ts`:

```ts
// lib/utils/reconciliationOps.ts

export interface SessionLite {
  id: string
  session_date: string // yyyy-MM-dd
}

export interface ReconciliationOp {
  sessionId: string
  sessionDate: string
}

/**
 * Para cada sessão ainda não reservada, monta a operação de reconciliação.
 * Puro: não toca no banco.
 *
 * Desde 2026-07 a matrícula fixa NÃO consome crédito: fixa exige plano ou
 * parceiro, e ambos entram de graça (spec §3). Por isso não há mais
 * needsCredit / grantReason / debitReason aqui.
 */
export function buildReconciliationOps(
  sessions: SessionLite[],
  bookedSessionIds: Set<string>,
): ReconciliationOp[] {
  return sessions
    .filter((s) => !bookedSessionIds.has(s.id))
    .map((s) => ({ sessionId: s.id, sessionDate: s.session_date }))
}
```

Note que `requiresCredit` some junto. Confirme que ninguém mais usa:

Run: `grep -rn "requiresCredit" --include=*.ts --include=*.tsx . | grep -v node_modules | grep -v worktrees`
Expected: só `features/aulas/creditReconciliation.ts` (corrigido no Step 5)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- lib/utils/reconciliationOps.test.ts`
Expected: PASS — 4 passed

- [ ] **Step 5: Reescrever `reconcileEnrollmentCredits`**

Em `features/aulas/creditReconciliation.ts`, substitua o bloco que vai do início do arquivo até o fim da função `reconcileEnrollmentCredits` (linhas 1–165) por:

```ts
// features/aulas/creditReconciliation.ts
import { createAdminClient } from '@/lib/supabase/server'
import { buildReconciliationOps } from '@/lib/utils/reconciliationOps'
import { getRemainingMonthWindow } from '@/lib/utils/monthWindow'
import { isSubscriptionCurrent } from '@/lib/billing/periodicity'

export interface ReconcileResult {
  booked: number
  skipped: number
}

const EMPTY: ReconcileResult = { booked: 0, skipped: 0 }

/**
 * Reserva as sessões da matrícula fixa (aluno+turma) no intervalo [from, to].
 * Idempotente.
 *
 * NÃO mexe em crédito: desde 2026-07 matrícula fixa exige plano ou parceiro, e
 * os dois entram de graça (spec §3). Antes daqui saía um par concede/debita por
 * sessão — era a mecânica de "plano dá crédito", que deixou de existir.
 */
export async function reconcileEnrollmentCredits(
  studentId: string,
  classId: string,
  from: string,
  to: string,
  injectedClient?: ReturnType<typeof createAdminClient>,
): Promise<ReconcileResult> {
  const adminClient = injectedClient ?? createAdminClient()
  const result: ReconcileResult = { ...EMPTY }

  const { data: cls } = await adminClient
    .from('classes')
    .select('max_students, organization_id')
    .eq('id', classId)
    .single()
  if (!cls) return result

  const { data: sessionsRaw } = await adminClient
    .from('class_sessions')
    .select('id, session_date')
    .eq('class_id', classId)
    .eq('status', 'scheduled')
    .gte('session_date', from)
    .lte('session_date', to)
    .order('session_date', { ascending: true })

  const sessions = (sessionsRaw ?? []) as { id: string; session_date: string }[]
  if (sessions.length === 0) return result

  // Reservas existentes em QUALQUER status. As canceladas entram de propósito:
  // opt-out de aula fixa (skipEnrollmentNoBooking) e saída com refund
  // (skipEnrollmentSession) deixam uma reserva 'cancelled', e reconciliar não
  // pode reativá-las. O unique student_id+session_id garante no máximo uma.
  const sessionIds = sessions.map((s) => s.id)
  const { data: existingRaw } = await adminClient
    .from('session_bookings')
    .select('session_id')
    .eq('student_id', studentId)
    .in('session_id', sessionIds)
  const bookedSessionIds = new Set(
    (existingRaw ?? []).map((b: { session_id: string }) => b.session_id),
  )

  const ops = buildReconciliationOps(sessions, bookedSessionIds)

  for (const op of ops) {
    const { error: bookErr } = await adminClient.rpc('book_session_atomic', {
      p_student_id: studentId,
      p_session_id: op.sessionId,
      p_max_students: cls.max_students,
      p_type: 'extra',
      p_from_enrollment: true,
      p_credit_used: false,
    })
    if (bookErr) {
      // SESSION_FULL ou ALREADY_BOOKED (corrida): pula.
      result.skipped++
      continue
    }
    result.booked++
  }

  return result
}
```

- [ ] **Step 6: Ajustar `reconcileAllActiveEnrollments`**

Na mesma `features/aulas/creditReconciliation.ts`, a elegibilidade usava `requiresCredit`. Substitua a linha:

```ts
    const eligible = !requiresCredit(partner) || activeSubStudents.has(memberKey)
```

por:

```ts
    // Elegível para renovar a fixa = tem parceiro OU plano vigente. É a mesma
    // regra que enrollStudentInClass aplica na entrada (spec §2). Plano vencido
    // simplesmente para de ser reservado; a grade sinaliza.
    const eligible = partner !== null || activeSubStudents.has(memberKey)
```

E os totais agora só têm `booked`/`skipped`. Substitua:

```ts
  const totals = { ...EMPTY, processedEnrollments: 0, failed: 0 }
```

...e dentro do `try`, substitua o acúmulo:

```ts
      const r = await reconcileEnrollmentCredits(e.student_id, e.class_id, from, to, adminClient)
      totals.booked += r.booked
      totals.skipped += r.skipped
      totals.processedEnrollments++
```

Ajuste também o tipo de retorno da função para `Promise<ReconcileResult & { processedEnrollments: number; failed: number }>` (já é isso — só confirme que compila com o novo `ReconcileResult`).

- [ ] **Step 7: Verify**

Run: `npm run build`
Expected: compila. Se acusar `granted`/`debited` em algum caller, corrija — esses campos deixaram de existir.

Run: `npm run test:run`
Expected: toda a suíte passa

- [ ] **Step 8: Commit**

```bash
git add features/aulas/creditReconciliation.ts lib/utils/reconciliationOps.ts lib/utils/reconciliationOps.test.ts
git commit -m "refactor(credito): matricula fixa deixa de consumir credito"
```

---

### Task 8: `enrollStudentInClass` exige plano ou parceiro

**Files:**
- Modify: `features/aulas/adminActions.ts:66-127`

- [ ] **Step 1: Adicionar o gate**

Em `enrollStudentInClass`, logo após o bloco que valida a turma (`if (!cls || !cls.is_active) return { error: 'Turma não encontrada ou inativa.' }`), insira:

```ts
  // Fixa exige plano ou parceiro (spec §2). Crédito não compra vaga fixa.
  const { data: membership } = await adminClient
    .from('memberships')
    .select('partner')
    .eq('user_id', studentId)
    .eq('organization_id', orgId)
    .maybeSingle()

  if (!membership) return { error: 'Aluno não participa desta academia.' }

  if (!(membership as { partner: string | null }).partner) {
    const { data: sub } = await adminClient
      .from('student_subscriptions')
      .select('gateway, current_period_end')
      .eq('student_id', studentId)
      .eq('organization_id', orgId)
      .eq('status', 'active')
      .maybeSingle()

    const hasActivePlan =
      !!sub && isSubscriptionCurrent(sub as { gateway: string; current_period_end: string | null }, new Date())

    if (!hasActivePlan) {
      return {
        error:
          'Aula fixa exige plano ativo ou Wellhub/TotalPass. Para uma aula pontual, adicione o aluno direto na sessão.',
      }
    }
  }
```

Adicione o import no topo de `features/aulas/adminActions.ts`:

```ts
import { isSubscriptionCurrent } from '@/lib/billing/periodicity'
```

- [ ] **Step 2: Remover a reconciliação de crédito da matrícula**

Ainda em `enrollStudentInClass`, o bloco atual reconcilia até o fim do mês para conceder/debitar crédito. Isso não faz mais sentido (fixa não consome crédito) — mas a reserva das sessões continua necessária. O código permanece igual; só o comentário muda. Substitua:

```ts
  // Concede + reserva + debita todas as sessões restantes do mês para esta turma
  const today = format(new Date(), 'yyyy-MM-dd')
  const monthEnd = format(endOfMonth(new Date()), 'yyyy-MM-dd')
  await reconcileEnrollmentCredits(studentId, classId, today, monthEnd)
```

por:

```ts
  // Reserva as sessões restantes do mês para esta turma. Não consome crédito:
  // quem chega aqui tem plano ou parceiro (spec §3).
  const today = format(new Date(), 'yyyy-MM-dd')
  const monthEnd = format(endOfMonth(new Date()), 'yyyy-MM-dd')
  await reconcileEnrollmentCredits(studentId, classId, today, monthEnd)
```

- [ ] **Step 3: Verify**

Run: `npm run build`
Expected: compila

Run: `npm run lint`
Expected: sem erro

- [ ] **Step 4: Commit**

```bash
git add features/aulas/adminActions.ts
git commit -m "feat(aulas): matricula fixa exige plano ativo ou parceiro"
```

---

### Task 9: `bookSession` decide o acesso por `resolveClassAccess`

**Files:**
- Modify: `features/aulas/actions.ts:30-85` (`bookNextSession`), `features/aulas/actions.ts:102-241` (`bookSession`)

Hoje o caller passa `useCreditArg` e `bookNextSession` decide com `!membership?.partner` — o que ignora plano e ignora dívida. A decisão passa a ser do `resolveClassAccess`.

- [ ] **Step 1: Imports**

Em `features/aulas/actions.ts`:

```ts
import { resolveClassAccess } from '@/lib/utils/accessRules'
import { isSubscriptionCurrent } from '@/lib/billing/periodicity'
```

- [ ] **Step 2: Simplificar `bookNextSession`**

Substitua o final de `bookNextSession` (as linhas que hoje leem a membership e calculam `useCredit`):

```ts
  // Vínculo de parceiro (por-academia) vem da membership da academia ativa.
  const membership = await getActiveMembership()
  const useCredit = !membership?.partner

  return bookSession(sessionId, useCredit)
```

por:

```ts
  // Quem decide o custo é resolveClassAccess, dentro de bookSession.
  return bookSession(sessionId)
```

- [ ] **Step 3: Trocar a decisão em `bookSession`**

Mude a assinatura, removendo `useCreditArg`:

```ts
export async function bookSession(sessionId: string): Promise<{ error?: string }> {
```

Substitua o bloco "Decide credit usage" (hoje: `const useCredit = useCreditArg ?? false; if (useCredit && profile.credits_balance < 1) ...`) por:

```ts
  // Plano vigente: 'active' com período vencido NÃO dá acesso — mesmo critério
  // da reconciliação (spec §1).
  const { data: sub } = await adminClient
    .from('student_subscriptions')
    .select('gateway, current_period_end')
    .eq('student_id', user.id)
    .eq('organization_id', orgId)
    .eq('status', 'active')
    .maybeSingle()

  const hasActivePlan =
    !!sub && isSubscriptionCurrent(sub as { gateway: string; current_period_end: string | null }, new Date())

  // Dívida aberta = payments pendente COM session_id. O filtro de session_id é
  // essencial: compra de crédito abandonada no checkout também fica 'pending',
  // mas com session_id null — sem o filtro ela bloquearia o aluno para sempre
  // (spec §4).
  const { count: debtCount } = await adminClient
    .from('payments')
    .select('id', { count: 'exact', head: true })
    .eq('student_id', user.id)
    .eq('organization_id', orgId)
    .eq('status', 'pending')
    .not('session_id', 'is', null)

  const decision = resolveClassAccess({
    partner: profile.partner,
    hasActivePlan,
    creditsBalance: profile.credits_balance,
    hasOpenDebt: (debtCount ?? 0) > 0,
  })

  if ('denied' in decision) {
    return {
      error:
        'Você tem uma aula em aberto. Regularize o pagamento com a academia para agendar novamente.',
    }
  }

  // Só 'credit' debita. 'partner' e 'plan' entram de graça; 'debt' entra e a
  // pendência nasce se houver presença (spec §5).
  const useCredit = decision.grant === 'credit'
```

O resto de `bookSession` (a RPC `book_session_atomic` com `p_credit_used: useCredit`, o débito condicional e o rollback) **fica igual** — `useCredit` agora vem da decisão em vez do argumento.

- [ ] **Step 4: Corrigir os callers**

Run: `grep -rn "bookSession(" --include=*.ts --include=*.tsx . | grep -v node_modules | grep -v worktrees`
Expected: só `bookNextSession` (já corrigido) e a própria definição. Se aparecer outro caller passando um segundo argumento, remova o argumento.

- [ ] **Step 5: Verify**

Run: `npm run build`
Expected: compila

Run: `npm run test:run`
Expected: toda a suíte passa

- [ ] **Step 6: Commit**

```bash
git add features/aulas/actions.ts
git commit -m "feat(aulas): bookSession decide custo por resolveClassAccess e bloqueia quem tem divida"
```

---

### Task 9.5: Extrair `hasActiveSubscriptionPlan` — o mesmo bloco parou de ser coincidência

Descoberta durante o code-quality review da Task 9: o bloco de 6 linhas "busca `student_subscriptions` ativa + roda por `isSubscriptionCurrent`" apareceu **três vezes** verbatim (`classDebt.ts` na Task 5, `enrollStudentInClass` na Task 8, `bookSession` na Task 9) — e o texto ainda não implementado da Task 12 (`addStudentToSession`, linhas 2263-2272 antes desta correção) tinha exatamente a **quarta** cópia. Passou do "três iguais é aceitável" para "toda mudança futura na regra de plano ativo precisa lembrar de 4 lugares". Extraído agora, antes que a Task 12 escreva a quarta cópia.

Numeração fora de sequência de propósito (9.5, não 10): correção de lacuna achada no review, não passo do desenho original. Não depende de nenhuma outra task; deve rodar antes da Task 12 (que já foi ajustada abaixo para usar o helper).

**Files:**
- Create: `lib/billing/planEligibility.ts`
- Test: `lib/billing/planEligibility.test.ts`
- Modify: `features/financeiro/classDebt.ts`
- Modify: `features/aulas/adminActions.ts` (`enrollStudentInClass`)
- Modify: `features/aulas/actions.ts` (`bookSession`)

**Fora de escopo de propósito:** `reconcileAllActiveEnrollments` (`features/aulas/creditReconciliation.ts`) e a página da grade (Tasks 13/14) usam uma variante em lote (`activeSubStudents.filter(s => isSubscriptionCurrent(s, now))` sobre um array pré-carregado) — é uma forma diferente, otimizada para não fazer N queries, e um candidato mais fraco pra extração. Não tocar.

- [ ] **Step 1: Write the failing test**

```ts
// lib/billing/planEligibility.test.ts
import { describe, it, expect } from 'vitest'
import { hasActiveSubscriptionPlan } from './planEligibility'

function makeClient(sub: { gateway?: string; current_period_end: string | null } | null) {
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: () => Promise.resolve({ data: sub }),
  }
  return { from: () => builder } as never
}

describe('hasActiveSubscriptionPlan', () => {
  it('sem assinatura ativa devolve false', async () => {
    expect(await hasActiveSubscriptionPlan(makeClient(null), 'stu-1', 'org-1')).toBe(false)
  })

  it('mercadopago com período vigente devolve true', async () => {
    const client = makeClient({ gateway: 'mercadopago', current_period_end: '2099-01-01T00:00:00Z' })
    expect(await hasActiveSubscriptionPlan(client, 'stu-1', 'org-1')).toBe(true)
  })

  it('mercadopago com período vencido devolve false', async () => {
    const client = makeClient({ gateway: 'mercadopago', current_period_end: '2020-01-01T00:00:00Z' })
    expect(await hasActiveSubscriptionPlan(client, 'stu-1', 'org-1')).toBe(false)
  })

  it('gateway manual é sempre vigente (gerido por fora)', async () => {
    const client = makeClient({ gateway: 'manual', current_period_end: null })
    expect(await hasActiveSubscriptionPlan(client, 'stu-1', 'org-1')).toBe(true)
  })

  it('gateway ausente (undefined) também é sempre vigente — mesma regra de isSubscriptionCurrent', async () => {
    const client = makeClient({ current_period_end: null })
    expect(await hasActiveSubscriptionPlan(client, 'stu-1', 'org-1')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- lib/billing/planEligibility.test.ts`
Expected: FAIL — `Failed to resolve import "./planEligibility"`

- [ ] **Step 3: Write the implementation**

```ts
// lib/billing/planEligibility.ts
// "Tem plano ativo?" isolado num único ponto — extraído depois que o mesmo
// bloco de 6 linhas apareceu em 3 call sites (classDebt, enrollStudentInClass,
// bookSession) e uma 4ª cópia (addStudentToSession, Task 12) estava prestes a
// repetir. Aceita um client injetável para reusar a mesma instância do caller
// e para ser testável com o padrão de stub já usado em classDebt.test.ts.
import { isSubscriptionCurrent } from './periodicity'
import type { createAdminClient } from '@/lib/supabase/server'

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * 'active' com período vencido NÃO conta — mesmo critério em toda a spec
 * (docs/superpowers/specs/2026-07-16-regras-acesso-credito-design.md §1).
 */
export async function hasActiveSubscriptionPlan(
  client: AdminClient,
  studentId: string,
  orgId: string,
): Promise<boolean> {
  const { data: sub } = await client
    .from('student_subscriptions')
    .select('gateway, current_period_end')
    .eq('student_id', studentId)
    .eq('organization_id', orgId)
    .eq('status', 'active')
    .maybeSingle()

  return !!sub && isSubscriptionCurrent(sub as { gateway: string; current_period_end: string | null }, new Date())
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- lib/billing/planEligibility.test.ts`
Expected: PASS — 5 passed

- [ ] **Step 5: Retrofit `features/financeiro/classDebt.ts`**

Troque o import `isSubscriptionCurrent` por `hasActiveSubscriptionPlan`:

```ts
import { hasActiveSubscriptionPlan } from '@/lib/billing/planEligibility'
```

E substitua o bloco 3:

```ts
  // 3. Plano vigente entra de graça. 'active' com período vencido NÃO conta —
  //    mesmo critério da reconciliação (spec §1).
  const { data: sub } = await client
    .from('student_subscriptions')
    .select('gateway, current_period_end')
    .eq('student_id', studentId)
    .eq('organization_id', orgId)
    .eq('status', 'active')
    .maybeSingle()

  if (sub && isSubscriptionCurrent(sub as { gateway: string; current_period_end: string | null }, new Date())) {
    return
  }
```

por:

```ts
  // 3. Plano vigente entra de graça. 'active' com período vencido NÃO conta —
  //    mesmo critério da reconciliação (spec §1).
  if (await hasActiveSubscriptionPlan(client, studentId, orgId)) return
```

- [ ] **Step 6: Retrofit `enrollStudentInClass` em `features/aulas/adminActions.ts`**

Troque o import `isSubscriptionCurrent` por `hasActiveSubscriptionPlan`. Substitua:

```ts
  if (!(membership as { partner: string | null }).partner) {
    const { data: sub } = await adminClient
      .from('student_subscriptions')
      .select('gateway, current_period_end')
      .eq('student_id', studentId)
      .eq('organization_id', orgId)
      .eq('status', 'active')
      .maybeSingle()

    const hasActivePlan =
      !!sub && isSubscriptionCurrent(sub as { gateway: string; current_period_end: string | null }, new Date())

    if (!hasActivePlan) {
```

por:

```ts
  if (!(membership as { partner: string | null }).partner) {
    const hasActivePlan = await hasActiveSubscriptionPlan(adminClient, studentId, orgId)

    if (!hasActivePlan) {
```

- [ ] **Step 7: Retrofit `bookSession` em `features/aulas/actions.ts`**

Troque o import `isSubscriptionCurrent` por `hasActiveSubscriptionPlan`. Substitua:

```ts
  // Plano vigente: 'active' com período vencido NÃO dá acesso — mesmo critério
  // da reconciliação (spec §1).
  const { data: sub } = await adminClient
    .from('student_subscriptions')
    .select('gateway, current_period_end')
    .eq('student_id', user.id)
    .eq('organization_id', orgId)
    .eq('status', 'active')
    .maybeSingle()

  const hasActivePlan =
    !!sub && isSubscriptionCurrent(sub as { gateway: string; current_period_end: string | null }, new Date())
```

por:

```ts
  // Plano vigente: 'active' com período vencido NÃO dá acesso — mesmo critério
  // da reconciliação (spec §1).
  const hasActivePlan = await hasActiveSubscriptionPlan(adminClient, user.id, orgId)
```

- [ ] **Step 8: Confirmar que `isSubscriptionCurrent` não ficou órfão nesses 3 arquivos**

Run: `grep -n "isSubscriptionCurrent" features/financeiro/classDebt.ts features/aulas/adminActions.ts features/aulas/actions.ts`
Expected: nenhum resultado — o import foi trocado por `hasActiveSubscriptionPlan` em todos os três.

- [ ] **Step 9: Verify**

Run: `npm run build`
Expected: compila sem erro

Run: `npm run lint`
Expected: sem erro

Run: `npm run test:run`
Expected: toda a suíte passa, incluindo os testes já existentes de `classDebt.test.ts` (o comportamento não muda, só a forma)

- [ ] **Step 10: Commit**

```bash
git add lib/billing/planEligibility.ts lib/billing/planEligibility.test.ts features/financeiro/classDebt.ts features/aulas/adminActions.ts features/aulas/actions.ts
git commit -m "refactor(billing): extrai hasActiveSubscriptionPlan, usado por classDebt/enroll/bookSession"
```

---

### Task 10: Check-in casa a sessão pela janela de ±1h

**Files:**
- Modify: `lib/checkin/ingest.ts:13-48` (`findLinkedSession`), `lib/checkin/ingest.ts:63-115` (`recordResolvedCheckin`)

Três mudanças (spec §7): janela em vez de data; casar por **reserva confirmada** em vez de matrícula fixa (hoje uma reserva avulsa nunca marca presença); e não sobrescrever presença já registrada.

- [ ] **Step 1: Imports**

Em `lib/checkin/ingest.ts`:

```ts
import { findSessionInWindow } from './sessionWindow'
import { sessionStartIso } from '@/lib/utils/sessionTime'
import { ensureClassDebt } from '@/features/financeiro/classDebt'
```

- [ ] **Step 2: Reescrever `findLinkedSession`**

Substitua a função inteira (linhas 13–48):

```ts
/**
 * Sessão com reserva confirmada do aluno cujo horário de início está a até 1h
 * do check-in (antes ou depois).
 *
 * Casa por RESERVA, não por matrícula fixa: antes só olhava turmas com
 * enrollment ativa, então uma reserva avulsa nunca marcava presença — a regra
 * é "a aula onde o aluno está vinculado" (spec §7).
 */
export async function findLinkedSession(
  client: AdminClient,
  studentId: string,
  orgId: string,
  checkinAt: string,
): Promise<string | null> {
  // Janela de ±1h pode atravessar a meia-noite: busca o dia do check-in e os
  // vizinhos, e deixa a comparação de instante para findSessionInWindow.
  const day = checkinAt.slice(0, 10)
  const dayBefore = new Date(new Date(day).getTime() - 86400000).toISOString().slice(0, 10)
  const dayAfter = new Date(new Date(day).getTime() + 86400000).toISOString().slice(0, 10)

  const { data: sessionsRaw } = await client
    .from('class_sessions')
    .select('id, session_date, class:classes(start_time)')
    .eq('organization_id', orgId)
    .eq('status', 'scheduled')
    .in('session_date', [dayBefore, day, dayAfter])

  type Row = {
    id: string
    session_date: string
    class: { start_time: string } | { start_time: string }[] | null
  }
  const rows = (sessionsRaw ?? []) as unknown as Row[]
  if (rows.length === 0) return null

  // Só sessões em que o aluno tem reserva confirmada.
  const { data: bookingsRaw } = await client
    .from('session_bookings')
    .select('session_id')
    .eq('student_id', studentId)
    .eq('status', 'confirmed')
    .in('session_id', rows.map((r) => r.id))

  const booked = new Set(
    (bookingsRaw ?? []).map((b: { session_id: string }) => b.session_id),
  )
  if (booked.size === 0) return null

  const candidates = rows
    .filter((r) => booked.has(r.id))
    .map((r) => {
      const cls = Array.isArray(r.class) ? r.class[0] : r.class
      if (!cls?.start_time) return null
      // sessionStartIso ancora em -03:00. Sem isso a janela erra por 3h.
      return { id: r.id, startsAt: sessionStartIso(r.session_date, cls.start_time) }
    })
    .filter((c): c is { id: string; startsAt: string } => c !== null)

  return findSessionInWindow(candidates, checkinAt)
}
```

- [ ] **Step 3: Atualizar `recordResolvedCheckin`**

`RecordResolvedInput` tem `date: string` (YYYY-MM-DD), usado para gravar `checkin_date` e para achar a sessão. Agora precisa do instante. Adicione o campo:

```ts
export interface RecordResolvedInput {
  orgId: string
  studentId: string
  partner: CheckinPartner
  /** YYYY-MM-DD — grava em checkins.checkin_date. */
  date: string
  /** Instante ISO do check-in. Usado para casar a sessão na janela de ±1h. */
  checkinAt: string
  externalRef: string | null
  validation: 'manual' | CheckinPartner
  createdBy?: string | null
}
```

Troque a chamada:

```ts
  const linkedSessionId = await findLinkedSession(client, input.studentId, input.orgId, input.date)
```

por:

```ts
  const linkedSessionId = await findLinkedSession(
    client,
    input.studentId,
    input.orgId,
    input.checkinAt,
  )
```

E substitua o bloco de presença (hoje um `upsert` com `onConflict`):

```ts
  if (linkedSessionId) {
    // ignoreDuplicates: "exceto quando o processo já realizou" (spec §7). Um
    // check-in reenviado NÃO pode reescrever uma presença que o professor já
    // ajustou na mão — antes o upsert sobrescrevia.
    const { error: attendanceError } = await client.from('attendance').upsert(
      {
        organization_id: input.orgId,
        student_id: input.studentId,
        session_id: linkedSessionId,
        status: 'present',
        source: input.partner,
        checked_in_at: new Date().toISOString(),
      },
      { onConflict: 'student_id,session_id', ignoreDuplicates: true },
    )
    if (attendanceError) {
      throw new Error(`Falha ao marcar presença: ${attendanceError.message}`)
    }

    // Presença gera pendência (spec §5). Aluno de parceiro nunca gera — o
    // ensureClassDebt confere isso —, mas a chamada fica aqui porque um
    // check-in manual do admin pode ser de aluno sem parceiro.
    try {
      await ensureClassDebt(client, {
        orgId: input.orgId,
        studentId: input.studentId,
        sessionId: linkedSessionId,
      })
    } catch (err) {
      console.error('[recordResolvedCheckin] ensureClassDebt falhou', {
        sessionId: linkedSessionId,
        studentId: input.studentId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
```

- [ ] **Step 4: Corrigir os callers de `recordResolvedCheckin`**

Run: `grep -rn "recordResolvedCheckin\|ingestPartnerCheckin" --include=*.ts . | grep -v node_modules | grep -v worktrees | grep -v "\.test\."`
Expected: `lib/checkin/ingest.ts`, `features/checkin/actions.ts`, `app/api/webhooks/wellhub/route.ts`

Em cada caller, adicione `checkinAt` ao objeto passado:
- Check-in manual do admin (`features/checkin/actions.ts`): `checkinAt: new Date().toISOString()`.
- Webhook (`ingestPartnerCheckin` → `recordResolvedCheckin`): propague `input.checkinAt`. Adicione `checkinAt: string` a `IngestPartnerCheckinInput` e passe adiante; no handler do webhook use o timestamp do evento se ele vier no payload, senão `new Date().toISOString()`.

- [ ] **Step 5: Atualizar os testes existentes de ingest**

Run: `npm run test:run -- lib/checkin/ingest.test.ts`
Expected: FAIL — falta `checkinAt` em `IngestPartnerCheckinInput`

O fake client de `lib/checkin/ingest.test.ts:37` resolve `{ data: [] }` para qualquer `await` no builder. A nova `findLinkedSession` consulta `class_sessions` e recebe `[]`, então continua devolvendo `null` — **todos os 7 testes seguem válidos** e o `linkedSessionId: null` que eles esperam continua correto. A única mudança é o `base` (linha 61):

```ts
  const base = {
    orgId: 'org-1',
    partner: 'wellhub' as const,
    partnerMemberId: 'GP123456',
    date: '2026-06-25',
    checkinAt: '2026-06-25T22:00:00Z',
    externalRef: 'evt_abc123',
    payload: { raw: true },
  }
```

Atualize também o comentário do fake client (linhas 10-14), que cita `enrollments` — a função não consulta mais essa tabela:

```ts
// Client falso: suporta o subconjunto de chamadas que o núcleo faz.
// - maybeSingle(): memberships (lookup do aluno), checkins (idempotência)
// - await builder: class_sessions (findLinkedSession curto-circuita com [])
// - insert(): checkins, pending_checkins (este último com .select('id').single())
// - update(): checkins, pending_checkins (fire-and-forget, encadeia .eq())
```

Run: `npm run test:run -- lib/checkin/ingest.test.ts`
Expected: PASS — 7 passed

- [ ] **Step 6: Verify**

Run: `npm run test:run`
Expected: toda a suíte passa

Run: `npm run build`
Expected: compila

- [ ] **Step 7: Commit**

```bash
git add lib/checkin/ingest.ts features/checkin/actions.ts app/api/webhooks/wellhub/route.ts lib/checkin/ingest.test.ts
git commit -m "feat(checkin): casa sessao por janela de +/-1h e nao sobrescreve presenca existente"
```

---

### Task 11: Cron de expiração de crédito

**Files:**
- Create: `app/api/cron/credit-expiry/route.ts`
- Modify: `app/api/cron/monthly-credit-renewal/route.ts`
- Modify: `vercel.json`

- [ ] **Step 1: Criar o cron**

```ts
// app/api/cron/credit-expiry/route.ts
// Expira créditos vencidos. Até 2026-07 isto NÃO existia: credit_expiry_days era
// configurável na UI e não fazia nada. Passou a importar porque, com plano deixando
// de emitir crédito, o saldo acumula de verdade (spec §3.1).
import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { createAdminClient } from '@/lib/supabase/server'
import { verifyCronSecret } from '@/lib/auth/cronAuth'
import { replayCredits } from '@/lib/utils/creditLots'

export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const admin = createAdminClient()
    const now = new Date()

    // Só quem tem saldo pode ter crédito a expirar.
    const { data: membersRaw } = await admin
      .from('memberships')
      .select('user_id, organization_id, credits_balance')
      .gt('credits_balance', 0)

    const members = (membersRaw ?? []) as {
      user_id: string
      organization_id: string
      credits_balance: number
    }[]

    let expiredStudents = 0
    let expiredCredits = 0
    let failed = 0

    for (const m of members) {
      try {
        const { data: txsRaw } = await admin
          .from('credit_transactions')
          .select('amount, created_at, expires_at')
          .eq('student_id', m.user_id)
          .eq('organization_id', m.organization_id)

        const txs = (txsRaw ?? []) as {
          amount: number
          created_at: string
          expires_at: string | null
        }[]

        const { expiredAmount } = replayCredits(txs, now)
        if (expiredAmount <= 0) continue

        // adjust_credits mantém credit_transactions como fonte da verdade e o
        // saldo cacheado em sincronia — nunca faça UPDATE direto no saldo.
        const { error } = await admin.rpc('adjust_credits', {
          p_student_id: m.user_id,
          p_org: m.organization_id,
          p_delta: -expiredAmount,
          p_type: 'expired',
          p_reason: `Expiração de ${expiredAmount} crédito(s) não utilizado(s)`,
        })
        if (error) throw new Error(error.message)

        expiredStudents++
        expiredCredits += expiredAmount
      } catch (err) {
        failed++
        console.error('[cron/credit-expiry] falhou para um aluno', {
          studentId: m.user_id,
          organizationId: m.organization_id,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    return NextResponse.json({ expiredStudents, expiredCredits, failed })
  } catch (e) {
    Sentry.captureException(e, { tags: { cron: 'credit-expiry' } })
    return NextResponse.json({ error: 'Cron failed' }, { status: 500 })
  }
}
```

- [ ] **Step 2: Aposentar a renovação mensal**

Substitua **todo** o conteúdo de `app/api/cron/monthly-credit-renewal/route.ts`:

```ts
// app/api/cron/monthly-credit-renewal/route.ts
// Plano não emite mais crédito (spec §3), então não há renovação a fazer. O que
// resta é reservar as sessões do mês para as matrículas fixas ativas — mesma
// janela, sem tocar em crédito.
import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { reconcileAllActiveEnrollments } from '@/features/aulas/creditReconciliation'
import { getMonthWindow } from '@/lib/utils/monthWindow'
import { verifyCronSecret } from '@/lib/auth/cronAuth'

export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Roda no dia 1 → janela = mês inteiro corrente.
    const { from, to } = getMonthWindow(new Date())
    const summary = await reconcileAllActiveEnrollments(from, to)
    return NextResponse.json({ window: { from, to }, ...summary })
  } catch (e) {
    Sentry.captureException(e, { tags: { cron: 'monthly-credit-renewal' } })
    return NextResponse.json({ error: 'Cron failed' }, { status: 500 })
  }
}
```

(O corpo é o mesmo; a mudança real foi na `reconcileAllActiveEnrollments`, na Task 7. Só o comentário do topo muda, para o próximo leitor não procurar renovação de crédito que não existe mais.)

- [ ] **Step 3: Registrar o cron**

Em `vercel.json`, adicione ao array `crons`:

```json
    {
      "path": "/api/cron/credit-expiry",
      "schedule": "0 3 * * *"
    }
```

Diário às 3h UTC (meia-noite BRT). Expiração é por data, então rodar todo dia mantém o erro em no máximo 24h.

- [ ] **Step 4: Verify**

Run: `npm run build`
Expected: compila

Run: `node -e "JSON.parse(require('fs').readFileSync('vercel.json','utf8')); console.log('vercel.json ok')"`
Expected: `vercel.json ok`

- [ ] **Step 5: Commit**

```bash
git add app/api/cron/credit-expiry/route.ts app/api/cron/monthly-credit-renewal/route.ts vercel.json
git commit -m "feat(credito): cron diario expira creditos vencidos via replay FIFO"
```

---

### Task 12: Admin adiciona aluno à sessão, com motivo

**Files:**
- Modify: `features/aulas/adminActions.ts` (nova action `addStudentToSession`)
- Modify: `types/index.ts` (tipo `AddStudentReason`)

A porta que ignora o bloqueio por dívida: o admin adiciona qualquer aluno a qualquer aula, sempre (aula experimental, pagamento na hora, aluno quitando no balcão).

O motivo é uma **pré-declaração**: grava a linha `payments` na hora, e o índice único da Task 4 faz essa linha suprimir a dívida automática quando a presença for marcada. "Deixar em aberto" não grava nada de propósito — o caminho automático da presença já faz o que ele quer.

- [ ] **Step 1: Adicionar o tipo**

Em `types/index.ts`, junto dos outros tipos de aulas:

```ts
/**
 * Motivo da adição de um aluno sem plano, parceiro nem crédito a uma sessão.
 * Pré-declaração: 'experimental' e 'on_spot' gravam payments na hora, o que
 * SUPRIME a dívida automática da presença (via payments_session_student_unique).
 * 'open' não grava nada — a presença cria a pendência normalmente.
 */
export type AddStudentReason = 'experimental' | 'on_spot' | 'open'
```

- [ ] **Step 2: Escrever a action**

Em `features/aulas/adminActions.ts`, ao final do arquivo:

```ts
// ---------------------------------------------------------------------------
// addStudentToSession — admin/professor adiciona aluno avulso a uma sessão
// ---------------------------------------------------------------------------

/**
 * Adiciona um aluno a uma sessão, com ou sem crédito, plano ou parceiro.
 *
 * IGNORA o bloqueio por dívida de propósito (spec §1): o admin pode estar
 * adicionando justamente o aluno que está quitando no balcão. Esta é a única
 * porta com essa permissão.
 *
 * `reason` só é considerado quando o aluno não tem plano, parceiro nem crédito;
 * caso contrário o caminho normal decide (parceiro/plano entram de graça,
 * crédito debita).
 */
export async function addStudentToSession(
  sessionId: string,
  studentId: string,
  reason: AddStudentReason,
): Promise<{ error?: string }> {
  const { orgId, error: authErr } = await requireAdmin()
  if (authErr) return { error: authErr }

  const adminClient = createAdminClient()

  const { data: session } = await adminClient
    .from('class_sessions')
    .select('id, status, class:classes(max_students)')
    .eq('id', sessionId)
    .eq('organization_id', orgId)
    .single()

  if (!session) return { error: 'Sessão não encontrada.' }
  if ((session as { status: string }).status !== 'scheduled') {
    return { error: 'Esta sessão não está disponível.' }
  }

  const clsRaw = (session as { class: { max_students: number } | { max_students: number }[] }).class
  const cls = Array.isArray(clsRaw) ? clsRaw[0] : clsRaw

  const { data: membership } = await adminClient
    .from('memberships')
    .select('partner, credits_balance')
    .eq('user_id', studentId)
    .eq('organization_id', orgId)
    .maybeSingle()

  if (!membership) return { error: 'Aluno não participa desta academia.' }
  const mem = membership as { partner: string | null; credits_balance: number }

  const hasActivePlan = await hasActiveSubscriptionPlan(adminClient, studentId, orgId)

  // Note o hasOpenDebt: false — o admin ignora o bloqueio (ver doc acima).
  const decision = resolveClassAccess({
    partner: mem.partner as CheckinPartner | null,
    hasActivePlan,
    creditsBalance: mem.credits_balance,
    hasOpenDebt: false,
  })

  // 'denied' é inalcançável com hasOpenDebt: false, mas o TypeScript não sabe.
  if ('denied' in decision) return { error: 'Não foi possível adicionar o aluno.' }

  const useCredit = decision.grant === 'credit'

  const { error: bookErr } = await adminClient.rpc('book_session_atomic', {
    p_student_id: studentId,
    p_session_id: sessionId,
    p_max_students: cls.max_students,
    p_type: 'extra',
    p_from_enrollment: false,
    p_credit_used: useCredit,
  })

  if (bookErr) {
    if (bookErr.message.includes('SESSION_FULL')) return { error: 'Esta turma está lotada.' }
    if (bookErr.message.includes('ALREADY_BOOKED')) return { error: 'Aluno já está nesta aula.' }
    return { error: 'Erro ao adicionar o aluno.' }
  }

  if (useCredit) {
    const { error: creditErr } = await adminClient.rpc('adjust_credits', {
      p_student_id: studentId,
      p_org: orgId,
      p_delta: -1,
      p_type: 'used',
      p_reason: 'Adicionado à aula pelo admin',
      p_session_id: sessionId,
    })
    if (creditErr) {
      await adminClient
        .from('session_bookings')
        .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
        .eq('student_id', studentId)
        .eq('session_id', sessionId)
      return { error: 'Erro ao debitar o crédito. Tente novamente.' }
    }
  }

  // Pré-declaração. Só para quem não tem plano/parceiro/crédito — para os outros
  // a aula já está paga e gravar payments aqui seria cobrança dupla.
  if (decision.grant === 'debt' && reason !== 'open') {
    const { data: settingsRaw } = await adminClient
      .from('system_settings')
      .select('key, value')
      .eq('organization_id', orgId)
      .in('key', ['single_class_price'])

    const priceRow = ((settingsRaw ?? []) as { key: string; value: string }[]).find(
      (s) => s.key === 'single_class_price',
    )
    const price = parseFloat(priceRow?.value ?? '0') || 0

    const { error: payErr } = await adminClient.from('payments').insert({
      organization_id: orgId,
      student_id: studentId,
      session_id: sessionId,
      amount: reason === 'experimental' ? 0 : price,
      currency: 'BRL',
      status: 'paid',
      type: reason === 'experimental' ? 'trial' : 'per_class',
      gateway: 'manual',
      paid_at: new Date().toISOString(),
      credits_qty: null,
    })

    // 23505 = já havia pendência para este par: a aula já estava registrada.
    // Não é erro — e não derruba a reserva, que é o que o admin pediu.
    if (payErr && payErr.code !== '23505') {
      console.error('[addStudentToSession] pre-declaracao falhou', {
        sessionId, studentId, reason, error: payErr.message,
      })
    }
  }

  revalidatePath(`/admin/grade/${sessionId}`)
  return {}
}
```

Adicione aos imports do topo de `features/aulas/adminActions.ts`:

```ts
import { resolveClassAccess } from '@/lib/utils/accessRules'
import { hasActiveSubscriptionPlan } from '@/lib/billing/planEligibility'
import type { AddStudentReason, CheckinPartner } from '@/types'
```

(`hasActiveSubscriptionPlan` substitui o antigo import de `isSubscriptionCurrent` — a Task 9.5 extraiu esse bloco pra um helper compartilhado, usado aqui pela primeira vez sem duplicar.)

- [ ] **Step 3: Verify**

Run: `npm run build`
Expected: compila

Run: `npm run lint`
Expected: sem erro

- [ ] **Step 4: Commit**

```bash
git add features/aulas/adminActions.ts types/index.ts
git commit -m "feat(aulas): admin adiciona aluno avulso a sessao com motivo (experimental/pago/aberto)"
```

---

### Task 13: UI — seletor de motivo e aviso de pendência

**Files:**
- Create: `features/aulas/AddStudentToSession.tsx`
- Modify: `app/(admin)/admin/grade/[sessionId]/page.tsx`

Sem esta task a action da Task 12 é código inalcançável. Duas coisas do spec §UI: o seletor de motivo (só para aluno sem plano/parceiro/crédito) e o aviso de que a presença vai virar dívida.

- [ ] **Step 1: Criar o componente**

```tsx
// features/aulas/AddStudentToSession.tsx
'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import type { AddStudentReason } from '@/types'

export interface AddableStudent {
  id: string
  full_name: string
  /** true quando o aluno não tem plano, parceiro nem crédito: entra devendo. */
  wouldOweDebt: boolean
}

interface Props {
  sessionId: string
  students: AddableStudent[]
  onAdd: (
    sessionId: string,
    studentId: string,
    reason: AddStudentReason,
  ) => Promise<{ error?: string }>
}

const REASONS: { value: AddStudentReason; label: string; hint: string }[] = [
  { value: 'experimental', label: 'Aula experimental', hint: 'Grátis, sem cobrança.' },
  { value: 'on_spot', label: 'Pagou na hora', hint: 'Entra no relatório como recebido.' },
  { value: 'open', label: 'Deixar em aberto', hint: 'Vira pendência a cobrar.' },
]

export function AddStudentToSession({ sessionId, students, onAdd }: Props) {
  const [studentId, setStudentId] = useState('')
  const [reason, setReason] = useState<AddStudentReason>('experimental')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const selected = students.find((s) => s.id === studentId)
  // O motivo só faz sentido para quem entraria devendo. Quem tem plano, parceiro
  // ou crédito já tem a aula paga — perguntar seria ruído (spec §6).
  const needsReason = selected?.wouldOweDebt ?? false

  function handleAdd() {
    if (!studentId) return
    setError(null)
    startTransition(async () => {
      const result = await onAdd(sessionId, studentId, needsReason ? reason : 'open')
      if (result.error) setError(result.error)
      else setStudentId('')
    })
  }

  if (students.length === 0) return null

  return (
    <Card>
      <h2 className="text-sm font-semibold text-white mb-3">Adicionar aluno</h2>

      <select
        value={studentId}
        onChange={(e) => setStudentId(e.target.value)}
        className="w-full bg-surface border border-surface-border rounded-lg px-3 py-2 text-sm text-white mb-3"
      >
        <option value="">Selecione um aluno…</option>
        {students.map((s) => (
          <option key={s.id} value={s.id}>
            {s.full_name}
            {s.wouldOweDebt ? ' — sem plano/crédito' : ''}
          </option>
        ))}
      </select>

      {needsReason && (
        <div className="space-y-2 mb-3">
          <p className="text-xs text-yellow-400">
            ⚠️ Este aluno não tem plano, Wellhub/TotalPass nem crédito.
          </p>
          {REASONS.map((r) => (
            <label
              key={r.value}
              className="flex items-start gap-2 text-xs text-slate-300 cursor-pointer"
            >
              <input
                type="radio"
                name="reason"
                value={r.value}
                checked={reason === r.value}
                onChange={() => setReason(r.value)}
                className="mt-0.5"
              />
              <span>
                <span className="text-white font-medium">{r.label}</span>
                <span className="text-slate-400"> — {r.hint}</span>
              </span>
            </label>
          ))}
        </div>
      )}

      {error && <p className="text-xs text-red-400 mb-2">{error}</p>}

      <Button
        size="sm"
        loading={isPending}
        disabled={!studentId || isPending}
        onClick={handleAdd}
        className="w-full"
      >
        Adicionar à aula
      </Button>
    </Card>
  )
}
```

- [ ] **Step 2: Alimentar o componente na página da sessão**

Em `app/(admin)/admin/grade/[sessionId]/page.tsx`, adicione aos imports:

```ts
import { AddStudentToSession, type AddableStudent } from '@/features/aulas/AddStudentToSession'
import { addStudentToSession } from '@/features/aulas/adminActions'
import { isSubscriptionCurrent } from '@/lib/billing/periodicity'
```

Depois do bloco que monta `students` (que termina no `.sort(...)`), insira:

```ts
  // Alunos da academia que ainda NÃO estão nesta sessão. `wouldOweDebt` decide
  // se o seletor de motivo aparece — mesma regra do resolveClassAccess, mas sem
  // o eixo dívida: o admin ignora o bloqueio (spec §1).
  const { data: allMemsRaw } = await adminClient
    .from('memberships')
    .select('user_id, partner, credits_balance')
    .eq('organization_id', orgId)
    .eq('role', 'student')

  const allMems = (allMemsRaw ?? []) as {
    user_id: string
    partner: string | null
    credits_balance: number
  }[]
  const candidateIds = allMems.map((m) => m.user_id).filter((id) => !studentIds.includes(id))

  const { data: candidateProfiles } =
    candidateIds.length > 0
      ? await adminClient.from('profiles').select('id, full_name').in('id', candidateIds)
      : { data: [] }

  const { data: candidateSubsRaw } =
    candidateIds.length > 0
      ? await adminClient
          .from('student_subscriptions')
          .select('student_id, gateway, current_period_end')
          .in('student_id', candidateIds)
          .eq('organization_id', orgId)
          .eq('status', 'active')
      : { data: [] }

  const now = new Date()
  const planStudents = new Set(
    ((candidateSubsRaw ?? []) as {
      student_id: string
      gateway: string
      current_period_end: string | null
    }[])
      .filter((s) => isSubscriptionCurrent(s, now))
      .map((s) => s.student_id),
  )
  const memById = new Map(allMems.map((m) => [m.user_id, m]))

  const addableStudents: AddableStudent[] = (candidateProfiles ?? [])
    .map((p: Pick<Profile, 'id' | 'full_name'>) => {
      const mem = memById.get(p.id)
      const hasAccess =
        !!mem?.partner || planStudents.has(p.id) || (mem?.credits_balance ?? 0) >= 1
      return { id: p.id, full_name: p.full_name, wouldOweDebt: !hasAccess }
    })
    .sort((a, b) => a.full_name.localeCompare(b.full_name, 'pt-BR'))
```

E no JSX, logo acima do `<AttendanceSheet ... />`:

```tsx
      <AddStudentToSession
        sessionId={params.sessionId}
        students={addableStudents}
        onAdd={addStudentToSession}
      />
```

- [ ] **Step 3: Verify**

Run: `npm run build`
Expected: compila

Run: `npm run lint`
Expected: sem erro

- [ ] **Step 4: Commit**

```bash
git add features/aulas/AddStudentToSession.tsx "app/(admin)/admin/grade/[sessionId]/page.tsx"
git commit -m "feat(aulas): UI de adicionar aluno a sessao com seletor de motivo"
```

---

### Task 14: Grade — alerta de "sem plano" no lugar de "sem crédito"

**Files:**
- Modify: `app/(admin)/admin/grade/page.tsx:89-111` e `:208-212`

O alerta atual conta alunos sem parceiro com `credits_balance < 1`. Com as regras novas ele está **errado**: em aula fixa o crédito deixou de importar, e o que a academia precisa ver é quem perdeu o plano — esse aluno para de ser reservado pela reconciliação e a vaga fica parada.

- [ ] **Step 1: Trocar a consulta**

Substitua o bloco que busca memberships e monta `noCreditMap` (as linhas que hoje vão de `const { data: enrollMemsRaw } =` até o fechamento do laço que preenche `noCreditMap`):

```ts
  // Quem está em aula fixa sem plano vigente e sem parceiro é irregular: a
  // reconciliação para de reservá-lo e a vaga fica parada. Fixa exige plano ou
  // parceiro (spec §2) — crédito não conta aqui.
  const { data: enrollMemsRaw } =
    enrolledStudentIds.length > 0
      ? await adminClient
          .from('memberships')
          .select('user_id, partner')
          .in('user_id', enrolledStudentIds)
          .eq('organization_id', orgId)
      : { data: [] }

  const partnerByStudent = new Map<string, string | null>()
  for (const m of (enrollMemsRaw ?? []) as { user_id: string; partner: string | null }[]) {
    partnerByStudent.set(m.user_id, m.partner)
  }

  const { data: subsRaw } =
    enrolledStudentIds.length > 0
      ? await adminClient
          .from('student_subscriptions')
          .select('student_id, gateway, current_period_end')
          .in('student_id', enrolledStudentIds)
          .eq('organization_id', orgId)
          .eq('status', 'active')
      : { data: [] }

  const now = new Date()
  const planStudents = new Set(
    ((subsRaw ?? []) as { student_id: string; gateway: string; current_period_end: string | null }[])
      .filter((s) => isSubscriptionCurrent(s, now))
      .map((s) => s.student_id),
  )

  const enrollCountMap = new Map<string, number>()
  const noPlanMap = new Map<string, number>()
  for (const e of enrollRows) {
    enrollCountMap.set(e.class_id, (enrollCountMap.get(e.class_id) ?? 0) + 1)
    const hasPartner = !!partnerByStudent.get(e.student_id)
    if (!hasPartner && !planStudents.has(e.student_id)) {
      noPlanMap.set(e.class_id, (noPlanMap.get(e.class_id) ?? 0) + 1)
    }
  }
```

Adicione ao topo de `app/(admin)/admin/grade/page.tsx`:

```ts
import { isSubscriptionCurrent } from '@/lib/billing/periodicity'
```

- [ ] **Step 2: Trocar o badge**

Substitua o bloco do alerta no JSX:

```tsx
                        {(noCreditMap.get(c.id) ?? 0) > 0 && (
                          <span className="text-xs text-yellow-400 font-medium">
                            ⚠️ {noCreditMap.get(c.id)} sem crédito
                          </span>
                        )}
```

por:

```tsx
                        {(noPlanMap.get(c.id) ?? 0) > 0 && (
                          <span className="text-xs text-yellow-400 font-medium">
                            ⚠️ {noPlanMap.get(c.id)} sem plano ativo
                          </span>
                        )}
```

- [ ] **Step 3: Verify**

Run: `npm run build`
Expected: compila, sem referência remanescente a `noCreditMap`

Run: `grep -rn "noCreditMap" "app/(admin)/admin/grade/page.tsx"`
Expected: nenhum resultado

- [ ] **Step 4: Commit**

```bash
git add "app/(admin)/admin/grade/page.tsx"
git commit -m "fix(grade): alerta passa a apontar aluno sem plano em aula fixa"
```

---

### Task 15: Verificação end-to-end

**Files:** nenhum (só verificação)

- [ ] **Step 1: Suíte completa**

Run: `npm run test:run`
Expected: todos passam. Nenhum teste menciona `granted`, `debited` ou `requiresCredit`.

- [ ] **Step 2: Tipos e lint**

Run: `npm run build`
Expected: compila

Run: `npm run lint`
Expected: sem erro

- [ ] **Step 3: Caçar sobras**

Run: `grep -rn "credits_per_month\|requiresCredit" --include=*.ts --include=*.tsx . | grep -v node_modules | grep -v worktrees`
Expected: nenhum resultado

Run: `grep -rn "isCreditExpired" --include=*.ts . | grep -v node_modules | grep -v worktrees`
Expected: só `lib/utils/creditRules.ts` e seu teste. **Apague a função e seus testes** — `replayCredits` a substituiu e ela nunca foi usada em produção. Commit: `chore(credito): remove isCreditExpired, substituida por replayCredits`

- [ ] **Step 4: Exercitar no app**

Invoque a skill `verify` para rodar o app e dirigir o fluxo de verdade. Roteiro mínimo:

1. Aluno com plano ativo agenda uma aula → entra sem gastar crédito; saldo não muda.
2. Aluno sem plano e sem crédito agenda → entra. Admin marca presença → aparece `payments` pendente com `session_id` e `amount = single_class_price`.
3. Esse mesmo aluno tenta agendar outra aula → bloqueado com a mensagem de aula em aberto.
4. Admin adiciona esse aluno bloqueado a uma sessão → **funciona** (a porta do admin ignora o bloqueio).
5. Admin tenta matricular aluno sem plano/parceiro numa fixa → erro pedindo plano.
6. Marcar presença duas vezes na mesma sessão → uma única linha em `payments`.

- [ ] **Step 5: Relatar**

Diga ao usuário o que foi verificado de verdade e o que não foi. O check-in de parceiro (janela ±1h) **não** dá para exercitar sem o sandbox da Wellhub — ver `reference-wellhub-sandbox-testing` na memória. Diga isso explicitamente em vez de deixar implícito que passou.

---

## Ordem de execução e dependências

```
Task 1 (accessRules)  ─┐
Task 2 (sessionWindow) ├─ puras, independentes, podem ir em paralelo
Task 3 (creditLots)   ─┘
Task 4 (migration)     ─── independente; precisa ser aplicada pelo usuário DEPOIS da Task 4.5 em produção
Task 4.5 (rm credits_per_month no app) ─── independente; correção de lacuna achada no review da Task 4
Task 5 (classDebt)     ─── precisa de 4 (índice único)
Task 6 (presença)      ─── precisa de 5
Task 7 (reconciliação) ─── precisa de 4 (drop credits_per_month)
Task 8 (fixa)          ─── precisa de 7
Task 9 (bookSession)   ─── precisa de 1
Task 9.5 (planEligibility) ─── independente; correção de lacuna achada no review da Task 9; precisa rodar antes da 12
Task 10 (check-in)     ─── precisa de 2 e 5
Task 11 (cron)         ─── precisa de 3 e 7
Task 12 (admin add)    ─── precisa de 1 e 4
Task 13 (UI add)       ─── precisa de 12
Task 14 (grade)        ─── precisa de 7
Task 15 (verificação)  ─── precisa de todas
```

## Cobertura do spec

| Seção do spec | Task |
|---|---|
| §1 Elegibilidade (`resolveClassAccess`) | 1 |
| §2 Matrícula fixa exige plano/parceiro | 8 |
| §3 Plano não emite crédito | 4 (drop), 4.5 (código do app + webhook MP), 7 (reconciliação), 11 (cron) |
| §3.1 Expiração de crédito | 3 (`replayCredits`), 11 (cron) |
| §4 Pendência em `payments` / `hasOpenDebt` | 5, 9 |
| §5 Dívida nasce na presença | 5, 6, 10 |
| §6 Motivo do admin (pré-declaração) | 12 (action), 13 (UI) |
| §7 Check-in na janela de ±1h | 2, 10 |
| Migração | 4 |
| UI (grade, seletor, aviso) | 13, 14 |
| Testes | 1, 2, 3, 5, 7, 10 |
