# Torneios: Home "Meus Torneios" + Agendamento de Confrontos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Na home do aluno, mostrar um card "Próximo jogo" e uma seção "Meus Torneios" (torneios ativos em que o aluno participa); e permitir que admin OU qualquer jogador do confronto marque data/hora da partida.

**Architecture:** Reaproveitamos a coluna `tournament_matches.played_at` (timestamptz, já existe) — **sem migration e sem mudança de RLS**. A autorização de agendamento (admin OU participante) é feita em código na server action via `createAdminClient()`. A lógica de fuso (BRT/America/Sao_Paulo) e a escolha do "próximo jogo" ficam em funções puras testáveis (`lib/torneios/matchTime.ts`, `lib/torneios/nextMatch.ts`). A home fica enxuta via um helper de dados (`features/torneios/studentHome.ts`) e um componente de apresentação (`features/torneios/NextMatchCard.tsx`).

**Tech Stack:** Next.js 14 App Router (Server Components + Client Components 'use client'), TypeScript, Supabase Postgres, Tailwind, Vitest.

---

## File Structure

**Create:**
- `lib/torneios/matchTime.ts` — helpers puros de fuso BRT (converter datetime-local ↔ ISO, formatar, início do dia BRT).
- `lib/torneios/matchTime.test.ts` — testes.
- `lib/torneios/nextMatch.ts` — `pickNextMatch` (função pura: escolhe o próximo confronto agendado não confirmado).
- `lib/torneios/nextMatch.test.ts` — testes.
- `features/torneios/studentHome.ts` — helper de dados server-side (`getStudentTournamentHome`).
- `features/torneios/NextMatchCard.tsx` — componente de apresentação do "Próximo jogo".

**Modify:**
- `features/torneios/actions.ts` — nova action `scheduleMatch`.
- `features/torneios/MatchScoreCard.tsx` — barra de data/hora + edição (admin ou participante).
- `app/(dashboard)/torneios/[id]/page.tsx` — incluir `played_at` no select/tipo/props.
- `app/(admin)/admin/torneios/[id]/page.tsx` — incluir `played_at` no select/tipo/props.
- `app/(dashboard)/home/page.tsx` — card "Próximo jogo", seção "Meus Torneios", excluir de "Próximos Torneios" os torneios já inscritos.

---

## Task 1: matchTime.ts — helpers de fuso BRT (TDD)

**Files:**
- Create: `lib/torneios/matchTime.ts`
- Test: `lib/torneios/matchTime.test.ts`

Contexto de fuso: o input `datetime-local` devolve hora "de parede" sem fuso; o servidor roda em UTC na Vercel. Interpretamos SEMPRE como America/Sao_Paulo (offset fixo -03:00, sem horário de verão no Brasil atual).

- [ ] **Step 1: Write the failing tests**

Create `lib/torneios/matchTime.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  brtLocalToIso,
  isoToBrtLocalInput,
  formatMatchDateTime,
  startOfTodayBrt,
} from './matchTime'

describe('brtLocalToIso', () => {
  it('interpreta o valor do input como horário de Brasília (-03:00)', () => {
    // 18:00 em Brasília = 21:00 UTC
    expect(brtLocalToIso('2026-07-05T18:00')).toBe('2026-07-05T21:00:00.000Z')
  })
  it('retorna null para string vazia', () => {
    expect(brtLocalToIso('')).toBeNull()
  })
  it('retorna null para valor inválido', () => {
    expect(brtLocalToIso('not-a-date')).toBeNull()
  })
})

describe('isoToBrtLocalInput', () => {
  it('converte ISO UTC para o formato do input em horário de Brasília', () => {
    // 21:00 UTC = 18:00 em Brasília
    expect(isoToBrtLocalInput('2026-07-05T21:00:00.000Z')).toBe('2026-07-05T18:00')
  })
  it('retorna string vazia para ISO inválido', () => {
    expect(isoToBrtLocalInput('not-a-date')).toBe('')
  })
})

describe('formatMatchDateTime', () => {
  it('formata em pt-BR com data e hora de Brasília', () => {
    const out = formatMatchDateTime('2026-07-05T21:00:00.000Z')
    expect(out).toContain('05/07')
    expect(out).toContain('18:00')
  })
})

describe('startOfTodayBrt', () => {
  it('retorna a meia-noite de Brasília do dia corrente em BRT', () => {
    // 2026-07-05T02:00Z = 2026-07-04 23:00 BRT -> hoje BRT = 2026-07-04
    const start = startOfTodayBrt(new Date('2026-07-05T02:00:00.000Z'))
    expect(start.toISOString()).toBe('2026-07-04T03:00:00.000Z')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- lib/torneios/matchTime.test.ts`
Expected: FAIL — "Failed to resolve import './matchTime'" / functions undefined.

- [ ] **Step 3: Write minimal implementation**

Create `lib/torneios/matchTime.ts`:

```ts
// lib/torneios/matchTime.ts
// Helpers de fuso para agendamento de confrontos.
// O input datetime-local não carrega fuso; interpretamos sempre como
// America/Sao_Paulo (offset fixo -03:00, sem horário de verão no Brasil atual).

const BRT_OFFSET = '-03:00'
const TZ = 'America/Sao_Paulo'

/** "2026-07-05T18:00" (BRT) -> ISO UTC. null se vazio/inválido. */
export function brtLocalToIso(local: string): string | null {
  if (!local) return null
  const withSeconds = local.length === 16 ? `${local}:00` : local
  const d = new Date(`${withSeconds}${BRT_OFFSET}`)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

/** ISO UTC -> "2026-07-05T18:00" (BRT) para preencher o input. '' se inválido. */
export function isoToBrtLocalInput(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  // sv-SE produz "YYYY-MM-DD HH:mm"
  const s = new Intl.DateTimeFormat('sv-SE', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d)
  return s.replace(' ', 'T')
}

/** ISO UTC -> "sáb., 05/07 · 18:00" (BRT). '' se inválido. */
export function formatMatchDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const date = new Intl.DateTimeFormat('pt-BR', {
    timeZone: TZ,
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
  }).format(d)
  const time = new Intl.DateTimeFormat('pt-BR', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d)
  return `${date} · ${time}`
}

/** Meia-noite (BRT) do dia corrente, como Date UTC. */
export function startOfTodayBrt(now: Date): Date {
  const dateStr = new Intl.DateTimeFormat('sv-SE', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
  return new Date(`${dateStr}T00:00:00${BRT_OFFSET}`)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- lib/torneios/matchTime.test.ts`
Expected: PASS (4 describes, all green).

- [ ] **Step 5: Commit**

```bash
git add lib/torneios/matchTime.ts lib/torneios/matchTime.test.ts
git commit -m "feat(torneios): helpers de fuso BRT para agendamento de confrontos"
```

---

## Task 2: nextMatch.ts — escolha do próximo confronto (TDD)

**Files:**
- Create: `lib/torneios/nextMatch.ts`
- Test: `lib/torneios/nextMatch.test.ts`

Regra: "próximo jogo" = confronto com `played_at` definido, ainda **não confirmado**, com `played_at >= início de hoje (BRT)`; entre os elegíveis, o de menor `played_at`.

- [ ] **Step 1: Write the failing tests**

Create `lib/torneios/nextMatch.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { pickNextMatch, type SchedulableMatch } from './nextMatch'

// now = 2026-07-05T12:00Z (09:00 BRT). Início de hoje BRT = 2026-07-05T03:00Z.
const now = new Date('2026-07-05T12:00:00.000Z')

function m(over: Partial<SchedulableMatch> & { id: string }): SchedulableMatch {
  return { played_at: null, result_status: null, ...over }
}

describe('pickNextMatch', () => {
  it('retorna null para lista vazia', () => {
    expect(pickNextMatch([], now)).toBeNull()
  })

  it('ignora confrontos sem played_at', () => {
    expect(pickNextMatch([m({ id: 'a' }), m({ id: 'b' })], now)).toBeNull()
  })

  it('ignora confrontos já confirmados, mesmo no futuro', () => {
    const rows = [m({ id: 'a', played_at: '2026-07-10T21:00:00.000Z', result_status: 'confirmed' })]
    expect(pickNextMatch(rows, now)).toBeNull()
  })

  it('ignora confrontos agendados antes do início de hoje (BRT)', () => {
    const rows = [m({ id: 'a', played_at: '2026-07-04T20:00:00.000Z' })]
    expect(pickNextMatch(rows, now)).toBeNull()
  })

  it('inclui confronto de hoje mesmo se o horário já passou', () => {
    // 05:00Z = 02:00 BRT, depois do início de hoje (03:00Z) e antes de now
    const rows = [m({ id: 'a', played_at: '2026-07-05T05:00:00.000Z' })]
    expect(pickNextMatch(rows, now)?.id).toBe('a')
  })

  it('entre vários elegíveis, escolhe o de menor played_at', () => {
    const rows = [
      m({ id: 'later', played_at: '2026-07-08T21:00:00.000Z' }),
      m({ id: 'soon', played_at: '2026-07-06T21:00:00.000Z' }),
      m({ id: 'confirmed', played_at: '2026-07-05T21:00:00.000Z', result_status: 'confirmed' }),
    ]
    expect(pickNextMatch(rows, now)?.id).toBe('soon')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- lib/torneios/nextMatch.test.ts`
Expected: FAIL — cannot resolve `./nextMatch`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/torneios/nextMatch.ts`:

```ts
// lib/torneios/nextMatch.ts
import { startOfTodayBrt } from './matchTime'

export interface SchedulableMatch {
  id: string
  played_at: string | null
  result_status: 'pending' | 'confirmed' | null
}

/** Próximo confronto agendado (não confirmado) a partir do início de hoje (BRT). */
export function pickNextMatch<T extends SchedulableMatch>(matches: T[], now: Date): T | null {
  const threshold = startOfTodayBrt(now).getTime()
  let best: T | null = null
  let bestTime = Infinity
  for (const match of matches) {
    if (!match.played_at) continue
    if (match.result_status === 'confirmed') continue
    const t = new Date(match.played_at).getTime()
    if (Number.isNaN(t) || t < threshold) continue
    if (t < bestTime) {
      bestTime = t
      best = match
    }
  }
  return best
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- lib/torneios/nextMatch.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/torneios/nextMatch.ts lib/torneios/nextMatch.test.ts
git commit -m "feat(torneios): pickNextMatch para o proximo confronto agendado"
```

---

## Task 3: scheduleMatch — server action (admin OU participante)

**Files:**
- Modify: `features/torneios/actions.ts` (adicionar action no fim do arquivo)

A action recebe apenas `matchId` e o ISO (ou null para limpar). Lê o `tournament_id` do banco para revalidar. Autorização: admin da academia ativa OU jogador do confronto (`canReportResult`). Padrão espelha `reportMatchResult` (linhas ~469-511) e `recordMatchResult` (checagem de role via `memberships`).

Imports já presentes no topo do arquivo (confirmado): `createClient, createAdminClient, getActiveOrgId` de `@/lib/supabase/server`; `revalidatePath` de `next/cache`; `canReportResult, type EligibilityMatch` de `@/lib/torneios/eligibility`. **Nenhum import novo é necessário.**

- [ ] **Step 1: Add the action**

Ao final de `features/torneios/actions.ts`, acrescente:

```ts
// ---------------------------------------------------------------------------
// scheduleMatch — admin OU qualquer jogador do confronto (last-write-wins)
// ---------------------------------------------------------------------------

export async function scheduleMatch(
  matchId: string,
  playedAtIso: string | null,
): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const adminClient = createAdminClient()
  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  const { data: match, error: mErr } = await adminClient
    .from('tournament_matches')
    .select('id, tournament_id, player1_id, partner1_id, player2_id, partner2_id, reported_by')
    .eq('id', matchId)
    .eq('organization_id', orgId)
    .single()
  if (mErr || !match) return { error: 'Confronto não encontrado.' }

  const { data: membership } = await adminClient
    .from('memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .single()
  const isAdmin = membership?.role === 'admin'

  if (!isAdmin && !canReportResult(user.id, match as EligibilityMatch)) {
    return { error: 'Sem permissão para marcar este confronto.' }
  }

  if (playedAtIso !== null) {
    const d = new Date(playedAtIso)
    if (Number.isNaN(d.getTime())) return { error: 'Data/hora inválida.' }
  }

  const { error: updErr } = await adminClient
    .from('tournament_matches')
    .update({ played_at: playedAtIso })
    .eq('id', matchId)
    .eq('organization_id', orgId)
  if (updErr) return { error: 'Erro ao salvar a data/hora. Tente novamente.' }

  revalidatePath(`/torneios/${match.tournament_id}`)
  revalidatePath(`/admin/torneios/${match.tournament_id}`)
  revalidatePath('/home')
  return {}
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros novos relativos a `scheduleMatch`.

- [ ] **Step 3: Commit**

```bash
git add features/torneios/actions.ts
git commit -m "feat(torneios): action scheduleMatch (admin ou participante)"
```

---

## Task 4: MatchScoreCard — barra de data/hora + edição

**Files:**
- Modify: `features/torneios/MatchScoreCard.tsx`

Adiciona `played_at` ao tipo, uma barra sempre visível com a data/hora (ou "Sem data/hora") e, para quem pode agendar (admin ou participante = `mySide !== null`), botão "Marcar data/hora"/"Editar" abrindo um input `datetime-local` com Salvar/Limpar/Cancelar.

- [ ] **Step 1: Add imports**

Em `features/torneios/MatchScoreCard.tsx`, altere o bloco de import das actions (linhas 10-14):

```ts
import {
  reportMatchResult,
  confirmMatchResult,
  recordMatchResult,
  scheduleMatch,
} from './actions'
```

E, logo após o import de eligibility (após a linha 19), adicione:

```ts
import {
  formatMatchDateTime,
  isoToBrtLocalInput,
  brtLocalToIso,
} from '@/lib/torneios/matchTime'
```

- [ ] **Step 2: Add played_at to the ScoreMatch interface**

Em `export interface ScoreMatch` (linhas 21-35), adicione a propriedade logo após `reported_by: string | null`:

```ts
  reported_by: string | null
  played_at: string | null
```

- [ ] **Step 3: Add scheduling state and handlers**

Logo após a definição de `mySide` (que termina na linha 75), adicione:

```ts
  const canSchedule = isAdmin || mySide !== null
  const [schedOpen, setSchedOpen] = useState(false)
  const [schedValue, setSchedValue] = useState<string>(
    match.played_at ? isoToBrtLocalInput(match.played_at) : '',
  )
  const [schedError, setSchedError] = useState<string | null>(null)
  const [schedPending, startSchedTransition] = useTransition()

  function saveSchedule() {
    const iso = brtLocalToIso(schedValue)
    if (!iso) {
      setSchedError('Informe uma data e hora válidas.')
      return
    }
    setSchedError(null)
    startSchedTransition(async () => {
      const res = await scheduleMatch(match.id, iso)
      if (res.error) setSchedError(res.error)
      else {
        setSchedOpen(false)
        router.refresh()
      }
    })
  }

  function clearSchedule() {
    setSchedError(null)
    startSchedTransition(async () => {
      const res = await scheduleMatch(match.id, null)
      if (res.error) setSchedError(res.error)
      else {
        setSchedOpen(false)
        router.refresh()
      }
    })
  }
```

- [ ] **Step 4: Render the scheduling bar**

Logo após o bloco do header (o `{(roundLabel || match.result_status) && ( ... )}` que fecha na linha 201) e **antes** de `{teamRow(1)}` (linha 203), insira:

```tsx
      {/* Data/hora do confronto */}
      <div className="flex items-center justify-between gap-2 border-b border-surface-border px-3 py-2">
        <span className="flex items-center gap-1.5 text-xs text-slate-400">
          <span aria-hidden>📅</span>
          {match.played_at ? formatMatchDateTime(match.played_at) : 'Sem data/hora'}
        </span>
        {canSchedule && !schedOpen && (
          <button
            type="button"
            onClick={() => {
              setSchedValue(match.played_at ? isoToBrtLocalInput(match.played_at) : '')
              setSchedError(null)
              setSchedOpen(true)
            }}
            className="text-xs font-semibold text-brand-400 hover:text-brand-300"
          >
            {match.played_at ? 'Editar' : 'Marcar data/hora'}
          </button>
        )}
      </div>
      {schedOpen && (
        <div className="space-y-2 border-b border-surface-border px-3 py-2.5">
          {schedError && <p className="text-xs text-red-400">{schedError}</p>}
          <input
            type="datetime-local"
            value={schedValue}
            onChange={(e) => setSchedValue(e.target.value)}
            aria-label="Data e hora do confronto"
            className="w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" loading={schedPending} onClick={saveSchedule}>
              Salvar
            </Button>
            {match.played_at && (
              <Button size="sm" variant="ghost" disabled={schedPending} onClick={clearSchedule}>
                Limpar
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              disabled={schedPending}
              onClick={() => {
                setSchedOpen(false)
                setSchedError(null)
              }}
            >
              Cancelar
            </Button>
          </div>
        </div>
      )}
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: `ScoreMatch` agora exige `played_at` — as duas páginas de detalhe ainda não passam esse campo, então **erros nessas páginas são esperados aqui** e serão corrigidos na Task 5. Nenhum erro dentro de `MatchScoreCard.tsx`.

- [ ] **Step 6: Commit**

```bash
git add features/torneios/MatchScoreCard.tsx
git commit -m "feat(torneios): barra de data/hora no card de confronto"
```

---

## Task 5: Páginas de detalhe (aluno + admin) — incluir played_at

**Files:**
- Modify: `app/(dashboard)/torneios/[id]/page.tsx`
- Modify: `app/(admin)/admin/torneios/[id]/page.tsx`

Ambas fazem `select` em `tournament_matches`, definem um tipo `ScoreMatchRaw` e montam `match={{ ... }}` para `MatchScoreCard`. Adicionar `played_at` nos três lugares.

### 5a — Página do aluno (`app/(dashboard)/torneios/[id]/page.tsx`)

- [ ] **Step 1: Add played_at to the select**

No select de `tournament_matches` (linhas 77-83), altere a primeira linha de campos escalares para incluir `played_at`:

```ts
    .select(`id, tournament_id, round, match_no,
      player1_id, player2_id, partner1_id, partner2_id,
      games1, games2, result_status, reported_by, confirmed_by, played_at,
      player1:profiles!player1_id(id, full_name),
      player2:profiles!player2_id(id, full_name),
      partner1:profiles!partner1_id(id, full_name),
      partner2:profiles!partner2_id(id, full_name)`)
```

- [ ] **Step 2: Add played_at to ScoreMatchRaw type**

No tipo `ScoreMatchRaw` (linhas 88-97), após `reported_by: string | null; confirmed_by: string | null`, acrescente:

```ts
    reported_by: string | null; confirmed_by: string | null; played_at: string | null
```

- [ ] **Step 3: Pass played_at to MatchScoreCard**

No `match={{ ... }}` (linhas 209-214), adicione `played_at`:

```tsx
                match={{
                  ...match,
                  player1_id: match.player1_id ?? '',
                  player2_id: match.player2_id ?? '',
                  result_status: match.result_status as 'pending' | 'confirmed' | null,
                  played_at: match.played_at,
                }}
```

### 5b — Página do admin (`app/(admin)/admin/torneios/[id]/page.tsx`)

- [ ] **Step 4: Add played_at to the select**

No select de `tournament_matches` (linhas 100-106), inclua `played_at` na linha de campos escalares:

```ts
    .select(`id, tournament_id, round, match_no,
      player1_id, player2_id, partner1_id, partner2_id,
      games1, games2, result_status, reported_by, confirmed_by, played_at,
      player1:profiles!player1_id(id, full_name),
      player2:profiles!player2_id(id, full_name),
      partner1:profiles!partner1_id(id, full_name),
      partner2:profiles!partner2_id(id, full_name)`)
```

- [ ] **Step 5: Add played_at to ScoreMatchRaw type**

No tipo `ScoreMatchRaw` (linha 115), altere a linha `reported_by: string | null; confirmed_by: string | null` para:

```ts
    reported_by: string | null; confirmed_by: string | null; played_at: string | null
```

- [ ] **Step 6: Pass played_at to MatchScoreCard**

No `match={{ ... }}` (linhas 429-434), adicione `played_at`:

```tsx
                        match={{
                          ...match,
                          player1_id: match.player1_id ?? '',
                          player2_id: match.player2_id ?? '',
                          result_status: match.result_status as 'pending' | 'confirmed' | null,
                          played_at: match.played_at,
                        }}
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros (os erros esperados da Task 4 sobre `played_at` faltando agora somem).

- [ ] **Step 6: Commit**

```bash
git add "app/(dashboard)/torneios/[id]/page.tsx" "app/(admin)/admin/torneios/[id]/page.tsx"
git commit -m "feat(torneios): carregar played_at nas paginas de detalhe do confronto"
```

---

## Task 6: studentHome.ts — helper de dados da home

**Files:**
- Create: `features/torneios/studentHome.ts`

Reúne (1) torneios ativos (status `open`/`in_progress`) em que o aluno está inscrito, (2) o conjunto de ids desses torneios (para a home excluir de "Próximos Torneios"), e (3) o próximo confronto agendado. Usa `createAdminClient()` **sempre org-scopado por `organization_id`**.

- [ ] **Step 1: Create the helper**

Create `features/torneios/studentHome.ts`:

```ts
// features/torneios/studentHome.ts
import { createAdminClient } from '@/lib/supabase/server'
import { pickNextMatch } from '@/lib/torneios/nextMatch'
import { teamLabel } from '@/lib/torneios/display'
import type { TournamentStatus } from '@/types'

export interface MyTournamentSummary {
  id: string
  name: string
  date: string
  status: TournamentStatus
}

export interface NextMatchSummary {
  matchId: string
  tournamentId: string
  tournamentName: string
  playedAt: string
  team1: string
  team2: string
  mySide: 1 | 2
}

export interface StudentTournamentHome {
  myTournaments: MyTournamentSummary[]
  myTournamentIds: Set<string>
  nextMatch: NextMatchSummary | null
}

const EMPTY: StudentTournamentHome = {
  myTournaments: [],
  myTournamentIds: new Set(),
  nextMatch: null,
}

type ProfRef = { full_name: string } | { full_name: string }[] | null | undefined
function profName(p: ProfRef): string | null {
  if (!p) return null
  const obj = Array.isArray(p) ? p[0] : p
  return obj?.full_name ?? null
}

export async function getStudentTournamentHome(
  { orgId, userId }: { orgId: string | null; userId: string },
): Promise<StudentTournamentHome> {
  if (!orgId) return EMPTY
  const admin = createAdminClient()

  // 1) Inscrições do aluno (como titular ou parceiro)
  const { data: entriesRaw } = await admin
    .from('tournament_entries')
    .select('tournament_id')
    .eq('organization_id', orgId)
    .or(`player_id.eq.${userId},partner_id.eq.${userId}`)

  const entryIds = Array.from(
    new Set(((entriesRaw ?? []) as { tournament_id: string }[]).map((e) => e.tournament_id)),
  )
  if (entryIds.length === 0) return EMPTY

  // 2) Torneios ativos (inscrições abertas ou em andamento)
  const { data: tournamentsRaw } = await admin
    .from('tournaments')
    .select('id, name, date, status')
    .eq('organization_id', orgId)
    .in('id', entryIds)
    .in('status', ['open', 'in_progress'])
    .order('date', { ascending: true })

  const myTournaments = (tournamentsRaw ?? []) as MyTournamentSummary[]
  const activeIds = myTournaments.map((t) => t.id)
  const myTournamentIds = new Set(activeIds)
  if (activeIds.length === 0) {
    return { myTournaments, myTournamentIds, nextMatch: null }
  }

  // 3) Próximo confronto agendado do aluno nesses torneios
  const { data: matchesRaw } = await admin
    .from('tournament_matches')
    .select(`id, tournament_id, played_at, result_status,
      player1_id, partner1_id, player2_id, partner2_id,
      player1:profiles!player1_id(full_name),
      partner1:profiles!partner1_id(full_name),
      player2:profiles!player2_id(full_name),
      partner2:profiles!partner2_id(full_name)`)
    .eq('organization_id', orgId)
    .in('tournament_id', activeIds)
    .or(
      `player1_id.eq.${userId},partner1_id.eq.${userId},player2_id.eq.${userId},partner2_id.eq.${userId}`,
    )

  type MatchRow = {
    id: string
    tournament_id: string
    played_at: string | null
    result_status: 'pending' | 'confirmed' | null
    player1_id: string
    partner1_id: string | null
    player2_id: string
    partner2_id: string | null
    player1: ProfRef
    partner1: ProfRef
    player2: ProfRef
    partner2: ProfRef
  }
  const matches = (matchesRaw ?? []) as unknown as MatchRow[]
  const picked = pickNextMatch(matches, new Date())

  let nextMatch: NextMatchSummary | null = null
  if (picked && picked.played_at) {
    const mySide: 1 | 2 =
      picked.player1_id === userId || picked.partner1_id === userId ? 1 : 2
    const tournamentName =
      myTournaments.find((t) => t.id === picked.tournament_id)?.name ?? 'Torneio'
    nextMatch = {
      matchId: picked.id,
      tournamentId: picked.tournament_id,
      tournamentName,
      playedAt: picked.played_at,
      team1: teamLabel([profName(picked.player1), profName(picked.partner1)]),
      team2: teamLabel([profName(picked.player2), profName(picked.partner2)]),
      mySide,
    }
  }

  return { myTournaments, myTournamentIds, nextMatch }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add features/torneios/studentHome.ts
git commit -m "feat(torneios): helper getStudentTournamentHome para a home do aluno"
```

---

## Task 7: NextMatchCard — componente de apresentação

**Files:**
- Create: `features/torneios/NextMatchCard.tsx`

Card destacado (`accent`) com link para o torneio, mostrando os times, data/hora e o nome do torneio. Realça o time do aluno via `mySide`.

- [ ] **Step 1: Create the component**

Create `features/torneios/NextMatchCard.tsx`:

```tsx
// features/torneios/NextMatchCard.tsx
import Link from 'next/link'
import { Card } from '@/components/ui/Card'
import { formatMatchDateTime } from '@/lib/torneios/matchTime'
import type { NextMatchSummary } from './studentHome'
import { cn } from '@/lib/utils/cn'

export function NextMatchCard({ match }: { match: NextMatchSummary }) {
  return (
    <Link href={`/torneios/${match.tournamentId}`} className="block">
      <Card accent className="hover:border-brand-600/50 transition-colors">
        <p className="text-[11px] font-bold uppercase tracking-wide text-brand-400">
          Próximo jogo
        </p>
        <div className="mt-1 flex items-center gap-2 text-sm font-semibold text-white">
          <span className={cn('truncate', match.mySide === 1 && 'text-brand-300')}>
            {match.team1}
          </span>
          <span className="shrink-0 text-xs font-normal text-slate-500">vs</span>
          <span className={cn('truncate', match.mySide === 2 && 'text-brand-300')}>
            {match.team2}
          </span>
        </div>
        <p className="mt-1.5 text-xs text-slate-400">
          <span aria-hidden>📅</span> {formatMatchDateTime(match.playedAt)} · {match.tournamentName}
        </p>
      </Card>
    </Link>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add features/torneios/NextMatchCard.tsx
git commit -m "feat(torneios): NextMatchCard de apresentacao do proximo jogo"
```

---

## Task 8: Home do aluno — Próximo jogo + Meus Torneios

**Files:**
- Modify: `app/(dashboard)/home/page.tsx`

Adiciona imports, carrega `getStudentTournamentHome`, renderiza o `NextMatchCard` após o `CheckinProgressCard`, adiciona a seção "Meus Torneios" e filtra "Próximos Torneios" para não repetir torneios já inscritos. Também aumenta o limite da query de torneios de 3 para 6 (para sobrar itens após o filtro).

- [ ] **Step 1: Add imports**

Após a linha 17 (`import { CalendarPlus } from 'lucide-react'`), adicione:

```ts
import { getStudentTournamentHome } from '@/features/torneios/studentHome'
import { NextMatchCard } from '@/features/torneios/NextMatchCard'
```

- [ ] **Step 2: Bump the tournaments query limit**

No `Promise.all`, no bloco da query de `tournaments` (linhas 46-52), altere `.limit(3)` para `.limit(6)`:

```ts
    supabase
      .from('tournaments')
      .select('*')
      .eq('status', 'open')
      .eq('organization_id', orgId)
      .order('date', { ascending: true })
      .limit(6),
```

- [ ] **Step 3: Load the student tournament home data**

Logo após `const tournaments = (tournamentsData ?? []) as Tournament[]` (linha 85), adicione:

```ts
  const { myTournaments, myTournamentIds, nextMatch } = await getStudentTournamentHome({
    orgId,
    userId: user.id,
  })
```

- [ ] **Step 4: Render the NextMatchCard after CheckinProgressCard**

Logo após o bloco do `CheckinProgressCard` (que fecha na linha 307), adicione:

```tsx
      {nextMatch && <NextMatchCard match={nextMatch} />}
```

- [ ] **Step 5: Add "Meus Torneios" section and filter "Próximos Torneios"**

Substitua o bloco final de "Próximos Torneios" (linhas 418-439) por:

```tsx
      {myTournaments.length > 0 && (
        <section>
          <SectionHeader title="Meus Torneios" href="/torneios" />
          <div className="space-y-2">
            {myTournaments.map((t) => (
              <Link key={t.id} href={`/torneios/${t.id}`}>
                <Card accent className="hover:border-brand-600/50 transition-colors cursor-pointer">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white truncate">{t.name}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {formatDate(t.date, "dd 'de' MMMM")}
                      </p>
                    </div>
                    <Badge variant={t.status === 'in_progress' ? 'warning' : 'success'}>
                      {t.status === 'in_progress' ? 'Em andamento' : 'Inscrito'}
                    </Badge>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}

      {tournaments.filter((t) => !myTournamentIds.has(t.id)).length > 0 && (
        <section>
          <SectionHeader title="Próximos Torneios" href="/torneios" />
          <div className="space-y-2">
            {tournaments
              .filter((t) => !myTournamentIds.has(t.id))
              .slice(0, 3)
              .map((tournament) => (
                <Link key={tournament.id} href={`/torneios/${tournament.id}`}>
                  <Card className="hover:border-brand-600/50 transition-colors cursor-pointer">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-white truncate">{tournament.name}</p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {formatDate(tournament.date, "dd 'de' MMMM")}
                        </p>
                      </div>
                      <Badge variant="level">Nível {tournament.level.toUpperCase()}</Badge>
                    </div>
                  </Card>
                </Link>
              ))}
          </div>
        </section>
      )}
```

- [ ] **Step 6: Nota — variantes de Badge**

Nenhuma ação de código. Apenas confirme mentalmente que `Badge` aceita `variant="warning"` e `variant="success"` (ambos já usados em `MatchScoreCard.tsx`, linhas 198-199) — a checagem real acontece no `tsc` do próximo passo.

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 8: Commit**

```bash
git add "app/(dashboard)/home/page.tsx"
git commit -m "feat(torneios): home com Proximo jogo e Meus Torneios"
```

---

## Task 9: Verificação final

**Files:** nenhum (validação).

- [ ] **Step 1: Run the full test suite**

Run: `npm run test:run`
Expected: PASS — incluindo `lib/torneios/matchTime.test.ts` e `lib/torneios/nextMatch.test.ts`; nenhum teste existente quebrado.

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: build sem erros de tipo.

- [ ] **Step 3: Smoke manual (roteiro)**

Verifique manualmente (dev server ou produção após deploy):
1. Aluno inscrito em torneio ativo vê a seção "Meus Torneios" na home; o mesmo torneio **não** aparece em "Próximos Torneios".
2. Admin abre o confronto e marca data/hora → salvou; o card mostra "📅 …".
3. Aluno participante do confronto edita a data/hora → salvou (last-write-wins).
4. Aluno **não** participante não vê botão "Marcar data/hora".
5. Com um confronto agendado no futuro e não confirmado, a home mostra o card "Próximo jogo" com o horário correto (America/Sao_Paulo).
6. Confronto confirmado (resultado lançado) não aparece mais como "Próximo jogo".

- [ ] **Step 4: Final commit (se houver ajustes do smoke)**

```bash
git add -p
git commit -m "fix(torneios): ajustes do smoke de agendamento/home"
```

---

## Notas de escopo

- **Sem migration** e **sem alteração de RLS**: reaproveita `tournament_matches.played_at`. A autorização (admin OU participante) é feita em código via `createAdminClient()` na action `scheduleMatch`, sempre org-scopada por `organization_id`.
- **Fuso:** todo armazenamento é em UTC (`timestamptz`); a UI interpreta/exibe em America/Sao_Paulo com offset fixo -03:00.
- **Regra do "Próximo jogo":** confronto com `played_at` definido, `result_status !== 'confirmed'`, `played_at >= início de hoje (BRT)`, menor `played_at` primeiro.
