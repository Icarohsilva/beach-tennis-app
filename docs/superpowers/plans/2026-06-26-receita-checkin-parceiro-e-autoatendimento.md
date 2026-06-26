# Receita de check-in de parceiro + autoatendimento de ID — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que o aluno informe o próprio ID de parceiro (Wellhub/TotalPass) no perfil, garantir que dependentes de parceiro entrem no financeiro, e calcular na hora a receita de check-in de parceiro no Financeiro do admin.

**Architecture:** Três features sobre o modelo `memberships` existente. F1 adiciona uma seção no `/perfil` + uma server action não-admin (`selfSetPartnerId`) que grava na membership da academia ativa, travada se o aluno for mensalista ativo. F2 é verificação (dependentes já aparecem na lista e na ficha; o cálculo de receita não pode filtrá-los). F3 adiciona uma tabela `partner_checkin_rates` (valor por check-in em reais, por academia), uma função pura `computePartnerRevenue` (com testes Vitest), três server actions, e um card client no Financeiro. Receita = Σ `min(check-ins do mês, meta) × valor do parceiro`, com teto na meta, calculada ao abrir a tela.

**Tech Stack:** Next.js 14 App Router (Server Components + server actions), TypeScript, Supabase (Postgres + RLS via `is_org_admin`), Vitest, Tailwind. App em pt-BR; comentários e mensagens de commit em português.

**Branch:** `develop`. Migrations são aplicadas manualmente pelo usuário no SQL Editor (nunca aplicar localmente). Workflow por task: editar → `npm run build` → commit dos arquivos específicos.

**Unidades de valor:** `partner_checkin_rates.value` e os totais calculados são em **reais** (`numeric(10,2)`, ex.: `10.00` = R$10 por check-in), para casar com o card do Financeiro que usa `Intl.NumberFormat('pt-BR', BRL)` direto sobre o valor.

---

## File Structure

**Novos:**
- `supabase/migrations/20260626000200_partner_checkin_rates.sql` — tabela `partner_checkin_rates` + RLS.
- `lib/checkin/partnerRevenue.ts` — função pura `computePartnerRevenue` + tipos.
- `lib/checkin/partnerRevenue.test.ts` — testes Vitest da função pura.
- `features/financeiro/partnerRevenueActions.ts` — `getPartnerCheckinRates`, `setPartnerCheckinRate`, `getPartnerRevenueThisMonth`.
- `features/checkin/SelfPartnerForm.tsx` — componente client do autoatendimento de ID (F1).
- `app/(admin)/admin/financeiro/PartnerRevenueCard.tsx` — card client de receita de parceiro (F3).

**Modificados:**
- `types/index.ts` — interface `PartnerCheckinRate`.
- `features/checkin/actions.ts` — action `selfSetPartnerId`.
- `app/(dashboard)/perfil/page.tsx` — seção "Acesso por parceiro" + render do `SelfPartnerForm`.
- `app/(admin)/admin/financeiro/page.tsx` — render do `PartnerRevenueCard` + carga de rates e receita.

---

## Task 1: Migration `partner_checkin_rates` + tipo `PartnerCheckinRate`

**Files:**
- Create: `supabase/migrations/20260626000200_partner_checkin_rates.sql`
- Modify: `types/index.ts` (após a interface `OrgIntegration`/`PendingCheckin`, perto da linha 39)

- [ ] **Step 1: Escrever a migration**

Cria `supabase/migrations/20260626000200_partner_checkin_rates.sql` com este conteúdo exato. O tipo `checkin_partner` (enum) e a função `is_org_admin(uuid)` já existem (usados em `20260626000000_checkin_integrations.sql`).

```sql
-- Valor por check-in de parceiro (Wellhub/TotalPass), por academia, em reais.
-- Desacoplado de a integração estar conectada: a academia define o valor mesmo
-- antes de plugar o webhook. A receita do mês é calculada na hora a partir dos
-- check-ins já gravados (sem ledger, sem cron).
create table if not exists partner_checkin_rates (
  organization_id uuid not null references organizations(id) on delete cascade,
  partner         checkin_partner not null,
  value           numeric(10,2) not null default 0, -- reais por check-in
  updated_at      timestamptz not null default now(),
  primary key (organization_id, partner)
);

alter table partner_checkin_rates enable row level security;

-- Leitura: admin da própria academia. Escrita: service role (admin actions).
create policy "partner_rates_admin_org" on partner_checkin_rates
  for select using (is_org_admin(organization_id));
```

- [ ] **Step 2: Adicionar o tipo `PartnerCheckinRate` em `types/index.ts`**

Logo após a interface `PendingCheckin` (que termina na linha 39, antes de `export type SessionStatus`), inserir:

```ts
export interface PartnerCheckinRate {
  organization_id: string
  partner: CheckinPartner
  value: number
  updated_at: string
}
```

- [ ] **Step 3: Verificar que o build de tipos passa**

Run: `npm run build`
Expected: build conclui sem erro de tipo (a migration não afeta o build; o tipo novo compila).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260626000200_partner_checkin_rates.sql types/index.ts
git commit -m "feat(financeiro): tabela partner_checkin_rates + tipo PartnerCheckinRate"
```

---

## Task 2: Função pura `computePartnerRevenue` (TDD)

**Files:**
- Create: `lib/checkin/partnerRevenue.ts`
- Test: `lib/checkin/partnerRevenue.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Cria `lib/checkin/partnerRevenue.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { computePartnerRevenue } from './partnerRevenue'
import type { PartnerStudentMonth, PartnerRates } from './partnerRevenue'

const rates: PartnerRates = { wellhub: 10, totalpass: 8 }

describe('computePartnerRevenue', () => {
  it('lista vazia → total 0 e subtotais 0', () => {
    expect(computePartnerRevenue([], rates)).toEqual({
      total: 0,
      perPartner: { wellhub: 0, totalpass: 0 },
    })
  })

  it('teto na meta: 15 check-ins, meta 12, valor 10 → 120 (não 150)', () => {
    const students: PartnerStudentMonth[] = [
      { partner: 'wellhub', checkinsThisMonth: 15, monthlyTarget: 12 },
    ]
    expect(computePartnerRevenue(students, rates)).toEqual({
      total: 120,
      perPartner: { wellhub: 120, totalpass: 0 },
    })
  })

  it('abaixo da meta: 5 check-ins, meta 12, valor 10 → 50', () => {
    const students: PartnerStudentMonth[] = [
      { partner: 'wellhub', checkinsThisMonth: 5, monthlyTarget: 12 },
    ]
    expect(computePartnerRevenue(students, rates)).toEqual({
      total: 50,
      perPartner: { wellhub: 50, totalpass: 0 },
    })
  })

  it('meta 0 → contribuição 0 mesmo com check-ins', () => {
    const students: PartnerStudentMonth[] = [
      { partner: 'wellhub', checkinsThisMonth: 9, monthlyTarget: 0 },
    ]
    expect(computePartnerRevenue(students, rates)).toEqual({
      total: 0,
      perPartner: { wellhub: 0, totalpass: 0 },
    })
  })

  it('valores negativos saneados para 0', () => {
    const students: PartnerStudentMonth[] = [
      { partner: 'wellhub', checkinsThisMonth: -3, monthlyTarget: -2 },
    ]
    expect(computePartnerRevenue(students, rates)).toEqual({
      total: 0,
      perPartner: { wellhub: 0, totalpass: 0 },
    })
  })

  it('mistura Wellhub + TotalPass → perPartner e total corretos', () => {
    const students: PartnerStudentMonth[] = [
      { partner: 'wellhub', checkinsThisMonth: 10, monthlyTarget: 12 }, // 10×10 = 100
      { partner: 'totalpass', checkinsThisMonth: 20, monthlyTarget: 12 }, // min(20,12)×8 = 96
      { partner: 'totalpass', checkinsThisMonth: 3, monthlyTarget: 12 }, // 3×8 = 24
    ]
    expect(computePartnerRevenue(students, rates)).toEqual({
      total: 220,
      perPartner: { wellhub: 100, totalpass: 120 },
    })
  })
})
```

- [ ] **Step 2: Rodar o teste para confirmar que falha**

Run: `npm run test:run -- lib/checkin/partnerRevenue.test.ts`
Expected: FAIL — "Failed to resolve import './partnerRevenue'" / `computePartnerRevenue is not a function`.

- [ ] **Step 3: Implementar a função pura**

Cria `lib/checkin/partnerRevenue.ts`:

```ts
import type { CheckinPartner } from '@/types'

export interface PartnerStudentMonth {
  partner: CheckinPartner
  checkinsThisMonth: number
  monthlyTarget: number
}

export type PartnerRates = Record<CheckinPartner, number> // reais por check-in

export interface PartnerRevenue {
  total: number // soma em reais
  perPartner: Record<CheckinPartner, number> // subtotal por parceiro
}

/**
 * Receita = Σ min(check-ins do mês, meta) × valor do parceiro.
 * Meta 0 ⇒ contribuição 0 (teto na meta). Negativos são saneados para 0.
 */
export function computePartnerRevenue(
  students: PartnerStudentMonth[],
  rates: PartnerRates,
): PartnerRevenue {
  const perPartner: Record<CheckinPartner, number> = { wellhub: 0, totalpass: 0 }

  for (const s of students) {
    const checkins = Math.max(s.checkinsThisMonth, 0)
    const target = Math.max(s.monthlyTarget, 0)
    const billable = Math.min(checkins, target)
    const rate = Math.max(rates[s.partner] ?? 0, 0)
    perPartner[s.partner] += billable * rate
  }

  return {
    total: perPartner.wellhub + perPartner.totalpass,
    perPartner,
  }
}
```

- [ ] **Step 4: Rodar o teste para confirmar que passa**

Run: `npm run test:run -- lib/checkin/partnerRevenue.test.ts`
Expected: PASS — 6 testes verdes.

- [ ] **Step 5: Commit**

```bash
git add lib/checkin/partnerRevenue.ts lib/checkin/partnerRevenue.test.ts
git commit -m "feat(financeiro): computePartnerRevenue (teto na meta) com testes"
```

---

## Task 3: Server actions de receita de parceiro

**Files:**
- Create: `features/financeiro/partnerRevenueActions.ts`

Replica o padrão de `app/(admin)/admin/financeiro/adminActions.ts` (helper `assertAdmin` com `createClient`/`getActiveOrgId`/`createAdminClient` checando `membership.role === 'admin'`) e usa `getMonthWindow` como em `features/checkin/actions.ts → monthlyProgress`.

- [ ] **Step 1: Criar o arquivo de actions**

Cria `features/financeiro/partnerRevenueActions.ts`:

```ts
'use server'
// features/financeiro/partnerRevenueActions.ts
// Receita de check-in de parceiro (Wellhub/TotalPass) calculada na hora.
import { revalidatePath } from 'next/cache'
import { createClient, createAdminClient, getActiveOrgId } from '@/lib/supabase/server'
import type { CheckinPartner } from '@/types'
import { getMonthWindow } from '@/lib/utils/monthWindow'
import {
  computePartnerRevenue,
  type PartnerRates,
  type PartnerStudentMonth,
  type PartnerRevenue,
} from '@/lib/checkin/partnerRevenue'

async function assertAdmin() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado.')

  const orgId = await getActiveOrgId()
  if (!orgId) throw new Error('Academia ativa não encontrada.')

  const adminClient = createAdminClient()
  // Papel é por-academia: vem da membership da academia ativa.
  const { data: membership } = await adminClient
    .from('memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .single()

  if (membership?.role !== 'admin') throw new Error('Sem permissão.')
  return { adminClient, orgId }
}

/** Lê os valores por check-in da academia ativa; default 0 para parceiro sem linha. */
export async function getPartnerCheckinRates(): Promise<PartnerRates> {
  const { adminClient, orgId } = await assertAdmin()
  const { data } = await adminClient
    .from('partner_checkin_rates')
    .select('partner, value')
    .eq('organization_id', orgId)

  const rates: PartnerRates = { wellhub: 0, totalpass: 0 }
  for (const row of (data ?? []) as { partner: CheckinPartner; value: number }[]) {
    rates[row.partner] = Number(row.value)
  }
  return rates
}

/** Define o valor por check-in de um parceiro (upsert). Admin-only. value em reais ≥ 0. */
export async function setPartnerCheckinRate(
  partner: CheckinPartner,
  value: number,
): Promise<{ error?: string }> {
  try {
    const { adminClient, orgId } = await assertAdmin()

    if (partner !== 'wellhub' && partner !== 'totalpass') {
      return { error: 'Parceiro inválido.' }
    }
    if (typeof value !== 'number' || Number.isNaN(value) || value < 0) {
      return { error: 'Valor inválido.' }
    }

    const { error } = await adminClient.from('partner_checkin_rates').upsert(
      {
        organization_id: orgId,
        partner,
        value,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'organization_id,partner' },
    )

    if (error) return { error: 'Erro ao salvar valor do parceiro.' }
    revalidatePath('/admin/financeiro')
    return {}
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}

/**
 * Receita de parceiro do mês corrente, calculada na hora. Carrega todas as
 * memberships de parceiro da academia (INCLUINDO dependentes), conta os check-ins
 * do mês de cada uma e aplica computePartnerRevenue com os valores atuais.
 */
export async function getPartnerRevenueThisMonth(): Promise<PartnerRevenue> {
  const { adminClient, orgId } = await assertAdmin()

  // Memberships de parceiro da academia ativa. NÃO filtrar is_dependent:
  // dependentes de parceiro contam no financeiro igual a alunos normais.
  const { data: memberships } = await adminClient
    .from('memberships')
    .select('user_id, payment_type, monthly_checkin_target')
    .eq('organization_id', orgId)
    .in('payment_type', ['wellhub', 'totalpass'])

  const { from, to } = getMonthWindow(new Date())
  const students: PartnerStudentMonth[] = []

  for (const m of (memberships ?? []) as {
    user_id: string
    payment_type: CheckinPartner
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
      partner: m.payment_type,
      checkinsThisMonth: count ?? 0,
      monthlyTarget: m.monthly_checkin_target ?? 0,
    })
  }

  const rates = await getPartnerCheckinRates()
  return computePartnerRevenue(students, rates)
}
```

- [ ] **Step 2: Verificar que o build passa**

Run: `npm run build`
Expected: build conclui sem erro de tipo (actions tipadas; imports resolvem).

- [ ] **Step 3: Commit**

```bash
git add features/financeiro/partnerRevenueActions.ts
git commit -m "feat(financeiro): actions de valor e receita de check-in de parceiro"
```

---

## Task 4: Card de receita de parceiro no Financeiro (UI)

**Files:**
- Create: `app/(admin)/admin/financeiro/PartnerRevenueCard.tsx`
- Modify: `app/(admin)/admin/financeiro/page.tsx`

O card recebe os valores e a receita iniciais por props (calculados no server) e permite editar os valores (`setPartnerCheckinRate`) e recalcular (`getPartnerRevenueThisMonth`). Segue o padrão visual de `PlansManager.tsx` (Card/Input/Button, mensagens de erro/sucesso, `useTransition`).

- [ ] **Step 1: Criar o componente client**

Cria `app/(admin)/admin/financeiro/PartnerRevenueCard.tsx`:

```tsx
'use client'
// app/(admin)/admin/financeiro/PartnerRevenueCard.tsx
import { useState, useTransition } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import {
  setPartnerCheckinRate,
  getPartnerRevenueThisMonth,
} from '@/features/financeiro/partnerRevenueActions'
import type { PartnerRates, PartnerRevenue } from '@/lib/checkin/partnerRevenue'

interface Props {
  initialRates: PartnerRates
  initialRevenue: PartnerRevenue
  hasZeroTargetStudents: boolean
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(amount)
}

export function PartnerRevenueCard({ initialRates, initialRevenue, hasZeroTargetStudents }: Props) {
  const [wellhub, setWellhub] = useState(String(initialRates.wellhub))
  const [totalpass, setTotalpass] = useState(String(initialRates.totalpass))
  const [revenue, setRevenue] = useState<PartnerRevenue>(initialRevenue)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [savePending, startSave] = useTransition()
  const [recalcPending, startRecalc] = useTransition()

  function handleSave() {
    setError(null)
    setSuccess(null)
    const w = parseFloat(wellhub)
    const t = parseFloat(totalpass)
    if (isNaN(w) || isNaN(t) || w < 0 || t < 0) {
      setError('Informe valores numéricos válidos (≥ 0).')
      return
    }
    startSave(async () => {
      const r1 = await setPartnerCheckinRate('wellhub', w)
      if (r1.error) return setError(r1.error)
      const r2 = await setPartnerCheckinRate('totalpass', t)
      if (r2.error) return setError(r2.error)
      const updated = await getPartnerRevenueThisMonth()
      setRevenue(updated)
      setSuccess('Valores salvos.')
    })
  }

  function handleRecalc() {
    setError(null)
    setSuccess(null)
    startRecalc(async () => {
      const updated = await getPartnerRevenueThisMonth()
      setRevenue(updated)
      setSuccess('Receita recalculada.')
    })
  }

  return (
    <div className="space-y-3">
      <Card>
        <p className="text-xs text-slate-400 font-medium uppercase tracking-wide mb-3">
          Valor por check-in
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Wellhub (R$)</label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={wellhub}
              onChange={(e) => setWellhub(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1 block">TotalPass (R$)</label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={totalpass}
              onChange={(e) => setTotalpass(e.target.value)}
            />
          </div>
        </div>
        {error && (
          <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 mt-3">
            {error}
          </p>
        )}
        {success && (
          <p className="text-sm text-green-400 bg-green-500/10 border border-green-500/30 rounded-lg px-3 py-2 mt-3">
            {success}
          </p>
        )}
        <div className="flex gap-2 mt-3">
          <Button size="sm" variant="primary" loading={savePending} onClick={handleSave}>
            Salvar valores
          </Button>
          <Button size="sm" variant="ghost" loading={recalcPending} onClick={handleRecalc}>
            Recalcular
          </Button>
        </div>
      </Card>

      <Card>
        <p className="text-slate-400 text-xs uppercase tracking-wide mb-1">
          A receber (mês seguinte)
        </p>
        <p className="text-2xl font-bold text-green-400">{formatCurrency(revenue.total)}</p>
        <div className="grid grid-cols-2 gap-2 text-xs mt-3 pt-3 border-t border-surface-border">
          <div>
            <span className="text-slate-400">Wellhub</span>
            <p className="text-white font-medium">{formatCurrency(revenue.perPartner.wellhub)}</p>
          </div>
          <div>
            <span className="text-slate-400">TotalPass</span>
            <p className="text-white font-medium">{formatCurrency(revenue.perPartner.totalpass)}</p>
          </div>
        </div>
        {hasZeroTargetStudents && (
          <p className="text-xs text-yellow-400 mt-3">
            Há alunos de parceiro com meta mensal 0 (não somam). Defina a meta na ficha do aluno.
          </p>
        )}
      </Card>
    </div>
  )
}
```

- [ ] **Step 2: Carregar rates + receita no server e renderizar o card**

Em `app/(admin)/admin/financeiro/page.tsx`:

(a) Adicionar os imports no topo (junto aos imports existentes):

```ts
import { PartnerRevenueCard } from './PartnerRevenueCard'
import {
  getPartnerCheckinRates,
  getPartnerRevenueThisMonth,
} from '@/features/financeiro/partnerRevenueActions'
```

(b) Após o bloco de `plans` (logo após a linha `const plans: SubscriptionPlan[] = plansRaw ?? []`), adicionar a carga dos dados de parceiro:

```ts
  // ─── Receita de parceiro (Wellhub/TotalPass) ─────────────────────────────
  const partnerRates = await getPartnerCheckinRates()
  const partnerRevenue = await getPartnerRevenueThisMonth()

  // Aviso: aluno de parceiro com meta 0 não soma na receita.
  const { data: partnerMembershipsRaw } = await adminClient
    .from('memberships')
    .select('monthly_checkin_target')
    .eq('organization_id', orgId)
    .in('payment_type', ['wellhub', 'totalpass'])
  const hasZeroTargetStudents = (
    (partnerMembershipsRaw ?? []) as { monthly_checkin_target: number }[]
  ).some((m) => (m.monthly_checkin_target ?? 0) === 0)
```

(c) Adicionar a seção no JSX, logo antes da seção "Gerenciar Planos" (antes de `{/* Gerenciar Planos */}`):

```tsx
      {/* Parceiros (Wellhub/TotalPass) */}
      <section>
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">
          Parceiros (Wellhub/TotalPass)
        </h2>
        <PartnerRevenueCard
          initialRates={partnerRates}
          initialRevenue={partnerRevenue}
          hasZeroTargetStudents={hasZeroTargetStudents}
        />
      </section>
```

- [ ] **Step 3: Verificar que o build passa**

Run: `npm run build`
Expected: build conclui sem erro de tipo; a rota `/admin/financeiro` compila com o novo card.

- [ ] **Step 4: Commit**

```bash
git add app/(admin)/admin/financeiro/PartnerRevenueCard.tsx app/(admin)/admin/financeiro/page.tsx
git commit -m "feat(financeiro): card de receita de check-in de parceiro com recalcular"
```

---

## Task 5: Action de autoatendimento `selfSetPartnerId` (F1)

**Files:**
- Modify: `features/checkin/actions.ts` (adicionar a action; reusa imports já presentes)

A action NÃO é admin-only: usa o usuário logado + academia ativa. Trava se houver `student_subscriptions` ativa. `features/checkin/actions.ts` já importa `createClient, createAdminClient, getActiveOrgId` e `CheckinPartner`.

- [ ] **Step 1: Adicionar a action no fim de `features/checkin/actions.ts`**

Inserir após a função `clearPendingPartner` (antes de `connectIntegration`, ou ao final do arquivo — qualquer posição entre as exports):

```ts
/**
 * Autoatendimento: o próprio aluno define seu vínculo de parceiro (Wellhub/TotalPass)
 * na academia ativa. Vale na hora. TRAVADO se o aluno já for mensalista ativo
 * (assinatura student_subscriptions com status='active'), para não conflitar com o
 * plano pago. NÃO mexe em monthly_checkin_target (a meta segue com o professor).
 */
export async function selfSetPartnerId(
  partner: CheckinPartner,
  partnerId: string,
): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  if (partner !== 'wellhub' && partner !== 'totalpass') {
    return { error: 'Parceiro inválido.' }
  }
  const trimmedId = partnerId.trim()
  if (!trimmedId) return { error: 'Informe o seu ID do parceiro.' }

  const adminClient = createAdminClient()

  // Trava: mensalista ativo não pode virar parceiro sozinho.
  const { data: activeSub } = await adminClient
    .from('student_subscriptions')
    .select('id')
    .eq('student_id', user.id)
    .eq('organization_id', orgId)
    .eq('status', 'active')
    .maybeSingle()
  if (activeSub) {
    return {
      error: 'Você tem um plano mensalista ativo. Fale com o professor para mudar para parceiro.',
    }
  }

  const idColumn = partner === 'wellhub' ? 'wellhub_id' : 'totalpass_id'
  const { error } = await adminClient
    .from('memberships')
    .update({
      payment_type: partner,
      [idColumn]: trimmedId,
      pending_partner: null,
    })
    .eq('user_id', user.id)
    .eq('organization_id', orgId)

  if (error) return { error: 'Erro ao salvar o vínculo de parceiro.' }

  revalidatePath('/perfil')
  return {}
}
```

- [ ] **Step 2: Verificar que o build passa**

Run: `npm run build`
Expected: build conclui sem erro de tipo.

- [ ] **Step 3: Commit**

```bash
git add features/checkin/actions.ts
git commit -m "feat(checkin): selfSetPartnerId (autoatendimento de ID, trava mensalista)"
```

---

## Task 6: Seção "Acesso por parceiro" no perfil (F1 UI)

**Files:**
- Create: `features/checkin/SelfPartnerForm.tsx`
- Modify: `app/(dashboard)/perfil/page.tsx`

- [ ] **Step 1: Criar o componente client `SelfPartnerForm`**

Cria `features/checkin/SelfPartnerForm.tsx`. Recebe o vínculo atual por props para pré-preencher; bloqueia o formulário se o aluno for mensalista ativo (`isActiveSubscriber`), mostrando a orientação.

```tsx
'use client'
// features/checkin/SelfPartnerForm.tsx
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { selfSetPartnerId } from '@/features/checkin/actions'
import type { CheckinPartner } from '@/types'

interface Props {
  currentPartner: CheckinPartner | null
  currentPartnerId: string | null
  isActiveSubscriber: boolean
}

export function SelfPartnerForm({ currentPartner, currentPartnerId, isActiveSubscriber }: Props) {
  const router = useRouter()
  const [partner, setPartner] = useState<CheckinPartner>(currentPartner ?? 'wellhub')
  const [partnerId, setPartnerId] = useState(currentPartnerId ?? '')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  if (isActiveSubscriber) {
    return (
      <p className="text-sm text-slate-300">
        Você tem um plano mensalista ativo. Para acessar via Wellhub ou TotalPass, fale com o
        professor.
      </p>
    )
  }

  function handleSave() {
    setError(null)
    setSuccess(null)
    const trimmed = partnerId.trim()
    if (!trimmed) {
      setError('Informe o seu ID do parceiro.')
      return
    }
    startTransition(async () => {
      const res = await selfSetPartnerId(partner, trimmed)
      if (res.error) {
        setError(res.error)
        return
      }
      setSuccess('Vínculo salvo. Seus check-ins serão registrados automaticamente.')
      router.refresh()
    })
  }

  return (
    <div className="space-y-3">
      {currentPartner && (
        <p className="text-xs text-slate-400">
          Vínculo atual:{' '}
          <span className="text-brand-500 font-medium capitalize">{currentPartner}</span>
          {currentPartnerId ? ` · ID ${currentPartnerId}` : ''}
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-slate-400 mb-1 block">Parceiro</label>
          <select
            value={partner}
            onChange={(e) => setPartner(e.target.value as CheckinPartner)}
            className="w-full bg-surface-card border border-surface-border rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-500"
          >
            <option value="wellhub">Wellhub</option>
            <option value="totalpass">TotalPass</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-slate-400 mb-1 block">Seu ID no parceiro</label>
          <Input
            type="text"
            placeholder="ID do parceiro"
            value={partnerId}
            onChange={(e) => setPartnerId(e.target.value)}
          />
        </div>
      </div>
      {error && (
        <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
          {error}
        </p>
      )}
      {success && (
        <p className="text-sm text-green-400 bg-green-500/10 border border-green-500/30 rounded-lg px-3 py-2">
          {success}
        </p>
      )}
      <Button size="sm" variant="primary" loading={pending} onClick={handleSave}>
        Salvar
      </Button>
    </div>
  )
}
```

- [ ] **Step 2: Renderizar a seção no perfil**

Em `app/(dashboard)/perfil/page.tsx`:

(a) Adicionar o import junto aos demais imports de componentes (perto da linha 8):

```ts
import { SelfPartnerForm } from '@/features/checkin/SelfPartnerForm'
```

(b) O `membership` carregado por `getActiveMembership()` (linha 29) já traz `payment_type`, `wellhub_id`, `totalpass_id`, `is_dependent`. Logo após a definição de `isWellhubOrTotalpass` (linha 137-138), derivar os dados do parceiro e se é mensalista ativo:

```ts
  const currentPartner =
    profile?.payment_type === 'wellhub' || profile?.payment_type === 'totalpass'
      ? profile.payment_type
      : null
  const currentPartnerId =
    currentPartner === 'wellhub'
      ? (membership?.wellhub_id ?? null)
      : currentPartner === 'totalpass'
        ? (membership?.totalpass_id ?? null)
        : null
  // Mensalista ativo ⇒ trava o autoatendimento (subscription já carregada acima).
  const isActiveSubscriber = subscription?.status === 'active'
```

(c) Adicionar a seção no JSX. Renderizar apenas para não-dependentes (dependentes são geridos pelo admin na ficha — F2), logo após a seção "Plano Ativo" (após o `</section>` que fecha o bloco da linha 176):

```tsx
      {/* Acesso por parceiro (autoatendimento de ID) — não para dependentes */}
      {!profile?.is_dependent && (
        <section>
          <SectionHeader title="Acesso por parceiro" />
          <div className="bg-surface-card border border-surface-border rounded-xl p-4">
            <p className="text-xs text-slate-500 mb-4">
              Informe seu ID do Wellhub ou TotalPass para registrar seus check-ins automaticamente.
            </p>
            <SelfPartnerForm
              currentPartner={currentPartner}
              currentPartnerId={currentPartnerId}
              isActiveSubscriber={isActiveSubscriber}
            />
          </div>
        </section>
      )}
```

- [ ] **Step 3: Verificar que o build passa**

Run: `npm run build`
Expected: build conclui sem erro de tipo; a rota `/perfil` compila com a nova seção.

- [ ] **Step 4: Commit**

```bash
git add features/checkin/SelfPartnerForm.tsx app/(dashboard)/perfil/page.tsx
git commit -m "feat(perfil): seção Acesso por parceiro (autoatendimento de ID)"
```

---

## Task 7: Verificação final (F2 + ponta a ponta)

F2 não tem código novo: dependentes já aparecem em `/admin/alunos` (a query filtra só `role='student'`, sem excluir `is_dependent`) e a ficha `/admin/alunos/[id]` já expõe a seção "Tipo de aluno". O ponto crítico do F2 — o cálculo de receita não filtrar `is_dependent` — está garantido em `getPartnerRevenueThisMonth` (Task 3, query sem filtro de dependente). Esta task valida tudo junto.

**Files:** nenhum (verificação).

- [ ] **Step 1: Rodar a suíte de testes**

Run: `npm run test:run`
Expected: PASS — todos os testes verdes, incluindo os 6 novos de `partnerRevenue.test.ts`.

- [ ] **Step 2: Build de produção**

Run: `npm run build`
Expected: build conclui sem erro de tipo nem de lint que quebre o build.

- [ ] **Step 3: Confirmar que a migration está pronta para o usuário aplicar**

Run: `git log --oneline -7`
Expected: ver os commits das Tasks 1-6. Lembrar o usuário de aplicar a migration `20260626000200_partner_checkin_rates.sql` no SQL Editor do Supabase **antes** de usar a tela (sem a tabela, `getPartnerCheckinRates`/`getPartnerRevenueThisMonth` retornam erro).

- [ ] **Step 4: Roteiro manual (pelo usuário, após aplicar a migration)**

Documentar para o usuário executar:
1. **F1 (aluno comum):** logar como aluno não-mensalista, abrir `/perfil` → seção "Acesso por parceiro" → escolher Wellhub + ID → Salvar → o vínculo aparece na hora.
2. **F1 (trava):** logar como aluno mensalista ativo → a seção mostra o aviso para falar com o professor (sem formulário).
3. **F2 (dependente):** no admin, abrir a ficha de um dependente, defini-lo como TotalPass com meta > 0; registrar check-ins; conferir que ele entra no card "A receber" do Financeiro.
4. **F3:** em `/admin/financeiro` → seção "Parceiros" → definir valores Wellhub/TotalPass → Salvar → registrar check-ins → "Recalcular" reflete os check-ins; conferir o total.

- [ ] **Step 5: Push da branch develop**

```bash
git push origin develop
```

Expected: branch `develop` atualizada no origin. (Merge para `main`/deploy de produção fica para o usuário autorizar separadamente, após aplicar a migration.)

---

## Self-Review (do autor do plano)

**1. Cobertura da spec:**
- F1 (aluno define o próprio ID, trava mensalista): Task 5 (action) + Task 6 (UI). ✓
- F2 (dependente no financeiro, sem schema novo): garantido pela query sem `is_dependent` em Task 3 + validação em Task 7. ✓
- F3 schema `partner_checkin_rates` + RLS: Task 1. ✓
- F3 tipo `PartnerCheckinRate`: Task 1. ✓
- F3 função pura `computePartnerRevenue` + testes: Task 2. ✓
- F3 actions (`getPartnerCheckinRates`, `setPartnerCheckinRate`, `getPartnerRevenueThisMonth`): Task 3. ✓
- F3 UI (`PartnerRevenueCard` + wire no page, valores + card "A receber" + Recalcular + aviso meta 0): Task 4. ✓
- Renovação mensal automática via `getMonthWindow`: usada em Task 3 (mesma janela do progresso do aluno). ✓
- Unidade em reais (numeric(10,2), format BRL direto): Task 1 + Task 4. ✓

**2. Placeholder scan:** sem TBD/TODO; todo passo tem código ou comando concreto. ✓

**3. Consistência de tipos:** `PartnerRates`, `PartnerStudentMonth`, `PartnerRevenue` definidos em Task 2 e usados com a mesma assinatura em Tasks 3 e 4. `PartnerCheckinRate` (Task 1) é o tipo da linha do banco, separado de `PartnerRates` (mapa parceiro→valor) — nomes distintos de propósito. `selfSetPartnerId(partner, partnerId)` (Task 5) bate com a chamada em `SelfPartnerForm` (Task 6). `setPartnerCheckinRate(partner, value)` / `getPartnerRevenueThisMonth()` (Task 3) batem com as chamadas em `PartnerRevenueCard` (Task 4). ✓
