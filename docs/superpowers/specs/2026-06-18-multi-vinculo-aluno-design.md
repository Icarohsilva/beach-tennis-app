# Multi-vínculo do aluno (login único, várias academias) — Design

**Data:** 2026-06-18
**Status:** Aprovado (aguardando revisão da spec escrita)

## Contexto

Hoje o modelo é "uma pessoa = uma academia". A tabela `profiles` mistura **identidade
da pessoa** (`full_name`, `avatar_url`, `phone`, `city`) com **dados que são por-academia**
(`organization_id`, `role`, `level`, `payment_type`, `contract_active`, `credits_balance`,
`monthly_checkin_target`, `pending_partner`, `is_dependent`, `parent_id`). A segurança (RLS)
deriva a academia de um único `organization_id` fixo no perfil, via a função
`auth_org_id()` (SECURITY DEFINER), e as policies de `20260616000500_rls_org_scoped.sql`
exigem `organization_id = auth_org_id()`.

Além disso, o email em `auth.users` é **único no sistema inteiro** — então hoje a mesma
pessoa não consegue estar em duas academias nem com contas separadas usando o mesmo email.

## Objetivo

Permitir que um **aluno** (identidade única, um login só) participe de **várias academias**,
com **créditos, nível, plano de pagamento e contrato separados por academia**. Identidade
(login, nome, foto, telefone) é compartilhada. O aluno entra numa 2ª academia sozinho, pelo
link/código de convite, **já logado**. No login, se tiver 2+ academias, escolhe qual usar
numa tela de seleção.

## Decisões tomadas (brainstorming)

- **Entrada na 2ª academia:** self-service pelo convite, com o aluno já logado.
- **Compartilhado vs separado:** só identidade é compartilhada; nível, créditos, plano,
  contrato e turmas são por-academia (cada academia é independente).
- **Seleção de academia:** tela de escolha a cada login (quando há 2+ academias).
- **Escopo de papel:** só **aluno** por enquanto. Admin/professor continua vinculado a uma
  única academia. O modelo de dados já deixa abrir para staff no futuro, sem nova migração
  estrutural.
- **Descoberta importante:** as tabelas de dados do aluno (`enrollments`, `session_bookings`,
  `attendance`, `credit_transactions`, `checkins`, `waitlists`, `student_subscriptions`,
  `payments`, `day_use_bookings`) já são chaveadas por `(organization_id, student_id)` — então
  **não mudam**. Só os campos por-academia que hoje vivem em `profiles` precisam migrar para
  o vínculo.

## Escopo

### 1. Modelo de dados

Migration nova (numeração `20260620xxxxxx_*`):

- Criar tabela **`memberships`** — um registro por pessoa × academia:
  - `id uuid pk default gen_random_uuid()`
  - `user_id uuid not null references profiles(id) on delete cascade`
  - `organization_id uuid not null references organizations(id) on delete cascade`
  - `role user_role not null default 'student'`
  - `level student_level` (mesmo enum de hoje)
  - `payment_type payment_type`
  - `contract_active boolean not null default false`
  - `credits_balance integer not null default 0` (cache; verdade = `credit_transactions`)
  - `monthly_checkin_target integer not null default 0`
  - `pending_partner` (mesmo tipo/coluna de hoje, se aplicável)
  - `is_dependent boolean not null default false`
  - `parent_id uuid references profiles(id)` (responsável, dentro da mesma academia)
  - `created_at timestamptz not null default now()`
  - **Único** por `(user_id, organization_id)`.
- **`profiles`** vira identidade pura. As colunas por-academia (`organization_id`, `role`,
  `level`, `payment_type`, `contract_active`, `credits_balance`, `monthly_checkin_target`,
  `pending_partner`, `is_dependent`, `parent_id`) são **removidas do `profiles` ao final da
  migração** (depois do backfill). Ficam: `id`, `full_name`, `avatar_url`, `phone`, `city`
  e os campos de perfil médico (migration `005_medical_profiles.sql`).
- `types/index.ts`: nova interface `Membership`; `Profile` perde os campos por-academia.

### 2. Migração dos dados de produção (obrigatória, ordem importa)

1. Criar a tabela `memberships`.
2. **Backfill:** `INSERT INTO memberships (user_id, organization_id, role, level, ...)
   SELECT id, organization_id, role, level, ... FROM profiles;` — uma membership por perfil
   existente (os 27 alunos + admin da Hudson), copiando os campos por-academia.
3. Só então **remover as colunas por-academia de `profiles`**.

Idempotente (guardas `IF NOT EXISTS` / `ON CONFLICT DO NOTHING` no insert).

### 3. Segurança (RLS) — parte crítica

- Substituir `auth_org_id()` por **`auth_org_ids()`** (SECURITY DEFINER) que devolve o
  **conjunto** de `organization_id` das memberships de `auth.uid()`.
- Em `20260616000500_rls_org_scoped.sql` (recriar policies): trocar
  `organization_id = auth_org_id()` por `organization_id IN (SELECT auth_org_ids())`
  (ou `= ANY(...)`), preservando as regras de papel já existentes.
- Isolamento mantido: a pessoa só lê/escreve em academias das quais é membro. A "academia
  ativa" do app **não** é o que garante segurança — a RLS é o cinto de segurança.
- `super_admin`: não há nenhum hoje (limpeza recente). Fora de escopo; policies de
  super_admin (se existirem) permanecem como estão.

### 4. Academia ativa (app)

- A academia ativa fica num **cookie** (`active_org_id`), lido por Server Components.
- Helpers em `lib/supabase/server.ts`:
  - `getMemberships()` — lista as memberships do usuário logado (join com `organizations`
    para nome/slug).
  - `getActiveOrgId()` — lê o cookie; valida que é uma membership do usuário; se inválido/ausente:
    - 1 membership → assume ela automaticamente;
    - 2+ memberships → sinaliza "precisa escolher" (a camada de layout redireciona para a tela
      de seleção).
  - `getCurrentOrg()` / `getCurrentOrgId()` passam a derivar da academia ativa (não mais do
    `profiles.organization_id`, que deixa de existir).
  - `getStaffContext()` / `requireOwner()` passam a ler `role` da **membership da academia
    ativa** (para admin, que é single-academy, é a sua única membership). `owner` continua
    sendo `organizations.owner_id`.
- Nova rota **`app/selecionar-academia/page.tsx`** (Server Component + ação client para gravar
  o cookie e redirecionar). Pública o suficiente para usuário autenticado sem academia ativa.
- O **layout do aluno** (`app/(dashboard)/layout.tsx`): se há 2+ memberships e nenhuma ativa
  válida, redireciona para `/selecionar-academia`. Um **seletor** no topo (BottomNav/topbar)
  permite trocar a academia ativa depois.
- O **layout admin** (`app/(admin)/layout.tsx`): lê `role` da membership da academia ativa
  (admin tem uma só). Gate de onboarding inalterado, mas a leitura de role/owner passa por
  membership/owner_id.

### 5. Fluxo "entrar na 2ª academia" (logado)

- Quando um **usuário já logado** abre o link/código de convite de uma academia:
  - Em vez do cadastro (que cria novo `auth.user`), mostrar "Entrar na academia X?".
  - Ação `joinAcademy(inviteCode)` (em `features/organizations/actions.ts`): resolve a
    academia por `invite_code`; se já existe membership do usuário nela → mensagem "você já
    participa"; senão cria `membership` (role=student) e define-a como academia ativa.
- O fluxo de **convite para quem não tem conta** (cadastro novo) continua existindo; o trigger
  `handle_new_user` (`20260616000300_handle_new_user_org.sql`) passa a **criar a membership
  inicial** a partir do `invite_code`/`organization_id` do metadata, em vez de gravar
  `profiles.organization_id` (que deixa de existir).
- Triggers de autofill de `organization_id` (`20260616000600_org_autofill_triggers.sql`):
  revisar — continuam preenchendo `organization_id` nas tabelas de dados (que seguem com a
  coluna). A fonte do org deixa de ser `profiles.organization_id`; passa a ser a academia
  ativa enviada pelo app (ou validada por membership). Detalhar no plano.

### 6. Créditos por academia

- As RPCs de crédito/booking (`20260611000000_booking_and_credit_rpcs.sql`) que hoje atualizam
  `profiles.credits_balance` passam a atualizar **`memberships.credits_balance`** da
  `(user_id, organization_id)` correspondente. `credit_transactions` já tem `organization_id`,
  então o saldo é naturalmente por-academia.
- Qualquer leitura de `credits_balance` no app passa a vir da membership da academia ativa.

## Arquivos

- Criar: migration `memberships` + backfill + drop colunas de `profiles` (pode ser uma ou
  mais migrations na ordem segura).
- Criar: migration que substitui `auth_org_id()` por `auth_org_ids()` e recria as policies
  org-scoped.
- Criar: migration que atualiza `handle_new_user` e as RPCs de crédito para usar `memberships`.
- Criar: `app/selecionar-academia/page.tsx` (+ ação de gravar cookie).
- Criar: componente seletor de academia (topo do app do aluno).
- Modificar: `types/index.ts` (nova `Membership`; `Profile` enxuto).
- Modificar: `lib/supabase/server.ts` (`getMemberships`, `getActiveOrgId`, `getCurrentOrg(Id)`,
  `getStaffContext`, `requireOwner`).
- Modificar: `features/organizations/actions.ts` (`joinAcademy`; ajustar `resolveInviteCode`).
- Modificar: `app/(dashboard)/layout.tsx` e `app/(admin)/layout.tsx` (academia ativa / role
  via membership).
- Modificar: fluxo de convite (`app/(auth)/cadastro` ou equivalente) para detectar usuário
  logado e oferecer `joinAcademy`.
- Auditar: todas as queries/Server Components que leem `profiles.organization_id`,
  `profiles.role`, `profiles.level`, `profiles.credits_balance`, etc. — passam a ler de
  `memberships` da academia ativa. (Enumerar no plano.)

## Verificação

1. `npm run test:run` — testes unitários seguem verdes; novos testes dos helpers puros (se
   houver lógica pura, ex.: resolução da academia ativa).
2. `npm run build` — sem erros de tipo após `Membership`/`Profile` enxuto.
3. **Teste de isolamento (o mais importante):** criar uma 2ª academia de teste; um aluno
   entra nela pelo convite estando logado; confirmar que ele tem créditos/nível separados em
   cada academia e que **não vê** turmas/dados da outra; trocar a academia ativa e conferir os
   dados certos. Repetir conferindo que admin de uma academia não enxerga a outra.
4. Confirmar que a Hudson (org #1) e seus 27 alunos seguem funcionando idêntico após a migração
   (login → entra direto, pois têm 1 academia só; créditos/nível preservados).
5. Migrations aplicadas em produção pelo usuário (SQL Editor), na ordem da spec.

## Fora de escopo

- Multi-vínculo para admin/professor (staff segue single-academy).
- Transferir créditos/histórico entre academias.
- Unificar feed social/torneios entre academias (cada academia continua isolada).
- Tela de "academia ativa" para super_admin (não há super_admin hoje).
