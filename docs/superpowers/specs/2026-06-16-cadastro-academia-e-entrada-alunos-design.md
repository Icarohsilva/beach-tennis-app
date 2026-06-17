# Plano 2 — Cadastro de Academia (self-service) + Entrada de Alunos por convite

**Data:** 2026-06-16
**Status:** Design aprovado, pronto para implementação
**Sequência:** Item 2 de 4 do meta-projeto SaaS multi-tenant (1. Fundação ✅ · **2. Cadastro de academia + alunos** · 3. Cobrança SaaS · 4. Super-admin + branding)

## Contexto

O Plano 1 (Fundação Multi-Tenant) já está em produção: a tabela `organizations`, `organization_id` em todas as tabelas, RLS escopada por `auth_org_id()`, trigger `handle_new_user` (que já lê `org_invite_code` do metadata e cai na org default), e os helpers `getCurrentOrgId()`/`getCurrentOrg()`.

Hoje as academias só são criadas manualmente via banco e todo signup sem código cai na academia default (Hudson). O Plano 2 entrega o **self-service**: um professor cria a própria academia e entra logado como dono na hora; alunos entram exclusivamente via link de convite; e o dono pode criar contas de **professores** (staff com acesso restrito) para ajudar na operação.

## Decisões tomadas (locked)

1. **Criação da academia:** self-service instantâneo, sem aprovação. O professor preenche um formulário e já entra como admin.
2. **Entrada de alunos:** apenas por **link de convite** (`/cadastro?convite=CODIGO`). O código vem embutido e travado.
3. **Cadastro sem código:** **bloqueado** para aluno. A tela orienta a usar o link da academia e oferece "É professor? Crie sua academia". Remove o fallback Hudson para novos signups (a Hudson continua intacta — seus perfis já têm `organization_id`).
4. **Dados da academia na criação:** nome da academia + dados do professor (nome, email, senha, telefone) + branding **opcional** (logo, cor, descrição). `slug` e `invite_code` são **gerados automaticamente** a partir do nome.
5. **Gestão do convite:** o dono vê o link, copia, e tem um **QR code** para captação presencial (lib `qrcode`).
6. **Múltiplos professores por academia:** o dono (admin master) pode criar/remover contas de professor.
7. **Permissões do professor:** acessa **apenas Aulas + Alunos**. Financeiro, Configurações e Gestão de equipe são **exclusivos do dono**.
8. **Mecanismo de criação (Abordagem A):** Server Action com service role faz tudo em TypeScript; `role=admin` é setado no servidor; reaproveita o trigger que liga perfil→org via `invite_code`.
9. **Trade-off de segurança:** gating do professor é feito **na aplicação** (telas + server actions), não na RLS. Professor é `role='admin'`, então o banco ainda permite leitura das tabelas financeiras via API direta. Aceito para v1 (professor é staff de confiança). Hardening por RLS fica como follow-up.

## Arquitetura

### Jornada A — Professor cria academia

1. Acessa `/criar-academia` (pública, linkada de `/login` e `/cadastro`).
2. Preenche nome da academia + seus dados + branding opcional.
3. Submit → Server Action `createAcademy`:
   - gera `slug` + `invite_code` únicos;
   - insere a `organization` (status `active`, `is_default false`);
   - cria o usuário no Auth (`createAdminClient().auth.admin.createUser`, `email_confirm: true`) com `org_invite_code` no metadata → o trigger `handle_new_user` cria o perfil ligado à org;
   - promove o perfil para `role = 'admin'`;
   - seta `organizations.owner_id = <novo profile id>`;
   - **rollback:** se a criação do usuário falhar após a org existir, apaga a org (evita órfã).
4. O cliente faz `signInWithPassword` com as credenciais e redireciona para `/admin/dashboard`.

> Auto-confirm de email está ativo em produção (`mailer_autoconfirm=true`), então o `createUser` com `email_confirm:true` permite login imediato.

### Jornada B — Aluno entra por convite

1. Recebe `/cadastro?convite=CODIGO`.
2. A tela chama `resolveInviteCode(code)` → mostra "Você está se cadastrando na **Academia X**" e trava o vínculo.
3. Aluno preenche o formulário atual (incluindo Wellhub/TotalPass) → `signUp` com `org_invite_code` no metadata → trigger liga à academia certa.
4. **Sem código válido:** tela de bloqueio — explica que precisa do link da academia + CTA "É professor? Crie sua academia".

### Papéis e permissões (staff)

Modelo enxuto, **sem novo valor no enum `user_role`**:

- Todo staff é `role = 'admin'` → a RLS org-scoped existente já dá acesso aos dados da academia, sem reescrever política.
- **`organizations.owner_id`** (→ `profiles.id`) marca o dono/master.
- **Dono** = `org.owner_id === profile.id`. **Professor** = admin da academia que **não** é o dono. Sem coluna nova em `profiles`.

Gating (sobre o `app/(admin)/layout.tsx`, que já exige `role='admin'`, adiciona-se `isOwner`):

| Rota | Professor | Proteção |
|---|---|---|
| `/admin/dashboard`, `/admin/alunos*`, `/admin/grade*`, `/admin/notificacoes`, `/admin/torneios*` | ✅ | liberado |
| `/admin/financeiro` | ❌ | `requireOwner()` no server component + escondido do menu |
| `/admin/configuracoes` | ❌ | idem |
| `/admin/equipe` (nova) | ❌ | idem |

O **dashboard** esconde widgets financeiros para professor (refinamento dentro da página).

**Criar professor** (`/admin/equipe`, owner-only): Server Action `createProfessor` cria o usuário na org do dono (via `org_invite_code` da própria academia no metadata → trigger liga à org) e promove a `admin`. O `owner_id` permanece o dono, então o novo entra como professor. **Remover professor** = excluir o usuário.

## Componentes

### Migration `supabase/migrations/20260616010000_org_signup.sql`
- `alter table organizations add column if not exists owner_id uuid references profiles(id)`
- `alter table organizations add column if not exists description text`
- Backfill idempotente: `owner_id` da Hudson = admin existente dela.
- Bucket público `org-logos` no Storage para logos (criado aqui ou via Dashboard; opcional).

### Helpers de servidor
- `getStaffContext()` → `{ user, profile, org, isOwner }` (reusa `getCurrentOrg`).
- `requireOwner()` → redireciona para `/admin/dashboard` se não for dono.
- `lib/org/identifiers.ts` → `generateSlug(name)`, `generateInviteCode()`, com checagem de unicidade contra o banco.

### Server Actions (`features/organizations/actions.ts`)
- `createAcademy(input)` — fluxo da Jornada A, com rollback.
- `createProfessor(input)` — owner-only.
- `removeProfessor(profileId)` — owner-only.
- `resolveInviteCode(code)` — público; retorna `{ orgId, orgName }` ou `null`.

### Páginas / UI
- `app/(auth)/criar-academia/page.tsx` — nova, pública. Form de criação + branding opcional.
- `app/(auth)/cadastro/page.tsx` — editada: lê `?convite`, resolve org, bloqueia sem código, passa `org_invite_code`.
- `app/(admin)/admin/equipe/page.tsx` — nova, owner-only: lista professores + criar/remover.
- `app/(admin)/admin/equipe/InviteCard.tsx` (client) — link + copiar + QR (`qrcode`).
- `app/(admin)/layout.tsx` — editada: calcula `isOwner`, esconde Financeiro/Configurações, mostra "Equipe" só para o dono.
- Guards `requireOwner()` em `financeiro/page.tsx`, `configuracoes/page.tsx`, `equipe/page.tsx`.
- Links "É professor? Crie sua academia" em `login` e `cadastro`.

### Tipos (`types/index.ts`)
- `Organization` ganha `owner_id?: string | null` e `description?: string | null`.

### Tratamento de erro
- Email já existente no Auth → mensagem amigável.
- Colisão de `slug`/`invite_code` → regenera e tenta de novo (limite de tentativas).
- Falha ao criar usuário após a org → apaga a org.
- Cadastro de aluno sem código válido → tela de bloqueio.

## Testes

### Automatizados (Vitest)
- `lib/org/identifiers.test.ts` — `generateSlug` (acentos, espaços, colisão→sufixo) e `generateInviteCode` (formato, unicidade).
- `canAccess(area, isOwner)` puro e testável, se extraído.

### Manual / ponta a ponta
1. `npm run test:run` (regras existentes verdes) + `npm run build` (tipos ok).
2. Criar academia via `/criar-academia` → cair logado em `/admin/dashboard` como dono.
3. Pegar link (+QR) em `/admin/equipe` → cadastrar aluno por ele → confirmar isolamento (vs Hudson e Arena Teste).
4. `/cadastro` sem código → tela de bloqueio.
5. Dono cria professor → logar como professor → vê Aulas/Alunos, **não** acessa Financeiro/Configurações/Equipe (inclusive deep-link).
6. Hudson (org #1) segue idêntica (owner_id backfillado; login/grade/financeiro do dono ok).

## Fora de escopo (planos futuros)
- Cobrança do SaaS (academia paga a plataforma) → Plano 3.
- Painel super-admin (gerir/aprovar/suspender academias) → Plano 4.
- **Uso visual** do branding na interface do aluno (aplicar logo/cores) → Plano 4. Aqui só coletamos e armazenamos.
- Bloqueio de financeiro no nível de banco (RLS) para professor — decidido como gating de aplicação na v1.
- Regenerar código de convite, multi-dono, convite por email/magic link.
