# Eixos de cobrança e parceiro independentes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Desacoplar `payment_type` (eixo cobrança: `subscriber`/`per_class`) do vínculo com parceiro (nova coluna `partner`: `wellhub`/`totalpass`/`null`), permitindo combinações como mensalista+wellhub, e remover a exigência de plano ativo para matrícula em aula fixa.

**Architecture:** `memberships` ganha a coluna `partner`. O app para de escrever `wellhub`/`totalpass` em `payment_type`; passa a ler o vínculo de parceiro em `partner`. Crédito de matrícula fixa passa a ser consumido só por quem **não tem parceiro E tem plano ativo**. Os dois eixos combinam livremente.

**Tech Stack:** Next.js 14 (App Router, Server Actions), TypeScript, Supabase (Postgres + RLS, migrations SQL), Vitest.

**Spec:** `docs/superpowers/specs/2026-07-15-eixos-cobranca-parceiro-independentes-design.md`

**Decisões de crédito (confirmadas):**
- Quem tem `partner != null` → **não consome crédito** na matrícula fixa (agenda via check-in).
- Matricular sem plano **e** sem parceiro → **pula a parte de crédito** (cria matrícula + reserva, sem conceder/debitar).

---

## Mapa de arquivos

| Arquivo | Responsabilidade | Ação |
|---|---|---|
| `supabase/migrations/20260715000000_membership_partner_axis.sql` | Coluna `partner` + backfill | Criar |
| `types/index.ts` | `Membership.partner` | Modificar |
| `lib/utils/reconciliationOps.ts` | `requiresCredit`/`buildReconciliationOps` | Modificar |
| `lib/utils/reconciliationOps.test.ts` | Testes do util puro | Modificar |
| `features/aulas/creditReconciliation.ts` | Reconciliação de crédito | Modificar |
| `features/checkin/actions.ts` | `setStudentType` (2 eixos) + `recordCheckin` | Modificar |
| `features/aulas/adminActions.ts` | `enrollStudentInClass` (remove validação de plano) | Modificar |
| `features/financeiro/actions.ts` | Remove bloqueio de parceiro assinar | Modificar |
| `features/financeiro/checkoutActions.ts` | Remove bloqueio de parceiro assinar | Modificar |
| `features/financeiro/partnerRevenueActions.ts` | Filtra por `partner` | Modificar |
| `features/comunidade/actions.ts` | Filtro por eixo | Modificar |
| `app/(admin)/admin/alunos/[id]/StudentProfileClient.tsx` | UI: 2 controles + selos | Modificar |
| `app/(admin)/admin/alunos/[id]/page.tsx` | Passa `partner` como prop | Modificar |

---

## Task 1: Migração — coluna `partner` + backfill

**Files:**
- Create: `supabase/migrations/20260715000000_membership_partner_axis.sql`

- [ ] **Step 1: Escrever a migração**

```sql
-- Eixo parceiro independente do eixo cobrança.
-- Antes: payment_type ∈ (subscriber, per_class, wellhub, totalpass) — exclusivo.
-- Agora: payment_type = só cobrança (subscriber|per_class); partner = wellhub|totalpass|null.

alter table memberships
  add column if not exists partner checkin_partner;

-- Quem era só-parceiro vira "avulso + parceiro": move o valor para `partner`
-- e zera a cobrança para per_class. IDs e meta já estão em colunas próprias.
update memberships
set partner = payment_type::text::checkin_partner,
    payment_type = 'per_class'
where payment_type::text in ('wellhub', 'totalpass');

-- Índice para o cálculo de repasse (memberships de parceiro da academia).
create index if not exists memberships_org_partner_idx
  on memberships (organization_id, partner)
  where partner is not null;
```

- [ ] **Step 2: Aplicar (responsabilidade do usuário)**

A migração é aplicada por quem tem credenciais do Supabase (ver memória `reference-supabase-cli-auth`). Avisar o usuário:
> "Migração `20260715000000_membership_partner_axis.sql` pronta. Rode `supabase db push` quando puder."

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260715000000_membership_partner_axis.sql
git commit -m "feat(db): coluna partner em memberships (eixo parceiro independente)"
```

---

## Task 2: Tipo `Membership.partner`

**Files:**
- Modify: `types/index.ts:137-153`

- [ ] **Step 1: Adicionar o campo `partner` na interface `Membership`**

Em `types/index.ts`, dentro de `interface Membership`, logo abaixo de `payment_type: PaymentType` (linha 143), adicionar:

```ts
  payment_type: PaymentType // eixo cobrança: 'subscriber' | 'per_class' (não recebe mais wellhub/totalpass)
  partner: CheckinPartner | null // eixo parceiro, independente da cobrança
```

Manter `PaymentType` com os 4 valores no arquivo (o enum do banco ainda os aceita; o app apenas para de gravar wellhub/totalpass em `payment_type`). Não remover valores para não quebrar leituras de exibição existentes.

- [ ] **Step 2: Verificar build de tipos**

Run: `npx tsc --noEmit`
Expected: sem novos erros (campo aditivo).

- [ ] **Step 3: Commit**

```bash
git add types/index.ts
git commit -m "feat(types): Membership.partner (eixo parceiro)"
```

---

## Task 3: Util de reconciliação — `requiresCredit` por parceiro

`requiresCredit` passa a decidir por **parceiro** (não por payment_type), e `buildReconciliationOps` recebe `needsCredit` já calculado.

**Files:**
- Modify: `lib/utils/reconciliationOps.ts:16-47`
- Test: `lib/utils/reconciliationOps.test.ts`

- [ ] **Step 1: Atualizar os testes (falham primeiro)**

Substituir o bloco `describe('requiresCredit', ...)` e o `describe('buildReconciliationOps', ...)` em `lib/utils/reconciliationOps.test.ts` por:

```ts
describe('requiresCredit', () => {
  it('é true quando não há parceiro (mensalista/avulso agendam por crédito)', () => {
    expect(requiresCredit(null)).toBe(true)
  })
  it('é false quando há parceiro (wellhub/totalpass agendam por check-in)', () => {
    expect(requiresCredit('wellhub')).toBe(false)
    expect(requiresCredit('totalpass')).toBe(false)
  })
})

describe('buildReconciliationOps', () => {
  const sessions = [
    { id: 's1', session_date: '2026-06-18' },
    { id: 's2', session_date: '2026-06-25' },
  ]

  it('cria uma op por sessão não reservada, com needsCredit e razões', () => {
    const ops = buildReconciliationOps(sessions, new Set<string>(), true, 'Mensal 1x')
    expect(ops).toEqual([
      {
        sessionId: 's1',
        sessionDate: '2026-06-18',
        needsCredit: true,
        grantReason: 'Plano Mensal 1x — aula 18/06',
        debitReason: 'Matrícula fixa — aula 18/06',
      },
      {
        sessionId: 's2',
        sessionDate: '2026-06-25',
        needsCredit: true,
        grantReason: 'Plano Mensal 1x — aula 25/06',
        debitReason: 'Matrícula fixa — aula 25/06',
      },
    ])
  })

  it('pula sessões já reservadas', () => {
    const ops = buildReconciliationOps(sessions, new Set(['s1']), true, 'Mensal 1x')
    expect(ops.map((o) => o.sessionId)).toEqual(['s2'])
  })

  it('marca needsCredit=false quando o caller passa false', () => {
    const ops = buildReconciliationOps(sessions, new Set<string>(), false, 'Mensal 1x')
    expect(ops.every((o) => o.needsCredit === false)).toBe(true)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:run -- lib/utils/reconciliationOps.test.ts`
Expected: FAIL (assinatura antiga de `buildReconciliationOps` recebe string; `requiresCredit('subscriber')` não existe mais como esperado).

- [ ] **Step 3: Implementar a mudança no util**

Em `lib/utils/reconciliationOps.ts`, substituir `requiresCredit` (linhas 16-19) e a assinatura/corpo de `buildReconciliationOps` (linhas 21-47) por:

```ts
/** Consome crédito quem NÃO tem parceiro. Parceiro (wellhub/totalpass) agenda via check-in. */
export function requiresCredit(partner: string | null): boolean {
  return !partner
}

/**
 * Para cada sessão ainda não reservada, monta a operação de reconciliação
 * (conceder + reservar + debitar). `needsCredit` é decidido pelo caller
 * (sem parceiro E com plano ativo). Puro: não toca no banco.
 */
export function buildReconciliationOps(
  sessions: SessionLite[],
  bookedSessionIds: Set<string>,
  needsCredit: boolean,
  planName: string,
): ReconciliationOp[] {
  return sessions
    .filter((s) => !bookedSessionIds.has(s.id))
    .map((s) => {
      // Parse yyyy-MM-dd as local date (not UTC)
      const [year, month, day] = s.session_date.split('-').map(Number)
      const localDate = new Date(year, month - 1, day)
      const ddmm = formatDate(localDate, 'dd/MM')
      return {
        sessionId: s.id,
        sessionDate: s.session_date,
        needsCredit,
        grantReason: `Plano ${planName} — aula ${ddmm}`,
        debitReason: `Matrícula fixa — aula ${ddmm}`,
      }
    })
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:run -- lib/utils/reconciliationOps.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/utils/reconciliationOps.ts lib/utils/reconciliationOps.test.ts
git commit -m "refactor(credits): requiresCredit decide por parceiro; buildReconciliationOps recebe needsCredit"
```

---

## Task 4: `creditReconciliation.ts` — needsCredit = sem parceiro E com plano

**Files:**
- Modify: `features/aulas/creditReconciliation.ts:40-96` e `:193-232`

- [ ] **Step 1: `reconcileEnrollmentCredits` — ler `partner` e exigir plano p/ crédito**

Em `features/aulas/creditReconciliation.ts`, substituir o bloco das linhas 40-66 (da query de membership até o fim do cálculo de `planName`) por:

```ts
  // Eixo parceiro é por-academia: vem da membership do aluno nesta academia.
  const { data: membership } = await adminClient
    .from('memberships')
    .select('partner')
    .eq('user_id', studentId)
    .eq('organization_id', cls.organization_id)
    .single()
  if (!membership) return result

  const partner = (membership.partner as string | null) ?? null

  // Plano ativo (nome p/ log + gate de crédito). Sem parceiro E com plano →
  // consome crédito; sem plano (ou com parceiro) → só reserva, sem crédito.
  let planName = 'Mensal'
  let hasActivePlan = false
  {
    const { data: sub } = await adminClient
      .from('student_subscriptions')
      .select('subscription_plans(name)')
      .eq('student_id', studentId)
      .eq('organization_id', cls.organization_id)
      .eq('status', 'active')
      .maybeSingle()
    if (sub) {
      hasActivePlan = true
      const planRel = (sub as { subscription_plans: { name: string } | { name: string }[] } | null)
        ?.subscription_plans
      const planObj = Array.isArray(planRel) ? planRel[0] : planRel
      if (planObj?.name) planName = planObj.name
    }
  }

  const needsCredit = requiresCredit(partner) && hasActivePlan
```

- [ ] **Step 2: Passar `needsCredit` para `buildReconciliationOps`**

Na mesma função, a chamada atual (linha ~96):

```ts
  const ops = buildReconciliationOps(sessions, bookedSessionIds, paymentType, planName)
```

vira:

```ts
  const ops = buildReconciliationOps(sessions, bookedSessionIds, needsCredit, planName)
```

- [ ] **Step 3: `reconcileAllActiveEnrollments` — mapear `partner`**

Substituir o bloco das linhas 193-204 (query de memberships + `paymentTypeByMember`) por:

```ts
  // Eixo parceiro é por-academia: indexado por user_id+organization_id.
  let membershipsQuery = adminClient
    .from('memberships')
    .select('user_id, organization_id, partner')
  if (orgId) membershipsQuery = membershipsQuery.eq('organization_id', orgId)
  const { data: membershipsRaw } = await membershipsQuery
  const partnerByMember = new Map<string, string | null>(
    (membershipsRaw ?? []).map(
      (m: { user_id: string; organization_id: string; partner: string | null }) =>
        [`${m.user_id}:${m.organization_id}`, m.partner],
    ),
  )
```

E no laço (linhas 229-233), substituir:

```ts
    const paymentType = paymentTypeByMember.get(memberKey) ?? 'subscriber'
    const eligible = !requiresCredit(paymentType) || activeSubStudents.has(memberKey)
```

por:

```ts
    const partner = partnerByMember.get(memberKey) ?? null
    // Elegível: tem parceiro (agenda sem crédito) OU tem assinatura em dia.
    const eligible = !requiresCredit(partner) || activeSubStudents.has(memberKey)
```

- [ ] **Step 4: Rodar a suíte completa**

Run: `npm run test:run`
Expected: PASS (nenhum teste referencia a assinatura antiga após Task 3).

- [ ] **Step 5: Commit**

```bash
git add features/aulas/creditReconciliation.ts
git commit -m "feat(credits): crédito de matrícula só sem parceiro e com plano ativo"
```

---

## Task 5: `setStudentType` — dois eixos independentes

`setStudentType` deixa de zerar um eixo ao mexer no outro. Passa a aceitar
`billing` (cobrança) e/ou `partner` (parceiro) de forma independente.

**Files:**
- Modify: `features/checkin/actions.ts:45-98` (`setStudentType`) e `:125` (`recordCheckin`)

- [ ] **Step 1: Reescrever `setStudentType`**

Substituir toda a função `setStudentType` (linhas 45-98) por:

```ts
/**
 * Define os eixos do aluno de forma independente:
 * - billing: 'subscriber' (mensalista) | 'per_class' (avulso) — eixo cobrança.
 * - partner: null | 'wellhub' | 'totalpass' (+ id + meta) — eixo parceiro.
 * Passar só um dos campos mexe só naquele eixo (não zera o outro).
 * (Vincular plano/créditos do mensalista continua em adminSubscribeStudentToPlan.)
 */
export async function setStudentType(
  studentId: string,
  input: {
    billing?: 'subscriber' | 'per_class'
    partner?:
      | { type: null }
      | { type: CheckinPartner; partnerId: string; monthlyTarget: number }
  },
): Promise<{ error?: string }> {
  const { ok, orgId } = await requireAdmin()
  if (!ok) return { error: 'Sem permissão de administrador.' }

  const patch: Record<string, unknown> = {}

  if (input.billing) {
    patch.payment_type = input.billing
  }

  if (input.partner) {
    if (input.partner.type === null) {
      // Desvincula o parceiro; zera a meta. Mantém os IDs (histórico) e a cobrança.
      patch.partner = null
      patch.monthly_checkin_target = 0
      patch.pending_partner = null
    } else {
      if (!Number.isInteger(input.partner.monthlyTarget) || input.partner.monthlyTarget < 0) {
        return { error: 'Meta mensal inválida.' }
      }
      const idColumn = input.partner.type === 'wellhub' ? 'wellhub_id' : 'totalpass_id'
      patch.partner = input.partner.type
      patch[idColumn] = input.partner.partnerId.trim() || null
      patch.monthly_checkin_target = input.partner.monthlyTarget
      patch.pending_partner = null
    }
  }

  if (Object.keys(patch).length === 0) return {}

  const adminClient = createAdminClient()
  // Eixos são por-academia: fonte é a membership da academia ativa.
  const { error } = await adminClient
    .from('memberships')
    .update(patch)
    .eq('user_id', studentId)
    .eq('organization_id', orgId)
  if (error) return { error: 'Erro ao definir tipo do aluno.' }

  revalidatePath(`/admin/alunos/${studentId}`)
  return {}
}
```

- [ ] **Step 2: `recordCheckin` — validar por `partner`**

Em `recordCheckin`, substituir a query e o check (linhas 117-127):

```ts
  const { data: profile } = await adminClient
    .from('memberships')
    .select('payment_type, wellhub_id, totalpass_id, monthly_checkin_target')
    .eq('user_id', studentId)
    .eq('organization_id', orgId)
    .single()

  if (!profile) return { error: 'Aluno não encontrado.' }
  if (profile.payment_type !== partner) {
    return { error: 'Aluno não está vinculado a este parceiro.' }
  }
```

por:

```ts
  const { data: profile } = await adminClient
    .from('memberships')
    .select('partner, wellhub_id, totalpass_id, monthly_checkin_target')
    .eq('user_id', studentId)
    .eq('organization_id', orgId)
    .single()

  if (!profile) return { error: 'Aluno não encontrado.' }
  if (profile.partner !== partner) {
    return { error: 'Aluno não está vinculado a este parceiro.' }
  }
```

- [ ] **Step 3: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: erros APENAS nos callers de `setStudentType` (StudentProfileClient.tsx, organizations/actions.ts) — corrigidos nas Tasks 6 e 10.

- [ ] **Step 4: Commit**

```bash
git add features/checkin/actions.ts
git commit -m "feat(checkin): setStudentType com eixos billing/partner independentes; recordCheckin valida por partner"
```

---

## Task 6: Caller de `setStudentType` em `organizations/actions.ts`

**Files:**
- Modify: `features/organizations/actions.ts:244-251`

- [ ] **Step 1: Migrar a chamada para a nova assinatura**

A chamada atual (linhas 245-251), dentro de `if (input.partner)`, é sempre um
vínculo de parceiro. Substituir:

```ts
  if (input.partner) {
    await setStudentType(created.user.id, {
      type: input.partner.type,
      partnerId: input.partner.partnerId,
      monthlyTarget: input.partner.monthlyTarget,
    })
  }
```

por:

```ts
  if (input.partner) {
    await setStudentType(created.user.id, {
      partner: {
        type: input.partner.type,
        partnerId: input.partner.partnerId,
        monthlyTarget: input.partner.monthlyTarget,
      },
    })
  }
```

(A cobrança do aluno criado não muda aqui — só o eixo parceiro.)

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros neste arquivo.

- [ ] **Step 3: Commit**

```bash
git add features/organizations/actions.ts
git commit -m "refactor: organizations/actions usa nova assinatura de setStudentType"
```

---

## Task 7: Remover exigência de plano na matrícula fixa

**Files:**
- Modify: `features/aulas/adminActions.ts:105-126`

- [ ] **Step 1: Remover a validação de plano ativo**

Em `enrollStudentInClass`, apagar completamente o bloco das linhas 105-126
(comentário "Validação: matrícula fixa exige plano ativo…" + a query de
`validationMembership` + o `if (requiresCredit(...))` que retorna o erro
"Aluno não possui plano ativo…"). A matrícula passa direto do teste de
"Turma lotada." (linha 103) para o upsert de `enrollments` (linha 128).

Se `requiresCredit` ficar sem uso neste arquivo após a remoção, remover também
o import correspondente (verificar com `grep -n "requiresCredit" features/aulas/adminActions.ts`).

- [ ] **Step 2: Verificar tipos/build**

Run: `npx tsc --noEmit`
Expected: sem erros neste arquivo.

- [ ] **Step 3: Verificação manual**

A reconciliação já lida com o caso sem crédito (Task 4): matricular um aluno
`per_class` sem plano e sem parceiro cria a matrícula e reserva as sessões,
sem conceder/debitar crédito. Registrar como checklist manual pós-deploy.

- [ ] **Step 4: Commit**

```bash
git add features/aulas/adminActions.ts
git commit -m "feat(aulas): permite matrícula em aula fixa sem plano vinculado"
```

---

## Task 8: Financeiro — parceiro pode assinar plano

**Files:**
- Modify: `features/financeiro/actions.ts:37-40` e `:147-150`
- Modify: `features/financeiro/checkoutActions.ts:46-57`

- [ ] **Step 1: `subscribeToPlan` — remover bloqueio**

Em `features/financeiro/actions.ts`, apagar as linhas 37-40:

```ts
  const paymentType = membership.payment_type as PaymentType
  if (paymentType === 'wellhub' || paymentType === 'totalpass') {
    return { error: 'Alunos Wellhub/TotalPass não precisam de assinatura no app.' }
  }
```

(O `membership` continua sendo usado adiante para `is_dependent`/`parent_id`; só o `paymentType` sai.)

- [ ] **Step 2: `adminSubscribeStudentToPlan` — remover bloqueio**

No mesmo arquivo, apagar as linhas 147-150:

```ts
  const paymentType = student.payment_type as PaymentType
  if (paymentType === 'wellhub' || paymentType === 'totalpass') {
    return { error: 'Alunos Wellhub/TotalPass não precisam de assinatura no app.' }
  }
```

E remover `payment_type` do `.select(...)` da query de `student` (linha 140):
`select('payment_type, is_dependent, parent_id, contract_active')` →
`select('is_dependent, parent_id, contract_active')`.

- [ ] **Step 3: `checkoutActions.ts` — remover bloqueio**

Em `features/financeiro/checkoutActions.ts`, apagar as linhas 46-57 (comentário
"Wellhub/TotalPass não assinam plano no app." + a query `studentMembership` +
o `if (paymentType === 'wellhub' ...)`).

Se o import de `PaymentType` ficar sem uso nesse arquivo, remover
(verificar com `grep -n "PaymentType" features/financeiro/checkoutActions.ts`).

- [ ] **Step 4: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem novos erros nesses arquivos.

- [ ] **Step 5: Commit**

```bash
git add features/financeiro/actions.ts features/financeiro/checkoutActions.ts
git commit -m "feat(financeiro): aluno com parceiro pode assinar plano de mensalista"
```

---

## Task 9: Repasse do parceiro filtra por `partner`

**Files:**
- Modify: `features/financeiro/partnerRevenueActions.ts:94-120`

- [ ] **Step 1: Trocar o filtro e o mapeamento**

Em `getPartnerRevenueThisMonth`, substituir a query (linhas 94-98):

```ts
  const { data: memberships } = await adminClient
    .from('memberships')
    .select('user_id, payment_type, monthly_checkin_target')
    .eq('organization_id', orgId)
    .in('payment_type', ['wellhub', 'totalpass'])
```

por:

```ts
  const { data: memberships } = await adminClient
    .from('memberships')
    .select('user_id, partner, monthly_checkin_target')
    .eq('organization_id', orgId)
    .not('partner', 'is', null)
```

E no laço, substituir o tipo e o `partner:` (linhas 103-120):

```ts
  for (const m of (memberships ?? []) as {
    user_id: string
    partner: CheckinPartner
    monthly_checkin_target: number
  }[]) {
    const { count } = await adminClient
      .from('checkins')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('student_id', m.user_id)
      .gte('checkin_date', from)
      .lte('checkin_date', to)

    students.push({
      partner: m.partner,
      checkinsThisMonth: count ?? 0,
      monthlyTarget: m.monthly_checkin_target ?? 0,
    })
  }
```

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem novos erros.

- [ ] **Step 3: Commit**

```bash
git add features/financeiro/partnerRevenueActions.ts
git commit -m "feat(financeiro): repasse de parceiro filtra por coluna partner"
```

---

## Task 10: Comunidade — filtro por eixo

O filtro `by_plan` hoje casa `payment_type` com valores que incluíam parceiro.
Passa a distinguir cobrança de parceiro.

**Files:**
- Modify: `features/comunidade/actions.ts:249-251`

- [ ] **Step 1: Filtrar por cobrança ou por parceiro**

Substituir (linhas 249-251):

```ts
  } else if (filterMode === 'by_plan' && filterValue) {
    memQuery = memQuery.eq('payment_type', filterValue as PaymentType)
  }
```

por:

```ts
  } else if (filterMode === 'by_plan' && filterValue) {
    // 'subscriber'/'per_class' filtram cobrança; 'wellhub'/'totalpass' filtram parceiro.
    if (filterValue === 'wellhub' || filterValue === 'totalpass') {
      memQuery = memQuery.eq('partner', filterValue as CheckinPartner)
    } else {
      memQuery = memQuery.eq('payment_type', filterValue as PaymentType)
    }
  }
```

Garantir que `CheckinPartner` está importado no topo do arquivo
(`import type { ... , CheckinPartner } from '@/types'`); adicionar se faltar.

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem novos erros.

- [ ] **Step 3: Commit**

```bash
git add features/comunidade/actions.ts
git commit -m "feat(comunidade): filtro distingue eixo cobrança e eixo parceiro"
```

---

## Task 11: UI — dois controles independentes + prop `partner`

A tela do aluno passa a ter **Cobrança** (Mensalista/Avulso) e **Parceiro**
(Nenhum/Wellhub/TotalPass) como controles separados, cada um com seu "Salvar".

**Files:**
- Modify: `app/(admin)/admin/alunos/[id]/page.tsx` (passar `partner`)
- Modify: `app/(admin)/admin/alunos/[id]/StudentProfileClient.tsx`

- [ ] **Step 1: Passar `partner` do server para o client**

Em `app/(admin)/admin/alunos/[id]/page.tsx`:

1. No `.select(...)` da membership (linha 35), adicionar `partner`:
   ```ts
   'level, payment_type, partner, contract_active, is_dependent, parent_id, credits_balance, monthly_checkin_target, pending_partner, wellhub_id, totalpass_id'
   ```
2. No cast de tipo da linha 58, adicionar `'partner'` à união:
   ```ts
   'level' | 'payment_type' | 'partner' | 'contract_active' | 'is_dependent' | 'parent_id' | 'credits_balance' | 'monthly_checkin_target' | 'pending_partner' | 'wellhub_id' | 'totalpass_id'
   ```
3. Nas props do `<StudentProfileClient ...>` (perto da linha 287), adicionar:
   ```ts
   partner={student.partner}
   ```
4. Selo de parceiro no header (após o bloco de `paymentLabel`, linha ~262).
   Adicionar, usando o `Badge` já em uso na página:
   ```tsx
   {student.partner && (
     <Badge variant="default">
       {student.partner === 'wellhub' ? 'Wellhub' : 'TotalPass'}
     </Badge>
   )}
   ```
   (Se `Badge` não estiver importado nesta página, importar de `@/components/ui/Badge`.)

- [ ] **Step 2: Novos props + estado no client**

Em `StudentProfileClient.tsx`:
- Adicionar `partner: 'wellhub' | 'totalpass' | null` às props do componente
  (junto de `paymentType`, por volta da linha 29/71).
- Substituir o estado das linhas 123-133 por dois eixos independentes:

```ts
  const [billing, setBilling] = useState<'subscriber' | 'per_class'>(
    paymentType === 'subscriber' ? 'subscriber' : 'per_class',
  )
  const [partnerType, setPartnerType] = useState<'none' | 'wellhub' | 'totalpass'>(
    partner ?? 'none',
  )
  const [partnerId, setPartnerId] = useState(
    (partner === 'totalpass' ? totalpassId : wellhubId) ?? '',
  )
  const [targetInput, setTargetInput] = useState(
    String(monthlyTarget > 0 ? monthlyTarget : orgDefaultTarget),
  )
  const [linkedPartner, setLinkedPartner] = useState<'wellhub' | 'totalpass' | null>(partner)
```

(Remover o antigo `studentType`/`setStudentTypeState` e o `linkedPartner`
baseado em `paymentType`.)

- [ ] **Step 3: Handlers separados por eixo**

Substituir `handleSaveType` (linhas 283-315) por dois handlers:

```ts
  function handleSaveBilling() {
    setError(null)
    startTransition(async () => {
      const result = await setStudentType(studentId, { billing })
      if (result.error) {
        setError(result.error)
        return
      }
      notify('Cobrança atualizada.')
    })
  }

  function handleSavePartner() {
    setError(null)
    if (partnerType === 'none') {
      startTransition(async () => {
        const result = await setStudentType(studentId, { partner: { type: null } })
        if (result.error) {
          setError(result.error)
          return
        }
        setLinkedPartner(null)
        notify('Parceiro desvinculado.')
      })
      return
    }
    const target = parseInt(targetInput, 10)
    if (Number.isNaN(target) || target < 0) {
      setError('Meta mensal inválida.')
      return
    }
    startTransition(async () => {
      const result = await setStudentType(studentId, {
        partner: { type: partnerType, partnerId, monthlyTarget: target },
      })
      if (result.error) {
        setError(result.error)
        return
      }
      setLinkedPartner(partnerType)
      notify('Parceiro atualizado.')
    })
  }
```

- [ ] **Step 4: Atualizar `handleConfirmPartner`**

Na função `handleConfirmPartner` (linhas 342-368), trocar a chamada
`setStudentType(studentId, { type: pending, partnerId: declaredId, monthlyTarget: target })`
por
`setStudentType(studentId, { partner: { type: pending, partnerId: declaredId, monthlyTarget: target } })`,
e substituir `setStudentTypeState(pending)` por `setPartnerType(pending)`.

- [ ] **Step 5: Atualizar o JSX do seletor**

No bloco do seletor de tipo (por volta das linhas 697-745), substituir o
`<select>` único (Mensalista/Wellhub/TotalPass) por **dois** controles:

```tsx
{/* Eixo cobrança */}
<label className="block text-sm text-slate-300 mb-1">Cobrança</label>
<select
  value={billing}
  onChange={(e) => setBilling(e.target.value as 'subscriber' | 'per_class')}
  className="w-full bg-surface-card border border-surface-border rounded-xl px-3 py-2 text-white text-sm"
>
  <option value="subscriber">Mensalista (plano)</option>
  <option value="per_class">Avulso</option>
</select>
<Button onClick={handleSaveBilling} loading={isPending} size="sm" className="mt-2">
  Salvar cobrança
</Button>

{/* Eixo parceiro */}
<label className="block text-sm text-slate-300 mb-1 mt-4">Parceiro</label>
<select
  value={partnerType}
  onChange={(e) => setPartnerType(e.target.value as 'none' | 'wellhub' | 'totalpass')}
  className="w-full bg-surface-card border border-surface-border rounded-xl px-3 py-2 text-white text-sm"
>
  <option value="none">Nenhum</option>
  <option value="wellhub">Wellhub</option>
  <option value="totalpass">TotalPass</option>
</select>
{partnerType !== 'none' && (
  <>
    <Input
      value={partnerId}
      onChange={(e) => setPartnerId(e.target.value)}
      className="mt-2"
      placeholder="ID do parceiro"
    />
    <Input
      value={targetInput}
      onChange={(e) => setTargetInput(e.target.value)}
      className="mt-2"
      placeholder="Meta de check-ins/mês"
    />
  </>
)}
<Button onClick={handleSavePartner} loading={isPending} size="sm" className="mt-2">
  Salvar parceiro
</Button>
```

(Ajustar os nomes de props do `Button`/`Input` ao padrão já usado no arquivo.)

- [ ] **Step 6: Selo duplo (exibição)**

Onde hoje mostra um selo único derivado de `paymentType`, mostrar dois:
cobrança (`billing === 'subscriber' ? 'Mensalista' : 'Avulso'`) e, se
`linkedPartner`, um selo do parceiro (`linkedPartner === 'wellhub' ? 'Wellhub' : 'TotalPass'`).
Reusar o componente `Badge` já importado no arquivo.

- [ ] **Step 7: Verificar build**

Run: `npx tsc --noEmit && npm run build`
Expected: sem erros.

- [ ] **Step 8: Commit**

```bash
git add "app/(admin)/admin/alunos/[id]/page.tsx" "app/(admin)/admin/alunos/[id]/StudentProfileClient.tsx"
git commit -m "feat(admin): UI de aluno com eixos cobrança e parceiro independentes"
```

---

## Task 12: Verificação final

- [ ] **Step 1: Suíte + lint + build**

Run: `npm run test:run && npm run lint && npm run build`
Expected: testes PASS; lint só com avisos pré-existentes de `<img>`; build OK.

- [ ] **Step 2: Checklist manual (pós `supabase db push`)**

Verificar no Admin → Aluno:
- Definir aluno como Mensalista **e** Wellhub (com meta) — os dois selos aparecem.
- Matricular numa aula fixa **sem plano** e sem parceiro — cria matrícula/reserva, sem mexer em crédito.
- Um aluno com parceiro consegue assinar plano (financeiro não bloqueia).
- Admin → Financeiro → repasse lista quem tem `partner` (inclusive mensalista+parceiro).
- Check-in manual de um aluno com `partner` funciona; de um sem `partner` é recusado.

- [ ] **Step 3: Commit final (se houver ajustes)**

```bash
git add -A
git commit -m "chore: ajustes finais dos eixos cobrança/parceiro"
```

---

## Notas de rollout

- A migração (Task 1) deve ser aplicada **antes** do deploy do código que lê
  `partner`. Ordem segura: aplicar migração → deploy.
- `PaymentType` mantém os 4 valores no TS/DB; nenhuma leitura de exibição
  legada quebra. Só paramos de **escrever** `wellhub`/`totalpass` em
  `payment_type`.
