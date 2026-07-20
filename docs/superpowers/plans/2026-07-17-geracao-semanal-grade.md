# Geração Semanal da Grade — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar a geração de grade de 90 dias por geração semanal (7 dias à frente + reserva dos fixos), disparada na criação de turma, manualmente (um dia da semana ou a semana toda), e automaticamente via cron configurável por academia.

**Architecture:** Um núcleo `generateGrid(orgId, from, to, opts)` que todos os caminhos chamam — ele gera sessões idempotentes com `buildSessionRows` (já existe) e reserva os fixos com `reconcileAllActiveEnrollments` (já existe). O agendamento automático usa um cron horário + marca d'água (`grid_auto_last_run`) resiliente a atrasos, com a decisão de "rodar agora?" isolada numa função pura testável. Uma migration zera as sessões futuras do regime velho, preservando as já realizadas.

**Tech Stack:** Next.js 14 App Router · TypeScript · Supabase (Postgres) · Vitest · date-fns · Vercel Cron

**Spec:** [docs/superpowers/specs/2026-07-17-geracao-semanal-grade-design.md](../specs/2026-07-17-geracao-semanal-grade-design.md)

---

## Contexto para quem nunca viu este repo

Leia antes da Task 1. Fatos que explicam as escolhas:

1. **`system_settings` é key/value por academia.** PK composta `(organization_id, key)`. Uma linha por chave. Leitura: `select key, value where organization_id = orgId`. Escrita: `upsert(rows, { onConflict: 'organization_id,key' })`. Valores são sempre `text` — converta na leitura.
2. **Fuso fixo −03:00.** O projeto assume Brasília sem horário de verão (documentado em `lib/utils/sessionTime.ts`). Para obter o horário de parede BRT de um `Date` UTC: `new Date(now.getTime() - 3*3600*1000)` e ler `getUTCDay()`/`getUTCHours()`/etc. Nunca use `getDay()`/`getHours()` locais do servidor (roda em UTC).
3. **`createAdminClient()` ignora RLS** — toda query precisa de `.eq('organization_id', orgId)`. `createClient()` respeita RLS (use para saber quem é o usuário logado).
4. **Migrations são aplicadas pelo usuário** via `supabase db push` — você escreve o `.sql`, não roda. O CLI não está autenticado aqui.
5. **`buildSessionRows(classId, dayOfWeek, fromStr, toStr)`** (`features/aulas/sessionUtils.ts`) já existe e é puro: devolve as linhas de `class_sessions` para as datas do intervalo que caem no `dayOfWeek`. **Não reimplemente.**
6. **`reconcileAllActiveEnrollments(from, to, orgId?)`** (`features/aulas/creditReconciliation.ts`) já existe: reserva as matrículas fixas elegíveis (plano vigente ou parceiro) nas sessões scheduled do intervalo. Idempotente, não mexe em crédito. **Reuse.**

**Comandos:**
- `npm run test:run -- caminho/arquivo.test.ts` — roda um teste
- `npm run build` — checa tipos
- `npm run lint` — ESLint

---

## Estrutura de arquivos

**Criar:**

| Arquivo | Responsabilidade |
|---|---|
| `lib/utils/gridSchedule.ts` | Puro. Datas em BRT, próxima ocorrência de dia-da-semana, decisão do catch-up. |
| `lib/utils/gridSchedule.test.ts` | Bordas de fuso, catch-up, atraso. |
| `features/aulas/gridGeneration.ts` | `generateGrid` — gera sessões + reserva fixos. |
| `features/aulas/gridGeneration.test.ts` | Filtro de dia/turma, janela do reconcile, idempotência. |
| `features/aulas/authGuards.ts` | `requireAdmin()` extraído (reuso entre actions). |
| `features/aulas/gridActions.ts` | Server actions `generateGridDay`, `generateGridWeek`. |
| `app/(admin)/admin/grade/GridGenerateButtons.tsx` | Botões "Gerar [dia]" e "Gerar semana toda". |
| `app/(admin)/admin/configuracoes/GridAutoForm.tsx` | Config da auto-geração (toggle+dia+hora). |
| `app/api/cron/weekly-grid-generation/route.ts` | Cron horário catch-up. |
| `supabase/migrations/20260718000000_weekly_grid_reset.sql` | Expurgo das sessões futuras. |

**Modificar:**

| Arquivo | Mudança |
|---|---|
| `features/aulas/adminActions.ts` | Importa `requireAdmin` de `authGuards`; remove a def local; remove `generateSessionsForExistingClass` e `generateWeeklyBookings`. |
| `features/aulas/class-form-actions.ts` | `createClass` usa `generateGrid` (7d) no lugar dos 90d. |
| `features/financeiro/actions.ts` | `updateSystemSettings` aceita as 3 chaves novas de grade. |
| `app/(admin)/admin/configuracoes/page.tsx` | Lê as chaves de grade e passa ao `GridAutoForm`. |
| `app/(admin)/admin/grade/page.tsx` | Usa `GridGenerateButtons`; remove `GenerateSessionsButton`. |
| `vercel.json` | Adiciona cron `weekly-grid-generation`; remove `monthly-credit-renewal`. |

**Deletar:**

| Arquivo | Motivo |
|---|---|
| `app/(admin)/admin/grade/GenerateSessionsButton.tsx` | Botão por-turma (90d + "sem crédito" obsoleto). |
| `app/api/cron/monthly-credit-renewal/route.ts` | Redundante com a geração semanal. |

**Ordem:** Tasks 1–2 são puras/independentes. Task 3 (extrair requireAdmin) destrava a Task 4. Tasks 5–8 dependem do núcleo. Task 9 (migration) é independente. Task 10 (limpeza) vem depois da Task 6 (que remove o último uso das actions velhas). Task 11 verifica.

---

### Task 1: `gridSchedule` — datas BRT e decisão do catch-up

**Files:**
- Create: `lib/utils/gridSchedule.ts`
- Test: `lib/utils/gridSchedule.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/utils/gridSchedule.test.ts
import { describe, it, expect } from 'vitest'
import { brtToday, addDaysStr, nextDateForDayOfWeek, shouldRunGridNow } from './gridSchedule'

describe('brtToday', () => {
  it('devolve a data BRT (não UTC) — 01:00Z de 18/07 ainda é 17/07 em BRT', () => {
    // 2026-07-18T01:00:00Z = 2026-07-17T22:00:00 BRT.
    expect(brtToday(new Date('2026-07-18T01:00:00Z'))).toBe('2026-07-17')
  })

  it('meio-dia UTC cai no mesmo dia em BRT', () => {
    expect(brtToday(new Date('2026-07-17T12:00:00Z'))).toBe('2026-07-17')
  })
})

describe('addDaysStr', () => {
  it('soma dias a uma data yyyy-MM-dd', () => {
    expect(addDaysStr('2026-07-17', 6)).toBe('2026-07-23')
  })

  it('atravessa a virada de mês', () => {
    expect(addDaysStr('2026-07-30', 6)).toBe('2026-08-05')
  })
})

describe('nextDateForDayOfWeek', () => {
  it('mesma data quando o dia-da-semana já bate (17/07/2026 é sexta = 5)', () => {
    expect(nextDateForDayOfWeek('2026-07-17', 5)).toBe('2026-07-17')
  })

  it('próxima terça (2) a partir de uma sexta', () => {
    // 17/07 sexta → próxima terça é 21/07.
    expect(nextDateForDayOfWeek('2026-07-17', 2)).toBe('2026-07-21')
  })

  it('próximo domingo (0) a partir de uma sexta', () => {
    expect(nextDateForDayOfWeek('2026-07-17', 0)).toBe('2026-07-19')
  })
})

describe('shouldRunGridNow', () => {
  // Alvo: toda segunda (1) às 06:00 BRT. 20/07/2026 é segunda.
  const NOW_MON_7AM = new Date('2026-07-20T10:00:00Z') // 07:00 BRT segunda
  const NOW_MON_5AM = new Date('2026-07-20T08:00:00Z') // 05:00 BRT segunda (antes do alvo)

  it('roda quando passou do alvo e nunca rodou', () => {
    expect(shouldRunGridNow(1, 6, null, NOW_MON_7AM)).toBe(true)
  })

  it('não roda antes da hora-alvo no dia certo', () => {
    // 05:00 BRT segunda: o alvo mais recente é a segunda ANTERIOR 06:00 (13/07).
    // Se nunca rodou, roda esse alvo antigo — mas a marca d'água de "rodou 13/07"
    // impede. Aqui lastRun cobre o alvo de 13/07, então NÃO roda às 05:00.
    expect(shouldRunGridNow(1, 6, '2026-07-13T09:00:00Z', NOW_MON_5AM)).toBe(false)
  })

  it('não roda de novo no mesmo alvo (marca d\'água >= alvo)', () => {
    // lastRun = 20/07 06:30 BRT (09:30Z) cobre o alvo de 20/07 06:00.
    expect(shouldRunGridNow(1, 6, '2026-07-20T09:30:00Z', NOW_MON_7AM)).toBe(false)
  })

  it('roda um alvo atrasado (cron perdeu a hora exata)', () => {
    // Agora é terça 10:00 BRT; alvo era segunda 06:00; última execução foi há 2 semanas.
    const NOW_TUE = new Date('2026-07-21T13:00:00Z') // terça 10:00 BRT
    expect(shouldRunGridNow(1, 6, '2026-07-06T09:00:00Z', NOW_TUE)).toBe(true)
  })

  it('lastRun logo antes do alvo mais recente ainda dispara', () => {
    // Alvo mais recente = 20/07 06:00 BRT (09:00Z). lastRun = 20/07 05:00 BRT (08:00Z) < alvo.
    expect(shouldRunGridNow(1, 6, '2026-07-20T08:00:00Z', NOW_MON_7AM)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- lib/utils/gridSchedule.test.ts`
Expected: FAIL — `Failed to resolve import "./gridSchedule"`

- [ ] **Step 3: Write the implementation**

```ts
// lib/utils/gridSchedule.ts
// Puro: datas em BRT e a decisão do cron de auto-geração. Fuso fixo −03:00
// (Brasília sem DST desde 2019, igual lib/utils/sessionTime.ts). Sem I/O.

const BRT_OFFSET_MS = 3 * 60 * 60 * 1000

/** Partes de "parede" em BRT de um instante UTC. */
function brtParts(now: Date): { year: number; month: number; day: number; dow: number; hour: number } {
  const b = new Date(now.getTime() - BRT_OFFSET_MS)
  return {
    year: b.getUTCFullYear(),
    month: b.getUTCMonth(), // 0-11
    day: b.getUTCDate(),
    dow: b.getUTCDay(), // 0=domingo
    hour: b.getUTCHours(),
  }
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** Data de hoje em BRT como yyyy-MM-dd. */
export function brtToday(now: Date): string {
  const p = brtParts(now)
  return `${p.year}-${pad(p.month + 1)}-${pad(p.day)}`
}

/** Soma dias a uma data yyyy-MM-dd (puro, sem fuso — opera em UTC). */
export function addDaysStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const base = new Date(Date.UTC(y, m - 1, d))
  base.setUTCDate(base.getUTCDate() + days)
  return `${base.getUTCFullYear()}-${pad(base.getUTCMonth() + 1)}-${pad(base.getUTCDate())}`
}

/** Primeira data >= fromStr cujo dia-da-semana é dayOfWeek (0=domingo). */
export function nextDateForDayOfWeek(fromStr: string, dayOfWeek: number): string {
  const [y, m, d] = fromStr.split('-').map(Number)
  const from = new Date(Date.UTC(y, m - 1, d))
  const offset = (dayOfWeek - from.getUTCDay() + 7) % 7
  return addDaysStr(fromStr, offset)
}

/**
 * Instante UTC do alvo mais recente (<= now) em que ocorreu targetDay + targetHour
 * no horário de parede BRT.
 */
function mostRecentTargetUtc(targetDay: number, targetHour: number, now: Date): Date {
  const p = brtParts(now)
  // Instante BRT-de-parede de hoje na hora-alvo, expresso em UTC.
  let target = new Date(Date.UTC(p.year, p.month, p.day, targetHour, 0, 0) + BRT_OFFSET_MS)
  // Recua até bater o dia-da-semana e não passar de `now`.
  const targetDow = new Date(target.getTime() - BRT_OFFSET_MS).getUTCDay()
  let back = (targetDow - targetDay + 7) % 7
  target = new Date(target.getTime() - back * 24 * 60 * 60 * 1000)
  if (target.getTime() > now.getTime()) {
    target = new Date(target.getTime() - 7 * 24 * 60 * 60 * 1000)
  }
  return target
}

/**
 * Decide se a auto-geração deve rodar agora para uma academia.
 * Roda quando `now` já passou do alvo mais recente E a marca d'água (última
 * execução) é anterior a esse alvo. Assim, se o cron perdeu a hora exata, a
 * próxima execução ainda pega o alvo pendente (catch-up).
 */
export function shouldRunGridNow(
  targetDay: number,
  targetHour: number,
  lastRunIso: string | null,
  now: Date,
): boolean {
  const target = mostRecentTargetUtc(targetDay, targetHour, now)
  if (now.getTime() < target.getTime()) return false
  if (!lastRunIso) return true
  return new Date(lastRunIso).getTime() < target.getTime()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- lib/utils/gridSchedule.test.ts`
Expected: PASS — todos os casos passam. Se algum de `shouldRunGridNow` falhar, revise `mostRecentTargetUtc` (é a parte com fuso) antes de mexer nos testes.

- [ ] **Step 5: Commit**

```bash
git add lib/utils/gridSchedule.ts lib/utils/gridSchedule.test.ts
git commit -m "feat(grade): helpers puros de agendamento semanal (BRT + catch-up)"
```

---

### Task 2: `generateGrid` — o núcleo compartilhado

**Files:**
- Create: `features/aulas/gridGeneration.ts`
- Test: `features/aulas/gridGeneration.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// features/aulas/gridGeneration.test.ts
import { describe, it, expect, vi } from 'vitest'
import { generateGrid } from './gridGeneration'

vi.mock('./creditReconciliation', () => ({
  reconcileAllActiveEnrollments: vi.fn().mockResolvedValue({
    booked: 3, skipped: 0, processedEnrollments: 3, failed: 0,
  }),
}))
import { reconcileAllActiveEnrollments } from './creditReconciliation'

/**
 * Fake client: `classes` devolve o que o teste configurar; `class_sessions.upsert`
 * captura as linhas. Só o subconjunto que generateGrid usa.
 */
function makeClient(classes: { id: string; day_of_week: number }[]) {
  const upserted: unknown[][] = []
  const from = vi.fn((table: string) => {
    if (table === 'class_sessions') {
      return { upsert: (rows: unknown[]) => { upserted.push(rows); return Promise.resolve({ error: null }) } }
    }
    // classes: encadeia select/eq/eq... e resolve com a lista (thenable)
    const builder: Record<string, unknown> = {}
    builder.select = () => builder
    builder.eq = () => builder
    builder.then = (resolve: (v: { data: unknown[] }) => void) => resolve({ data: classes })
    return builder
  })
  return { client: { from } as never, upserted }
}

describe('generateGrid', () => {
  it('gera as sessões da semana e chama a reconciliação com a mesma janela', async () => {
    const { client, upserted } = makeClient([{ id: 'c1', day_of_week: 2 }]) // terça
    const r = await generateGrid('org-1', '2026-07-20', '2026-07-26', {}, client)

    // buildSessionRows p/ terça no intervalo [seg 20, dom 26] → 1 sessão (21/07 terça).
    expect(upserted).toHaveLength(1)
    expect(upserted[0]).toHaveLength(1)
    expect(upserted[0][0]).toMatchObject({ class_id: 'c1', session_date: '2026-07-21', status: 'scheduled' })
    expect(r.sessionsCreated).toBe(1)
    expect(reconcileAllActiveEnrollments).toHaveBeenCalledWith('2026-07-20', '2026-07-26', 'org-1')
    expect(r.studentsBooked).toBe(3)
  })

  it('sem turmas não gera nada nem chama a reconciliação', async () => {
    vi.mocked(reconcileAllActiveEnrollments).mockClear()
    const { client, upserted } = makeClient([])
    const r = await generateGrid('org-1', '2026-07-20', '2026-07-26', {}, client)
    expect(upserted).toHaveLength(0)
    expect(r.sessionsCreated).toBe(0)
    expect(reconcileAllActiveEnrollments).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- features/aulas/gridGeneration.test.ts`
Expected: FAIL — `Failed to resolve import "./gridGeneration"`

- [ ] **Step 3: Write the implementation**

```ts
// features/aulas/gridGeneration.ts
// Núcleo ÚNICO de geração semanal da grade. Chamado por: criar turma, botão
// "gerar dia", botão "gerar semana", e o cron de auto-geração. Gera as sessões
// (idempotente) e reserva os alunos fixos elegíveis.
import { createAdminClient } from '@/lib/supabase/server'
import { buildSessionRows } from './sessionUtils'
import { reconcileAllActiveEnrollments } from './creditReconciliation'

type AdminClient = ReturnType<typeof createAdminClient>

export interface GenerateGridResult {
  sessionsCreated: number
  studentsBooked: number
}

/**
 * Gera as sessões das turmas ativas da org no intervalo [from, to] e reserva os
 * fixos. `opts.dayOfWeek` restringe às turmas daquele dia; `opts.classId` a uma
 * turma. Idempotente: o upsert com ignoreDuplicates não recria sessões existentes.
 */
export async function generateGrid(
  orgId: string,
  from: string, // yyyy-MM-dd
  to: string, // yyyy-MM-dd
  opts: { dayOfWeek?: number; classId?: string } = {},
  injectedClient?: AdminClient,
): Promise<GenerateGridResult> {
  const client = injectedClient ?? createAdminClient()

  let q = client
    .from('classes')
    .select('id, day_of_week')
    .eq('organization_id', orgId)
    .eq('is_active', true)
  if (opts.dayOfWeek !== undefined) q = q.eq('day_of_week', opts.dayOfWeek)
  if (opts.classId !== undefined) q = q.eq('id', opts.classId)

  const { data: classesRaw } = await q
  const classes = (classesRaw ?? []) as { id: string; day_of_week: number }[]
  if (classes.length === 0) return { sessionsCreated: 0, studentsBooked: 0 }

  const rows = classes.flatMap((c) => buildSessionRows(c.id, c.day_of_week, from, to))
  if (rows.length > 0) {
    // organization_id é preenchido pelo trigger trg_set_org (deriva de class_id).
    await client
      .from('class_sessions')
      .upsert(rows, { onConflict: 'class_id,session_date', ignoreDuplicates: true })
  }

  const rec = await reconcileAllActiveEnrollments(from, to, orgId)

  return { sessionsCreated: rows.length, studentsBooked: rec.booked }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- features/aulas/gridGeneration.test.ts`
Expected: PASS — 2 passed

Nota: `sessionsCreated` conta as linhas ENVIADAS ao upsert, não as efetivamente inseridas (o `ignoreDuplicates` pode pular algumas). É a métrica que a UI mostra ("N sessões geradas") e é suficiente; contar as realmente inseridas exigiria um `select count` extra sem valor real aqui.

- [ ] **Step 5: Commit**

```bash
git add features/aulas/gridGeneration.ts features/aulas/gridGeneration.test.ts
git commit -m "feat(grade): generateGrid gera a semana e reserva os fixos"
```

---

### Task 3: Extrair `requireAdmin` para reuso

**Files:**
- Create: `features/aulas/authGuards.ts`
- Modify: `features/aulas/adminActions.ts:5-45` (imports + remover a def local)

`requireAdmin` vive hoje dentro de `adminActions.ts`, que é um arquivo `'use server'` — não dá para exportar um helper não-action dele (o Next exige que todo export de `'use server'` seja uma server action async). Extrair para um módulo normal permite que `gridActions.ts` (Task 4) reuse sem duplicar.

- [ ] **Step 1: Criar o módulo compartilhado**

```ts
// features/aulas/authGuards.ts
// Guarda de auth compartilhada entre as server actions de aulas. NÃO é
// 'use server' — é um helper importável.
import { createClient, createAdminClient, getActiveOrgId } from '@/lib/supabase/server'

/** Exige admin da academia ativa. Retorna { userId, orgId } ou { error }. */
export async function requireAdmin(): Promise<{ userId: string; orgId: string; error?: string }> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { userId: '', orgId: '', error: 'Não autenticado.' }

  const orgId = await getActiveOrgId()
  if (!orgId) return { userId: user.id, orgId: '', error: 'Academia ativa não encontrada.' }

  // Papel é por-academia: vem da membership da academia ativa.
  const adminClient = createAdminClient()
  const { data: membership } = await adminClient
    .from('memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .single()

  if (membership?.role !== 'admin') {
    return { userId: user.id, orgId, error: 'Sem permissão de administrador.' }
  }
  return { userId: user.id, orgId }
}
```

- [ ] **Step 2: Trocar a def local em `adminActions.ts` por um import**

Em `features/aulas/adminActions.ts`, adicione ao bloco de imports do topo:

```ts
import { requireAdmin } from './authGuards'
```

E **remova** a função local `async function requireAdmin() { ... }` inteira (linhas ~17-37, do `async function requireAdmin` até o `}` que fecha a função e retorna `{ userId, orgId }`). O `createClient` pode ficar órfão nos imports — se `npm run build` acusar `createClient` não usado, remova-o da linha de import `from '@/lib/supabase/server'` (confira antes se nenhuma outra função do arquivo o usa).

- [ ] **Step 3: Verify**

Run: `npm run build`
Expected: compila. Se acusar import não usado, ajuste conforme o Step 2.

Run: `npm run test:run`
Expected: toda a suíte passa (nenhum comportamento mudou)

- [ ] **Step 4: Commit**

```bash
git add features/aulas/authGuards.ts features/aulas/adminActions.ts
git commit -m "refactor(aulas): extrai requireAdmin para authGuards (reuso)"
```

---

### Task 4: Server actions `generateGridDay` e `generateGridWeek`

**Files:**
- Create: `features/aulas/gridActions.ts`

- [ ] **Step 1: Escrever as actions**

```ts
// features/aulas/gridActions.ts
'use server'
import { revalidatePath } from 'next/cache'
import { requireAdmin } from './authGuards'
import { generateGrid } from './gridGeneration'
import { brtToday, addDaysStr, nextDateForDayOfWeek } from '@/lib/utils/gridSchedule'

interface GridActionResult {
  error?: string
  sessionsCreated?: number
  studentsBooked?: number
}

/** Gera a próxima ocorrência de um dia-da-semana (todas as turmas do dia). */
export async function generateGridDay(dayOfWeek: number): Promise<GridActionResult> {
  const { orgId, error } = await requireAdmin()
  if (error) return { error }

  if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
    return { error: 'Dia inválido.' }
  }

  const today = brtToday(new Date())
  const target = nextDateForDayOfWeek(today, dayOfWeek)
  const r = await generateGrid(orgId, target, target, { dayOfWeek })

  revalidatePath('/admin/grade')
  return { sessionsCreated: r.sessionsCreated, studentsBooked: r.studentsBooked }
}

/** Gera a semana toda (7 datas a partir de hoje, todas as turmas). */
export async function generateGridWeek(): Promise<GridActionResult> {
  const { orgId, error } = await requireAdmin()
  if (error) return { error }

  const from = brtToday(new Date())
  const to = addDaysStr(from, 6)
  const r = await generateGrid(orgId, from, to)

  revalidatePath('/admin/grade')
  return { sessionsCreated: r.sessionsCreated, studentsBooked: r.studentsBooked }
}
```

- [ ] **Step 2: Verify**

Run: `npm run build`
Expected: compila

- [ ] **Step 3: Commit**

```bash
git add features/aulas/gridActions.ts
git commit -m "feat(grade): server actions de geracao manual (dia e semana)"
```

---

### Task 5: `createClass` gera a semana em vez de 90 dias

**Files:**
- Modify: `features/aulas/class-form-actions.ts:36-48`

- [ ] **Step 1: Trocar o bloco de 90 dias**

Em `features/aulas/class-form-actions.ts`, dentro de `createClass`, substitua o bloco que gera 90 dias:

```ts
  // Auto-generate sessions for the next 90 days
  const today = new Date()
  const end = new Date()
  end.setDate(today.getDate() + 90)
  const rows = buildSessionRows(
    newClass.id,
    data.day_of_week,
    format(today, 'yyyy-MM-dd'),
    format(end, 'yyyy-MM-dd'),
  )
  if (rows.length > 0) {
    await adminClient.from('class_sessions').insert(rows)
  }
```

por:

```ts
  // Gera só a próxima semana da turma (7 datas). O regime de 90 dias foi
  // substituído pela geração semanal (spec 2026-07-17).
  const from = brtToday(new Date())
  await generateGrid(orgId, from, addDaysStr(from, 6), { classId: newClass.id })
```

Ajuste os imports do topo de `features/aulas/class-form-actions.ts`:
- Adicione: `import { generateGrid } from './gridGeneration'` e `import { brtToday, addDaysStr } from '@/lib/utils/gridSchedule'`.
- Remova `buildSessionRows` e `format` dos imports **se** não forem mais usados no arquivo (confira com `grep`; `format` pode estar em `updateClass` — nesse caso mantenha).

**Nota sobre o reconcile na criação:** `generateGrid` sempre chama
`reconcileAllActiveEnrollments` da org inteira no intervalo (não só da turma
nova). Na criação de turma isso é seguro e essencialmente um no-op: a turma
recém-criada ainda não tem matrículas, e o reconcile é idempotente — só reserva
fixos em sessões que **já existem**. Turmas de outras que a academia ainda não
gerou não têm sessão no intervalo, então o reconcile não age nelas. O custo é uma
passada de reconcile numa operação rara (criar turma). Não vale acoplar um filtro
de turma ao reconcile só para otimizar isso.

- [ ] **Step 2: Verify**

Run: `grep -n "buildSessionRows\|format(" features/aulas/class-form-actions.ts`
Expected: confirme quais imports ainda são usados antes de remover

Run: `npm run build`
Expected: compila

Run: `npm run test:run -- features/aulas/class-form-actions.test.ts`
Expected: PASS — o teste existente cobre `buildSessionRows` (que não mudou); nada deve quebrar

- [ ] **Step 3: Commit**

```bash
git add features/aulas/class-form-actions.ts
git commit -m "feat(grade): criar turma gera a semana (nao mais 90 dias)"
```

---

### Task 6: UI da grade — botões de geração; remover o por-turma

**Files:**
- Create: `app/(admin)/admin/grade/GridGenerateButtons.tsx`
- Modify: `app/(admin)/admin/grade/page.tsx`
- Delete: `app/(admin)/admin/grade/GenerateSessionsButton.tsx`

- [ ] **Step 1: Criar o componente de botões**

```tsx
// app/(admin)/admin/grade/GridGenerateButtons.tsx
'use client'
import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/Button'
import { generateGridWeek, generateGridDay } from '@/features/aulas/gridActions'

function feedback(r: { error?: string; sessionsCreated?: number; studentsBooked?: number }): string {
  if (r.error) return `Erro: ${r.error}`
  return `${r.sessionsCreated ?? 0} sessões geradas · ${r.studentsBooked ?? 0} alunos reservados.`
}

/** Botão "Gerar semana toda" — vai no topo da grade. */
export function GenerateWeekButton() {
  const [msg, setMsg] = useState<string | null>(null)
  const [isPending, start] = useTransition()
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant="secondary"
        loading={isPending}
        onClick={() => start(async () => setMsg(feedback(await generateGridWeek())))}
      >
        Gerar semana
      </Button>
      {msg && <span className="text-xs text-slate-400">{msg}</span>}
    </div>
  )
}

/** Botão "Gerar [dia]" — vai no cabeçalho de cada dia da grade. */
export function GenerateDayButton({ dayOfWeek }: { dayOfWeek: number }) {
  const [msg, setMsg] = useState<string | null>(null)
  const [isPending, start] = useTransition()
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={isPending}
        onClick={() => start(async () => setMsg(feedback(await generateGridDay(dayOfWeek))))}
        className="text-xs text-brand-400 hover:text-brand-300 underline disabled:opacity-50"
      >
        {isPending ? 'Gerando…' : 'Gerar'}
      </button>
      {msg && <span className="text-xs text-slate-400">{msg}</span>}
    </span>
  )
}
```

- [ ] **Step 2: Ligar na página da grade**

Em `app/(admin)/admin/grade/page.tsx`:

1. Troque o import do botão velho:

```ts
import { GenerateSessionsButton } from './GenerateSessionsButton'
```

por:

```ts
import { GenerateWeekButton, GenerateDayButton } from './GridGenerateButtons'
```

2. No header (o `<div className="flex gap-2">` com Day Use / + Nova Turma), adicione `<GenerateWeekButton />` como primeiro item do grupo.

3. No cabeçalho de cada dia da grade semanal — o `<h3>` que hoje mostra `{DAY_ABBR[day]}` — envolva num flex e acrescente o botão do dia:

```tsx
              <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-2 flex items-center justify-between">
                <span>{DAY_ABBR[day]}</span>
                <GenerateDayButton dayOfWeek={day} />
              </h3>
```

4. **Remova** o `<GenerateSessionsButton classId={c.id} />` de dentro do card da turma.

- [ ] **Step 3: Deletar o botão velho**

```bash
git rm "app/(admin)/admin/grade/GenerateSessionsButton.tsx"
```

- [ ] **Step 4: Verify**

Run: `grep -rn "GenerateSessionsButton" "app/(admin)/admin/grade/"`
Expected: nenhum resultado

Run: `npm run build`
Expected: compila

- [ ] **Step 5: Commit**

```bash
git add "app/(admin)/admin/grade/page.tsx" "app/(admin)/admin/grade/GridGenerateButtons.tsx"
git commit -m "feat(grade): botoes de gerar dia e semana; remove o por-turma"
```

---

### Task 7: Configuração da auto-geração (UI + persistência)

**Files:**
- Create: `app/(admin)/admin/configuracoes/GridAutoForm.tsx`
- Modify: `features/financeiro/actions.ts` (`updateSystemSettings`)
- Modify: `app/(admin)/admin/configuracoes/page.tsx`

- [ ] **Step 1: `updateSystemSettings` aceita as chaves de grade**

Em `features/financeiro/actions.ts`, na função `updateSystemSettings`, estenda a assinatura e a validação. Substitua a assinatura:

```ts
export async function updateSystemSettings(settings: {
  credit_expiry_days?: number
  cancellation_window_hours?: number
  default_checkin_target?: number
}): Promise<{ error?: string }> {
```

por:

```ts
export async function updateSystemSettings(settings: {
  credit_expiry_days?: number
  cancellation_window_hours?: number
  default_checkin_target?: number
  grid_auto_enabled?: boolean
  grid_auto_day?: number
  grid_auto_hour?: number
}): Promise<{ error?: string }> {
```

Logo após a validação existente de `default_checkin_target` (o bloco `if (settings.default_checkin_target !== undefined ...) return {error}`), adicione:

```ts
  if (
    settings.grid_auto_day !== undefined &&
    (!Number.isInteger(settings.grid_auto_day) || settings.grid_auto_day < 0 || settings.grid_auto_day > 6)
  ) {
    return { error: 'Dia da geração automática inválido.' }
  }
  if (
    settings.grid_auto_hour !== undefined &&
    (!Number.isInteger(settings.grid_auto_hour) || settings.grid_auto_hour < 0 || settings.grid_auto_hour > 23)
  ) {
    return { error: 'Hora da geração automática inválida.' }
  }
```

O bloco que monta `rows` já faz `Object.entries(settings).filter(v !== undefined).map(... value: String(value))` — isso serializa `boolean`/`number` corretamente (`String(true)='true'`, `String(1)='1'`), então **não precisa mudar**. Confirme lendo o código: as novas chaves entram no upsert automaticamente.

- [ ] **Step 2: Criar o form de auto-geração**

```tsx
// app/(admin)/admin/configuracoes/GridAutoForm.tsx
'use client'
import { useState, useTransition } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { updateSystemSettings } from '@/features/financeiro/actions'

const DAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']

interface Props {
  settings: { grid_auto_enabled: boolean; grid_auto_day: number; grid_auto_hour: number }
}

export function GridAutoForm({ settings }: Props) {
  const [enabled, setEnabled] = useState(settings.grid_auto_enabled)
  const [day, setDay] = useState(settings.grid_auto_day)
  const [hour, setHour] = useState(settings.grid_auto_hour)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    start(async () => {
      const r = await updateSystemSettings({
        grid_auto_enabled: enabled,
        grid_auto_day: day,
        grid_auto_hour: hour,
      })
      if (r.error) setError(r.error)
      else setSuccess('Geração automática salva.')
    })
  }

  return (
    <Card>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>}
        {success && <p className="text-sm text-green-400 bg-green-500/10 border border-green-500/30 rounded-lg px-3 py-2">{success}</p>}

        <label className="flex items-center gap-2 text-sm text-slate-300 font-medium">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Gerar a grade da próxima semana automaticamente
        </label>
        <p className="text-xs text-slate-400">
          Quando ligado, o sistema gera as sessões da semana e reserva os alunos fixos no dia e hora escolhidos. Desligado, use os botões “Gerar” na grade.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-sm text-slate-300 font-medium">Dia</label>
            <select
              value={day}
              onChange={(e) => setDay(Number(e.target.value))}
              disabled={!enabled}
              className="w-full bg-surface border border-surface-border rounded-lg px-3 py-2 text-sm text-white disabled:opacity-50"
            >
              {DAYS.map((d, i) => (
                <option key={i} value={i}>{d}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-sm text-slate-300 font-medium">Hora</label>
            <select
              value={hour}
              onChange={(e) => setHour(Number(e.target.value))}
              disabled={!enabled}
              className="w-full bg-surface border border-surface-border rounded-lg px-3 py-2 text-sm text-white disabled:opacity-50"
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
              ))}
            </select>
          </div>
        </div>

        <Button type="submit" variant="primary" loading={pending}>Salvar geração automática</Button>
      </form>
    </Card>
  )
}
```

- [ ] **Step 3: Ligar na página de configurações**

Em `app/(admin)/admin/configuracoes/page.tsx`:

1. Import: `import { GridAutoForm } from './GridAutoForm'`.

2. No cálculo de `defaults` (o `Map` já traz todas as linhas de `system_settings`), adicione a leitura das chaves de grade logo depois do bloco `defaults`:

```ts
  const gridAuto = {
    grid_auto_enabled: (map.get('grid_auto_enabled') ?? 'false') === 'true',
    grid_auto_day: Number(map.get('grid_auto_day') ?? 1),
    grid_auto_hour: Number(map.get('grid_auto_hour') ?? 6),
  }
```

3. No JSX, logo abaixo do `<SystemSettingsForm settings={defaults} />`, adicione:

```tsx
      <div>
        <h2 className="text-lg font-bold text-white">Geração automática da grade</h2>
        <p className="text-slate-400 text-sm mt-1">
          Gere a grade da próxima semana automaticamente, no dia e hora que escolher.
        </p>
      </div>
      <GridAutoForm settings={gridAuto} />
```

- [ ] **Step 4: Verify**

Run: `npm run build`
Expected: compila

Run: `npm run lint`
Expected: sem erro

- [ ] **Step 5: Commit**

```bash
git add "app/(admin)/admin/configuracoes/GridAutoForm.tsx" "app/(admin)/admin/configuracoes/page.tsx" features/financeiro/actions.ts
git commit -m "feat(grade): config de geracao automatica (toggle + dia + hora)"
```

---

### Task 8: Cron de auto-geração (catch-up)

**Files:**
- Create: `app/api/cron/weekly-grid-generation/route.ts`
- Modify: `vercel.json`

- [ ] **Step 1: Criar o cron**

```ts
// app/api/cron/weekly-grid-generation/route.ts
// Auto-geração semanal da grade. Roda de hora em hora; para cada academia com
// grid_auto_enabled, decide via shouldRunGridNow (catch-up com marca d'água) se
// gera agora. Resiliente a atraso/falha do Vercel: se perder a hora exata, a
// próxima execução pega o alvo pendente.
import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { createAdminClient } from '@/lib/supabase/server'
import { verifyCronSecret } from '@/lib/auth/cronAuth'
import { generateGrid } from '@/features/aulas/gridGeneration'
import { brtToday, addDaysStr, shouldRunGridNow } from '@/lib/utils/gridSchedule'

export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const admin = createAdminClient()
    const now = new Date()

    // Todas as chaves de grade de todas as academias, numa query.
    const { data: rowsRaw, error: readErr } = await admin
      .from('system_settings')
      .select('organization_id, key, value')
      .in('key', ['grid_auto_enabled', 'grid_auto_day', 'grid_auto_hour', 'grid_auto_last_run'])

    if (readErr) throw new Error(readErr.message)

    // Agrupa por academia.
    const byOrg = new Map<string, Record<string, string>>()
    for (const r of (rowsRaw ?? []) as { organization_id: string; key: string; value: string }[]) {
      const m = byOrg.get(r.organization_id) ?? {}
      m[r.key] = r.value
      byOrg.set(r.organization_id, m)
    }

    let orgsProcessed = 0
    let sessionsCreated = 0
    let failed = 0

    for (const [orgId, s] of byOrg) {
      if (s.grid_auto_enabled !== 'true') continue

      const day = Number(s.grid_auto_day ?? '1')
      const hour = Number(s.grid_auto_hour ?? '6')
      const lastRun = s.grid_auto_last_run ?? null
      if (!shouldRunGridNow(day, hour, lastRun, now)) continue

      try {
        const from = brtToday(now)
        const r = await generateGrid(orgId, from, addDaysStr(from, 6))
        sessionsCreated += r.sessionsCreated
        orgsProcessed++

        // Marca d'água: grava DEPOIS de gerar, para o catch-up funcionar.
        await admin
          .from('system_settings')
          .upsert(
            { organization_id: orgId, key: 'grid_auto_last_run', value: now.toISOString() },
            { onConflict: 'organization_id,key' },
          )
      } catch (err) {
        failed++
        console.error('[cron/weekly-grid-generation] falhou para uma academia', {
          organizationId: orgId,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    return NextResponse.json({ orgsProcessed, sessionsCreated, failed })
  } catch (e) {
    Sentry.captureException(e, { tags: { cron: 'weekly-grid-generation' } })
    return NextResponse.json({ error: 'Cron failed' }, { status: 500 })
  }
}
```

- [ ] **Step 2: Registrar no vercel.json e remover o mensal**

Substitua **todo** o `vercel.json` por:

```json
{
  "crons": [
    {
      "path": "/api/cron/waitlist-notifications",
      "schedule": "0 8 * * *"
    },
    {
      "path": "/api/cron/mp-token-refresh",
      "schedule": "0 4 * * 1"
    },
    {
      "path": "/api/cron/credit-expiry",
      "schedule": "0 3 * * *"
    },
    {
      "path": "/api/cron/weekly-grid-generation",
      "schedule": "0 * * * *"
    }
  ]
}
```

(Removeu `monthly-credit-renewal`, adicionou `weekly-grid-generation` de hora em hora. A rota `monthly-credit-renewal` é deletada na Task 10.)

- [ ] **Step 3: Verify**

Run: `npm run build`
Expected: compila; a rota `ƒ /api/cron/weekly-grid-generation` aparece na tabela

Run: `node -e "JSON.parse(require('fs').readFileSync('vercel.json','utf8')); console.log('vercel.json ok')"`
Expected: `vercel.json ok`

- [ ] **Step 4: Commit**

```bash
git add app/api/cron/weekly-grid-generation/route.ts vercel.json
git commit -m "feat(grade): cron horario de auto-geracao com catch-up"
```

---

### Task 9: Migration de expurgo

**Files:**
- Create: `supabase/migrations/20260718000000_weekly_grid_reset.sql`

- [ ] **Step 1: Escrever a migration**

```sql
-- supabase/migrations/20260718000000_weekly_grid_reset.sql
-- Virada do regime de 90 dias para geração semanal (spec 2026-07-17).
-- Zera as sessões futuras que o regime velho deixou, para a geração semanal
-- assumir. Preserva o que já foi realizado.

-- Apaga class_sessions de HOJE (BRT) em diante, EXCETO:
--   - status = 'completed' (aula já finalizada), e
--   - sessões com presença marcada (attendance),
-- porque desde o spec de acesso/crédito (2026-07-16) a dívida e o financeiro
-- nascem da presença — apagar isso destruiria registro financeiro.
--
-- Cascade (001_initial_schema.sql): session_bookings e attendance são
-- 'on delete cascade' (as reservas futuras caem junto; attendance só existe nas
-- preservadas). payments.session_id é 'on delete set null' — uma pré-declaração
-- de admin (paid) numa sessão futura sem presença vira um pagamento órfão com
-- session_id null; é inofensivo (hasOpenDebt filtra session_id not null).
delete from class_sessions cs
where cs.session_date >= (now() at time zone 'America/Sao_Paulo')::date
  and cs.status <> 'completed'
  and not exists (
    select 1 from attendance a where a.session_id = cs.id
  );
```

- [ ] **Step 2: Verificar as premissas do schema**

Run: `grep -n "session_id uuid.*references class_sessions" supabase/migrations/001_initial_schema.sql`
Expected: `session_bookings` e `attendance` com `on delete cascade`; `payments` com `on delete set null`

Run: `grep -n "status attendance_status\|create table attendance" supabase/migrations/001_initial_schema.sql`
Expected: a tabela `attendance` existe com coluna `session_id`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260718000000_weekly_grid_reset.sql
git commit -m "feat(db): expurgo das sessoes futuras do regime de 90 dias"
```

- [ ] **Step 4: Avisar o usuário**

A migration **não** é aplicada por você. Diga ao usuário, com estas palavras:

> A migration `20260718000000_weekly_grid_reset.sql` precisa ser aplicada com `supabase db push`. Ela apaga as sessões de hoje em diante (menos as já realizadas/com presença), deixando a grade futura vazia — a academia repovoa pelo botão "Gerar semana" ou ligando a auto-geração. Aplique DEPOIS do deploy do código. Vale conferir antes quantas sessões serão apagadas:
> `select count(*) from class_sessions cs where cs.session_date >= (now() at time zone 'America/Sao_Paulo')::date and cs.status <> 'completed' and not exists (select 1 from attendance a where a.session_id = cs.id);`

---

### Task 10: Limpeza do resíduo (actions e cron mensal)

**Files:**
- Modify: `features/aulas/adminActions.ts` (remover `generateSessionsForExistingClass`, `generateWeeklyBookings`)
- Delete: `app/api/cron/monthly-credit-renewal/route.ts`

Só rode esta task **depois** da Task 6 (que removeu o último uso de `generateSessionsForExistingClass`/`generateWeeklyBookings` via `GenerateSessionsButton`).

- [ ] **Step 1: Confirmar que nada mais usa as actions velhas**

Run: `grep -rn "generateSessionsForExistingClass\|generateWeeklyBookings" --include=*.ts --include=*.tsx . | grep -v node_modules | grep -v worktrees`
Expected: só as definições em `features/aulas/adminActions.ts` (nenhum caller restante). Se aparecer um caller, pare e reporte.

- [ ] **Step 2: Remover as duas actions de `adminActions.ts`**

Em `features/aulas/adminActions.ts`, remova as funções `generateWeeklyBookings` (inteira, com seu comentário de cabeçalho) e `generateSessionsForExistingClass` (inteira, com seu comentário). São as duas últimas funções do arquivo. Após remover, o import `buildSessionRows` (`import { buildSessionRows } from './sessionUtils'`) e `endOfMonth`/`format` de `date-fns` podem ficar órfãos — remova os que o `npm run build` acusar como não usados (confira antes se outra função do arquivo os usa; `reconcileEnrollmentCredits` e `format`/`endOfMonth` são usados em `enrollStudentInClass`, então provavelmente ficam).

- [ ] **Step 3: Deletar o cron mensal**

```bash
git rm app/api/cron/monthly-credit-renewal/route.ts
```

- [ ] **Step 4: Verify**

Run: `npm run build`
Expected: compila, sem imports órfãos

Run: `npm run test:run`
Expected: toda a suíte passa

- [ ] **Step 5: Commit**

```bash
git add features/aulas/adminActions.ts
git commit -m "chore(grade): remove geracao de 90 dias e cron mensal (substituidos pela semanal)"
```

---

### Task 11: Verificação end-to-end

**Files:** nenhum (só verificação)

- [ ] **Step 1: Suíte completa**

Run: `npm run test:run`
Expected: todos passam (inclui os novos `gridSchedule.test.ts` e `gridGeneration.test.ts`)

- [ ] **Step 2: Tipos e lint**

Run: `npm run build`
Expected: compila

Run: `npm run lint`
Expected: sem erro

- [ ] **Step 3: Caçar sobras**

Run: `grep -rn "monthly-credit-renewal\|GenerateSessionsButton\|generateSessionsForExistingClass\|generateWeeklyBookings" --include=*.ts --include=*.tsx --include=*.json . | grep -v node_modules | grep -v worktrees`
Expected: nenhum resultado (nem no `vercel.json`, nem em código)

- [ ] **Step 4: Exercitar no app (se houver ambiente seguro)**

Invoque a skill `verify`. Se o app não puder ser rodado contra um banco seguro (o `.env.local` aponta para produção — confirmar com o usuário), reporte SKIP com o motivo, como no spec 1. Roteiro mínimo se houver ambiente:

1. Criar turma → a próxima semana aparece na grade (não 90 dias).
2. Botão "Gerar [dia]" numa terça → gera as turmas de terça da próxima semana, reserva os fixos.
3. Botão "Gerar semana" → gera 7 dias de todas as turmas.
4. Configurações → ligar auto-geração, dia+hora; conferir que salva.
5. Idempotência: clicar "Gerar semana" duas vezes → não duplica sessões.

- [ ] **Step 5: Relatar**

Diga o que foi verificado de verdade e o que não foi. O cron de auto-geração não dá para exercitar sem esperar o horário/mockar o tempo — a lógica de decisão está coberta por `gridSchedule.test.ts`; diga isso explicitamente.

---

## Ordem de execução e dependências

```
Task 1 (gridSchedule)  ─┐ puras/independentes
Task 2 (generateGrid)  ─┘ (Task 2 mocka reconcile; não depende da 1)
Task 3 (requireAdmin)  ─── destrava a 4
Task 4 (gridActions)   ─── precisa de 1, 2, 3
Task 5 (createClass)   ─── precisa de 1, 2
Task 6 (UI grade)      ─── precisa de 4; remove o último uso das actions velhas
Task 7 (config auto)   ─── precisa de nada novo além do padrão de settings
Task 8 (cron)          ─── precisa de 1, 2
Task 9 (migration)     ─── independente; aplicada pelo usuário
Task 10 (limpeza)      ─── precisa de 6 (senão quebra o build)
Task 11 (verificação)  ─── precisa de todas
```

## Cobertura do spec

| Seção do spec | Task |
|---|---|
| §1 Núcleo `generateGrid` | 2 |
| §2a Criar turma (7d) | 5 |
| §2b Botão "gerar dia" | 4 (action), 6 (UI) |
| §2c Botão "gerar semana" | 4 (action), 6 (UI) |
| §2d Cron automático | 8 |
| §3 Config em system_settings | 7 |
| §4 Cron catch-up | 8 |
| §5 Lógica pura do agendamento | 1 |
| §6 Migração de expurgo | 9 |
| §7 Limpeza de resíduo (actions, botão, cron mensal) | 6, 10 |
| UI (grade, config) | 6, 7 |
| Testes | 1, 2 |
```
