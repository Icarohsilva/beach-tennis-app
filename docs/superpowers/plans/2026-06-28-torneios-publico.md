# Torneios Públicos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar página pública `/t/[id]` compartilhável, upload de imagem de capa, premiação automática ao encerrar torneio, e inscrição avulsa (sem membership).

**Architecture:** Public route group `app/(public)/t/[id]/` sem auth middleware; 4 novas server actions em `features/torneios/actions.ts`; 3 migrations SQL; 3 novos Client Components no admin; remoção do label de formato do dashboard.

**Tech Stack:** Next.js 14 App Router, TypeScript, Supabase (Auth + Postgres + Storage), Tailwind CSS

---

## Contexto do Projeto

Codebase: `C:\beach-tennis-app` (branch `develop`)

**Arquivos críticos — ler antes de editar:**
- `features/torneios/actions.ts` — server actions de torneios (`'use server'`)
- `types/index.ts` — interfaces TypeScript (Tournament, etc.)
- `middleware.ts` — rotas públicas vs protegidas
- `app/(admin)/admin/torneios/[id]/page.tsx` — page do admin detalhe (Server Component)
- `app/(admin)/admin/torneios/CreateTournamentForm.tsx` — form de criação (Client Component)
- `app/(dashboard)/torneios/[id]/page.tsx` — page do aluno (Server Component)
- `lib/supabase/server.ts` — `createClient()`, `createAdminClient()`, `getActiveOrgId()`

**Padrões do projeto:**
- Design system dark: bg-surface `#0c1220`, bg-surface-card `#151e31`, border-surface-border `#26334d`, text-brand-500 `#f97316`
- `createAdminClient()` bypassa RLS — sempre filtrar por `organization_id` quando escrevendo
- Migrations aplicadas manualmente via SQL Editor do Supabase (nunca rodar `supabase db push`)
- Commits: `git add` nos arquivos específicos, nunca `git add -A`
- Branch: `develop`

---

## Mapa de Arquivos

| Ação | Arquivo |
|------|---------|
| Criar | `supabase/migrations/20260628000100_tournament_cover_winners.sql` |
| Criar | `supabase/migrations/20260628000200_tournament_images_bucket.sql` |
| Criar | `supabase/migrations/20260628000300_tournaments_public_read.sql` |
| Modificar | `types/index.ts` (Tournament interface) |
| Modificar | `middleware.ts` (rotas públicas) |
| Modificar | `features/torneios/actions.ts` (4 novas actions + update createTournament) |
| Criar | `app/(public)/layout.tsx` |
| Criar | `app/(public)/t/[id]/RegisterExternalButton.tsx` |
| Criar | `app/(public)/t/[id]/page.tsx` |
| Criar | `app/(admin)/admin/torneios/[id]/CoverImageCard.tsx` |
| Criar | `app/(admin)/admin/torneios/[id]/CloseTournamentButton.tsx` |
| Criar | `app/(admin)/admin/torneios/[id]/WinnersCard.tsx` |
| Modificar | `app/(admin)/admin/torneios/[id]/page.tsx` |
| Modificar | `app/(admin)/admin/torneios/CreateTournamentForm.tsx` |
| Modificar | `app/(dashboard)/torneios/[id]/page.tsx` |

---

## Task 1: Migrations SQL

**Files:**
- Create: `supabase/migrations/20260628000100_tournament_cover_winners.sql`
- Create: `supabase/migrations/20260628000200_tournament_images_bucket.sql`
- Create: `supabase/migrations/20260628000300_tournaments_public_read.sql`

- [ ] **Step 1: Criar migration de colunas cover_image_url e winners**

Conteúdo de `supabase/migrations/20260628000100_tournament_cover_winners.sql`:

```sql
-- Imagem de capa do torneio (URL do Storage bucket tournament-images).
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS cover_image_url text;

-- Pódio: 1º, 2º e 3º lugar. Preenchidos automaticamente ao encerrar;
-- admin pode corrigir. winner*_partner_id para dupla_fixa (null no americano).
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS winner1_id uuid REFERENCES profiles(id);
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS winner2_id uuid REFERENCES profiles(id);
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS winner3_id uuid REFERENCES profiles(id);
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS winner1_partner_id uuid REFERENCES profiles(id);
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS winner2_partner_id uuid REFERENCES profiles(id);
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS winner3_partner_id uuid REFERENCES profiles(id);
```

- [ ] **Step 2: Criar migration do bucket tournament-images**

Conteúdo de `supabase/migrations/20260628000200_tournament_images_bucket.sql`:

```sql
-- Bucket público para imagens de capa de torneios.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'tournament-images',
  'tournament-images',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Qualquer admin autenticado pode fazer upload.
CREATE POLICY IF NOT EXISTS "tournament-images upload"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'tournament-images');

-- Leitura pública (o bucket já é público, mas a policy explicita).
CREATE POLICY IF NOT EXISTS "tournament-images public read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'tournament-images');
```

- [ ] **Step 3: Criar migration de RLS pública para torneios**

Conteúdo de `supabase/migrations/20260628000300_tournaments_public_read.sql`:

```sql
-- Torneios não-rascunho são visíveis publicamente (página /t/[id]).
-- A página atual usa createAdminClient() mas a policy evita lock-in.
CREATE POLICY IF NOT EXISTS "tournaments_public_read" ON tournaments
  FOR SELECT TO anon, authenticated
  USING (status IN ('open', 'in_progress', 'finished'));

-- Inscrições de torneios públicos também são visíveis.
CREATE POLICY IF NOT EXISTS "tournament_entries_public_read" ON tournament_entries
  FOR SELECT TO anon, authenticated
  USING (
    tournament_id IN (
      SELECT id FROM tournaments WHERE status IN ('open', 'in_progress', 'finished')
    )
  );
```

- [ ] **Step 4: Commit das migrations**

```bash
git add supabase/migrations/20260628000100_tournament_cover_winners.sql
git add supabase/migrations/20260628000200_tournament_images_bucket.sql
git add supabase/migrations/20260628000300_tournaments_public_read.sql
git commit -m "feat(torneios): migrations cover_image_url, winners, storage bucket, public RLS"
```

> **Nota:** Estas migrations devem ser aplicadas **manualmente** pelo usuário via SQL Editor do Supabase antes de qualquer teste que acesse o banco.

---

## Task 2: Tipos TypeScript + Middleware

**Files:**
- Modify: `types/index.ts` (interface Tournament, linha 279)
- Modify: `middleware.ts` (linha 28)

- [ ] **Step 1: Adicionar campos ao tipo Tournament em `types/index.ts`**

Localizar a interface Tournament (começa na linha 279) e substituir por:

```ts
export interface Tournament {
  id: string
  organization_id: string
  name: string
  date: string
  sport: string
  category: TournamentCategory
  participant_type: ParticipantType
  format: TournamentFormat
  modality: TournamentModality | null
  level: StudentLevel
  sets_to_win: number
  games_per_set: number
  tiebreak_games: boolean
  status: TournamentStatus
  created_by: string
  cover_image_url: string | null
  winner1_id: string | null
  winner2_id: string | null
  winner3_id: string | null
  winner1_partner_id: string | null
  winner2_partner_id: string | null
  winner3_partner_id: string | null
}
```

- [ ] **Step 2: Adicionar `/t/` às rotas públicas no middleware**

Em `middleware.ts`, localizar o bloco de rotas públicas (volta da linha 21). Adicionar `pathname.startsWith('/t/')` após a linha de `/arenas`:

```ts
  // Public routes — pass through immediately
  if (
    pathname === '/' ||
    pathname.startsWith('/login') ||
    pathname.startsWith('/cadastro') ||
    pathname.startsWith('/criar-academia') ||
    pathname.startsWith('/recuperar-senha') ||
    pathname.startsWith('/nova-senha') ||
    pathname.startsWith('/experimental') ||
    pathname.startsWith('/arenas') ||
    pathname.startsWith('/t/')
  ) {
    return NextResponse.next()
  }
```

- [ ] **Step 3: Verificar que o build passa**

```bash
npm run build
```

Expected: sem erros de tipo. Se houver erros nos arquivos que referenciam `Tournament` (como as páginas de admin/dashboard), eles resolverão nas próximas tasks.

- [ ] **Step 4: Commit**

```bash
git add types/index.ts middleware.ts
git commit -m "feat(torneios): Tournament com cover_image_url e winners; /t/ como rota pública"
```

---

## Task 3: Novas Server Actions

**Files:**
- Modify: `features/torneios/actions.ts`

Adicionar 4 funções ao fim do arquivo e atualizar `createTournament` para aceitar `cover_image_url`.

- [ ] **Step 1: Atualizar `createTournament` para aceitar cover_image_url**

No arquivo `features/torneios/actions.ts`, localizar a assinatura de `createTournament` (linha 43) e adicionar o campo opcional:

```ts
export async function createTournament(input: {
  name: string
  date: string
  sport: string
  category: TournamentCategory
  participant_type: ParticipantType
  format: TournamentFormat
  level: StudentLevel
  scoring: ScoringConfig
  cover_image_url?: string | null
}): Promise<{ error?: string; id?: string }> {
```

No `.insert({...})` dentro de `createTournament` (após `created_by: user.id`), adicionar:

```ts
      cover_image_url: input.cover_image_url ?? null,
```

- [ ] **Step 2: Adicionar imports necessários ao topo do arquivo**

Verificar que `revalidatePath` está importado. Se não estiver, adicionar após a linha `'use server'`:

```ts
import { revalidatePath } from 'next/cache'
```

Verificar que `MatchResultInput` e `FORMATS` já estão importados (eles estão — são usados em `generateBracket`).

- [ ] **Step 3: Adicionar `closeTournament` ao fim do arquivo**

```ts
// ---------------------------------------------------------------------------
// closeTournament — admin only: encerra torneio e preenche pódio automático
// ---------------------------------------------------------------------------

export async function closeTournament(
  tournamentId: string,
): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const adminClient = createAdminClient()
  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  const { data: membership } = await adminClient
    .from('memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .single()
  if (membership?.role !== 'admin') return { error: 'Sem permissão.' }

  const { data: tournament, error: tErr } = await adminClient
    .from('tournaments')
    .select('id, status, format, sets_to_win, games_per_set, tiebreak_games')
    .eq('id', tournamentId)
    .eq('organization_id', orgId)
    .single()
  if (tErr || !tournament) return { error: 'Torneio não encontrado.' }
  if (tournament.status === 'finished') return { error: 'Torneio já encerrado.' }

  // Buscar entradas e partidas para calcular classificação
  const { data: entriesRaw } = await adminClient
    .from('tournament_entries')
    .select('player_id, partner_id')
    .eq('tournament_id', tournamentId)
  const entries = (entriesRaw ?? []).map((e) => ({
    playerId: e.player_id as string,
    partnerId: (e.partner_id as string | null) ?? null,
  }))

  const { data: matchesRaw } = await adminClient
    .from('tournament_matches')
    .select('player1_id, partner1_id, player2_id, partner2_id, games1, games2, result_status')
    .eq('tournament_id', tournamentId)
  const matches = (matchesRaw ?? []).map((m) => ({
    player1_id: m.player1_id as string,
    partner1_id: (m.partner1_id as string | null) ?? null,
    player2_id: m.player2_id as string,
    partner2_id: (m.partner2_id as string | null) ?? null,
    games1: (m.games1 as number | null) ?? 0,
    games2: (m.games2 as number | null) ?? 0,
    result_status: (m.result_status as 'pending' | 'confirmed' | null),
  }))

  // Calcular classificação via motor de formato
  const scoring: ScoringConfig = {
    sets_to_win: (tournament.sets_to_win as number) ?? 1,
    games_per_set: (tournament.games_per_set as number) ?? 6,
    tiebreak_games: (tournament.tiebreak_games as boolean) ?? true,
  }
  const fmt = FORMATS[(tournament.format as string) ?? 'americano']
  const standings = fmt
    ? fmt.computeStandings(entries, matches as import('@/lib/torneios/types').MatchResultInput[], scoring)
    : []

  const [w1, w2, w3] = standings

  const { error: updateErr } = await adminClient
    .from('tournaments')
    .update({
      status: 'finished' as TournamentStatus,
      winner1_id: w1?.playerId ?? null,
      winner2_id: w2?.playerId ?? null,
      winner3_id: w3?.playerId ?? null,
      winner1_partner_id: null, // americano = ranking individual; null para todos
      winner2_partner_id: null,
      winner3_partner_id: null,
    })
    .eq('id', tournamentId)
  if (updateErr) return { error: 'Erro ao encerrar torneio. Tente novamente.' }

  revalidatePath(`/admin/torneios/${tournamentId}`)
  revalidatePath(`/t/${tournamentId}`)
  return {}
}
```

- [ ] **Step 4: Adicionar `updateWinners`**

```ts
// ---------------------------------------------------------------------------
// updateWinners — admin corrige pódio manualmente após encerramento
// ---------------------------------------------------------------------------

export async function updateWinners(
  tournamentId: string,
  winners: {
    winner1_id: string | null
    winner2_id: string | null
    winner3_id: string | null
  },
): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const adminClient = createAdminClient()
  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  const { data: membership } = await adminClient
    .from('memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .single()
  if (membership?.role !== 'admin') return { error: 'Sem permissão.' }

  const { error: updateErr } = await adminClient
    .from('tournaments')
    .update({
      winner1_id: winners.winner1_id,
      winner2_id: winners.winner2_id,
      winner3_id: winners.winner3_id,
    })
    .eq('id', tournamentId)
    .eq('organization_id', orgId)
  if (updateErr) return { error: 'Erro ao salvar resultado. Tente novamente.' }

  revalidatePath(`/admin/torneios/${tournamentId}`)
  revalidatePath(`/t/${tournamentId}`)
  return {}
}
```

- [ ] **Step 5: Adicionar `updateTournamentCover`**

```ts
// ---------------------------------------------------------------------------
// updateTournamentCover — admin troca imagem de capa
// ---------------------------------------------------------------------------

export async function updateTournamentCover(
  tournamentId: string,
  coverImageUrl: string | null,
): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const adminClient = createAdminClient()
  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  const { data: membership } = await adminClient
    .from('memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .single()
  if (membership?.role !== 'admin') return { error: 'Sem permissão.' }

  const { error: updateErr } = await adminClient
    .from('tournaments')
    .update({ cover_image_url: coverImageUrl })
    .eq('id', tournamentId)
    .eq('organization_id', orgId)
  if (updateErr) return { error: 'Erro ao salvar imagem. Tente novamente.' }

  revalidatePath(`/admin/torneios/${tournamentId}`)
  revalidatePath(`/t/${tournamentId}`)
  return {}
}
```

- [ ] **Step 6: Adicionar `registerExternal`**

```ts
// ---------------------------------------------------------------------------
// registerExternal — inscrição avulsa (sem membership): acessa via link público
// ---------------------------------------------------------------------------

export async function registerExternal(
  tournamentId: string,
): Promise<{ error?: string }> {
  // Usa createClient() apenas para ler sessão (uid); não precisa de org do usuário.
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  // adminClient para ler org_id do torneio e inserir sem RLS de membership.
  const adminClient = createAdminClient()

  const { data: tournament } = await adminClient
    .from('tournaments')
    .select('id, organization_id, status')
    .eq('id', tournamentId)
    .single()
  if (!tournament) return { error: 'Torneio não encontrado.' }
  if (tournament.status !== 'open') return { error: 'Inscrições encerradas.' }

  // Checar duplicidade
  const { count: dup } = await adminClient
    .from('tournament_entries')
    .select('id', { count: 'exact', head: true })
    .eq('tournament_id', tournamentId)
    .eq('player_id', user.id)
  if ((dup ?? 0) > 0) return { error: 'Você já está inscrito neste torneio.' }

  const { error: insertErr } = await adminClient
    .from('tournament_entries')
    .insert({
      organization_id: tournament.organization_id,
      tournament_id: tournamentId,
      player_id: user.id,
      partner_id: null,
    })
  if (insertErr) return { error: 'Erro ao realizar inscrição. Tente novamente.' }

  revalidatePath(`/t/${tournamentId}`)
  return {}
}
```

- [ ] **Step 7: Verificar build**

```bash
npm run build
```

Expected: sem erros. Se aparecer "Property 'cover_image_url' does not exist on type", confirmar que o tipo Tournament foi atualizado na Task 2.

- [ ] **Step 8: Commit**

```bash
git add features/torneios/actions.ts
git commit -m "feat(torneios): closeTournament, updateWinners, updateTournamentCover, registerExternal"
```

---

## Task 4: Route Group Público — layout + RegisterExternalButton

**Files:**
- Create: `app/(public)/layout.tsx`
- Create: `app/(public)/t/[id]/RegisterExternalButton.tsx`

- [ ] **Step 1: Criar `app/(public)/layout.tsx`**

```tsx
// app/(public)/layout.tsx
// Layout mínimo sem guards de auth. Não inclui BottomNav nem Sidebar.
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
```

- [ ] **Step 2: Criar diretório `app/(public)/t/[id]/`**

Verificar que a pasta existe:
```bash
mkdir -p "app/(public)/t/[id]"
```

- [ ] **Step 3: Criar `app/(public)/t/[id]/RegisterExternalButton.tsx`**

```tsx
'use client'
// app/(public)/t/[id]/RegisterExternalButton.tsx
// Botão de inscrição avulsa para visitantes autenticados sem membership.
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { registerExternal } from '@/features/torneios/actions'

export function RegisterExternalButton({ tournamentId }: { tournamentId: string }) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  function handleRegister() {
    setError(null)
    startTransition(async () => {
      const result = await registerExternal(tournamentId)
      if (result.error) {
        setError(result.error)
      } else {
        router.refresh()
      }
    })
  }

  return (
    <div>
      <button
        onClick={handleRegister}
        disabled={isPending}
        style={{ width: '100%' }}
        className="bg-gradient-to-r from-orange-600 to-orange-500 text-white border-none rounded-xl py-3 text-base font-semibold disabled:opacity-60 cursor-pointer hover:from-orange-500 hover:to-orange-400 transition-all"
      >
        {isPending ? 'Inscrevendo...' : 'Inscrever-se'}
      </button>
      {error && <p className="text-xs text-red-400 mt-2 text-center">{error}</p>}
    </div>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add "app/(public)/layout.tsx" "app/(public)/t/[id]/RegisterExternalButton.tsx"
git commit -m "feat(torneios): route group público — layout + RegisterExternalButton"
```

---

## Task 5: Página Pública do Torneio `/t/[id]`

**Files:**
- Create: `app/(public)/t/[id]/page.tsx`

Esta é a página principal do link compartilhado. É um Server Component que:
1. Busca o torneio via `createAdminClient()` (bypass de RLS)
2. Verifica se o usuário está autenticado via `createClient().auth.getUser()`
3. Renderiza cover image, nome, badges, CTA de inscrição, inscritos, pódio

- [ ] **Step 1: Criar `app/(public)/t/[id]/ShareButton.tsx`**

O botão "Compartilhar" precisa ser um Client Component pois chama `navigator.share` / `navigator.clipboard`:

```tsx
'use client'
// app/(public)/t/[id]/ShareButton.tsx
import { useState } from 'react'

export function ShareButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)

  function handleShare() {
    if (navigator.share) {
      navigator.share({ url }).catch(() => {})
    } else {
      navigator.clipboard.writeText(url).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      })
    }
  }

  return (
    <button
      onClick={handleShare}
      className="absolute top-3 right-3 bg-black/50 text-white text-xs rounded-full px-3 py-1 flex items-center gap-1.5 hover:bg-black/70 transition-colors"
    >
      🔗 {copied ? 'Copiado!' : 'Compartilhar'}
    </button>
  )
}
```

- [ ] **Step 2: Criar `app/(public)/t/[id]/page.tsx`**

```tsx
// app/(public)/t/[id]/page.tsx
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { formatDate } from '@/lib/utils/dateHelpers'
import { RegisterExternalButton } from './RegisterExternalButton'
import { ShareButton } from './ShareButton'

interface PageProps { params: { id: string } }

function normalizeProf<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v
}

// ---------------------------------------------------------------------------
// OG metadata (WhatsApp / Instagram preview)
// ---------------------------------------------------------------------------

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const adminClient = createAdminClient()
  const { data: t } = await adminClient
    .from('tournaments')
    .select('name, date, cover_image_url')
    .eq('id', params.id)
    .not('status', 'eq', 'draft')
    .single()

  if (!t) return { title: 'Torneio — ArenaHub' }

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://arenahub.website'
  const images = t.cover_image_url
    ? [{ url: t.cover_image_url as string, width: 1200, height: 630 }]
    : []
  const dateStr = formatDate(t.date as string, "dd 'de' MMMM 'de' yyyy")

  return {
    title: t.name as string,
    description: `Torneio ${dateStr}`,
    openGraph: {
      title: t.name as string,
      description: `Torneio ${dateStr}`,
      url: `${baseUrl}/t/${params.id}`,
      images,
      type: 'website',
    },
    twitter: {
      card: t.cover_image_url ? 'summary_large_image' : 'summary',
      title: t.name as string,
    },
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function PublicTournamentPage({ params }: PageProps) {
  const adminClient = createAdminClient()

  // Busca torneio (não-rascunho). Supabase retorna `any` para colunas novas
  // até a geração de tipos — usamos cast local TRow para clareza.
  const { data: tournamentRaw } = await adminClient
    .from('tournaments')
    .select('id, name, date, sport, category, level, status, cover_image_url, winner1_id, winner2_id, winner3_id')
    .eq('id', params.id)
    .not('status', 'eq', 'draft')
    .single()

  if (!tournamentRaw) notFound()

  type TRow = {
    id: string; name: string; date: string; sport: string; category: string
    level: string; status: string; cover_image_url: string | null
    winner1_id: string | null; winner2_id: string | null; winner3_id: string | null
  }
  const t = tournamentRaw as unknown as TRow

  // Inscritos
  const { data: entriesRaw } = await adminClient
    .from('tournament_entries')
    .select('player_id, player:profiles!tournament_entries_player_id_fkey(id, full_name)')
    .eq('tournament_id', params.id)
    .order('created_at', { ascending: true })

  type EntryRow = {
    player_id: string
    player: { id: string; full_name: string } | { id: string; full_name: string }[] | null
  }
  const entries = (entriesRaw ?? []) as unknown as EntryRow[]
  const players = entries.map((e) => normalizeProf(e.player)).filter(Boolean) as { id: string; full_name: string }[]

  // Nomes dos vencedores
  const winnerIds = [t.winner1_id, t.winner2_id, t.winner3_id].filter((id): id is string => Boolean(id))
  const { data: winnerProfilesRaw } = winnerIds.length > 0
    ? await adminClient.from('profiles').select('id, full_name').in('id', winnerIds)
    : { data: [] }
  const winnerNames = new Map<string, string>()
  for (const p of (winnerProfilesRaw ?? []) as { id: string; full_name: string }[]) {
    winnerNames.set(p.id, p.full_name)
  }

  // Verifica se usuário está logado e inscrito
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  let isRegistered = false
  if (user) {
    const { count } = await adminClient
      .from('tournament_entries')
      .select('id', { count: 'exact', head: true })
      .eq('tournament_id', params.id)
      .eq('player_id', user.id)
    isRegistered = (count ?? 0) > 0
  }

  const isOpen = t.status === 'open'
  const isFinished = t.status === 'finished'
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://arenahub.website'
  const shareUrl = `${baseUrl}/t/${params.id}`

  const CATEGORY_LABELS: Record<string, string> = {
    livre: 'Livre', masculino: 'Masculino', feminino: 'Feminino', misto: 'Misto',
  }
  const SPORT_LABELS: Record<string, string> = {
    beach_tennis: '🎾 Beach Tennis', beach_volei: '🏐 Beach Vôlei', padel: '🏓 Padel',
  }
  const STATUS_LABELS: Record<string, string> = {
    open: 'Inscrições Abertas', in_progress: 'Em Andamento', finished: 'Encerrado',
  }

  return (
    <div className="min-h-screen bg-surface" style={{ maxWidth: 480, margin: '0 auto', fontFamily: 'sans-serif' }}>

      {/* Cover Image */}
      <div
        className="relative w-full"
        style={{ height: 160, background: t.cover_image_url ? undefined : 'linear-gradient(135deg,#1e3a5f 0%,#f97316 100%)' }}
      >
        {t.cover_image_url && (
          <img src={t.cover_image_url} alt={t.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        )}
        {!t.cover_image_url && (
          <span className="absolute inset-0 flex items-center justify-center text-white/30 text-sm">
            {t.name}
          </span>
        )}
        <ShareButton url={shareUrl} />
      </div>

      {/* Header */}
      <div className="bg-surface-card border-b border-surface-border px-4 py-4">
        <div className="flex flex-wrap gap-2 mb-2.5">
          {t.status !== 'draft' && (
            <span
              className="text-xs font-semibold px-2.5 py-1 rounded-full"
              style={{ background: isOpen ? '#15803d' : isFinished ? '#334155' : '#92400e', color: '#fff' }}
            >
              {STATUS_LABELS[t.status] ?? t.status}
            </span>
          )}
          <span className="bg-surface-border text-slate-400 text-xs px-2.5 py-1 rounded-full">
            {SPORT_LABELS[t.sport] ?? t.sport}
          </span>
          <span className="bg-surface-border text-slate-400 text-xs px-2.5 py-1 rounded-full">
            Nível {t.level.toUpperCase()}
          </span>
          {t.category && t.category !== 'livre' && (
            <span className="bg-surface-border text-slate-400 text-xs px-2.5 py-1 rounded-full">
              {CATEGORY_LABELS[t.category] ?? t.category}
            </span>
          )}
        </div>
        <h1 className="text-white text-2xl font-extrabold leading-tight mb-1">{t.name}</h1>
        <p className="text-slate-500 text-sm">
          {formatDate(t.date, "dd 'de' MMMM 'de' yyyy")}
        </p>
      </div>

      {/* CTA de inscrição */}
      {isOpen && (
        <div className="mx-3 mt-3 bg-surface-card border border-surface-border rounded-xl p-4">
          <p className="text-slate-300 text-sm mb-2.5">Inscrições abertas — participe!</p>
          {isRegistered ? (
            <span className="block bg-green-800/40 text-green-400 text-sm px-3 py-2 rounded-xl font-semibold w-full text-center">
              ✓ Você está inscrito
            </span>
          ) : user ? (
            <RegisterExternalButton tournamentId={t.id} />
          ) : (
            <div>
              <Link
                href={`/login?next=/t/${t.id}`}
                className="block w-full bg-gradient-to-r from-orange-600 to-orange-500 text-white text-center rounded-xl py-3 text-base font-semibold hover:from-orange-500 hover:to-orange-400 transition-all"
              >
                Inscrever-se
              </Link>
              <p className="text-slate-500 text-xs text-center mt-2">
                Precisa de uma conta?{' '}
                <Link href={`/cadastro?next=/t/${t.id}`} className="text-brand-500 hover:underline">
                  Cadastre-se grátis
                </Link>
              </p>
            </div>
          )}
        </div>
      )}

      {/* Inscritos */}
      {players.length > 0 && (
        <div className="px-3 mt-3">
          <p className="text-slate-500 text-xs font-semibold uppercase tracking-wide mb-2">
            {players.length} {players.length === 1 ? 'inscrito' : 'inscritos'}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {players.slice(0, 8).map((p) => {
              const abbr = p.full_name.split(' ').slice(0, 2).map((n, i) => (i === 0 ? n : n[0] + '.')).join(' ')
              return (
                <span key={p.id} className="bg-surface-card text-slate-400 text-xs px-2.5 py-1 rounded-full border border-surface-border">
                  {abbr}
                </span>
              )
            })}
            {players.length > 8 && (
              <span className="bg-surface-card text-slate-400 text-xs px-2.5 py-1 rounded-full border border-surface-border">
                +{players.length - 8}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Resultado final (só ao encerrar) */}
      {isFinished && (t.winner1_id || t.winner2_id || t.winner3_id) && (
        <div className="px-3 mt-3 pb-4">
          <p className="text-slate-500 text-xs font-semibold uppercase tracking-wide mb-2">
            🏆 Resultado final
          </p>
          <div className="flex gap-2 items-end">
            {/* 2º lugar */}
            <div className="flex-1 bg-surface-card rounded-xl p-3 text-center border border-surface-border">
              <div className="text-xl mb-1">🥈</div>
              <div className="text-white text-xs font-semibold leading-tight">
                {t.winner2_id ? winnerNames.get(t.winner2_id) ?? '—' : '—'}
              </div>
              <div className="text-slate-500 text-xs">2º lugar</div>
            </div>
            {/* 1º lugar (maior) */}
            <div className="flex-1 bg-surface-card rounded-xl p-4 text-center border-2 border-brand-500">
              <div className="text-2xl mb-1">🥇</div>
              <div className="text-white text-sm font-bold leading-tight">
                {t.winner1_id ? winnerNames.get(t.winner1_id) ?? '—' : '—'}
              </div>
              <div className="text-brand-500 text-xs font-semibold">1º lugar</div>
            </div>
            {/* 3º lugar */}
            <div className="flex-1 bg-surface-card rounded-xl p-3 text-center border border-surface-border">
              <div className="text-xl mb-1">🥉</div>
              <div className="text-white text-xs font-semibold leading-tight">
                {t.winner3_id ? winnerNames.get(t.winner3_id) ?? '—' : '—'}
              </div>
              <div className="text-slate-500 text-xs">3º lugar</div>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="px-3 py-4 mt-4 border-t border-surface-border text-center">
        <span className="text-slate-600 text-xs">Powered by ArenaHub</span>
      </div>

    </div>
  )
}
```

- [ ] **Step 3: Verificar build**

```bash
npm run build
```

Expected: sem erros. A página /t/[id] aparece nas rotas geradas.

- [ ] **Step 4: Commit**

```bash
git add "app/(public)/t/[id]/page.tsx" "app/(public)/t/[id]/ShareButton.tsx"
git commit -m "feat(torneios): página pública /t/[id] com OG metadata, pódio e inscrição avulsa"
```

---

## Task 6: Admin — Componentes Cliente para o Admin Detalhe

**Files:**
- Create: `app/(admin)/admin/torneios/[id]/CoverImageCard.tsx`
- Create: `app/(admin)/admin/torneios/[id]/CloseTournamentButton.tsx`
- Create: `app/(admin)/admin/torneios/[id]/WinnersCard.tsx`

- [ ] **Step 1: Criar `CoverImageCard.tsx`**

```tsx
'use client'
// app/(admin)/admin/torneios/[id]/CoverImageCard.tsx
// Card do admin com preview da imagem de capa + URL copiável.
import { useState, useTransition } from 'react'
import { Card } from '@/components/ui/Card'
import { createClient } from '@/lib/supabase/client'
import { updateTournamentCover } from '@/features/torneios/actions'

interface CoverImageCardProps {
  tournamentId: string
  coverImageUrl: string | null
  shareUrl: string
}

export function CoverImageCard({ tournamentId, coverImageUrl, shareUrl }: CoverImageCardProps) {
  const [currentUrl, setCurrentUrl] = useState<string | null>(coverImageUrl)
  const [copied, setCopied] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadError(null)
    startTransition(async () => {
      const supabase = createClient()
      const ext = file.name.split('.').pop() ?? 'jpg'
      const path = `${crypto.randomUUID()}.${ext}`
      const { error: upErr } = await supabase.storage
        .from('tournament-images')
        .upload(path, file)
      if (upErr) {
        setUploadError('Erro no upload da imagem.')
        return
      }
      const { data: urlData } = supabase.storage
        .from('tournament-images')
        .getPublicUrl(path)
      const newUrl = urlData.publicUrl
      const result = await updateTournamentCover(tournamentId, newUrl)
      if (result.error) {
        setUploadError(result.error)
        return
      }
      setCurrentUrl(newUrl)
    })
  }

  function handleCopy() {
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <Card>
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">🔗 Link público</p>

      {/* Preview da imagem */}
      <div
        className="relative w-full rounded-lg overflow-hidden mb-2"
        style={{
          height: 80,
          background: currentUrl ? undefined : 'linear-gradient(135deg,#1e3a5f,#f97316)',
        }}
      >
        {currentUrl ? (
          <img src={currentUrl} alt="Capa" className="w-full h-full object-cover" />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center text-white/30 text-xs">
            Sem imagem de capa
          </span>
        )}
        <label className="absolute top-1.5 right-1.5 cursor-pointer">
          <span className="bg-black/60 text-white text-xs rounded px-2 py-1 hover:bg-black/80 transition-colors">
            {isPending ? '...' : 'Trocar'}
          </span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={handleFileChange}
            disabled={isPending}
          />
        </label>
      </div>

      {/* URL copiável */}
      <div className="flex gap-2 items-center">
        <span className="flex-1 bg-surface border border-surface-border rounded-lg px-3 py-2 text-xs text-slate-500 font-mono truncate">
          {shareUrl}
        </span>
        <button
          onClick={handleCopy}
          className="bg-brand-500 text-white rounded-lg px-3 py-2 text-xs font-semibold hover:bg-orange-400 transition-colors whitespace-nowrap"
        >
          {copied ? 'Copiado!' : 'Copiar'}
        </button>
      </div>

      {uploadError && <p className="text-xs text-red-400 mt-2">{uploadError}</p>}
    </Card>
  )
}
```

- [ ] **Step 2: Criar `CloseTournamentButton.tsx`**

```tsx
'use client'
// app/(admin)/admin/torneios/[id]/CloseTournamentButton.tsx
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { closeTournament } from '@/features/torneios/actions'

export function CloseTournamentButton({ tournamentId }: { tournamentId: string }) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  function handleClose() {
    if (
      !confirm(
        'Encerrar este torneio? O pódio será preenchido automaticamente pelo ranking atual. Você poderá corrigir depois.',
      )
    )
      return
    setError(null)
    startTransition(async () => {
      const result = await closeTournament(tournamentId)
      if (result.error) {
        setError(result.error)
      } else {
        router.refresh()
      }
    })
  }

  return (
    <div>
      <button
        onClick={handleClose}
        disabled={isPending}
        className="bg-surface-card border border-surface-border text-slate-400 rounded-lg px-3 py-1.5 text-sm hover:border-red-500 hover:text-red-400 transition-colors disabled:opacity-50"
      >
        {isPending ? 'Encerrando...' : 'Encerrar torneio'}
      </button>
      {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
    </div>
  )
}
```

- [ ] **Step 3: Criar `WinnersCard.tsx`**

```tsx
'use client'
// app/(admin)/admin/torneios/[id]/WinnersCard.tsx
// Pódio editável — ativo só depois de encerrar o torneio.
import { useState, useTransition } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { updateWinners } from '@/features/torneios/actions'

interface Player { id: string; full_name: string }

interface WinnersCardProps {
  tournamentId: string
  isFinished: boolean
  winner1Id: string | null
  winner2Id: string | null
  winner3Id: string | null
  allPlayers: Player[]
}

export function WinnersCard({
  tournamentId,
  isFinished,
  winner1Id,
  winner2Id,
  winner3Id,
  allPlayers,
}: WinnersCardProps) {
  const [w1, setW1] = useState(winner1Id ?? '')
  const [w2, setW2] = useState(winner2Id ?? '')
  const [w3, setW3] = useState(winner3Id ?? '')
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  function handleSave() {
    setError(null)
    setSaved(false)
    startTransition(async () => {
      const result = await updateWinners(tournamentId, {
        winner1_id: w1 || null,
        winner2_id: w2 || null,
        winner3_id: w3 || null,
      })
      if (result.error) {
        setError(result.error)
      } else {
        setSaved(true)
      }
    })
  }

  const selectClass =
    'w-full rounded-lg bg-surface border border-surface-border px-2 py-1.5 text-white text-sm focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-40'

  const slots = [
    { emoji: '🥇', label: '1º lugar', val: w1, set: setW1 },
    { emoji: '🥈', label: '2º lugar', val: w2, set: setW2 },
    { emoji: '🥉', label: '3º lugar', val: w3, set: setW3 },
  ]

  return (
    <Card className={isFinished ? '' : 'opacity-50 pointer-events-none'}>
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">
        🏆 Resultado final{!isFinished && ' (disponível ao encerrar)'}
      </p>
      <div className="grid gap-2">
        {slots.map(({ emoji, label, val, set }) => (
          <div key={label} className="flex items-center gap-2">
            <span className="text-sm w-6 shrink-0">{emoji}</span>
            <span className="text-xs text-slate-400 w-16 shrink-0">{label}</span>
            <select
              value={val}
              onChange={(e) => set(e.target.value)}
              className={selectClass}
              disabled={!isFinished || isPending}
            >
              <option value="">—</option>
              {allPlayers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
      {isFinished && (
        <div className="mt-3 flex items-center gap-2">
          <Button onClick={handleSave} loading={isPending} size="sm">
            Salvar resultado
          </Button>
          {saved && <span className="text-xs text-green-400">Salvo!</span>}
          {error && <span className="text-xs text-red-400">{error}</span>}
        </div>
      )}
    </Card>
  )
}
```

- [ ] **Step 4: Verificar build**

```bash
npm run build
```

Expected: sem erros de tipo.

- [ ] **Step 5: Commit**

```bash
git add "app/(admin)/admin/torneios/[id]/CoverImageCard.tsx"
git add "app/(admin)/admin/torneios/[id]/CloseTournamentButton.tsx"
git add "app/(admin)/admin/torneios/[id]/WinnersCard.tsx"
git commit -m "feat(torneios): admin components — CoverImageCard, CloseTournamentButton, WinnersCard"
```

---

## Task 7: Admin Detail Page — integrar novos cards

**Files:**
- Modify: `app/(admin)/admin/torneios/[id]/page.tsx`

Adicionar: imports dos 3 novos componentes, cálculo do shareUrl e allPlayers, e 3 cards após o header.

- [ ] **Step 1: Adicionar imports ao topo de `app/(admin)/admin/torneios/[id]/page.tsx`**

Após a linha `import { GenerateBracketButton } from './GenerateBracketButton'`, adicionar:

```ts
import { CoverImageCard } from './CoverImageCard'
import { CloseTournamentButton } from './CloseTournamentButton'
import { WinnersCard } from './WinnersCard'
```

- [ ] **Step 2: Adicionar cálculo de shareUrl e allPlayers no Server Component**

Após a linha `const nameById: Record<string, string> = { ... }` (que já existe no arquivo), adicionar:

```ts
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://arenahub.website'
  const shareUrl = `${baseUrl}/t/${t.id}`
  const isFinished = t.status === 'finished'

  // Lista de jogadores para o WinnersCard
  const allPlayers = entries
    .map((e) => normalizeProf(e.player))
    .filter(Boolean)
    .map((p) => p as { id: string; full_name: string })
```

- [ ] **Step 3: Adicionar os cards no JSX, após o header e antes de "Inscrições"**

No JSX de `AdminTorneioDetailPage`, após o bloco `{/* Header */}` (que fecha com `</div>`), adicionar:

```tsx
      {/* Ações rápidas */}
      <div className="grid gap-3 sm:grid-cols-2">
        <CoverImageCard
          tournamentId={t.id}
          coverImageUrl={t.cover_image_url ?? null}
          shareUrl={shareUrl}
        />
        <div className="space-y-3">
          <Card>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Ações</p>
            <div className="flex flex-wrap gap-2">
              {t.status === 'open' && <GenerateBracketButton tournamentId={t.id} />}
              {t.status !== 'finished' && (
                <CloseTournamentButton tournamentId={t.id} />
              )}
            </div>
          </Card>
          <WinnersCard
            tournamentId={t.id}
            isFinished={isFinished}
            winner1Id={t.winner1_id ?? null}
            winner2Id={t.winner2_id ?? null}
            winner3Id={t.winner3_id ?? null}
            allPlayers={allPlayers}
          />
        </div>
      </div>
```

> **Nota:** `t` é `tournament as Tournament` já declarado no arquivo. O tipo `Tournament` já tem `cover_image_url`, `winner1_id`, etc. após a Task 2, então nenhum cast adicional é necessário.

- [ ] **Step 4: Remover GenerateBracketButton do header**

No bloco header, remover:
```tsx
          {t.status === 'open' && (
            <div className="mt-3"><GenerateBracketButton tournamentId={t.id} /></div>
          )}
```

(Ele agora está no card de Ações que adicionamos.)

- [ ] **Step 5: Verificar build**

```bash
npm run build
```

Expected: sem erros de tipo.

- [ ] **Step 6: Commit**

```bash
git add "app/(admin)/admin/torneios/[id]/page.tsx"
git commit -m "feat(torneios): admin detalhe — cards Link público, Ações e Resultado final"
```

---

## Task 8: Admin Creation Form — upload de imagem de capa

**Files:**
- Modify: `app/(admin)/admin/torneios/CreateTournamentForm.tsx`

- [ ] **Step 1: Adicionar imports de Supabase client**

No início do arquivo, após os imports existentes, adicionar:

```ts
import { createClient } from '@/lib/supabase/client'
```

- [ ] **Step 2: Adicionar estado para o arquivo de capa**

Dentro da função `CreateTournamentForm`, após o estado `error`:

```ts
  const [coverFile, setCoverFile] = useState<File | null>(null)
  const [coverPreview, setCoverPreview] = useState<string | null>(null)
```

- [ ] **Step 3: Adicionar handler para seleção de arquivo**

Após `function handleSubmit`, adicionar:

```ts
  function handleCoverChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setCoverFile(file)
    setCoverPreview(URL.createObjectURL(file))
  }
```

- [ ] **Step 4: Atualizar `handleSubmit` para fazer upload antes de criar o torneio**

Substituir o bloco `startTransition(async () => { ... })` existente por:

```ts
    startTransition(async () => {
      let coverImageUrl: string | null = null

      // Upload de imagem de capa (se selecionada)
      if (coverFile) {
        const supabase = createClient()
        const ext = coverFile.name.split('.').pop() ?? 'jpg'
        const path = `${crypto.randomUUID()}.${ext}`
        const { error: upErr } = await supabase.storage
          .from('tournament-images')
          .upload(path, coverFile)
        if (upErr) {
          setError('Erro ao fazer upload da imagem de capa.')
          return
        }
        const { data: urlData } = supabase.storage
          .from('tournament-images')
          .getPublicUrl(path)
        coverImageUrl = urlData.publicUrl
      }

      const result = await createTournament({
        name: name.trim(),
        date,
        sport,
        category,
        participant_type: participantType,
        format,
        level,
        scoring: { sets_to_win: 1, games_per_set: gamesPerSet, tiebreak_games: true },
        cover_image_url: coverImageUrl,
      })
      if (result.error) setError(result.error)
      else {
        setName('')
        setDate('')
        setCoverFile(null)
        setCoverPreview(null)
        router.refresh()
      }
    })
```

- [ ] **Step 5: Adicionar campo de upload no JSX**

Antes do botão `<Button type="submit" ...>`, adicionar:

```tsx
      {/* Campo de imagem de capa */}
      <div className="sm:col-span-2">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-slate-300">Imagem de capa <span className="text-slate-500 font-normal">(opcional)</span></span>
          <div
            className="border-2 border-dashed border-surface-border rounded-xl p-4 text-center cursor-pointer hover:border-brand-500/50 transition-colors"
            style={{ background: '#1a1f2e' }}
          >
            {coverPreview ? (
              <img src={coverPreview} alt="Preview" className="w-full h-24 object-cover rounded-lg" />
            ) : (
              <>
                <div className="text-2xl mb-1">🖼️</div>
                <p className="text-brand-500 text-xs font-semibold">Escolher arquivo</p>
                <p className="text-slate-500 text-xs mt-1">Aparece no link compartilhado (JPEG / PNG / WebP, max 5 MB)</p>
              </>
            )}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={handleCoverChange}
            />
          </div>
        </label>
      </div>
```

- [ ] **Step 6: Verificar build**

```bash
npm run build
```

Expected: sem erros de tipo.

- [ ] **Step 7: Commit**

```bash
git add "app/(admin)/admin/torneios/CreateTournamentForm.tsx"
git commit -m "feat(torneios): form de criação com upload de imagem de capa"
```

---

## Task 9: Dashboard — remover badge de formato

**Files:**
- Modify: `app/(dashboard)/torneios/[id]/page.tsx`

O badge `{t.format && <Badge variant="default">{FORMATS[t.format]?.label ?? t.format}</Badge>}` mostra "Americano (Super N)" para o aluno. Remover.

- [ ] **Step 1: Localizar e remover o badge de formato**

Em `app/(dashboard)/torneios/[id]/page.tsx`, localizar o bloco (linha ~161):

```tsx
          {t.format && <Badge variant="default">{FORMATS[t.format]?.label ?? t.format}</Badge>}
```

Remover essa linha inteira.

- [ ] **Step 2: Verificar se `FORMATS` ainda é usado em outro lugar do arquivo**

Se `FORMATS` agora só for usado no bloco de classificação (`computeStandings`), o import de `FORMATS` ainda é necessário. Verificar se `FORMATS` aparece em outra linha além do badge removido. A importação de `FORMATS` em `lib/torneios/formats.ts` deve permanecer pois é usada para `FORMATS[t.format ?? 'americano']?.computeStandings(...)`.

- [ ] **Step 3: Verificar build**

```bash
npm run build
```

Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add "app/(dashboard)/torneios/[id]/page.tsx"
git commit -m "fix(torneios): remover badge de formato do dashboard (sem 'Americano' para aluno)"
```

---

## Task 10: Verificação Final

**Files:** (nenhuma mudança de código — apenas verificação)

- [ ] **Step 1: Rodar testes unitários**

```bash
npm run test:run
```

Expected: todos os testes passam. Os testes existentes em `lib/torneios/` (standings, schedule, formats, eligibility) não foram alterados e devem continuar passando.

- [ ] **Step 2: Build final**

```bash
npm run build
```

Expected: Build completo sem erros ou warnings de tipo.

- [ ] **Step 3: Smoke test manual — página pública**

1. Abrir o app em modo desenvolvimento: `npm run dev`
2. Ir para `/admin/torneios` como admin
3. Criar um torneio com imagem de capa
4. Confirmar que o link público `/t/[id]` mostra a página sem precisar estar logado (abrir em aba anônima)
5. Na aba anônima, clicar "Inscrever-se" → confirmar redirect para `/login?next=/t/[id]`
6. Fazer login → confirmar redirecionamento de volta para `/t/[id]`
7. Clicar "Inscrever-se" novamente → confirmar badge "✓ Você está inscrito"
8. Como admin, encerrar o torneio → confirmar que o pódio aparece na página pública

- [ ] **Step 4: Smoke test — admin**

1. Como admin, verificar card "Link público" na página de detalhe
2. Clicar "Trocar" → fazer upload de imagem → confirmar preview atualiza
3. Clicar "Copiar" → confirmar URL no clipboard
4. Verificar que o card "Resultado final" está desabilitado (opacity) enquanto torneio não foi encerrado
5. Encerrar torneio → confirmar que o pódio do card "Resultado final" foi preenchido
6. Editar pódio manualmente → clicar "Salvar resultado" → confirmar "Salvo!"

- [ ] **Step 5: Verificar OG tags**

Abrir `https://cards-dev.twitter.com/validator` ou `https://developers.facebook.com/tools/debug/` e colar a URL `/t/[id]` de produção para confirmar que o título e imagem aparecem no preview.

- [ ] **Step 6: Commit final e push**

```bash
git push origin develop
```

---

## Checklist de Aplicação das Migrations

Antes de testar no ambiente de produção, o usuário deve aplicar as 3 migrations via Supabase SQL Editor na ordem:

1. `supabase/migrations/20260628000100_tournament_cover_winners.sql`
2. `supabase/migrations/20260628000200_tournament_images_bucket.sql`
3. `supabase/migrations/20260628000300_tournaments_public_read.sql`
