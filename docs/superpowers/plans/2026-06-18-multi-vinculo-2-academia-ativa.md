# Multi-vínculo do aluno — Plano 2/3: Academia ativa + app lê/escreve via memberships

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer o app derivar TODA leitura/escrita por-academia da **academia ativa** (cookie `active_org_id`) e das `memberships`, em vez de `profiles.*`. `profiles` mantém as colunas (fonte dupla); o drop é o Plano 3.

**Architecture:** Um helper puro `resolveActiveOrg()` decide a academia ativa a partir das memberships + cookie. Helpers de servidor (`getActiveOrgId`, `getActiveMembership`, `getMemberships`) expõem isso. Toda query de aluno que hoje confia na RLS single-org passa a filtrar `organization_id = activeOrgId` explicitamente, e os campos por-academia (nível, créditos, plano) vêm da membership ativa. As RPCs de crédito e o webhook gravam em `memberships.credits_balance`.

**Pré-condição de segurança:** Neste plano **nenhum usuário tem 2 memberships ainda** (`joinAcademy` é o Plano 3). Logo `resolveActiveOrg` sempre cai na membership única → a academia ativa = a de hoje. O escopo por org adicionado é estruturalmente correto, mas é no-op até o Plano 3. Isso torna o deploy do Plano 2 de baixo risco.

**Tech Stack:** Next.js 14 (Server Components, Server Actions, `cookies()`), TypeScript, Supabase, Vitest.

**Contexto da sequência:** Plano 2 de 3 (ver `docs/superpowers/specs/2026-06-18-multi-vinculo-aluno-design.md`). Requer o Plano 1 aplicado (tabela `memberships`, backfill, RLS via `auth_org_ids()`, `handle_new_user` cria membership).

---

## File Structure

- **Criar** `lib/org/activeOrg.ts` — helper puro `resolveActiveOrg()` (lógica testável sem rede).
- **Criar** `lib/org/activeOrg.test.ts` — testes do helper.
- **Criar** `features/organizations/setActiveOrg.ts` — Server Action que grava o cookie `active_org_id`.
- **Modificar** `lib/supabase/server.ts` — `getMemberships`, `getActiveOrgId`, `resolveActiveOrgForUser`, `getActiveMembership`; reescrever `getCurrentOrgId`/`getCurrentOrg`/`getStaffContext`/`requireOwner` para usar a academia ativa.
- **Criar** `supabase/migrations/20260622000000_credit_rpcs_memberships.sql` — `adjust_credits` passa a atualizar `memberships.credits_balance` (param de org); mantém `credit_transactions`.
- **Modificar** `features/organizations/actions.ts` — `createAcademy` promove a **membership** do dono a `admin` (além de `profiles.role`, fonte dupla).
- **Modificar** `app/(dashboard)/layout.tsx` — resolve academia ativa; passa nome da org ativa ao topo.
- **Modificar** `app/(admin)/layout.tsx` — papel/owner via membership da academia ativa.
- **Modificar (audit de leitura/escrita)** — todos os arquivos listados na Task 8, trocando reads de `profiles.<campo por-academia>` por membership ativa e adicionando `organization_id = activeOrgId` nas queries de aluno.

---

## Task 1: Helper puro `resolveActiveOrg` (TDD)

**Files:**
- Create: `lib/org/activeOrg.ts`
- Test: `lib/org/activeOrg.test.ts`

- [ ] **Step 1: Escrever os testes (falhando)**

```ts
import { describe, it, expect } from 'vitest'
import { resolveActiveOrg } from './activeOrg'

const m = (organization_id: string) => ({ organization_id })

describe('resolveActiveOrg', () => {
  it('sem memberships → none', () => {
    expect(resolveActiveOrg([], null)).toEqual({ status: 'none' })
    expect(resolveActiveOrg([], 'org-1')).toEqual({ status: 'none' })
  })
  it('uma membership → ativa ela (ignora cookie inválido)', () => {
    expect(resolveActiveOrg([m('org-1')], null)).toEqual({ status: 'active', orgId: 'org-1' })
    expect(resolveActiveOrg([m('org-1')], 'lixo')).toEqual({ status: 'active', orgId: 'org-1' })
  })
  it('2+ e cookie válido → usa o cookie', () => {
    expect(resolveActiveOrg([m('org-1'), m('org-2')], 'org-2')).toEqual({ status: 'active', orgId: 'org-2' })
  })
  it('2+ e cookie ausente/inválido → choose', () => {
    expect(resolveActiveOrg([m('org-1'), m('org-2')], null)).toEqual({ status: 'choose' })
    expect(resolveActiveOrg([m('org-1'), m('org-2')], 'org-9')).toEqual({ status: 'choose' })
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:run -- lib/org/activeOrg.test.ts`
Expected: FAIL — `resolveActiveOrg` não existe.

- [ ] **Step 3: Implementar**

```ts
// lib/org/activeOrg.ts
// Decide a academia ativa a partir das memberships do usuário e do cookie.
// Função pura: sem rede, sem cookies — testável isoladamente.

export interface MembershipLite {
  organization_id: string
}

export type ActiveOrgResolution =
  | { status: 'none' } // usuário sem nenhuma membership
  | { status: 'active'; orgId: string } // resolvido (cookie válido ou membership única)
  | { status: 'choose' } // 2+ memberships e cookie ausente/inválido → precisa escolher

export function resolveActiveOrg(
  memberships: MembershipLite[],
  cookieOrgId: string | null,
): ActiveOrgResolution {
  if (memberships.length === 0) return { status: 'none' }
  const ids = memberships.map((mm) => mm.organization_id)
  if (cookieOrgId && ids.includes(cookieOrgId)) return { status: 'active', orgId: cookieOrgId }
  if (memberships.length === 1) return { status: 'active', orgId: ids[0] }
  return { status: 'choose' }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:run -- lib/org/activeOrg.test.ts`
Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add lib/org/activeOrg.ts lib/org/activeOrg.test.ts
git commit -m "feat: resolveActiveOrg puro (multi-vínculo plano 2)"
```

---

## Task 2: Server Action `setActiveOrg` (grava cookie)

**Files:**
- Create: `features/organizations/setActiveOrg.ts`

- [ ] **Step 1: Escrever a action**

```ts
'use server'
// features/organizations/setActiveOrg.ts
// Grava a academia ativa num cookie httpOnly. Valida que a org é uma membership do
// usuário (defesa: ninguém ativa uma academia da qual não participa).
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'

export const ACTIVE_ORG_COOKIE = 'active_org_id'

export async function setActiveOrg(orgId: string): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  // memberships do usuário são legíveis por ele (RLS memberships_select_own).
  const { data: membership } = await supabase
    .from('memberships')
    .select('organization_id')
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!membership) return { error: 'Você não participa desta academia.' }

  cookies().set(ACTIVE_ORG_COOKIE, orgId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  })
  return {}
}
```

- [ ] **Step 2: Verificar build**

Run: `npm run build`
Expected: compila sem erros.

- [ ] **Step 3: Commit**

```bash
git add features/organizations/setActiveOrg.ts
git commit -m "feat: action setActiveOrg grava cookie active_org_id (multi-vínculo plano 2)"
```

---

## Task 3: Helpers de servidor (academia ativa)

**Files:**
- Modify: `lib/supabase/server.ts`

- [ ] **Step 1: Adicionar imports e helpers de academia ativa**

No topo do arquivo, junto aos imports existentes, adicionar:

```ts
import { resolveActiveOrg, type ActiveOrgResolution } from '@/lib/org/activeOrg'
import { ACTIVE_ORG_COOKIE } from '@/features/organizations/setActiveOrg'
import type { Membership } from '@/types'
```

Adicionar, após `createAdminClient()`:

```ts
// Memberships do usuário logado, com nome/slug da academia (para a tela de seleção
// e o seletor do topo). Lê via RLS (memberships_select_own).
export interface MembershipWithOrg {
  organization_id: string
  role: string
  org_name: string
  org_slug: string
}

export async function getMemberships(): Promise<MembershipWithOrg[]> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []
  const { data } = await supabase
    .from('memberships')
    .select('organization_id, role, organizations(name, slug)')
    .eq('user_id', user.id)
  return ((data ?? []) as Array<{
    organization_id: string
    role: string
    organizations: { name: string; slug: string } | { name: string; slug: string }[] | null
  }>).map((r) => {
    const o = Array.isArray(r.organizations) ? r.organizations[0] : r.organizations
    return {
      organization_id: r.organization_id,
      role: r.role,
      org_name: o?.name ?? '',
      org_slug: o?.slug ?? '',
    }
  })
}

// Resolução completa (none | active | choose). Usada pelos layouts para decidir
// redirect para /selecionar-academia (Plano 3). Hoje, com 1 membership, sempre active.
export async function resolveActiveOrgForUser(): Promise<ActiveOrgResolution> {
  const memberships = await getMemberships()
  const cookieOrgId = cookies().get(ACTIVE_ORG_COOKIE)?.value ?? null
  return resolveActiveOrg(
    memberships.map((mm) => ({ organization_id: mm.organization_id })),
    cookieOrgId,
  )
}

// Id da academia ativa (null se não resolvida — sem membership ou precisa escolher).
export async function getActiveOrgId(): Promise<string | null> {
  const res = await resolveActiveOrgForUser()
  return res.status === 'active' ? res.orgId : null
}

// Membership do usuário na academia ativa (campos por-academia: level, credits, etc.).
export async function getActiveMembership(): Promise<Membership | null> {
  const orgId = await getActiveOrgId()
  if (!orgId) return null
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await createAdminClient()
    .from('memberships')
    .select('*')
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .single()
  return (data as Membership) ?? null
}
```

- [ ] **Step 2: Reescrever `getCurrentOrgId` / `getCurrentOrg` para derivar da academia ativa**

Substituir o corpo de `getCurrentOrgId` (linhas ~37-47) por:

```ts
// Academia (tenant) ativa do usuário. Deriva da membership ativa (cookie), NÃO mais de
// profiles.organization_id. Use para escopar TODA query feita com createAdminClient.
export async function getCurrentOrgId(): Promise<string | null> {
  return getActiveOrgId()
}
```

`getCurrentOrg()` permanece como está (já usa `getCurrentOrgId()`).

- [ ] **Step 3: Reescrever `getStaffContext` para usar a membership ativa**

Substituir o corpo de `getStaffContext` (linhas ~68-92) por:

```ts
export async function getStaffContext(): Promise<StaffContext | null> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const orgId = await getActiveOrgId()
  if (!orgId) return null

  const admin = createAdminClient()
  // Papel vem da membership da academia ativa (não mais de profiles.role).
  const { data: membership } = await admin
    .from('memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .single()
  if (!membership) return null

  const { data: org } = await admin
    .from('organizations')
    .select('owner_id')
    .eq('id', orgId)
    .single()

  return {
    userId: user.id,
    organizationId: orgId,
    isOwner: org?.owner_id === user.id,
  }
}
```

`requireOwner()` permanece como está (usa `getStaffContext()`).

- [ ] **Step 4: Verificar build**

Run: `npm run build`
Expected: compila. (Atenção a import circular: `setActiveOrg.ts` importa de `server.ts`? Não — `server.ts` importa `ACTIVE_ORG_COOKIE` de `setActiveOrg.ts`, e `setActiveOrg.ts` importa `createClient` de `server.ts`. Para evitar ciclo, mover a constante `ACTIVE_ORG_COOKIE` para `lib/org/activeOrg.ts` e importá-la nos dois. **Faça isso:** declare `export const ACTIVE_ORG_COOKIE = 'active_org_id'` em `lib/org/activeOrg.ts`, e em `setActiveOrg.ts`/`server.ts` importe de `@/lib/org/activeOrg`.)

> **Correção de ciclo (aplicar):** em `lib/org/activeOrg.ts` adicione `export const ACTIVE_ORG_COOKIE = 'active_org_id'`. Em `setActiveOrg.ts` troque a declaração local por `import { ACTIVE_ORG_COOKIE } from '@/lib/org/activeOrg'` e re-exporte se necessário. Em `server.ts` importe `ACTIVE_ORG_COOKIE` de `@/lib/org/activeOrg`.

- [ ] **Step 5: Commit**

```bash
git add lib/supabase/server.ts lib/org/activeOrg.ts features/organizations/setActiveOrg.ts
git commit -m "feat: helpers de academia ativa em server.ts (multi-vínculo plano 2)"
```

---

## Task 4: RPC de crédito grava em `memberships.credits_balance`

**Files:**
- Create: `supabase/migrations/20260622000000_credit_rpcs_memberships.sql`
- Reference: `supabase/migrations/20260611000000_booking_and_credit_rpcs.sql`

**Problema:** `adjust_credits` hoje faz `update profiles set credits_balance = ...`. Com multi-vínculo o saldo é por-academia → precisa atualizar a `memberships` da `(student_id, org)`. A org não é parâmetro hoje; `credit_transactions` já tem `organization_id` (preenchido pelo trigger de autofill — que ainda funciona no Plano 2 porque `profiles.organization_id` existe). Adicionamos um parâmetro `p_org` e fazemos o update na membership; o profile continua sendo atualizado também (fonte dupla até o Plano 3).

- [ ] **Step 1: Escrever a migration**

```sql
-- Multi-vínculo (Plano 2) — RPC de crédito por academia.
-- adjust_credits ganha p_org: atualiza memberships.credits_balance da (aluno, org) e,
-- por fonte dupla (até o Plano 3), também profiles.credits_balance. Mantém a inserção
-- em credit_transactions. Assinatura antiga é removida para evitar ambiguidade.

drop function if exists public.adjust_credits(uuid, int, text, text, uuid, timestamptz);

create or replace function public.adjust_credits(
  p_student_id uuid,
  p_org uuid,
  p_delta int,
  p_type text,
  p_reason text,
  p_session_id uuid default null,
  p_expires_at timestamptz default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_found boolean;
begin
  update memberships
  set credits_balance = credits_balance + p_delta
  where user_id = p_student_id
    and organization_id = p_org
    and credits_balance + p_delta >= 0;

  get diagnostics v_found = row_count;
  if v_found = 0 then
    perform 1 from memberships where user_id = p_student_id and organization_id = p_org;
    if not found then
      raise exception 'STUDENT_NOT_FOUND';
    end if;
    raise exception 'INSUFFICIENT_CREDITS';
  end if;

  -- Fonte dupla: mantém profiles.credits_balance em sincronia (removido no Plano 3).
  update profiles set credits_balance = credits_balance + p_delta where id = p_student_id;

  insert into credit_transactions (student_id, organization_id, type, amount, reason, session_id, expires_at)
  values (p_student_id, p_org, p_type::credit_transaction_type, p_delta, p_reason, p_session_id, p_expires_at);
end;
$$;

revoke all on function public.adjust_credits(uuid, uuid, int, text, text, uuid, timestamptz) from public, anon, authenticated;
```

> **Nota:** `book_session_atomic` insere em `session_bookings` sem mexer em saldo — não muda aqui. Mas o `session_bookings.organization_id` precisa estar preenchido; no Plano 2 ainda vem do trigger de autofill (que deriva de `profiles.organization_id`, ainda presente). O ajuste para a org explícita acontece quando o app chamar com a org ativa (Step 2 abaixo / Task 8).

- [ ] **Step 2: Atualizar TODOS os call sites de `adjust_credits` no app**

Busque os chamadores e adicione o argumento de org (a academia ativa do contexto). Run: `grep -rn "adjust_credits\|rpc('adjust_credits'\|\.rpc(\"adjust_credits" features app` (esperado: `features/aulas/actions.ts`, `features/aulas/creditReconciliation.ts`, `features/aulas/adminActions.ts`, `app/api/webhooks/mercadopago/route.ts`, cron de renovação se houver). Para cada chamada `supabase.rpc('adjust_credits', { p_student_id, p_delta, p_type, p_reason, ... })`, inserir `p_org: <orgId>` onde `<orgId>` é a academia ativa (`await getActiveOrgId()` no contexto do aluno) ou, em contexto admin, `ctx.organizationId` do `getStaffContext()`/`requireOwner()`, ou — no webhook/cron — a `organization_id` da linha de origem (subscription/payment).

> Esta troca de assinatura faz o build/tests falharem até todos os call sites passarem `p_org`. Resolva todos antes do commit.

- [ ] **Step 3: Verificar**

Run: `npm run build` e `npm run test:run`
Expected: build e testes verdes (após corrigir todos os call sites).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260622000000_credit_rpcs_memberships.sql features app
git commit -m "feat: adjust_credits por academia (memberships.credits_balance) + call sites (multi-vínculo plano 2)"
```

---

## Task 5: Webhook Mercado Pago grava saldo na membership

**Files:**
- Modify: `app/api/webhooks/mercadopago/route.ts`

- [ ] **Step 1: Trocar a atualização de saldo**

O webhook hoje faz `update profiles set credits_balance = credits_per_month` (renovação, não acúmulo). A `student_subscriptions` tem `organization_id`. Substituir a atualização de `profiles.credits_balance` por uma atualização de `memberships.credits_balance` da `(student_id, organization_id da subscription)`, mantendo a inserção em `credit_transactions` com a mesma `organization_id`. Por fonte dupla, manter também o update em `profiles` (removido no Plano 3).

Padrão concreto (adaptar aos nomes de variável já existentes no arquivo):

```ts
// orgId vem de student_subscriptions.organization_id (já carregado para achar o plano)
await adminClient
  .from('memberships')
  .update({ credits_balance: creditsPerMonth })
  .eq('user_id', studentId)
  .eq('organization_id', orgId)

// fonte dupla (removido no Plano 3)
await adminClient
  .from('profiles')
  .update({ credits_balance: creditsPerMonth })
  .eq('id', studentId)
```

> Se o webhook ainda não seleciona `organization_id` da subscription, adicione-o ao `select`.

- [ ] **Step 2: Verificar build**

Run: `npm run build`
Expected: compila.

- [ ] **Step 3: Commit**

```bash
git add app/api/webhooks/mercadopago/route.ts
git commit -m "feat: webhook MP renova saldo na membership da academia (multi-vínculo plano 2)"
```

---

## Task 6: `createAcademy` promove a membership do dono a admin

**Files:**
- Modify: `features/organizations/actions.ts` (função `createAcademy`, bloco final que promove `profiles.role` e grava `owner_id`)

- [ ] **Step 1: Promover também a membership**

No bloco final de `createAcademy` (após criar o usuário), além do `update profiles set role='admin'` e do `update organizations set owner_id`, promover a membership inicial (que o trigger `handle_new_user` criou como `student`) a `admin`:

```ts
// 3. Promove o perfil a admin e marca como dono da org.
await admin.from('profiles').update({ role: 'admin' }).eq('id', created.user.id)
await admin.from('organizations').update({ owner_id: created.user.id }).eq('id', org.id)
// Promove também a membership da academia recém-criada (fonte da verdade do papel).
await admin
  .from('memberships')
  .update({ role: 'admin' })
  .eq('user_id', created.user.id)
  .eq('organization_id', org.id)
```

> `createProfessor` (mesmo arquivo) também cria usuário via `handle_new_user` (membership student) e promove `profiles.role='admin'`. Aplicar a mesma promoção da membership ali: após `update profiles set role='admin'`, `update memberships set role='admin' where user_id = created.user.id and organization_id = ctx.organizationId`.

- [ ] **Step 2: Verificar build**

Run: `npm run build`
Expected: compila.

- [ ] **Step 3: Commit**

```bash
git add features/organizations/actions.ts
git commit -m "feat: createAcademy/createProfessor promovem a membership a admin (multi-vínculo plano 2)"
```

---

## Task 7: Layouts derivam papel/academia ativa via membership

**Files:**
- Modify: `app/(admin)/layout.tsx`
- Modify: `app/(dashboard)/layout.tsx`

- [ ] **Step 1: Admin layout — papel e owner via academia ativa**

Substituir a checagem de papel (que hoje lê `profiles.role` e `profiles.organization_id`) por:

```ts
import { createClient } from '@/lib/supabase/server'
import { getStaffContext } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/server'
// ...
const ctx = await getStaffContext()
if (!ctx) redirect('/home') // sem contexto de staff na academia ativa

const adminClient = createAdminClient()
const { data: org } = await adminClient
  .from('organizations')
  .select('owner_id, name, onboarding_completed')
  .eq('id', ctx.organizationId)
  .single()

const isOwner = ctx.isOwner
// gate de onboarding inalterado:
if (org && org.onboarding_completed === false && isOwner) redirect('/onboarding')
```

> `getStaffContext()` já valida que o usuário tem membership na academia ativa; mas **não** valida o papel `admin`. Mantenha um gate explícito: leia o papel via membership ativa e redirecione não-admins para `/home`. Concreto: após `getStaffContext()`, buscar `memberships.role` da `(user, ctx.organizationId)` e `if (role !== 'admin') redirect('/home')`. (No Plano 3, admin com 2+ academias passa pela seleção; hoje é single.)

- [ ] **Step 2: Dashboard layout — nome da org ativa + (gancho do Plano 3)**

`app/(dashboard)/layout.tsx` já usa `getCurrentOrg()` que agora deriva da academia ativa — nenhuma mudança obrigatória de comportamento no Plano 2 (1 membership). **Adicionar o gancho de redireção** para o Plano 3 já é útil e seguro:

```ts
import { resolveActiveOrgForUser } from '@/lib/supabase/server'
// ...
const res = await resolveActiveOrgForUser()
if (res.status === 'choose') redirect('/selecionar-academia') // rota criada no Plano 3
// res.status === 'none' → usuário sem academia; deixa seguir (estado raro), org?.name fica vazio
```

> No Plano 2 ninguém tem 2 memberships, então `status` nunca é `choose` — a linha é inerte até o Plano 3, mas já deixa o layout pronto. A rota `/selecionar-academia` só existe a partir do Plano 3; o redirect nunca dispara antes disso.

- [ ] **Step 3: Verificar build**

Run: `npm run build`
Expected: compila.

- [ ] **Step 4: Commit**

```bash
git add "app/(admin)/layout.tsx" "app/(dashboard)/layout.tsx"
git commit -m "feat: layouts via academia ativa/membership (multi-vínculo plano 2)"
```

---

## Task 8: Auditoria de leitura/escrita por-academia (campos de membership + escopo de org)

Esta é a tarefa central de superfície. **Transformação canônica** a aplicar em cada arquivo:

1. **Campos por-academia lidos de `profiles`** (`level`, `credits_balance`, `payment_type`, `contract_active`, `monthly_checkin_target`, `pending_partner`, `is_dependent`, `parent_id`, `wellhub_id`, `totalpass_id`, `role`) → ler da **membership da academia ativa**.
   - Em página de aluno: `const membership = await getActiveMembership()` e usar `membership.level`, `membership.credits_balance`, etc. (em vez de `profile.level`...). `full_name`/`avatar_url`/`phone`/`city` continuam vindo de `profiles`.
   - Em página/ação de admin sobre um aluno-alvo: ler a membership do aluno na academia do admin (`ctx.organizationId`), não de `profiles`.
2. **Queries de aluno que hoje confiam na RLS single-org** (tabelas com `organization_id`: `classes`, `dayuse_slots`, `tournaments`, `subscription_plans`, e leituras por `student_id` que cruzam academias: `session_bookings`, `enrollments`, `waitlists`) → adicionar `.eq('organization_id', activeOrgId)` com `activeOrgId = await getActiveOrgId()`.
3. **Escritas por aluno** (insert em `session_bookings`, `waitlists`, `credit_transactions` via RPC, `posts`, `post_likes`, `post_comments`, `dayuse_bookings`, `medical_profiles`, `enrollments`) → passar `organization_id: activeOrgId` explicitamente (não depender do trigger de autofill, que será simplificado no Plano 3).

> **Exemplo totalmente resolvido — `app/(dashboard)/home/page.tsx`** (padrão a replicar):
> - Trocar o `select('full_name, credits_balance, payment_type, level, is_dependent')` de `profiles` por: manter de `profiles` só `full_name`; obter `credits_balance`, `payment_type`, `level`, `is_dependent` de `const membership = await getActiveMembership()`.
> - Definir `const orgId = await getActiveOrgId()` no topo.
> - Adicionar `.eq('organization_id', orgId)` nas queries de `tournaments`, `classes`, `dayuse_slots`.
> - Para as leituras por `student_id` (`session_bookings` "próximas aulas", `enrollments` weeklyCount, `waitlists`), adicionar `.eq('organization_id', orgId)`.
> - `showCredits`, `StatHeader` etc. passam a ler de `membership`.

**Subtarefas (uma por arquivo — cada uma: aplicar a transformação canônica, `npm run build`, commit):**

- [ ] **8.1** `app/(dashboard)/home/page.tsx` — membership: `credits_balance, payment_type, level, is_dependent`; org-scope: `tournaments, classes, dayuse_slots, session_bookings, enrollments, waitlists`.
- [ ] **8.2** `app/(dashboard)/agendar/page.tsx` — membership: `level, is_dependent`; org-scope: `classes, session_bookings, enrollments, waitlists`.
- [ ] **8.3** `app/(dashboard)/perfil/page.tsx` — membership: `level, payment_type, credits_balance, contract_active, monthly_checkin_target, is_dependent`; identidade (`full_name, phone, city, avatar_url`) segue em `profiles`.
- [ ] **8.4** `app/(dashboard)/comunidade/page.tsx` + `app/(dashboard)/comunidade/ComunidadeClient.tsx` + `features/comunidade/PostFeed.tsx` + `features/comunidade/CreatePost.tsx` + `features/comunidade/actions.ts` — org-scope dos posts/likes/comments por `organization_id = activeOrgId`; inserts passam `organization_id`.
- [ ] **8.5** `app/(dashboard)/torneios/[id]/page.tsx` + `features/torneios/actions.ts` + `features/torneios/TournamentCard.tsx` — org-scope de `tournaments`/`tournament_matches`/`tournament_registrations`.
- [ ] **8.6** `features/aulas/actions.ts` (booking/cancel) — usar `activeOrgId` no insert de `session_bookings`, passar `p_org` para `adjust_credits`; respeitar `organization_id` ao consultar `class_sessions`/`classes`.
- [ ] **8.7** `features/aulas/waitlistActions.ts` — `waitlists` insert/select com `organization_id = activeOrgId`.
- [ ] **8.8** `features/aulas/creditReconciliation.ts` + `features/aulas/adminActions.ts` — leituras de saldo/`monthly_checkin_target` via membership; `adjust_credits` com `p_org = ctx.organizationId`.
- [ ] **8.9** `features/checkin/actions.ts` + `lib/checkin/validator.ts` — `payment_type, wellhub_id, totalpass_id, monthly_checkin_target, pending_partner` via membership da academia ativa do aluno (admin define-os na membership, não em `profiles`); inserts de `checkins` passam `organization_id`.
- [ ] **8.10** `features/financeiro/actions.ts` + `app/(admin)/admin/financeiro/page.tsx` + `app/(admin)/admin/financeiro/adminActions.ts` — leituras de plano/contrato/saldo via membership; escopo por `ctx.organizationId`.
- [ ] **8.11** Páginas admin de alunos: `app/(admin)/admin/alunos/page.tsx`, `app/(admin)/admin/alunos/[id]/page.tsx`, `app/(admin)/admin/alunos/[id]/StudentProfileClient.tsx` — listar/editar `level, payment_type, contract_active, credits_balance, monthly_checkin_target, is_dependent, parent_id` na **membership** do aluno na `ctx.organizationId` (updates passam a escrever em `memberships`, mantendo `profiles` em fonte dupla via update espelhado até o Plano 3).
- [ ] **8.12** `app/(admin)/admin/dashboard/page.tsx`, `app/(admin)/admin/grade/**`, `app/(admin)/admin/torneios/**`, `app/(admin)/admin/configuracoes/page.tsx`, `app/(admin)/admin/equipe/page.tsx` — todas as leituras de alunos/turmas/config escopadas por `ctx.organizationId`; campos por-academia de alunos via membership.
- [ ] **8.13** `features/aulas/DependentsSection.tsx` + criação de dependentes — `is_dependent`/`parent_id` na membership; dependente recebe membership na mesma org.
- [ ] **8.14** Cron jobs em `app/api/cron/**` (renovação de crédito, waitlist) — iterar por membership (saldo por academia); `adjust_credits` com `p_org`.

> **Para o executor (subagent-driven):** despache **uma subtarefa por vez**, na ordem 8.1→8.14. Em cada uma: leia o arquivo atual, aplique a transformação canônica (membership ativa + `organization_id = activeOrgId`), rode `npm run build` e `npm run test:run`, e faça um commit isolado por subtarefa (`refactor(8.x): <arquivo> via membership/academia ativa`). Não agrupar várias subtarefas num commit — facilita revisão e rollback.

- [ ] **Step final da Task 8: grep de regressão**

Run: `grep -rn "credits_balance\|\.level\|payment_type\|monthly_checkin_target\|contract_active\|pending_partner\|wellhub_id\|totalpass_id" features app --include=*.ts --include=*.tsx | grep -i "profiles"`
Expected: nenhuma leitura desses campos a partir de `profiles` em código de app (todas migraram para membership). Restam apenas os updates de fonte dupla intencionais (marcados com comentário `// fonte dupla`).

---

## Verificação (fim do Plano 2)

1. `npm run test:run` — verde (incluindo `lib/org/activeOrg.test.ts` e os testes de regras existentes).
2. `npm run build` — sem erros de tipo.
3. **Aplicar migration** `20260622000000_credit_rpcs_memberships.sql` (SQL Editor) **antes** de subir o deploy que usa a nova assinatura de `adjust_credits`.
4. **Teste de fumaça em produção (1 academia, comportamento idêntico):** login como aluno Hudson → home mostra créditos/nível corretos (agora da membership); agendar/cancelar aula debita/credita certo (RPC com `p_org`); check-in Wellhub/TotalPass; painel admin lista e edita alunos (gravando na membership). Tudo idêntico ao de antes.
5. **Conferência de saldo (SQL Editor):** após uma operação de crédito, `memberships.credits_balance` e `profiles.credits_balance` da mesma `(user, org)` devem coincidir (fonte dupla sincronizada).

> **Não** seguir para o Plano 3 (que dropa as colunas de `profiles`) antes de confirmar os itens 4 e 5 estáveis em produção.

---

## Self-Review (autor do plano)

- **Cobertura da spec (seções 4 e 6):** academia ativa em cookie ✓ (Tasks 1-3); `getMemberships`/`getActiveOrgId`/`getCurrentOrg(Id)`/`getStaffContext`/`requireOwner` ✓ (Task 3); RPCs de crédito em `memberships` ✓ (Task 4); leitura de saldo via membership ✓ (Task 8); layouts via membership ✓ (Task 7). A **tela de seleção** e o **seletor de troca** ficam para o Plano 3 (dependem de 2+ memberships, que só existem após `joinAcademy`).
- **Placeholders:** as Tasks 1-7 têm código literal completo. A Task 8 é uma auditoria de ~30 arquivos: especifica a transformação canônica + um exemplo totalmente resolvido (home) + lista nominal por arquivo com os campos/queries exatos. Cada subtarefa é executada lendo o arquivo no momento — decisão consciente para um refactor mecânico amplo (evita código que envelhece no plano).
- **Consistência de tipos/nomes:** `getActiveOrgId`, `getActiveMembership`, `resolveActiveOrgForUser`, `ACTIVE_ORG_COOKIE`, `adjust_credits(p_student_id, p_org, ...)` usados de forma consistente entre tasks. Ciclo de import resolvido movendo `ACTIVE_ORG_COOKIE` para `lib/org/activeOrg.ts`.
- **Risco de cutover:** mitigado — `profiles` mantém colunas (fonte dupla); todo update por-academia espelha em `profiles` até o Plano 3; nenhum usuário tem 2 memberships ainda.
