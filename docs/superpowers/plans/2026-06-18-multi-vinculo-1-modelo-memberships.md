# Multi-vínculo do aluno — Plano 1/3: Modelo `memberships` + backfill + RLS

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduzir a tabela `memberships` (uma por pessoa × academia) como nova fonte da verdade dos dados por-academia, com backfill dos perfis existentes e a RLS reescrita para derivar a academia das memberships — **sem nenhuma mudança de comportamento** para os 27 alunos atuais.

**Architecture:** Migração puramente aditiva. `profiles` mantém TODAS as colunas por-academia (fonte dupla, deploy reversível) — o drop fica para o Plano 3. A RLS passa a usar `auth_org_ids()` (conjunto de orgs das memberships) e `is_org_admin(org)` no lugar de `auth_org_id()`/`is_admin()`. Como o backfill cria exatamente 1 membership por perfil, o conjunto de visibilidade é idêntico ao de hoje.

**Tech Stack:** Supabase (Postgres + RLS, SECURITY DEFINER functions), TypeScript (`types/index.ts`). Migrations aplicadas manualmente pelo usuário no SQL Editor.

**Contexto da sequência:** Este é o **Plano 1 de 3** da spec `docs/superpowers/specs/2026-06-18-multi-vinculo-aluno-design.md`.
- **Plano 1 (este):** modelo `memberships` + backfill + RLS. Nada no app muda; tudo continua lendo `profiles`.
- **Plano 2:** app passa a ler/escrever via **academia ativa** (cookie) e memberships; `profiles` ainda mantém as colunas (fonte dupla).
- **Plano 3:** tela de seleção + `joinAcademy` + **drop** das colunas por-academia de `profiles`.

**Decisões herdadas do mapeamento do código (não estavam explícitas na spec):**
- `wellhub_id` e `totalpass_id` **entram na `memberships`** (são por-academia: andam junto de `payment_type`/`monthly_checkin_target`, ver `features/checkin/actions.ts`).
- A função `is_admin()` (global, lê `profiles.role`) é substituída por `is_org_admin(org)` (lê `memberships.role`), porque no Plano 3 `profiles.role` deixa de existir. Como staff é single-academy, o resultado é idêntico hoje.
- `auth_org_id()` **permanece** neste plano (ainda é usada por triggers de autofill); só será removida no Plano 3.

---

## File Structure

- **Criar** `supabase/migrations/20260621000000_memberships.sql` — tabela `memberships`, funções `auth_org_ids()` e `is_org_admin(uuid)`, RLS da própria `memberships`.
- **Criar** `supabase/migrations/20260621000100_backfill_memberships.sql` — backfill idempotente (1 membership por perfil).
- **Criar** `supabase/migrations/20260621000200_rls_memberships_scoped.sql` — recria as policies org-scoped usando as novas funções.
- **Criar** `supabase/migrations/20260621000300_handle_new_user_membership.sql` — trigger `handle_new_user` passa a criar a membership inicial (continua gravando `profiles.organization_id` para fonte dupla).
- **Modificar** `types/index.ts` — adicionar a interface `Membership`. `Profile` **fica inalterado** neste plano.

> **Padrão das migrations deste repo:** SQL em minúsculas, comentários em pt-BR, idempotência via `if not exists` / `create or replace` / `on conflict do nothing`. Funções de RLS são `security definer` com `set search_path = public`.

---

## Task 1: Migration — tabela `memberships` + funções de RLS

**Files:**
- Create: `supabase/migrations/20260621000000_memberships.sql`

- [ ] **Step 1: Escrever a migration completa**

Conteúdo exato do arquivo:

```sql
-- Multi-vínculo (Plano 1) — parte 1/4
-- Cria memberships (uma linha por pessoa × academia) com TODOS os campos por-academia
-- que hoje vivem em profiles. Cria auth_org_ids() (conjunto de orgs do usuário) e
-- is_org_admin(org) (papel admin naquela org), que substituem auth_org_id()/is_admin()
-- na RLS. Migração aditiva: profiles continua intacto (fonte dupla até o Plano 3).

-- 1. Tabela de vínculos.
create table if not exists memberships (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references profiles(id) on delete cascade,
  organization_id        uuid not null references organizations(id) on delete cascade,
  role                   user_role not null default 'student',
  level                  student_level not null default 'iniciante',
  payment_type           payment_type not null default 'per_class',
  is_dependent           boolean not null default false,
  parent_id              uuid references profiles(id) on delete set null,
  contract_active        boolean not null default true,
  credits_balance        int not null default 0,
  monthly_checkin_target int not null default 0,
  pending_partner        checkin_partner,
  wellhub_id             text,
  totalpass_id           text,
  created_at             timestamptz not null default now(),
  unique (user_id, organization_id)
);

-- Índices para os caminhos quentes da RLS e das leituras por academia.
create index if not exists memberships_user_idx on memberships (user_id);
create index if not exists memberships_org_idx on memberships (organization_id);

-- 2. Conjunto de orgs do usuário autenticado. SECURITY DEFINER + search_path fixo:
-- lê memberships sem disparar recursão de RLS (mesmo motivo de auth_org_id()).
create or replace function auth_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id from memberships where user_id = auth.uid();
$$;

-- 3. O usuário é admin NAQUELA academia? Substitui is_admin() (que era global).
create or replace function is_org_admin(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from memberships
    where user_id = auth.uid() and organization_id = p_org and role = 'admin'
  );
$$;

-- 4. RLS da própria memberships.
alter table memberships enable row level security;

drop policy if exists "memberships_select_own" on memberships;
drop policy if exists "memberships_select_admin_org" on memberships;

-- Cada um lê os próprios vínculos (necessário para a tela de seleção do Plano 2/3).
create policy "memberships_select_own" on memberships
  for select using (user_id = auth.uid());

-- Admin lê os vínculos da própria academia (gestão de alunos).
create policy "memberships_select_admin_org" on memberships
  for select using (is_org_admin(organization_id));

-- Escrita de memberships é via service role (createAdminClient) / triggers; nenhuma
-- policy de insert/update/delete é exposta ao papel authenticated.
```

- [ ] **Step 2: Verificar idempotência (revisão manual)**

Releia o arquivo: todo `create` tem `if not exists` ou `or replace`; todo `policy` tem `drop policy if exists` antes. Rodar a migration duas vezes seguidas não deve dar erro.
Expected: nenhum statement sem guarda de idempotência.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260621000000_memberships.sql
git commit -m "feat(db): tabela memberships + auth_org_ids/is_org_admin (multi-vínculo plano 1)"
```

---

## Task 2: Migration — backfill (1 membership por perfil)

**Files:**
- Create: `supabase/migrations/20260621000100_backfill_memberships.sql`

- [ ] **Step 1: Escrever a migration de backfill**

Conteúdo exato do arquivo:

```sql
-- Multi-vínculo (Plano 1) — parte 2/4
-- Backfill: uma membership por perfil existente, copiando os campos por-academia.
-- Idempotente: on conflict (user_id, organization_id) do nothing. Perfis sem
-- organization_id (não deveria haver após o Plano de fundação) são ignorados.

insert into memberships (
  user_id, organization_id, role, level, payment_type, is_dependent, parent_id,
  contract_active, credits_balance, monthly_checkin_target, pending_partner,
  wellhub_id, totalpass_id, created_at
)
select
  p.id, p.organization_id, p.role, p.level, p.payment_type, p.is_dependent, p.parent_id,
  p.contract_active, p.credits_balance, p.monthly_checkin_target, p.pending_partner,
  p.wellhub_id, p.totalpass_id, p.created_at
from profiles p
where p.organization_id is not null
on conflict (user_id, organization_id) do nothing;
```

- [ ] **Step 2: Conferir nomes de coluna contra `profiles` (revisão manual)**

Confirme que cada coluna do `select` existe em `profiles` (ver `001_initial_schema.sql` linhas 26-42 + `monthly_checkin_target`/`pending_partner` das migrations de check-in). Em especial: `monthly_checkin_target`, `pending_partner`, `wellhub_id`, `totalpass_id`.
Expected: todas as 13 colunas batem com `profiles`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260621000100_backfill_memberships.sql
git commit -m "feat(db): backfill memberships a partir de profiles (multi-vínculo plano 1)"
```

---

## Task 3: Migration — RLS org-scoped via memberships

**Files:**
- Create: `supabase/migrations/20260621000200_rls_memberships_scoped.sql`
- Reference: `supabase/migrations/20260616000500_rls_org_scoped.sql` (conjunto de policies a espelhar, trocando os predicados)

**Transformação canônica (aplicada a TODAS as policies do arquivo de referência):**
- `is_admin() and organization_id = auth_org_id()` → `is_org_admin(organization_id)`
- `organization_id = auth_org_id()` (leitura de aluno) → `organization_id in (select auth_org_ids())`
- Predicados por dono de linha (`student_id = auth.uid()`, `author_id = auth.uid()`, etc.) **não mudam**.

- [ ] **Step 1: Escrever a migration recriando as policies**

Conteúdo exato do arquivo:

```sql
-- Multi-vínculo (Plano 1) — parte 3/4
-- Reescreve a RLS org-scoped para derivar a academia das MEMBERSHIPS, não mais de
-- profiles.organization_id. Espelha 20260616000500_rls_org_scoped.sql trocando:
--   is_admin() and organization_id = auth_org_id()  ->  is_org_admin(organization_id)
--   organization_id = auth_org_id()                 ->  organization_id in (select auth_org_ids())
-- Como o backfill cria 1 membership por perfil, a visibilidade é idêntica à de hoje.

-- 1. Limpa as policies existentes nas tabelas tenant (independente do nome).
do $$
declare
  r record;
  tables text[] := array[
    'profiles', 'classes', 'class_sessions', 'enrollments', 'session_bookings',
    'attendance', 'credit_transactions', 'trial_bookings', 'subscription_plans',
    'student_subscriptions', 'payments', 'system_settings', 'tournaments',
    'tournament_matches', 'tournament_registrations', 'posts', 'post_likes',
    'post_comments', 'notifications', 'dayuse_slots', 'dayuse_bookings',
    'medical_profiles', 'checkins', 'waitlists'
  ];
begin
  for r in
    select policyname, tablename
    from pg_policies
    where schemaname = 'public' and tablename = any(tables)
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- 2. Recria as policies org-scoped via memberships.

-- profiles: o aluno lê o próprio; admin lê perfis das suas academias.
create policy "profiles_select_own" on profiles for select using (id = auth.uid());
create policy "profiles_select_admin_org" on profiles for select using (is_org_admin(organization_id));
create policy "profiles_update_own" on profiles for update using (id = auth.uid());
create policy "profiles_update_admin_org" on profiles for update using (is_org_admin(organization_id));
create policy "profiles_insert_admin_org" on profiles for insert with check (is_org_admin(organization_id));

-- classes
create policy "classes_select_org" on classes for select using (organization_id in (select auth_org_ids()) and is_active = true);
create policy "classes_admin_org" on classes for all using (is_org_admin(organization_id));

-- class_sessions
create policy "class_sessions_select_org" on class_sessions for select using (organization_id in (select auth_org_ids()));
create policy "class_sessions_admin_org" on class_sessions for all using (is_org_admin(organization_id));

-- enrollments
create policy "enrollments_select_own" on enrollments for select using (student_id = auth.uid());
create policy "enrollments_admin_org" on enrollments for all using (is_org_admin(organization_id));

-- session_bookings
create policy "session_bookings_select_own" on session_bookings for select using (student_id = auth.uid());
create policy "session_bookings_insert_own" on session_bookings for insert with check (student_id = auth.uid() and organization_id in (select auth_org_ids()));
create policy "session_bookings_update_own" on session_bookings for update using (student_id = auth.uid());
create policy "session_bookings_admin_org" on session_bookings for all using (is_org_admin(organization_id));

-- attendance
create policy "attendance_select_own" on attendance for select using (student_id = auth.uid());
create policy "attendance_admin_org" on attendance for all using (is_org_admin(organization_id));

-- credit_transactions
create policy "credit_tx_select_own" on credit_transactions for select using (student_id = auth.uid());
create policy "credit_tx_select_admin_org" on credit_transactions for select using (is_org_admin(organization_id));
create policy "credit_tx_insert_admin_org" on credit_transactions for insert with check (is_org_admin(organization_id));

-- subscription_plans
create policy "plans_select_org" on subscription_plans for select using (organization_id in (select auth_org_ids()) and is_active = true);
create policy "plans_admin_org" on subscription_plans for all using (is_org_admin(organization_id));

-- student_subscriptions
create policy "subs_select_own" on student_subscriptions for select using (student_id = auth.uid() or payer_id = auth.uid());
create policy "subs_admin_org" on student_subscriptions for all using (is_org_admin(organization_id));

-- payments
create policy "payments_select_own" on payments for select using (student_id = auth.uid());
create policy "payments_select_admin_org" on payments for select using (is_org_admin(organization_id));

-- system_settings (por academia)
create policy "settings_admin_org" on system_settings for all using (is_org_admin(organization_id));

-- tournaments
create policy "tournaments_select_org" on tournaments for select using (organization_id in (select auth_org_ids()));
create policy "tournaments_admin_org" on tournaments for all using (is_org_admin(organization_id));

-- tournament_matches
create policy "matches_select_org" on tournament_matches for select using (organization_id in (select auth_org_ids()));
create policy "matches_admin_org" on tournament_matches for all using (is_org_admin(organization_id));

-- tournament_registrations: só aplica se a tabela existir neste ambiente.
do $$
begin
  if to_regclass('public.tournament_registrations') is not null then
    execute 'drop policy if exists "treg_select_org" on tournament_registrations';
    execute 'drop policy if exists "treg_insert_own" on tournament_registrations';
    execute 'drop policy if exists "treg_admin_org" on tournament_registrations';
    execute 'create policy "treg_select_org" on tournament_registrations for select using (organization_id in (select auth_org_ids()))';
    execute 'create policy "treg_insert_own" on tournament_registrations for insert with check (player_id = auth.uid() and organization_id in (select auth_org_ids()))';
    execute 'create policy "treg_admin_org" on tournament_registrations for all using (is_org_admin(organization_id))';
  end if;
end $$;

-- posts
create policy "posts_select_org" on posts for select using (organization_id in (select auth_org_ids()));
create policy "posts_insert_own" on posts for insert with check (author_id = auth.uid() and organization_id in (select auth_org_ids()));
create policy "posts_update_own" on posts for update using (author_id = auth.uid());
create policy "posts_delete_own" on posts for delete using (author_id = auth.uid());
create policy "posts_admin_org" on posts for all using (is_org_admin(organization_id));

-- post_likes
create policy "likes_select_org" on post_likes for select using (organization_id in (select auth_org_ids()));
create policy "likes_insert_own" on post_likes for insert with check (user_id = auth.uid() and organization_id in (select auth_org_ids()));
create policy "likes_delete_own" on post_likes for delete using (user_id = auth.uid());

-- post_comments
create policy "comments_select_org" on post_comments for select using (organization_id in (select auth_org_ids()));
create policy "comments_insert_own" on post_comments for insert with check (author_id = auth.uid() and organization_id in (select auth_org_ids()));
create policy "comments_delete_own" on post_comments for delete using (author_id = auth.uid());

-- notifications
create policy "notif_select_own" on notifications for select using (user_id = auth.uid());
create policy "notif_update_own" on notifications for update using (user_id = auth.uid());
create policy "notif_insert_admin_org" on notifications for insert with check (is_org_admin(organization_id));

-- trial_bookings (insert é via service role na API pública)
create policy "trials_admin_org" on trial_bookings for select using (is_org_admin(organization_id));

-- dayuse_slots
create policy "dayuse_slots_select_org" on dayuse_slots for select using (organization_id in (select auth_org_ids()) and is_active = true);
create policy "dayuse_slots_admin_org" on dayuse_slots for all using (is_org_admin(organization_id));

-- dayuse_bookings
create policy "dayuse_bookings_select" on dayuse_bookings for select using (student_id = auth.uid() or is_org_admin(organization_id));
create policy "dayuse_bookings_insert_own" on dayuse_bookings for insert with check (student_id = auth.uid() and organization_id in (select auth_org_ids()));
create policy "dayuse_bookings_update_own" on dayuse_bookings for update using (student_id = auth.uid());
create policy "dayuse_bookings_admin_org" on dayuse_bookings for all using (is_org_admin(organization_id));

-- medical_profiles
create policy "medical_own_select" on medical_profiles for select using (profile_id = auth.uid());
create policy "medical_own_insert" on medical_profiles for insert with check (profile_id = auth.uid() and organization_id in (select auth_org_ids()));
create policy "medical_own_update" on medical_profiles for update using (profile_id = auth.uid());
create policy "medical_admin_org" on medical_profiles for select using (is_org_admin(organization_id));

-- checkins
create policy "checkins_select_own" on checkins for select using (student_id = auth.uid());
create policy "checkins_admin_org" on checkins for all using (is_org_admin(organization_id));

-- waitlists: só aplica se a tabela existir neste ambiente.
do $$
begin
  if to_regclass('public.waitlists') is not null then
    execute 'drop policy if exists "waitlists_select_own" on waitlists';
    execute 'drop policy if exists "waitlists_insert_own" on waitlists';
    execute 'drop policy if exists "waitlists_update_own" on waitlists';
    execute 'drop policy if exists "waitlists_admin_org" on waitlists';
    execute 'create policy "waitlists_select_own" on waitlists for select using (student_id = auth.uid())';
    execute 'create policy "waitlists_insert_own" on waitlists for insert with check (student_id = auth.uid() and organization_id in (select auth_org_ids()))';
    execute 'create policy "waitlists_update_own" on waitlists for update using (student_id = auth.uid())';
    execute 'create policy "waitlists_admin_org" on waitlists for all using (is_org_admin(organization_id))';
  end if;
end $$;

-- organizations: membro lê as academias das quais participa (substitui id = auth_org_id()).
drop policy if exists "Members view own organization" on organizations;
create policy "Members view own organization" on organizations
  for select using (id in (select auth_org_ids()));
```

- [ ] **Step 2: Conferência cruzada contra o arquivo de referência (revisão manual)**

Abra `20260616000500_rls_org_scoped.sql` lado a lado. Para cada policy, confirme que: (a) o nome foi preservado; (b) o predicado por-dono não mudou; (c) `auth_org_id()`/`is_admin()` foram trocados pela forma nova. Confirme também a policy extra de `organizations` (não estava no arquivo de referência, veio de `20260616000000_organizations.sql`).
Expected: paridade 1:1 de policies + a de `organizations`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260621000200_rls_memberships_scoped.sql
git commit -m "feat(db): RLS org-scoped via memberships (auth_org_ids/is_org_admin) — multi-vínculo plano 1"
```

---

## Task 4: Migration — `handle_new_user` cria a membership inicial

**Files:**
- Create: `supabase/migrations/20260621000300_handle_new_user_membership.sql`
- Reference: `supabase/migrations/20260616000300_handle_new_user_org.sql` (versão atual do trigger)

- [ ] **Step 1: Escrever a migration**

Mantém a inserção em `profiles` (com `organization_id` — fonte dupla) e **adiciona** a criação da membership inicial na mesma org. Conteúdo exato do arquivo:

```sql
-- Multi-vínculo (Plano 1) — parte 4/4
-- handle_new_user passa a criar TAMBÉM a membership inicial (role student) na academia
-- resolvida pelo invite_code. Continua gravando profiles.organization_id e os campos de
-- parceiro em profiles (fonte dupla — o drop dessas colunas é o Plano 3). Sem isso, um
-- cadastro novo no Plano 1 ficaria sem membership e a RLS (auth_org_ids) o bloquearia.

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

  insert into public.profiles (
    id, organization_id, full_name, avatar_url, phone,
    pending_partner, wellhub_id, totalpass_id
  )
  values (
    new.id,
    v_org,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    new.raw_user_meta_data->>'avatar_url',
    new.raw_user_meta_data->>'phone',
    v_pp, v_wellhub, v_totalpass
  );

  -- Membership inicial (aluno) na academia resolvida. Idempotente por segurança.
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
```

> **Nota para o executor:** `createAcademy` (em `features/organizations/actions.ts`) promove o perfil a `admin` e marca `owner_id` DEPOIS do signup. No Plano 1 a membership inicial é criada como `student`; o `createAcademy` precisará também promover a membership do dono a `admin`. **Isso é tratado no Plano 2** (a action ainda lê/grava `profiles.role` neste plano). Não alterar `createAcademy` aqui.

- [ ] **Step 2: Conferir contra a versão atual do trigger (revisão manual)**

Compare com `20260616000300_handle_new_user_org.sql`: a lógica de resolução de org e a inserção em `profiles` devem ser equivalentes; a única adição é o `insert into memberships`.
Expected: paridade na parte de `profiles` + bloco novo de membership.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260621000300_handle_new_user_membership.sql
git commit -m "feat(db): handle_new_user cria membership inicial (multi-vínculo plano 1)"
```

---

## Task 5: Tipo `Membership` em `types/index.ts`

**Files:**
- Modify: `types/index.ts` (logo após a interface `Profile`, por volta da linha 68)

- [ ] **Step 1: Adicionar a interface `Membership`**

Insira após o fechamento da interface `Profile` (linha 68):

```ts
// Vínculo de uma pessoa com uma academia. Fonte da verdade dos dados por-academia
// (a partir do Plano 2 substitui os campos correspondentes de Profile).
export interface Membership {
  id: string
  user_id: string
  organization_id: string
  role: UserRole
  level: StudentLevel
  payment_type: PaymentType
  is_dependent: boolean
  parent_id: string | null
  contract_active: boolean
  credits_balance: number // cache; verdade = credit_transactions
  monthly_checkin_target: number
  pending_partner: CheckinPartner | null
  wellhub_id: string | null
  totalpass_id: string | null
  created_at: string
}
```

> `Profile` permanece **inalterado** neste plano (ainda carrega os campos por-academia; o slim é no Plano 3).

- [ ] **Step 2: Verificar build de tipos**

Run: `npm run build`
Expected: build conclui sem erros de tipo (a nova interface é aditiva e ainda não tem consumidores).

- [ ] **Step 3: Commit**

```bash
git add types/index.ts
git commit -m "feat(types): interface Membership (multi-vínculo plano 1)"
```

---

## Verificação (fim do Plano 1)

1. `npm run test:run` — testes unitários existentes seguem verdes (nada de lógica de app mudou).
2. `npm run build` — sem erros de tipo.
3. **Aplicação das migrations (usuário, SQL Editor, nesta ordem):**
   1. `20260621000000_memberships.sql`
   2. `20260621000100_backfill_memberships.sql`
   3. `20260621000200_rls_memberships_scoped.sql`
   4. `20260621000300_handle_new_user_membership.sql`
4. **Conferência pós-backfill (SQL Editor):**
   - `select count(*) from memberships;` deve igualar `select count(*) from profiles where organization_id is not null;` (esperado: 28 — 27 alunos + 1 admin).
   - `select count(*) from profiles p where not exists (select 1 from memberships m where m.user_id = p.id and m.organization_id = p.organization_id);` deve ser `0`.
5. **Teste de fumaça (app inalterado):** login como aluno da Hudson e como o admin; grade, agendamento, créditos e o painel admin funcionam **idênticos** ao de antes (a RLS agora deriva de memberships, mas o conjunto é o mesmo).

> **Não** seguir para o Plano 2 antes de confirmar o item 4 em produção.

---

## Self-Review (autor do plano)

- **Cobertura da spec (seção 1 e 3):** tabela `memberships` com todos os campos por-academia ✓ (Task 1); unicidade `(user_id, organization_id)` ✓; backfill 1:1 ✓ (Task 2); `auth_org_id()` → `auth_org_ids()` ✓ e policies `IN (SELECT auth_org_ids())` ✓ (Tasks 1, 3); `handle_new_user` cria membership ✓ (Task 4). **Drop das colunas de profiles** é explicitamente diferido ao Plano 3 (decisão de faseamento aprovada).
- **Placeholders:** nenhum — todo SQL e TS está completo e literal.
- **Consistência de tipos/nomes:** `auth_org_ids()`, `is_org_admin(uuid)`, `memberships`, colunas e enums (`user_role`, `student_level`, `payment_type`, `checkin_partner`) batem entre as 4 migrations e a interface `Membership`.
- **Decisão registrada:** `wellhub_id`/`totalpass_id` em memberships (não estavam na spec; justificado pelo acoplamento com `payment_type`). `is_admin()`→`is_org_admin(org)`.
