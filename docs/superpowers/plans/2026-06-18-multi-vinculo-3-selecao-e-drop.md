# Multi-vínculo do aluno — Plano 3/3: Seleção de academia, `joinAcademy` e drop de `profiles`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Habilitar de fato o multi-vínculo no app — tela de seleção quando há 2+ academias, seletor de troca no topo, entrada self-service numa 2ª academia por código de convite (já logado) — e então **remover as colunas por-academia de `profiles`**, encerrando a fonte dupla.

**Architecture:** O Plano 2 já fez o app derivar tudo da academia ativa (cookie) e das `memberships`, com `profiles` ainda espelhando os campos (fonte dupla). O Plano 3 (a) entrega a UI que cria/usa múltiplos vínculos e (b) faz o cutover final: reescreve as funções/triggers/RLS que ainda tocam as colunas por-academia de `profiles`, e só então dropa essas colunas. Após este plano, `profiles` carrega apenas **identidade** (login, nome, foto, telefone, cidade) e `memberships` é a única fonte da verdade do que é por-academia.

**Tech Stack:** Next.js 14 (Server Components, Server Actions, `cookies()`), TypeScript, Supabase (Postgres + RLS), Vitest.

**Contexto da sequência:** Plano 3 de 3 (ver `docs/superpowers/specs/2026-06-18-multi-vinculo-aluno-design.md`). **Requer os Planos 1 e 2 aplicados e estáveis em produção** — em especial: `memberships` é fonte da verdade, `getActiveOrgId`/`getActiveMembership`/`getMemberships`/`resolveActiveOrgForUser` existem em `lib/supabase/server.ts`, `setActiveOrg`/`ACTIVE_ORG_COOKIE` existem, e **nenhum** código de app ainda lê os campos por-academia de `profiles` (só restam os updates de "fonte dupla" marcados com `// fonte dupla`).

**Ordem de cutover (crítica):** As tarefas de UI (1–4) podem ir a produção a qualquer momento — são puramente aditivas. O **drop das colunas** (Tasks 5–8) só é seguro depois que: (i) o código que ainda escreve em `profiles` (fonte dupla) for removido e implantado (Task 6), e (ii) as funções/triggers/RLS do banco que ainda referenciam essas colunas forem reescritas (Task 5). A migration que dropa as colunas (Task 7) é a **última** coisa a aplicar.

---

## File Structure

- **Criar** `app/selecionar-academia/page.tsx` — Server Component: lista as memberships e oferece a escolha.
- **Criar** `app/selecionar-academia/AcademyChooser.tsx` — Client Component: chama `setActiveOrg` e navega.
- **Criar** `components/ui/OrgSwitcher.tsx` — Client Component: seletor de troca no topo (só aparece com 2+ vínculos).
- **Modificar** `app/(dashboard)/layout.tsx` — renderiza o `OrgSwitcher` no lugar do nome estático quando há 2+ vínculos.
- **Modificar** `features/organizations/actions.ts` — nova action `joinAcademy(inviteCode)`.
- **Modificar** `app/(auth)/cadastro/page.tsx` — fluxo de convite para **usuário já logado** (entra na academia em vez de criar conta).
- **Criar** `supabase/migrations/20260623000000_profiles_identity_cutover.sql` — reescreve `handle_new_user` e `adjust_credits` (sem `profiles` por-academia), dropa os triggers de autofill que derivam de `profiles`, reescreve a RLS de `profiles` via `memberships`.
- **Criar** `supabase/migrations/20260623000100_drop_profiles_per_org_columns.sql` — dropa `auth_org_id()` e as colunas por-academia de `profiles`.
- **Modificar** `types/index.ts` — `Profile` slim (só identidade).

---

## Task 1: Tela `/selecionar-academia`

**Files:**
- Create: `app/selecionar-academia/page.tsx`
- Create: `app/selecionar-academia/AcademyChooser.tsx`

A rota fica **fora** dos grupos `(dashboard)`/`(admin)` (aqueles layouts redirecionam para cá quando `status === 'choose'`; colocá-la dentro causaria laço). Tem seu próprio shell mínimo.

- [ ] **Step 1: Criar o Client Component da escolha**

```tsx
// app/selecionar-academia/AcademyChooser.tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { setActiveOrg } from '@/features/organizations/setActiveOrg'
import { Card } from '@/components/ui/Card'

interface Option {
  organization_id: string
  org_name: string
  role: string
}

export function AcademyChooser({ options }: { options: Option[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')

  async function choose(orgId: string) {
    setBusy(orgId)
    setError('')
    const res = await setActiveOrg(orgId)
    if (res.error) {
      setError(res.error)
      setBusy(null)
      return
    }
    // Admin cai no painel; aluno na home. O layout de destino revalida o cookie.
    const role = options.find((o) => o.organization_id === orgId)?.role
    router.push(role === 'admin' ? '/admin/dashboard' : '/home')
    router.refresh()
  }

  return (
    <Card>
      <div className="h-1.5 -mx-4 -mt-4 mb-6 rounded-t-xl bg-gradient-to-r from-brand-500 to-brand-700" />
      <h2 className="text-lg font-semibold text-white mb-1">Escolha a academia</h2>
      <p className="text-slate-400 text-sm mb-6">Você participa de mais de uma academia.</p>
      <div className="flex flex-col gap-3">
        {options.map((o) => (
          <button
            key={o.organization_id}
            onClick={() => choose(o.organization_id)}
            disabled={busy !== null}
            className="w-full text-left px-4 py-3 rounded-xl bg-surface-card border border-surface-border hover:border-brand-500 transition-colors disabled:opacity-50"
          >
            <span className="block text-white font-medium">{o.org_name}</span>
            <span className="block text-xs text-slate-400">
              {o.role === 'admin' ? 'Administração' : 'Aluno'}
              {busy === o.organization_id ? ' · entrando…' : ''}
            </span>
          </button>
        ))}
      </div>
      {error && <p className="text-sm text-red-400 mt-4">{error}</p>}
    </Card>
  )
}
```

- [ ] **Step 2: Criar a página (Server Component)**

```tsx
// app/selecionar-academia/page.tsx
import { redirect } from 'next/navigation'
import { createClient, getMemberships } from '@/lib/supabase/server'
import { AcademyChooser } from './AcademyChooser'

export default async function SelecionarAcademiaPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const memberships = await getMemberships()
  // 0 vínculos: estado raro — manda pra home (layout decide o que fazer).
  if (memberships.length === 0) redirect('/home')
  // 1 vínculo: não há o que escolher — segue direto.
  if (memberships.length === 1) {
    const only = memberships[0]
    redirect(only.role === 'admin' ? '/admin/dashboard' : '/home')
  }

  return (
    <div className="min-h-screen bg-surface text-white flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <AcademyChooser
          options={memberships.map((m) => ({
            organization_id: m.organization_id,
            org_name: m.org_name,
            role: m.role,
          }))}
        />
      </div>
    </div>
  )
}
```

> O redirect do layout `(dashboard)` para `/selecionar-academia` (quando `status === 'choose'`) já foi adicionado no Plano 2, Task 7. Inerte até existirem 2+ memberships.

- [ ] **Step 3: Verificar build**

Run: `npm run build`
Expected: compila.

- [ ] **Step 4: Commit**

```bash
git add "app/selecionar-academia/page.tsx" "app/selecionar-academia/AcademyChooser.tsx"
git commit -m "feat: tela /selecionar-academia (multi-vínculo plano 3)"
```

---

## Task 2: Seletor de troca no topo (`OrgSwitcher`)

**Files:**
- Create: `components/ui/OrgSwitcher.tsx`
- Modify: `app/(dashboard)/layout.tsx`

- [ ] **Step 1: Criar o `OrgSwitcher` (client)**

```tsx
// components/ui/OrgSwitcher.tsx
'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { setActiveOrg } from '@/features/organizations/setActiveOrg'

interface Item {
  organization_id: string
  org_name: string
}

// Mostra o nome da academia ativa; ao clicar, abre um menu para trocar de academia.
// Só deve ser renderizado quando há 2+ vínculos (decisão no layout).
export function OrgSwitcher({ items, activeOrgId }: { items: Item[]; activeOrgId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const active = items.find((i) => i.organization_id === activeOrgId)

  function switchTo(orgId: string) {
    setOpen(false)
    if (orgId === activeOrgId) return
    startTransition(async () => {
      await setActiveOrg(orgId)
      router.push('/home')
      router.refresh()
    })
  }

  return (
    <div className="relative max-w-[60%]">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={pending}
        className="flex items-center gap-1 text-sm font-semibold text-white truncate disabled:opacity-50"
      >
        <span className="truncate">{active?.org_name ?? ''}</span>
        <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor" className="shrink-0 text-slate-400">
          <path d="M5.5 7.5L10 12l4.5-4.5z" />
        </svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-8 z-50 w-56 rounded-xl bg-surface-card border border-surface-border shadow-lg py-1">
            {items.map((i) => (
              <button
                key={i.organization_id}
                onClick={() => switchTo(i.organization_id)}
                className="block w-full text-left px-3 py-2 text-sm text-white hover:bg-surface-border/40 truncate"
              >
                {i.organization_id === activeOrgId ? '✓ ' : ''}{i.org_name}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Renderizar no `(dashboard)/layout.tsx`**

No layout, buscar memberships + academia ativa e renderizar o switcher quando houver 2+; caso contrário, manter o nome estático atual. Substituir o `<span>` do nome (linhas ~37-39) e ajustar os imports/topo:

```tsx
import { createClient, getCurrentOrg, getMemberships, getActiveOrgId, resolveActiveOrgForUser } from '@/lib/supabase/server'
import { OrgSwitcher } from '@/components/ui/OrgSwitcher'
// ...
const res = await resolveActiveOrgForUser()
if (res.status === 'choose') redirect('/selecionar-academia')

const org = await getCurrentOrg()
const memberships = await getMemberships()
const activeOrgId = await getActiveOrgId()
```

E no header, trocar o `<span>` estático por:

```tsx
{memberships.length > 1 && activeOrgId ? (
  <OrgSwitcher
    items={memberships.map((m) => ({ organization_id: m.organization_id, org_name: m.org_name }))}
    activeOrgId={activeOrgId}
  />
) : (
  <span className="text-sm font-semibold text-white truncate max-w-[60%]">{org?.name ?? ''}</span>
)}
```

> Mantém o comportamento de hoje para quem tem 1 vínculo (a grande maioria). O switcher só surge para multi-vínculo.

- [ ] **Step 3: Verificar build**

Run: `npm run build`
Expected: compila.

- [ ] **Step 4: Commit**

```bash
git add components/ui/OrgSwitcher.tsx "app/(dashboard)/layout.tsx"
git commit -m "feat: OrgSwitcher no topo do app (multi-vínculo plano 3)"
```

---

## Task 3: Action `joinAcademy(inviteCode)`

**Files:**
- Modify: `features/organizations/actions.ts`

Cria uma membership (role `student`) para o **usuário logado** numa academia resolvida por código de convite. Idempotente: se já participa, apenas ativa a academia.

- [ ] **Step 1: Adicionar a action**

Adicionar ao final de `features/organizations/actions.ts` (e garantir o import de `createClient`):

```ts
// Entrada self-service numa 2ª (ou N-ésima) academia por código de convite, com o
// usuário JÁ logado. Cria a membership student e ativa a academia. Idempotente.
export async function joinAcademy(inviteCode: string): Promise<{ error?: string; orgId?: string }> {
  const code = inviteCode.trim().toUpperCase()
  if (!code) return { error: 'Informe o código de convite.' }

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const admin = createAdminClient()
  const { data: org } = await admin
    .from('organizations')
    .select('id, status')
    .eq('invite_code', code)
    .maybeSingle()
  if (!org || org.status !== 'active') return { error: 'Código de convite inválido.' }

  // Cria a membership se ainda não existir (não rebaixa quem já é admin).
  const { error: insErr } = await admin
    .from('memberships')
    .insert({ user_id: user.id, organization_id: org.id, role: 'student' })
  // 23505 = já participa: tudo bem, segue para ativar.
  if (insErr && insErr.code !== '23505') {
    return { error: 'Não foi possível entrar na academia.' }
  }

  revalidatePath('/home')
  return { orgId: org.id }
}
```

> `createClient` precisa estar importado no topo do arquivo (hoje só `createAdminClient`/`getStaffContext` estão). Adicione `createClient` ao import existente de `@/lib/supabase/server`.

- [ ] **Step 2: Verificar build**

Run: `npm run build`
Expected: compila.

- [ ] **Step 3: Commit**

```bash
git add features/organizations/actions.ts
git commit -m "feat: action joinAcademy por código de convite (multi-vínculo plano 3)"
```

---

## Task 4: Fluxo de convite para usuário já logado

**Files:**
- Modify: `app/(auth)/cadastro/page.tsx`

Hoje `/cadastro?convite=XYZ` sempre tenta `signUp`. Para multi-vínculo, se o usuário **já está logado**, o link de convite deve **entrar** na academia (via `joinAcademy`) em vez de criar conta.

- [ ] **Step 1: Detectar sessão e oferecer entrada**

Em `CadastroInner`, após resolver `orgName` (quando válido), checar se há sessão ativa; se houver, renderizar um card de confirmação que chama `joinAcademy` e ativa a academia. Adições:

```tsx
import { resolveInviteCode, joinAcademy } from '@/features/organizations/actions'
import { setActiveOrg } from '@/features/organizations/setActiveOrg'
// ...
const [loggedIn, setLoggedIn] = useState<boolean | null>(null)
const [joining, setJoining] = useState(false)

useEffect(() => {
  const supabase = createClient()
  supabase.auth.getUser().then(({ data }) => setLoggedIn(!!data.user))
}, [])

async function handleJoin() {
  setJoining(true)
  setError('')
  const res = await joinAcademy(inviteCode)
  if (res.error || !res.orgId) {
    setError(res.error ?? 'Erro ao entrar na academia.')
    setJoining(false)
    return
  }
  await setActiveOrg(res.orgId)
  router.push('/home')
  router.refresh()
}
```

Renderizar, **antes** do formulário de cadastro e depois do bloqueio de convite inválido (quando `orgName` é válido e `loggedIn === true`):

```tsx
if (orgName && loggedIn) {
  return (
    <Card>
      <div className="h-1.5 -mx-4 -mt-4 mb-6 rounded-t-xl bg-gradient-to-r from-brand-500 to-brand-700" />
      <h2 className="text-lg font-semibold text-white mb-1">Entrar em {orgName}</h2>
      <p className="text-slate-400 text-sm mb-6">
        Você já tem uma conta. Deseja entrar também na <span className="text-brand-400">{orgName}</span>?
      </p>
      {error && <p className="text-sm text-red-400 mb-3">{error}</p>}
      <Button onClick={handleJoin} loading={joining} size="lg" className="w-full">
        Entrar nesta academia
      </Button>
    </Card>
  )
}
```

> A renderização do formulário de signup só ocorre quando `loggedIn === false`. Enquanto `loggedIn === null` (verificando sessão), manter o estado de carregamento (`resolving` já cobre; se necessário, condicionar o form a `loggedIn === false`).

- [ ] **Step 2: Verificar build**

Run: `npm run build`
Expected: compila.

- [ ] **Step 3: Commit**

```bash
git add "app/(auth)/cadastro/page.tsx"
git commit -m "feat: convite entra em 2ª academia quando já logado (multi-vínculo plano 3)"
```

---

## Task 5: Migration — cutover de `profiles` para identidade (funções, triggers, RLS)

**Files:**
- Create: `supabase/migrations/20260623000000_profiles_identity_cutover.sql`
- Reference: `supabase/migrations/20260621000300_handle_new_user_membership.sql`, `20260622000000_credit_rpcs_memberships.sql`, `20260616000600_org_autofill_triggers.sql`, `20260621000200_rls_memberships_scoped.sql`

Esta migration **prepara** o banco para perder as colunas: nenhuma função/trigger/policy pode mais referenciar os campos por-academia de `profiles` depois dela. Não dropa colunas ainda (isso é a Task 7).

- [ ] **Step 1: Escrever a migration**

```sql
-- Multi-vínculo (Plano 3) — parte 1/2: cutover de profiles para identidade.
-- Remove toda referência a colunas por-academia de profiles em funções/triggers/RLS,
-- para que a Task 7 possa dropá-las. NÃO dropa colunas aqui.

-- 1. handle_new_user: grava apenas identidade em profiles + cria a membership inicial.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_partner    text := new.raw_user_meta_data->>'pending_partner';
  v_partner_id text := new.raw_user_meta_data->>'partner_id';
  v_invite     text := new.raw_user_meta_data->>'org_invite_code';
  v_org        uuid;
  v_pp         checkin_partner := case when v_partner in ('wellhub','totalpass') then v_partner::checkin_partner else null end;
  v_wellhub    text := case when v_partner = 'wellhub' then nullif(v_partner_id, '') else null end;
  v_totalpass  text := case when v_partner = 'totalpass' then nullif(v_partner_id, '') else null end;
begin
  select id into v_org
    from organizations
    where invite_code = v_invite and status = 'active';

  if v_org is null then
    select id into v_org from organizations where is_default limit 1;
  end if;

  -- profiles agora é só identidade.
  insert into public.profiles (id, full_name, avatar_url, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    new.raw_user_meta_data->>'avatar_url',
    new.raw_user_meta_data->>'phone'
  );

  -- Campos por-academia (inclusive parceiro de check-in) vão para a membership.
  if v_org is not null then
    insert into public.memberships (
      user_id, organization_id, role, pending_partner, wellhub_id, totalpass_id
    )
    values (new.id, v_org, 'student', v_pp, v_wellhub, v_totalpass)
    on conflict (user_id, organization_id) do nothing;
  end if;

  return new;
end;
$$;

-- 2. adjust_credits: remove o update de fonte dupla em profiles.
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

  insert into credit_transactions (student_id, organization_id, type, amount, reason, session_id, expires_at)
  values (p_student_id, p_org, p_type::credit_transaction_type, p_delta, p_reason, p_session_id, p_expires_at);
end;
$$;

revoke all on function public.adjust_credits(uuid, uuid, int, text, text, uuid, timestamptz) from public, anon, authenticated;

-- 3. Remove os triggers de autofill que derivavam organization_id de PROFILES.
--    O app passou a informar organization_id explicitamente nesses inserts (Plano 2,
--    Task 8). Os triggers que derivam de pais que AINDA têm organization_id
--    (class_sessions<-classes, dayuse_bookings<-dayuse_slots, tournament_matches<-
--    tournaments, tournament_registrations<-tournaments, trial_bookings<-class_sessions)
--    permanecem.
do $$
declare
  t text;
  profiles_derived text[] := array[
    'enrollments', 'session_bookings', 'attendance', 'credit_transactions',
    'student_subscriptions', 'payments', 'tournaments', 'posts', 'post_likes',
    'post_comments', 'notifications', 'checkins', 'waitlists', 'dayuse_slots',
    'medical_profiles'
  ];
begin
  foreach t in array profiles_derived loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists trg_set_org on public.%I;', t);
    end if;
  end loop;
end $$;

-- 4. RLS de profiles: admin enxerga/edita um perfil se houver membership ligando esse
--    perfil a uma academia que o admin administra (substitui is_org_admin(profiles.organization_id)).
drop policy if exists "profiles_select_admin_org" on profiles;
drop policy if exists "profiles_update_admin_org" on profiles;
drop policy if exists "profiles_insert_admin_org" on profiles;

create policy "profiles_select_admin_org" on profiles for select using (
  exists (
    select 1 from memberships m
    where m.user_id = profiles.id and is_org_admin(m.organization_id)
  )
);
create policy "profiles_update_admin_org" on profiles for update using (
  exists (
    select 1 from memberships m
    where m.user_id = profiles.id and is_org_admin(m.organization_id)
  )
);
-- profiles é criado pelo trigger (service role); não há insert via authenticated.

-- Policies de SELECT/UPDATE do próprio perfil (id = auth.uid()) permanecem como estão.
```

> **Atenção (revisão manual antes de aplicar):** confirme que não restam OUTRAS funções/policies do banco referenciando os campos por-academia de `profiles`. Em especial revise `book_session_atomic` e quaisquer RPCs de reconciliação/cron em migrations anteriores — se alguma seleciona `profiles.credits_balance`/`profiles.role`/etc., reescreva-a para usar `memberships` nesta mesma migration. Caso de uso: `grep -rni "profiles" supabase/migrations` e inspecionar cada `select ... from profiles` que pegue colunas por-academia.

- [ ] **Step 2: Conferência cruzada (revisão manual)**

Compare `handle_new_user` e `adjust_credits` com as versões dos Planos 1/2 — a única diferença deve ser a remoção das escritas em colunas por-academia de `profiles`. Confirme que os triggers removidos batem exatamente com a lista "deriva de profiles" do arquivo `20260616000600_org_autofill_triggers.sql`.
Expected: nenhuma referência remanescente a colunas por-academia de `profiles` em funções/triggers/policies.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260623000000_profiles_identity_cutover.sql
git commit -m "feat(db): cutover profiles->identidade (funções/triggers/RLS) — multi-vínculo plano 3"
```

---

## Task 6: Remover as escritas de fonte dupla em `profiles` no app

**Files (auditar e editar):**
- `app/api/webhooks/mercadopago/route.ts` (update espelhado de `credits_balance`)
- `features/organizations/actions.ts` (`createAcademy`/`createProfessor`: `update profiles set role='admin'`)
- Páginas/admin de edição de aluno (updates espelhados de `level`, `payment_type`, `contract_active`, `credits_balance`, `monthly_checkin_target`, `is_dependent`, `parent_id`, `wellhub_id`, `totalpass_id`) — todos marcados com `// fonte dupla` no Plano 2.

Esta tarefa remove **toda** escrita em colunas por-academia de `profiles`, deixando-as órfãs para o drop. Deve ser implantada **antes** de aplicar a Task 7.

- [ ] **Step 1: Localizar todas as escritas de fonte dupla**

Run: `grep -rn "fonte dupla" features app --include=*.ts --include=*.tsx`
Run: `grep -rn "from('profiles')" features app --include=*.ts --include=*.tsx`
Expected: a primeira lista exatamente os updates espelhados a remover; a segunda ajuda a achar updates não comentados. Identidade (`full_name`, `avatar_url`, `phone`, `city`) **continua** em `profiles` — não remover esses.

- [ ] **Step 2: Remover cada update espelhado**

Para cada `update profiles set <campo por-academia>` (incluindo `role`), apagar a chamada, deixando apenas a escrita equivalente em `memberships` (já adicionada no Plano 2). Em `createAcademy`/`createProfessor`, remover `await admin.from('profiles').update({ role: 'admin' })...` — a promoção da membership a admin (Plano 2, Task 6) é suficiente.

> **Mantém** os updates de `profiles` que tocam SÓ identidade (ex.: usuário edita nome/telefone/foto no perfil). O critério: removível ⇔ o campo deixará de existir em `profiles` após a Task 7.

- [ ] **Step 3: Verificar**

Run: `npm run build` e `npm run test:run`
Run (regressão): `grep -rn "fonte dupla" features app --include=*.ts --include=*.tsx`
Expected: build/tests verdes; o grep de "fonte dupla" não retorna mais nada.

- [ ] **Step 4: Commit**

```bash
git add features app
git commit -m "refactor: remover escritas de fonte dupla em profiles (multi-vínculo plano 3)"
```

---

## Task 7: Migration — drop de `auth_org_id()` e das colunas por-academia de `profiles`

**Files:**
- Create: `supabase/migrations/20260623000100_drop_profiles_per_org_columns.sql`

**Pré-condição:** Tasks 5 e 6 aplicadas/implantadas e o app estável (sem erros). Esta migration é **irreversível** sem restore.

- [ ] **Step 1: Escrever a migration**

```sql
-- Multi-vínculo (Plano 3) — parte 2/2: drop final das colunas por-academia de profiles.
-- Pré-requisito: 20260623000000 aplicado e o app já não escreve nessas colunas.
-- auth_org_id() (single-org, lia profiles.organization_id) não tem mais consumidores
-- desde o Plano 1 (RLS usa auth_org_ids()); removida aqui junto das colunas.

drop function if exists auth_org_id();

alter table profiles
  drop column if exists organization_id,
  drop column if exists role,
  drop column if exists level,
  drop column if exists payment_type,
  drop column if exists is_dependent,
  drop column if exists parent_id,
  drop column if exists contract_active,
  drop column if exists credits_balance,
  drop column if exists monthly_checkin_target,
  drop column if exists pending_partner,
  drop column if exists wellhub_id,
  drop column if exists totalpass_id;
```

> **Atenção:** se `auth_org_id()` ainda for referenciada por alguma policy/função (não deveria, após o Plano 1), o `drop function` falha por dependência — nesse caso, identifique e reescreva o consumidor antes. Idem para as colunas: o Postgres bloqueia o `drop column` se uma policy/trigger/view ainda a referenciar (a Task 5 deve ter limpado tudo). Rode primeiro num ambiente de staging/preview, se disponível.

- [ ] **Step 2: Revisão de dependências (manual, antes de aplicar)**

No SQL Editor, antes do drop, rodar:
```sql
-- procura dependências remanescentes em policies
select schemaname, tablename, policyname, qual, with_check
from pg_policies
where qual ilike '%auth_org_id(%' or with_check ilike '%auth_org_id(%';
```
Expected: zero linhas. Se houver, voltar à Task 5 e reescrever o consumidor.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260623000100_drop_profiles_per_org_columns.sql
git commit -m "feat(db): drop colunas por-academia de profiles + auth_org_id (multi-vínculo plano 3)"
```

---

## Task 8: `Profile` slim (só identidade) em `types/index.ts`

**Files:**
- Modify: `types/index.ts` (interface `Profile`, linhas ~49-68)

- [ ] **Step 1: Reduzir a interface `Profile`**

Substituir a interface `Profile` inteira por:

```ts
// profiles = identidade compartilhada (1 por pessoa). Tudo que é por-academia mora
// em Membership. NÃO adicione campos por-academia aqui.
export interface Profile {
  id: string
  full_name: string
  avatar_url: string | null
  phone: string | null
  city: string | null
  created_at: string
}
```

> Campos removidos (agora em `Membership`): `organization_id`, `role`, `level`, `payment_type`, `is_dependent`, `parent_id`, `contract_active`, `credits_balance`, `monthly_checkin_target`, `pending_partner`, `wellhub_id`, `totalpass_id`.

- [ ] **Step 2: Corrigir os erros de tipo resultantes**

Run: `npm run build`
Expected: o compilador aponta qualquer leitura remanescente de `profile.<campo por-academia>` que tenha escapado da auditoria do Plano 2. Para cada erro, trocar pela membership ativa (`getActiveMembership()`), conforme a transformação canônica do Plano 2. Repetir até o build passar.

- [ ] **Step 3: Verificar**

Run: `npm run build` e `npm run test:run`
Expected: ambos verdes.

- [ ] **Step 4: Commit**

```bash
git add types/index.ts features app
git commit -m "feat(types): Profile slim (só identidade) — multi-vínculo plano 3"
```

---

## Verificação (fim do Plano 3 e da sequência)

1. `npm run test:run` — verde.
2. `npm run build` — sem erros de tipo (prova que nenhum código lê campo por-academia de `profiles`).
3. **Aplicar migrations (SQL Editor), nesta ordem e só após implantar a Task 6:**
   1. `20260623000000_profiles_identity_cutover.sql`
   2. (deploy do app sem fonte dupla — Tasks 1–6)
   3. `20260623000100_drop_profiles_per_org_columns.sql`
4. **Teste de isolamento multi-vínculo (o mais importante):**
   - Como um aluno existente da Hudson, abrir o link de convite de uma **2ª academia de teste** (`/cadastro?convite=<código>`) → deve aparecer "Entrar em \<academia\>" e, ao confirmar, criar a 2ª membership e ativar a academia.
   - No topo do app, o **OrgSwitcher** agora aparece; trocar para a academia B → a home mostra créditos/nível/turmas **da B** (zerados/independentes), e **nada** da Hudson.
   - Trocar de volta para a Hudson → dados originais intactos.
   - Logar do zero com esse aluno (2 vínculos) → cai em `/selecionar-academia`.
   - Admin de cada academia continua vendo apenas os próprios alunos (a RLS de `profiles` agora via memberships).
5. **Conferência de schema (SQL Editor):** `select column_name from information_schema.columns where table_name='profiles';` retorna apenas identidade (`id, full_name, avatar_url, phone, city, created_at`).
6. **Smoke da academia #1 (Hudson):** login, grade, agendar/cancelar (crédito por academia), check-in Wellhub/TotalPass, painel admin — tudo idêntico.

---

## Self-Review (autor do plano)

- **Cobertura da spec (seções 4, 5 e 6):** tela `/selecionar-academia` ✓ (Task 1); seletor de troca ✓ (Task 2); `joinAcademy` + fluxo de convite logado ✓ (Tasks 3–4); **drop das colunas por-academia de `profiles`** ✓ (Task 7); `Profile` slim ✓ (Task 8); `handle_new_user` identidade-only + membership ✓ (Task 5).
- **Ordem de cutover:** explícita e segura — funções/triggers/RLS reescritos (Task 5) e fonte dupla removida do app (Task 6) **antes** do drop (Task 7). A migration de drop é a última ação.
- **Triggers de autofill:** só os que derivavam de `profiles` são removidos; os que derivam de pais com `organization_id` (classes, tournaments, dayuse_slots, class_sessions) permanecem. Consistente com a auditoria do Plano 2, Task 8, que já passou a informar `organization_id` explicitamente nos inserts afetados.
- **RLS de `profiles`:** corrigida para não depender de `profiles.organization_id` (passa a verificar via `memberships` + `is_org_admin`). Sem isso, o `drop column organization_id` falharia por dependência de policy.
- **Placeholders:** Tasks 1–5, 7–8 têm código/SQL literal completo. A Task 6 é uma remoção guiada por `grep "fonte dupla"` (marcador deixado de propósito no Plano 2) — determinística na prática.
- **Consistência de nomes:** `setActiveOrg`/`ACTIVE_ORG_COOKIE`, `getMemberships`/`getActiveOrgId`/`resolveActiveOrgForUser`, `joinAcademy`, `adjust_credits(p_student_id, p_org, ...)`, `is_org_admin`, `auth_org_ids` — todos batem com os Planos 1 e 2.
```