# Alternância Aluno ↔ Super Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar a quem tem `profiles.is_platform_admin = true` um atalho de ida e volta entre a visão de aluno e o painel `/super-admin`, reaproveitando o badge "Painel" que já existe para staff de academia.

**Architecture:** Dois badges pequenos (`<Link>` com a mesma classe Tailwind do badge "Painel" já existente), um em cada header — `app/(dashboard)/layout.tsx` ganha "Plataforma" → `/super-admin`; `app/(super-admin)/layout.tsx` ganha "Aluno" → `/home`. Nenhum componente novo, nenhuma tabela nova, nenhum gate de segurança novo (a proteção de `/super-admin` já existe e não muda).

**Tech Stack:** Next.js 14 App Router (Server Components), TypeScript, Tailwind, Supabase (RLS).

Spec: [docs/superpowers/specs/2026-08-08-toggle-super-admin-aluno-design.md](../specs/2026-08-08-toggle-super-admin-aluno-design.md)

---

### Task 1: Badge "Plataforma" no dashboard do aluno

**Files:**
- Modify: `app/(dashboard)/layout.tsx`

- [ ] **Step 1: Ler `is_platform_admin` na mesma query que já busca `tour_aluno_seen_at`**

Em `app/(dashboard)/layout.tsx`, troque:

```tsx
  const { data: tourProfile } = await supabase
    .from('profiles')
    .select('tour_aluno_seen_at')
    .eq('id', user.id)
    .single()
```

por:

```tsx
  const { data: tourProfile } = await supabase
    .from('profiles')
    .select('tour_aluno_seen_at, is_platform_admin')
    .eq('id', user.id)
    .single()

  // Mesmo motivo do badge "Painel" (isStaff) logo abaixo: sem atalho, quem também é
  // platform admin não tem caminho nenhum de volta ao painel de plataforma a partir
  // da visão de aluno a não ser digitar a URL. RLS de profiles já permite ler a
  // própria linha — não precisa de createAdminClient() aqui, é só um atalho de
  // navegação, não o gate de segurança (esse já existe em (super-admin)/layout.tsx).
  const isPlatformAdmin = tourProfile?.is_platform_admin === true
```

- [ ] **Step 2: Renderizar o badge no header**

Ainda em `app/(dashboard)/layout.tsx`, localize o bloco do badge "Painel" dentro do header (procure por `isStaff && (`):

```tsx
          {isStaff && (
            <Link
              href="/admin/dashboard"
              className="shrink-0 whitespace-nowrap rounded-lg border border-brand-500/40 bg-brand-500/10 px-2 py-1 text-xs font-semibold text-brand-300 transition-colors hover:bg-brand-500/20"
            >
              Painel
            </Link>
          )}
          <HelpButton variant="aluno" inline />
```

Insira o novo badge entre os dois, mesma classe do badge "Painel":

```tsx
          {isStaff && (
            <Link
              href="/admin/dashboard"
              className="shrink-0 whitespace-nowrap rounded-lg border border-brand-500/40 bg-brand-500/10 px-2 py-1 text-xs font-semibold text-brand-300 transition-colors hover:bg-brand-500/20"
            >
              Painel
            </Link>
          )}
          {isPlatformAdmin && (
            <Link
              href="/super-admin"
              className="shrink-0 whitespace-nowrap rounded-lg border border-brand-500/40 bg-brand-500/10 px-2 py-1 text-xs font-semibold text-brand-300 transition-colors hover:bg-brand-500/20"
            >
              Plataforma
            </Link>
          )}
          <HelpButton variant="aluno" inline />
```

`Link` já está importado no topo do arquivo (`import Link from 'next/link'`) — usado pelo badge "Painel" existente. Não precisa adicionar import novo.

- [ ] **Step 3: Verificar o build**

Run: `npm run build`
Expected: compila sem erros de tipo.

- [ ] **Step 4: Commit**

```bash
git add "app/(dashboard)/layout.tsx"
git commit -m "feat(super-admin): badge Plataforma no header do aluno para quem tem is_platform_admin"
```

---

### Task 2: Badge "Aluno" no painel de super-admin

**Files:**
- Modify: `app/(super-admin)/layout.tsx`

- [ ] **Step 1: Renderizar o badge no header**

Em `app/(super-admin)/layout.tsx`, localize o grupo à direita do header:

```tsx
          <div className="flex shrink-0 items-center gap-3">
            <span className="hidden text-xs text-slate-500 sm:block">
              {profile.full_name ?? user.email}
            </span>
            <LogoutButton className="text-sm font-semibold text-red-400 hover:text-red-300">
              Sair
            </LogoutButton>
          </div>
```

Insira o badge "Aluno" entre o nome e o botão de sair, mesma classe do badge "Painel"/"Plataforma" usado no dashboard do aluno:

```tsx
          <div className="flex shrink-0 items-center gap-3">
            <span className="hidden text-xs text-slate-500 sm:block">
              {profile.full_name ?? user.email}
            </span>
            <Link
              href="/home"
              className="shrink-0 whitespace-nowrap rounded-lg border border-brand-500/40 bg-brand-500/10 px-2 py-1 text-xs font-semibold text-brand-300 transition-colors hover:bg-brand-500/20"
            >
              Aluno
            </Link>
            <LogoutButton className="text-sm font-semibold text-red-400 hover:text-red-300">
              Sair
            </LogoutButton>
          </div>
```

`Link` já está importado no topo do arquivo (usado pelo link do logo "ArenaHub · Plataforma" que envolve o `ShieldCheck`). Não precisa adicionar import novo.

- [ ] **Step 2: Verificar o build**

Run: `npm run build`
Expected: compila sem erros de tipo.

- [ ] **Step 3: Commit**

```bash
git add "app/(super-admin)/layout.tsx"
git commit -m "feat(super-admin): badge Aluno no header do painel de plataforma"
```

---

### Task 3: Verificação manual no navegador

Sem lógica de negócio isolável em função pura aqui — é composição de JSX condicional com um dado já buscado. Verificação via preview.

**Files:** nenhum

- [ ] **Step 1: Subir o dev server**

Use a ferramenta de preview do projeto (`preview_start` com a config de dev existente). Confirme que o `.env.local` existe neste worktree — ele é ignorado pelo git e não vem automaticamente; copie do repositório principal se faltar.

- [ ] **Step 2: Usuário sem `is_platform_admin`**

Logado como aluno comum (sem `is_platform_admin`), abrir `/home`: o badge "Plataforma" NÃO deve aparecer. Se esse aluno também for staff de alguma academia, o badge "Painel" continua aparecendo normalmente (não pode ter sido afetado).

- [ ] **Step 3: Usuário com `is_platform_admin`**

Marcar `is_platform_admin = true` para um usuário de teste (via SQL direto no Supabase, já que não existe UI de admin pra isso). Logado como esse usuário, abrir `/home`: o badge "Plataforma" aparece no header, ao lado do "Painel" (se aplicável) e antes do botão de Ajuda. Clicar nele deve levar a `/super-admin`.

- [ ] **Step 4: Botão de volta**

Dentro de `/super-admin`, confirmar que o badge "Aluno" aparece no header, entre o nome do usuário e "Sair". Clicar nele deve levar a `/home`.

- [ ] **Step 5: Confirmar que a proteção de `/super-admin` não mudou**

Com um usuário SEM `is_platform_admin`, tentar acessar `/super-admin` direto pela URL: deve continuar redirecionando para `/home`, como já acontecia antes desta mudança.

---

### Task 4: Checagem final

**Files:** nenhum

- [ ] **Step 1: Lint**

Run: `npm run lint`
Expected: sem erros novos.

- [ ] **Step 2: Build de produção**

Run: `npm run build`
Expected: build completo sem erros.
