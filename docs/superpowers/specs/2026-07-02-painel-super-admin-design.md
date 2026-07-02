# Painel Super-Admin — Design

**Data:** 2026-07-02
**Meta-projeto:** Fundação multi-tenant / SaaS (item 4 da sequência — fecha o ciclo cadastro → cobrança → gestão da plataforma).

## Contexto

O app é multi-tenant: cada academia é uma `organization`, isolada por `organization_id` + RLS.
O papel de plataforma `super_admin` foi **declarado** no enum `user_role` lá na Fundação
(Plano 1), mas **nunca foi usado** — não existe nenhum super-admin hoje, nem tela, nem
checagem. Este projeto constrói o painel que faltava: o dono da plataforma ver e gerenciar
todas as academias e suas assinaturas.

Decisões já tomadas com o usuário (via brainstorming):
- **Quem vira super-admin:** flag `profiles.is_platform_admin` (identidade global), setada
  manualmente por SQL. Super-admin é papel de **plataforma**, não de uma academia — por isso
  mora em `profiles` (1 por pessoa), não em `memberships` (por-academia). Não mexe no enum
  `user_role` nem na RLS existente.
- **Suspensão com dente:** suspender uma academia passa a **bloquear o acesso** de todos os
  usuários dela (painel admin E área do aluno), não só escondê-la do diretório público.
- **Escopo v1:** lista de academias + detalhe + suspender/reativar. **Fora:** métricas
  agregadas (MRR, contagem global) e criar/editar academia manualmente pelo painel.
- **Localização:** route group próprio `app/(super-admin)/super-admin/*`, independente de
  academia ativa/membership.

## Arquitetura

### 1. Modelo de dados

Migration nova (`supabase/migrations/20260702xxxxxx_platform_admin.sql`):

```sql
alter table profiles
  add column if not exists is_platform_admin boolean not null default false;
```

- Sem policy de RLS nova. A checagem do papel é sempre via `createAdminClient()` (service
  role, bypassa RLS) — mesmo padrão do `app/(admin)/layout.tsx`, que já usa admin client
  para ler `memberships.role`.
- Concessão manual (uma vez, no SQL Editor):
  ```sql
  update profiles set is_platform_admin = true
  where id = (select id from auth.users where email = 'icaro.silva@eteg.com.br');
  ```
- `types/index.ts`: adicionar `is_platform_admin: boolean` à interface `Profile`.

### 2. Bloqueio de academia suspensa

`organizations.status` (`active` | `suspended`) já existe. Hoje só é lido em dois pontos
públicos (`app/arenas/[slug]/page.tsx` e a resolução de código de convite em
`features/organizations/actions.ts`). Este projeto adiciona o bloqueio nas áreas
autenticadas:

- `app/(dashboard)/layout.tsx` já busca a org via `getCurrentOrg()` — basta ler `org.status`
  (custo zero de query extra).
- `app/(admin)/layout.tsx` já busca a org com um `select` específico — basta adicionar
  `status` a esse select existente.
- Se `status === 'suspended'`, os dois layouts renderizam uma tela terminal
  **"Academia suspensa"** (mensagem + contato de suporte + botão Sair) no lugar do conteúdo —
  sem redirect (evita loop), sem navegação.
- Componente reutilizável `components/ui/SuspendedNotice.tsx` para essa tela, usado nos dois
  layouts (DRY).
- O super-admin **não** é afetado (ele não tem academia ativa; acessa o `(super-admin)`
  layout, que não checa status de org).

### 3. Rotas e páginas

Novo route group `app/(super-admin)/`:

**`app/(super-admin)/layout.tsx`** — gate de acesso:
1. `createClient().auth.getUser()` → sem usuário: `redirect('/login')`.
2. `createAdminClient()` lê `profiles.is_platform_admin` de `user.id`.
3. Se `!== true`: `redirect('/home')` (silencioso — não revela que a rota existe).
4. Não chama `getActiveOrgId()`/`getStaffContext()` — super-admin não é membro de academia.
5. Layout visual simples (header "Plataforma" + LogoutButton), sem sidebar de academia.

**`app/(super-admin)/super-admin/page.tsx`** — lista de academias:
- Tabela: nome, cidade/UF, dono (nome — o e-mail fica em `auth.users` e só é buscado no
  detalhe, para evitar N+1 na lista), status da academia, status da assinatura SaaS, data de
  criação. Linha clicável → detalhe.
- Busca simples por nome (client-side; sem paginação — volume baixo hoje).
- Badge de status: `active`/`suspended` (academia) e `trialing`/`active`/`past_due`/`canceled`
  (assinatura).

**`app/(super-admin)/super-admin/[id]/page.tsx`** — detalhe da academia:
- Dados: nome, slug, cidade/UF, dono (nome + e-mail), descrição, data de criação, status.
- Card de assinatura: status, `trial_ends_at`, `current_period_end`.
- Contadores (via `count: 'exact', head: true`, scoped por `organization_id`): nº de alunos
  (memberships role='student'), nº de professores/admins (role='admin'), nº de torneios.
- Botão **Suspender** (se active) / **Reativar** (se suspended), com confirmação.

Middleware: **sem alteração**. `/super-admin` não está na allowlist pública do
`middleware.ts`, então já cai na regra "exige cookie de sessão"; a checagem real de papel é
no layout (padrão do projeto).

### 4. Camada de dados (Server Actions)

Novo `features/super-admin/actions.ts` — todas re-checam `is_platform_admin` internamente
(defesa em profundidade; não confiam só no gate do layout) e usam `createAdminClient()`.
Retornam o padrão `{ error?: string }` (ou dados) já usado no resto do código.

- `requirePlatformAdmin()` — helper interno: lê o usuário logado + `is_platform_admin`;
  retorna o `userId` ou lança/retorna erro. Reutilizado por todas as actions e pelo layout.
- `listOrganizations()` — organizations + owner (profiles: full_name, e-mail via auth) +
  platform_subscriptions (status/trial/período), ordenado por `created_at desc`.
- `getOrganizationDetail(orgId)` — dados da org + assinatura + os três contadores.
- `suspendOrganization(orgId)` — `update organizations set status = 'suspended'`.
- `reactivateOrganization(orgId)` — `update organizations set status = 'active'`.

As duas últimas fazem `revalidatePath('/super-admin')` e `revalidatePath('/super-admin/[id]')`.

### 5. Tipos e testes

- `types/index.ts`: `Profile.is_platform_admin: boolean`.
- Não há função pura complexa o suficiente para TDD isolado (a lógica é CRUD + gate de auth).
  A verificação é por `npm run build` (tipos) + `npm run test:run` (sem regressões) + roteiro
  manual de isolamento.

## Fluxo (ponta a ponta)

1. Você roda o `update ... is_platform_admin = true` no SQL Editor (uma vez).
2. Loga normalmente pelo `/login` (mesma conta) e acessa `/super-admin`.
3. Vê a lista de academias; clica numa → detalhe com assinatura e contadores.
4. Clica **Suspender** → confirma → `organizations.status = 'suspended'`.
5. No próximo request, admin e alunos daquela academia veem a tela "Academia suspensa"
   (bloqueados); as demais academias seguem normais. **Reativar** desfaz.

## Segurança

- Coluna `is_platform_admin` só é setada por SQL (service role) — nunca por fluxo de app.
- Todo acesso ao painel e às actions é gateado por `is_platform_admin` verificado via
  `createAdminClient()` (ground-truth, ignora RLS), em duas camadas (layout + action).
- Nenhuma policy de RLS é afrouxada. `platform_subscriptions`/`organizations` continuam
  manipuladas só por service role.
- O gate de academia suspensa roda **antes** de renderizar qualquer conteúdo autenticado.

## Fora de escopo (follow-ups)

- Métricas agregadas da plataforma (MRR, nº total de alunos, academias em trial).
- Criar/editar academia manualmente pelo painel super-admin.
- Paginação/ordenação avançada na lista (só necessário com muitas academias).
- Log de auditoria das ações de suspensão.
- Impersonar admin de uma academia (entrar como) para suporte.
