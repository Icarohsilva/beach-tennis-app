# Motor de Torneios — Fundação (Americano / Super N) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar o motor de torneios genérico multi-esporte na sua fundação: criar torneio configurável → inscrição com trava de gênero → gerar chave do Americano (Super N revezando) → lançar/confirmar placar → classificação individual ao vivo.

**Architecture:** Núcleo de **funções puras** em `lib/torneios/` (geração de chave, classificação, elegibilidade) plugadas num registro de formatos, com actions finas (`features/torneios/actions.ts`) e telas admin/aluno. Schema generalizado (sport/category/participant_type/format/placar) para os formatos futuros plugarem sem reescrever actions. Migrations aplicadas manualmente no SQL Editor pelo usuário.

**Tech Stack:** Next.js 14 App Router · TypeScript · Tailwind · Supabase (Postgres + RLS) · Vitest · Vercel

**Spec:** `docs/superpowers/specs/2026-06-26-motor-torneios-fundacao-design.md`

**Branch:** `develop`. Workflow por task: editar → `npm run build` (e `npm run test:run` quando houver teste) → commit dos arquivos específicos. Migrations NÃO são aplicadas pelo agente — o usuário aplica no SQL Editor. Não fazer merge para `main` sem autorização explícita.

---

## Convenções importantes deste repositório

- Nunca editar migrations antigas; criar novas com numeração `20260626xxxxxx_*`.
- Comentários e mensagens de commit em português. Mensagens de erro de action em pt-BR.
- Actions seguem o padrão: `getActiveOrgId()` + checagem de `role` na membership da org ativa + escopo por `organization_id`. Escritas via `createAdminClient()` (service role).
- RLS de tabela nova: `select using (organization_id in (select auth_org_ids()))`, escrita do dono `player_id = auth.uid()`, admin via `is_org_admin(organization_id)`.
- Nunca commitar `.env`/segredos. Stage arquivos específicos (nunca `git add -A`).

---

## Task 1: Migration — `profiles.gender`

**Files:**
- Create: `supabase/migrations/20260626000400_profiles_gender.sql`

- [ ] **Step 1: Criar a migration**

```sql
-- Gênero é identidade (não por-academia), então mora em profiles (slim pós-cutover).
-- Coletado no cadastro/criação de aluno, editável no /perfil. Alunos existentes
-- ficam null até preencher. Usado pela elegibilidade de torneios M/F.
alter table profiles add column if not exists gender text;

alter table profiles drop constraint if exists profiles_gender_check;
alter table profiles add constraint profiles_gender_check
  check (gender in ('M', 'F') or gender is null);
```

- [ ] **Step 2: Commit (migration é aplicada manualmente pelo usuário)**

```bash
git add supabase/migrations/20260626000400_profiles_gender.sql
git commit -m "feat(torneios): migration profiles.gender (identidade)"
```

---

## Task 2: Migration — generalizar `tournaments`

**Files:**
- Create: `supabase/migrations/20260626000500_tournaments_generalize.sql`

**Contexto:** Em `001_initial_schema.sql`, `tournaments.format` é enum `tournament_format` (default `'super8'`) e `tournaments.modality` é enum `tournament_modality` NOT NULL. Convertemos `format` para `text` (flexível p/ novos formatos sem mexer no enum, e permite backfill no mesmo txn), tornamos `modality` nullable (p/ `participant_type='individual'`) e adicionamos as colunas novas com backfill idempotente.

- [ ] **Step 1: Criar a migration**

```sql
-- format vira text: aceita americano|round_robin|eliminatoria|ranking sem mexer no enum,
-- e permite backfill super8->americano no mesmo txn (ADD VALUE de enum não pode ser
-- usado na mesma transação). modality vira nullable p/ suportar participant_type individual.
alter table tournaments alter column format type text using format::text;
alter table tournaments alter column format set default 'americano';
alter table tournaments alter column modality drop not null;

alter table tournaments add column if not exists sport text not null default 'beach_tennis';
alter table tournaments add column if not exists category text not null default 'livre';
alter table tournaments add column if not exists participant_type text not null default 'dupla_revezando';
alter table tournaments add column if not exists sets_to_win int not null default 1;
alter table tournaments add column if not exists games_per_set int not null default 6;
alter table tournaments add column if not exists tiebreak_games boolean not null default true;

-- Backfill idempotente dos torneios existentes (Hudson em prod).
update tournaments set format = 'americano' where format = 'super8';
update tournaments set participant_type = 'dupla_fixa' where modality = 'dupla_fixa';
update tournaments set participant_type = 'dupla_revezando' where modality = 'dupla_revezando';

-- Guardas de domínio.
alter table tournaments drop constraint if exists tournaments_category_check;
alter table tournaments add constraint tournaments_category_check
  check (category in ('masculino', 'feminino', 'misto', 'livre'));
alter table tournaments drop constraint if exists tournaments_participant_type_check;
alter table tournaments add constraint tournaments_participant_type_check
  check (participant_type in ('individual', 'dupla_fixa', 'dupla_revezando'));
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260626000500_tournaments_generalize.sql
git commit -m "feat(torneios): generalizar tournaments (sport/category/participant_type/placar)"
```

---

## Task 3: Migration — `tournament_entries` + RLS

**Files:**
- Create: `supabase/migrations/20260626000600_tournament_entries.sql`

**Contexto:** O código referenciava `tournament_registrations`, que **nunca foi criada** em prod. Criamos `tournament_entries` (nome cobre individual e dupla). A RLS órfã guardada por `to_regclass` de `tournament_registrations` permanece inofensiva.

- [ ] **Step 1: Criar a migration**

```sql
-- Uma linha por unidade inscrita (cobre individual e dupla). Substitui a
-- tournament_registrations referenciada pelo código mas nunca criada em prod.
create table if not exists tournament_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  tournament_id uuid not null references tournaments(id) on delete cascade,
  player_id uuid not null references profiles(id),
  partner_id uuid references profiles(id),
  seed int,
  created_at timestamptz not null default now(),
  unique (tournament_id, player_id)
);

create index if not exists tournament_entries_tournament_idx
  on tournament_entries(tournament_id);

alter table tournament_entries enable row level security;

-- Mesmo padrão das demais tabelas (memberships): leitura por org do usuário,
-- inscrição da própria pessoa, cancelamento da própria, admin faz tudo na org.
create policy "tentries_select_org" on tournament_entries
  for select using (organization_id in (select auth_org_ids()));
create policy "tentries_insert_own" on tournament_entries
  for insert with check (player_id = auth.uid() and organization_id in (select auth_org_ids()));
create policy "tentries_delete_own" on tournament_entries
  for delete using (player_id = auth.uid() and organization_id in (select auth_org_ids()));
create policy "tentries_admin_org" on tournament_entries
  for all using (is_org_admin(organization_id));
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260626000600_tournament_entries.sql
git commit -m "feat(torneios): criar tournament_entries + RLS org-scoped"
```

---

## Task 4: Migration — generalizar `tournament_matches`

**Files:**
- Create: `supabase/migrations/20260626000700_tournament_matches_result.sql`

**Contexto:** `tournament_matches` já tem `organization_id` (migration `20260616000100`). Adicionamos os campos de resultado por games + fluxo de confirmação. As escritas de placar são feitas via `createAdminClient()` (service role) após validação em código — não precisa de policy de UPDATE para aluno.

- [ ] **Step 1: Criar a migration**

```sql
-- Resultado por games + fluxo de confirmação. winner_id (existente) vira derivado/opcional.
alter table tournament_matches add column if not exists match_no int;
alter table tournament_matches add column if not exists result jsonb;
alter table tournament_matches add column if not exists games1 int;
alter table tournament_matches add column if not exists games2 int;
alter table tournament_matches add column if not exists result_status text;
alter table tournament_matches add column if not exists reported_by uuid references profiles(id);
alter table tournament_matches add column if not exists confirmed_by uuid references profiles(id);

alter table tournament_matches drop constraint if exists tmatches_result_status_check;
alter table tournament_matches add constraint tmatches_result_status_check
  check (result_status in ('pending', 'confirmed') or result_status is null);
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260626000700_tournament_matches_result.sql
git commit -m "feat(torneios): tournament_matches com resultado por games + confirmação"
```

---

## Task 5: Tipos em `types/index.ts`

**Files:**
- Modify: `types/index.ts`

- [ ] **Step 1: Adicionar/atualizar os tipos**

Localize a linha `export type TournamentFormat = 'super8'` e substitua por:

```ts
export type Gender = 'M' | 'F'
export type TournamentCategory = 'masculino' | 'feminino' | 'misto' | 'livre'
export type ParticipantType = 'individual' | 'dupla_fixa' | 'dupla_revezando'
// 'super8' mantido p/ leitura de linhas legadas; o motor novo usa 'americano'.
export type TournamentFormat =
  | 'americano'
  | 'round_robin'
  | 'eliminatoria'
  | 'ranking'
  | 'super8'

export interface ScoringConfig {
  sets_to_win: number
  games_per_set: number
  tiebreak_games: boolean
}

export interface StandingRow {
  playerId: string
  played: number
  wins: number
  gamesFor: number
  gamesAgainst: number
  diff: number
  points: number
}
```

No `interface Profile`, adicione após `phone: string | null`:

```ts
  gender: Gender | null
```

Substitua o bloco `export interface Tournament { ... }` por:

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
}

export interface TournamentEntry {
  id: string
  organization_id: string
  tournament_id: string
  player_id: string
  partner_id: string | null
  seed: number | null
  created_at: string
}
```

- [ ] **Step 2: Verificar build de tipos**

Run: `npm run build`
Expected: pode falhar em arquivos que ainda usam os campos antigos (corrigidos nas próximas tasks). Confirme que `types/index.ts` em si compila (sem erro de sintaxe). Se o build quebrar **apenas** em `features/torneios/*` e `app/**/torneios/**`, prossiga — essas telas são reescritas adiante.

- [ ] **Step 3: Commit**

```bash
git add types/index.ts
git commit -m "feat(torneios): tipos Gender/Category/ParticipantType/ScoringConfig/StandingRow/TournamentEntry"
```

---

## Task 6: Tipos do motor (`lib/torneios/types.ts`)

**Files:**
- Create: `lib/torneios/types.ts`

Tipos internos do motor (entrada/saída das funções puras). Reexporta `ScoringConfig`/`StandingRow` de `@/types` p/ uso conveniente nos módulos do motor.

- [ ] **Step 1: Criar o arquivo**

```ts
// lib/torneios/types.ts
// Tipos do núcleo puro de torneios. Não importam nada do banco.
import type { ScoringConfig, StandingRow } from '@/types'

export type { ScoringConfig, StandingRow }

// Uma partida planejada pelo gerador (ainda sem placar).
export interface MatchPlan {
  p1: string
  partner1: string | null
  p2: string
  partner2: string | null
}

export interface RoundPlan {
  round: number
  matches: MatchPlan[]
  resting: string[]
}

// Unidade inscrita (player individual; partner usado só em dupla fixa).
export interface EntryRef {
  playerId: string
  partnerId: string | null
}

// Partida com resultado, como entra na classificação.
export interface MatchResultInput {
  player1_id: string
  partner1_id: string | null
  player2_id: string
  partner2_id: string | null
  games1: number
  games2: number
  result_status: 'pending' | 'confirmed' | null
}

export interface FormatEngine {
  label: string
  generate(playerIds: string[]): RoundPlan[]
  computeStandings(
    entries: EntryRef[],
    matches: MatchResultInput[],
    config: ScoringConfig,
  ): StandingRow[]
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/torneios/types.ts
git commit -m "feat(torneios): tipos do núcleo puro do motor"
```

---

## Task 7: Elegibilidade (`lib/torneios/eligibility.ts`) — TDD

**Files:**
- Create: `lib/torneios/eligibility.ts`
- Test: `lib/torneios/eligibility.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// lib/torneios/eligibility.test.ts
import { describe, it, expect } from 'vitest'
import {
  canRegister,
  canReportResult,
  canConfirmResult,
  type EligibilityMatch,
} from './eligibility'

const match: EligibilityMatch = {
  player1_id: 'a',
  partner1_id: 'b',
  player2_id: 'c',
  partner2_id: 'd',
  reported_by: null,
}

describe('canRegister', () => {
  it('masculino: aceita M, barra F, pede perfil se null', () => {
    expect(canRegister('M', 'masculino').ok).toBe(true)
    expect(canRegister('F', 'masculino').ok).toBe(false)
    const semGenero = canRegister(null, 'masculino')
    expect(semGenero.ok).toBe(false)
    expect(semGenero.reason).toMatch(/perfil/i)
  })

  it('feminino: aceita F, barra M', () => {
    expect(canRegister('F', 'feminino').ok).toBe(true)
    expect(canRegister('M', 'feminino').ok).toBe(false)
  })

  it('misto e livre: aceitam qualquer gênero, inclusive null', () => {
    for (const cat of ['misto', 'livre'] as const) {
      expect(canRegister('M', cat).ok).toBe(true)
      expect(canRegister('F', cat).ok).toBe(true)
      expect(canRegister(null, cat).ok).toBe(true)
    }
  })
})

describe('canReportResult', () => {
  it('aceita qualquer um dos 4 jogadores', () => {
    for (const id of ['a', 'b', 'c', 'd']) {
      expect(canReportResult(id, match)).toBe(true)
    }
  })
  it('barra quem não está na partida', () => {
    expect(canReportResult('x', match)).toBe(false)
  })
})

describe('canConfirmResult', () => {
  it('admin sempre confirma', () => {
    expect(canConfirmResult('x', { ...match, reported_by: 'a' }, true)).toBe(true)
  })
  it('dupla adversária à de reported_by confirma', () => {
    const m = { ...match, reported_by: 'a' } // a/b reportaram
    expect(canConfirmResult('c', m, false)).toBe(true)
    expect(canConfirmResult('d', m, false)).toBe(true)
  })
  it('a própria dupla de reported_by não confirma', () => {
    const m = { ...match, reported_by: 'a' }
    expect(canConfirmResult('a', m, false)).toBe(false)
    expect(canConfirmResult('b', m, false)).toBe(false)
  })
  it('estranho não confirma; sem reported_by ninguém confirma (exceto admin)', () => {
    expect(canConfirmResult('x', { ...match, reported_by: 'a' }, false)).toBe(false)
    expect(canConfirmResult('c', { ...match, reported_by: null }, false)).toBe(false)
  })
})
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `npm run test:run -- lib/torneios/eligibility.test.ts`
Expected: FAIL ("Cannot find module './eligibility'").

- [ ] **Step 3: Implementar**

```ts
// lib/torneios/eligibility.ts
import type { Gender, TournamentCategory } from '@/types'

export interface EligibilityMatch {
  player1_id: string
  partner1_id: string | null
  player2_id: string
  partner2_id: string | null
  reported_by: string | null
}

export function canRegister(
  playerGender: Gender | null,
  category: TournamentCategory,
): { ok: boolean; reason?: string } {
  if (category === 'misto' || category === 'livre') return { ok: true }

  const required: Gender = category === 'masculino' ? 'M' : 'F'
  if (playerGender === null) {
    return {
      ok: false,
      reason: 'Complete seu gênero no perfil para se inscrever nesta categoria.',
    }
  }
  if (playerGender !== required) {
    return {
      ok: false,
      reason: `Este torneio é exclusivo para ${
        category === 'masculino' ? 'masculino' : 'feminino'
      }.`,
    }
  }
  return { ok: true }
}

function sideOf(userId: string, m: EligibilityMatch): 1 | 2 | null {
  if (userId === m.player1_id || userId === m.partner1_id) return 1
  if (userId === m.player2_id || userId === m.partner2_id) return 2
  return null
}

export function canReportResult(userId: string, m: EligibilityMatch): boolean {
  return sideOf(userId, m) !== null
}

export function canConfirmResult(
  userId: string,
  m: EligibilityMatch,
  isAdmin: boolean,
): boolean {
  if (isAdmin) return true
  if (!m.reported_by) return false
  const reporterSide = sideOf(m.reported_by, m)
  const userSide = sideOf(userId, m)
  if (reporterSide === null || userSide === null) return false
  // Só a dupla adversária à de quem reportou pode confirmar.
  return userSide !== reporterSide
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:run -- lib/torneios/eligibility.test.ts`
Expected: PASS (todos os testes verdes).

- [ ] **Step 5: Commit**

```bash
git add lib/torneios/eligibility.ts lib/torneios/eligibility.test.ts
git commit -m "feat(torneios): elegibilidade (gênero/categoria, reportar, confirmar) + testes"
```

---

## Task 8: Geração do Americano (`lib/torneios/schedule/americano.ts`) — TDD

**Files:**
- Create: `lib/torneios/schedule/americano.ts`
- Test: `lib/torneios/schedule/americano.test.ts`

**Algoritmo (determinístico):** método do círculo (round-robin) gera, p/ N par, N−1 rodadas onde cada par de jogadores se forma exatamente uma vez. Cada rodada vira `floor((N/2)/2)` partidas de 2 contra 2. Quando há sobra (N não múltiplo de 4), **uma dupla descansa por rodada**, escolhida gulosamente pela maior carga de jogos acumulada → mantém jogos e byes balanceados em ±1. Apenas N **par** de 4 a 16; caso contrário, erro claro. Recebe IDs já embaralhados (shuffle fica na action) → puro e testável.

- [ ] **Step 1: Escrever o teste que falha**

```ts
// lib/torneios/schedule/americano.test.ts
import { describe, it, expect } from 'vitest'
import { generateAmericanoSchedule } from './americano'

function ids(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `p${i}`)
}

const SIZES = [4, 6, 8, 10, 12, 16]

describe('generateAmericanoSchedule — invariantes por tamanho', () => {
  for (const n of SIZES) {
    it(`N=${n}: estrutura válida, jogos e byes balanceados (±1), parceria <=1`, () => {
      const plan = generateAmericanoSchedule(ids(n))
      expect(plan.length).toBe(n - 1)

      const playCount = new Map<string, number>()
      const byeCount = new Map<string, number>()
      const partnerSeen = new Map<string, number>()

      for (const round of plan) {
        // Ninguém aparece duas vezes na mesma rodada.
        const seen = new Set<string>()
        for (const m of round.matches) {
          for (const id of [m.p1, m.partner1, m.p2, m.partner2]) {
            if (id === null) continue
            expect(seen.has(id)).toBe(false)
            seen.add(id)
          }
          for (const [x, y] of [
            [m.p1, m.partner1],
            [m.p2, m.partner2],
          ] as const) {
            if (x && y) {
              const key = [x, y].sort().join('|')
              partnerSeen.set(key, (partnerSeen.get(key) ?? 0) + 1)
            }
          }
          for (const id of [m.p1, m.partner1, m.p2, m.partner2]) {
            if (id) playCount.set(id, (playCount.get(id) ?? 0) + 1)
          }
        }
        for (const id of round.resting) {
          expect(seen.has(id)).toBe(false)
          byeCount.set(id, (byeCount.get(id) ?? 0) + 1)
        }
      }

      // Todos jogaram ao menos uma vez.
      expect(playCount.size).toBe(n)
      const plays = [...playCount.values()]
      expect(Math.max(...plays) - Math.min(...plays)).toBeLessThanOrEqual(1)

      // Byes balanceados (quando há byes).
      const byes = SIZES.includes(n) ? [...byeCount.values()] : []
      if (byes.length > 0) {
        expect(Math.max(...byes) - Math.min(...byes)).toBeLessThanOrEqual(1)
      }

      // Nenhuma parceria se repete (método do círculo dá cada par no máx 1x).
      for (const c of partnerSeen.values()) expect(c).toBeLessThanOrEqual(1)
    })
  }
})

describe('generateAmericanoSchedule — N=8 caso ideal', () => {
  it('7 rodadas, 2 partidas/rodada, ninguém descansa, todos parceiros 1x', () => {
    const plan = generateAmericanoSchedule(ids(8))
    expect(plan.length).toBe(7)
    for (const r of plan) {
      expect(r.matches.length).toBe(2)
      expect(r.resting.length).toBe(0)
    }
  })
})

describe('generateAmericanoSchedule — tamanhos inválidos', () => {
  it('rejeita ímpar, <4 e >16', () => {
    expect(() => generateAmericanoSchedule(ids(5))).toThrow()
    expect(() => generateAmericanoSchedule(ids(2))).toThrow()
    expect(() => generateAmericanoSchedule(ids(18))).toThrow()
  })
})
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `npm run test:run -- lib/torneios/schedule/americano.test.ts`
Expected: FAIL ("Cannot find module './americano'").

- [ ] **Step 3: Implementar**

```ts
// lib/torneios/schedule/americano.ts
import type { RoundPlan, MatchPlan } from '../types'

// Método do círculo: p/ m par, m-1 rodadas; cada par não-ordenado se forma 1x.
// Retorna rodadas de pares de ÍNDICES (0..m-1).
function circleRounds(m: number): [number, number][][] {
  const fixed = 0
  const rot = Array.from({ length: m - 1 }, (_, i) => i + 1)
  const rounds: [number, number][][] = []
  for (let r = 0; r < m - 1; r++) {
    const arr = [fixed, ...rot]
    const pairs: [number, number][] = []
    for (let i = 0; i < m / 2; i++) {
      pairs.push([arr[i], arr[m - 1 - i]])
    }
    rounds.push(pairs)
    // Rotaciona rot uma posição (circle method).
    rot.unshift(rot.pop() as number)
  }
  return rounds
}

export function generateAmericanoSchedule(playerIds: string[]): RoundPlan[] {
  const n = playerIds.length
  if (n < 4 || n > 16 || n % 2 !== 0) {
    throw new Error('Americano aceita apenas um número par de 4 a 16 jogadores.')
  }

  const rounds = circleRounds(n)
  const playCount = new Array<number>(n).fill(0)
  const plan: RoundPlan[] = []

  rounds.forEach((pairs, r) => {
    let usable = pairs
    const resting: string[] = []

    // Sobra uma dupla quando o nº de pares é ímpar (N não múltiplo de 4).
    if (pairs.length % 2 === 1) {
      // Descansa a dupla de maior carga acumulada (mantém jogos balanceados ±1).
      let restIdx = 0
      let worst = -1
      pairs.forEach((pr, i) => {
        const load = playCount[pr[0]] + playCount[pr[1]]
        if (load > worst) {
          worst = load
          restIdx = i
        }
      })
      const rp = pairs[restIdx]
      resting.push(playerIds[rp[0]], playerIds[rp[1]])
      usable = pairs.filter((_, i) => i !== restIdx)
    }

    const matches: MatchPlan[] = []
    for (let c = 0; c + 1 < usable.length; c += 2) {
      const a = usable[c]
      const b = usable[c + 1]
      matches.push({
        p1: playerIds[a[0]],
        partner1: playerIds[a[1]],
        p2: playerIds[b[0]],
        partner2: playerIds[b[1]],
      })
      playCount[a[0]]++
      playCount[a[1]]++
      playCount[b[0]]++
      playCount[b[1]]++
    }

    plan.push({ round: r + 1, matches, resting })
  })

  return plan
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:run -- lib/torneios/schedule/americano.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/torneios/schedule/americano.ts lib/torneios/schedule/americano.test.ts
git commit -m "feat(torneios): geração do Americano (método do círculo + rest guloso) + testes"
```

---

## Task 9: Classificação (`lib/torneios/standings.ts`) — TDD

**Files:**
- Create: `lib/torneios/standings.ts`
- Test: `lib/torneios/standings.test.ts`

**Regras:** agrega por **jogador individual** (no Americano cada um soma os games das duplas que formou). Conta **só** `result_status='confirmed'`. Ordena por: (1) saldo `diff` desc, (2) games a favor desc, (3) vitórias desc, (4) `playerId` asc (estável). `points = wins`.

- [ ] **Step 1: Escrever o teste que falha**

```ts
// lib/torneios/standings.test.ts
import { describe, it, expect } from 'vitest'
import { computeStandings } from './standings'
import type { EntryRef, MatchResultInput, ScoringConfig } from './types'

const config: ScoringConfig = { sets_to_win: 1, games_per_set: 6, tiebreak_games: true }
const entries: EntryRef[] = [
  { playerId: 'a', partnerId: null },
  { playerId: 'b', partnerId: null },
  { playerId: 'c', partnerId: null },
  { playerId: 'd', partnerId: null },
]

function match(p1: string, pa1: string, p2: string, pa2: string, g1: number, g2: number, status: MatchResultInput['result_status']): MatchResultInput {
  return { player1_id: p1, partner1_id: pa1, player2_id: p2, partner2_id: pa2, games1: g1, games2: g2, result_status: status }
}

describe('computeStandings', () => {
  it('agrega games por jogador e ignora pending/sem resultado', () => {
    const matches = [
      match('a', 'b', 'c', 'd', 6, 4, 'confirmed'), // a,b +6/-4 ; c,d +4/-6
      match('a', 'c', 'b', 'd', 6, 2, 'pending'), // ignorada
      match('a', 'd', 'b', 'c', 3, 3, null), // ignorada
    ]
    const rows = computeStandings(entries, matches, config)
    const a = rows.find((r) => r.playerId === 'a')!
    expect(a.played).toBe(1)
    expect(a.gamesFor).toBe(6)
    expect(a.gamesAgainst).toBe(4)
    expect(a.diff).toBe(2)
    expect(a.wins).toBe(1)
    const c = rows.find((r) => r.playerId === 'c')!
    expect(c.diff).toBe(-2)
    expect(c.wins).toBe(0)
  })

  it('ordena por saldo, depois games a favor, depois vitórias', () => {
    const matches = [
      match('a', 'b', 'c', 'd', 6, 0, 'confirmed'),
      match('c', 'a', 'b', 'd', 6, 5, 'confirmed'),
    ]
    const rows = computeStandings(entries, matches, config)
    // a: +12/-5 = +7 ; c: +6/-6=0... calcula e confirma topo é 'a'
    expect(rows[0].playerId).toBe('a')
    expect(rows[0].diff).toBeGreaterThanOrEqual(rows[1].diff)
  })

  it('inclui todos os inscritos mesmo sem jogos', () => {
    const rows = computeStandings(entries, [], config)
    expect(rows.length).toBe(4)
    expect(rows.every((r) => r.played === 0)).toBe(true)
  })
})
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `npm run test:run -- lib/torneios/standings.test.ts`
Expected: FAIL ("Cannot find module './standings'").

- [ ] **Step 3: Implementar**

```ts
// lib/torneios/standings.ts
import type {
  EntryRef,
  MatchResultInput,
  ScoringConfig,
  StandingRow,
} from './types'

export function computeStandings(
  entries: EntryRef[],
  matches: MatchResultInput[],
  _config: ScoringConfig,
): StandingRow[] {
  const rows = new Map<string, StandingRow>()
  const ensure = (id: string): StandingRow => {
    let row = rows.get(id)
    if (!row) {
      row = { playerId: id, played: 0, wins: 0, gamesFor: 0, gamesAgainst: 0, diff: 0, points: 0 }
      rows.set(id, row)
    }
    return row
  }

  // Garante uma linha por jogador inscrito (inclui partner em dupla fixa).
  for (const e of entries) {
    ensure(e.playerId)
    if (e.partnerId) ensure(e.partnerId)
  }

  for (const m of matches) {
    if (m.result_status !== 'confirmed') continue
    const side1 = [m.player1_id, m.partner1_id].filter((x): x is string => !!x)
    const side2 = [m.player2_id, m.partner2_id].filter((x): x is string => !!x)
    const s1won = m.games1 > m.games2
    const s2won = m.games2 > m.games1

    for (const id of side1) {
      const row = ensure(id)
      row.played++
      row.gamesFor += m.games1
      row.gamesAgainst += m.games2
      if (s1won) row.wins++
    }
    for (const id of side2) {
      const row = ensure(id)
      row.played++
      row.gamesFor += m.games2
      row.gamesAgainst += m.games1
      if (s2won) row.wins++
    }
  }

  const list = [...rows.values()]
  for (const r of list) {
    r.diff = r.gamesFor - r.gamesAgainst
    r.points = r.wins
  }

  list.sort(
    (a, b) =>
      b.diff - a.diff ||
      b.gamesFor - a.gamesFor ||
      b.wins - a.wins ||
      a.playerId.localeCompare(b.playerId),
  )
  return list
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:run -- lib/torneios/standings.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/torneios/standings.ts lib/torneios/standings.test.ts
git commit -m "feat(torneios): classificação individual (saldo de games, só confirmados) + testes"
```

---

## Task 10: Registro de formatos (`lib/torneios/formats.ts`) — TDD

**Files:**
- Create: `lib/torneios/formats.ts`
- Test: `lib/torneios/formats.test.ts`

As actions chamam o motor pelo registro `FORMATS[format]`, nunca por `if/else`. Na Fundação só `americano` é registrado.

- [ ] **Step 1: Escrever o teste que falha**

```ts
// lib/torneios/formats.test.ts
import { describe, it, expect } from 'vitest'
import { FORMATS } from './formats'

describe('FORMATS', () => {
  it('registra americano com generate e computeStandings', () => {
    const eng = FORMATS['americano']
    expect(eng).toBeDefined()
    expect(typeof eng.generate).toBe('function')
    expect(typeof eng.computeStandings).toBe('function')
    expect(eng.label).toMatch(/americano/i)
  })

  it('americano.generate produz rodadas', () => {
    const plan = FORMATS['americano'].generate(['a', 'b', 'c', 'd'])
    expect(plan.length).toBe(3)
  })

  it('formato desconhecido é undefined', () => {
    expect(FORMATS['inexistente']).toBeUndefined()
  })
})
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `npm run test:run -- lib/torneios/formats.test.ts`
Expected: FAIL ("Cannot find module './formats'").

- [ ] **Step 3: Implementar**

```ts
// lib/torneios/formats.ts
import type { FormatEngine } from './types'
import { generateAmericanoSchedule } from './schedule/americano'
import { computeStandings } from './standings'

// Mapa format -> motor. Formatos futuros (round_robin, eliminatoria, ranking)
// entram aqui sem tocar nas actions.
export const FORMATS: Record<string, FormatEngine> = {
  americano: {
    label: 'Americano (Super N)',
    generate: generateAmericanoSchedule,
    computeStandings,
  },
}
```

- [ ] **Step 4: Rodar e ver passar (suite inteira do motor)**

Run: `npm run test:run -- lib/torneios`
Expected: PASS em eligibility, americano, standings e formats.

- [ ] **Step 5: Commit**

```bash
git add lib/torneios/formats.ts lib/torneios/formats.test.ts
git commit -m "feat(torneios): registro de formatos (americano) + teste"
```

---

## Task 11: Actions — `createTournament` + `registerForTournament` generalizados

**Files:**
- Modify: `features/torneios/actions.ts`

**Contexto:** As actions atuais usam `tournament_registrations` e a assinatura antiga de `createTournament`. Generalizamos para o schema novo (`tournament_entries`, sport/category/participant_type/placar, trava de gênero).

- [ ] **Step 1: Atualizar imports e `createTournament`**

No topo, substitua o import de tipos por:

```ts
import { createClient, createAdminClient, getActiveOrgId, getActiveMembership } from '@/lib/supabase/server'
import { canStudentAttendLevel } from '@/lib/utils/levelAccess'
import { canRegister } from '@/lib/torneios/eligibility'
import type {
  StudentLevel,
  TournamentStatus,
  TournamentFormat,
  TournamentCategory,
  ParticipantType,
  TournamentModality,
  Gender,
  ScoringConfig,
} from '@/types'
```

Substitua a função `createTournament` inteira por:

```ts
function modalityFromParticipant(pt: ParticipantType): TournamentModality | null {
  if (pt === 'dupla_fixa') return 'dupla_fixa'
  if (pt === 'dupla_revezando') return 'dupla_revezando'
  return null // individual
}

export async function createTournament(input: {
  name: string
  date: string
  sport: string
  category: TournamentCategory
  participant_type: ParticipantType
  format: TournamentFormat
  level: StudentLevel
  scoring: ScoringConfig
}): Promise<{ error?: string; id?: string }> {
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

  const { data, error } = await adminClient
    .from('tournaments')
    .insert({
      organization_id: orgId,
      name: input.name,
      date: input.date,
      sport: input.sport,
      category: input.category,
      participant_type: input.participant_type,
      modality: modalityFromParticipant(input.participant_type),
      format: input.format,
      level: input.level,
      sets_to_win: input.scoring.sets_to_win,
      games_per_set: input.scoring.games_per_set,
      tiebreak_games: input.scoring.tiebreak_games,
      status: 'draft' as TournamentStatus,
      created_by: user.id,
    })
    .select('id')
    .single()

  if (error || !data) return { error: 'Erro ao criar torneio. Tente novamente.' }
  return { id: data.id }
}
```

- [ ] **Step 2: Substituir `registerForTournament`**

```ts
export async function registerForTournament(
  tournamentId: string,
  partnerId?: string,
): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const adminClient = createAdminClient()
  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  const { data: tournament, error: tErr } = await adminClient
    .from('tournaments')
    .select('id, status, level, category, participant_type')
    .eq('id', tournamentId)
    .eq('organization_id', orgId)
    .single()
  if (tErr || !tournament) return { error: 'Torneio não encontrado.' }
  if (tournament.status !== 'open') {
    return { error: 'Inscrições encerradas para este torneio.' }
  }

  const membership = await getActiveMembership()
  if (!membership) return { error: 'Perfil não encontrado.' }

  if (!canStudentAttendLevel(membership.level as StudentLevel, tournament.level as StudentLevel)) {
    return {
      error: `Seu nível (${membership.level}) não permite participar deste torneio (${tournament.level}).`,
    }
  }

  // Gênero é identidade → vem de profiles.
  const { data: profile } = await adminClient
    .from('profiles')
    .select('gender')
    .eq('id', user.id)
    .single()
  const myGender = (profile?.gender ?? null) as Gender | null

  const elig = canRegister(myGender, tournament.category as TournamentCategory)
  if (!elig.ok) return { error: elig.reason ?? 'Inscrição não permitida nesta categoria.' }

  // Duplicidade.
  const { count: dupCount } = await adminClient
    .from('tournament_entries')
    .select('id', { count: 'exact', head: true })
    .eq('tournament_id', tournamentId)
    .eq('player_id', user.id)
  if ((dupCount ?? 0) > 0) return { error: 'Você já está inscrito neste torneio.' }

  // Dupla fixa exige parceiro; em misto valida 1 M + 1 F.
  let partner: string | null = null
  if (tournament.participant_type === 'dupla_fixa') {
    if (!partnerId) return { error: 'Selecione um parceiro para dupla fixa.' }
    partner = partnerId
    if (tournament.category === 'misto') {
      const { data: partnerProfile } = await adminClient
        .from('profiles')
        .select('gender')
        .eq('id', partnerId)
        .single()
      const partnerGender = (partnerProfile?.gender ?? null) as Gender | null
      const oneEach =
        (myGender === 'M' && partnerGender === 'F') ||
        (myGender === 'F' && partnerGender === 'M')
      if (!oneEach) {
        return { error: 'Categoria mista exige uma dupla com 1 homem e 1 mulher.' }
      }
    }
  }

  const { error: insertErr } = await adminClient
    .from('tournament_entries')
    .insert({
      organization_id: orgId,
      tournament_id: tournamentId,
      player_id: user.id,
      partner_id: partner,
    })
  if (insertErr) return { error: 'Erro ao realizar inscrição. Tente novamente.' }
  return {}
}
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: pode quebrar em `recordMatchResult` (assinatura antiga) e telas — corrigidos nas Tasks 12-13 e 16-18. Confirme que `actions.ts` não tem erro nas funções desta task.

- [ ] **Step 4: Commit**

```bash
git add features/torneios/actions.ts
git commit -m "feat(torneios): createTournament/registerForTournament no schema novo (entries + gênero)"
```

---

## Task 12: Action — `generateBracket`

**Files:**
- Modify: `features/torneios/actions.ts`

- [ ] **Step 1: Adicionar imports e a função `generateBracket`**

Adicione ao import do motor:

```ts
import { FORMATS } from '@/lib/torneios/formats'
```

Adicione a função (após `registerForTournament`):

```ts
// Embaralha sem mutar o original (Fisher-Yates).
function shuffle<T>(arr: T[]): T[] {
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

export async function generateBracket(
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
    .select('id, status, format')
    .eq('id', tournamentId)
    .eq('organization_id', orgId)
    .single()
  if (tErr || !tournament) return { error: 'Torneio não encontrado.' }
  if (tournament.status === 'draft') {
    return { error: 'Abra as inscrições antes de gerar a chave.' }
  }
  if (tournament.status === 'finished') {
    return { error: 'Torneio encerrado.' }
  }

  const engine = FORMATS[tournament.format]
  if (!engine) return { error: 'Formato ainda não suportado para geração de chave.' }

  const { data: entriesRaw } = await adminClient
    .from('tournament_entries')
    .select('player_id')
    .eq('tournament_id', tournamentId)
    .eq('organization_id', orgId)
  const playerIds = (entriesRaw ?? []).map((e) => e.player_id as string)

  let plan
  try {
    plan = engine.generate(shuffle(playerIds))
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erro ao gerar a chave.' }
  }

  // Regenerar limpa a chave anterior (idempotente): delete + insert.
  await adminClient.from('tournament_matches').delete().eq('tournament_id', tournamentId)

  const rows = plan.flatMap((rp) =>
    rp.matches.map((m, i) => ({
      organization_id: orgId,
      tournament_id: tournamentId,
      round: rp.round,
      match_no: i + 1,
      player1_id: m.p1,
      partner1_id: m.partner1,
      player2_id: m.p2,
      partner2_id: m.partner2,
    })),
  )

  if (rows.length > 0) {
    const { error: insErr } = await adminClient.from('tournament_matches').insert(rows)
    if (insErr) return { error: 'Erro ao salvar a chave. Tente novamente.' }
  }

  // Gerar a chave coloca o torneio em andamento.
  if (tournament.status === 'open') {
    await adminClient
      .from('tournaments')
      .update({ status: 'in_progress' })
      .eq('id', tournamentId)
  }

  return {}
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: sem novos erros nesta função (telas ainda pendentes).

- [ ] **Step 3: Commit**

```bash
git add features/torneios/actions.ts
git commit -m "feat(torneios): generateBracket (embaralha, gera via registro, idempotente)"
```

---

## Task 13: Actions — reportar / confirmar / lançar (admin) / cancelar

**Files:**
- Modify: `features/torneios/actions.ts`

- [ ] **Step 1: Adicionar import de elegibilidade do match**

```ts
import { canReportResult, canConfirmResult, type EligibilityMatch } from '@/lib/torneios/eligibility'
```

(Junte com o import já existente de `canRegister` no mesmo `from '@/lib/torneios/eligibility'`.)

- [ ] **Step 2: Substituir `recordMatchResult` (admin) pela versão por games**

```ts
// Admin lança/corrige direto, já confirmado.
export async function recordMatchResult(
  matchId: string,
  games1: number,
  games2: number,
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

  if (!Number.isInteger(games1) || !Number.isInteger(games2) || games1 < 0 || games2 < 0) {
    return { error: 'Placar inválido.' }
  }

  const { error: updErr } = await adminClient
    .from('tournament_matches')
    .update({
      games1,
      games2,
      result: { games1, games2 },
      result_status: 'confirmed',
      reported_by: user.id,
      confirmed_by: user.id,
      winner_id: null,
    })
    .eq('id', matchId)
    .eq('organization_id', orgId)
  if (updErr) return { error: 'Erro ao salvar resultado. Tente novamente.' }
  return {}
}
```

- [ ] **Step 3: Adicionar `reportMatchResult` (jogador) e `confirmMatchResult`**

```ts
// Qualquer um dos 4 jogadores lança o placar -> fica pendente de confirmação.
export async function reportMatchResult(
  matchId: string,
  games1: number,
  games2: number,
): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const adminClient = createAdminClient()
  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  if (!Number.isInteger(games1) || !Number.isInteger(games2) || games1 < 0 || games2 < 0) {
    return { error: 'Placar inválido.' }
  }

  const { data: match, error: mErr } = await adminClient
    .from('tournament_matches')
    .select('id, player1_id, partner1_id, player2_id, partner2_id, reported_by')
    .eq('id', matchId)
    .eq('organization_id', orgId)
    .single()
  if (mErr || !match) return { error: 'Confronto não encontrado.' }

  if (!canReportResult(user.id, match as EligibilityMatch)) {
    return { error: 'Você não participa deste confronto.' }
  }

  const { error: updErr } = await adminClient
    .from('tournament_matches')
    .update({
      games1,
      games2,
      result: { games1, games2 },
      result_status: 'pending',
      reported_by: user.id,
      confirmed_by: null,
    })
    .eq('id', matchId)
  if (updErr) return { error: 'Erro ao lançar placar. Tente novamente.' }
  return {}
}

// Dupla adversária à de reported_by (ou admin) confirma.
export async function confirmMatchResult(
  matchId: string,
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
  const isAdmin = membership?.role === 'admin'

  const { data: match, error: mErr } = await adminClient
    .from('tournament_matches')
    .select('id, player1_id, partner1_id, player2_id, partner2_id, reported_by, result_status')
    .eq('id', matchId)
    .eq('organization_id', orgId)
    .single()
  if (mErr || !match) return { error: 'Confronto não encontrado.' }
  if (match.result_status !== 'pending') {
    return { error: 'Não há placar pendente de confirmação.' }
  }

  if (!canConfirmResult(user.id, match as EligibilityMatch, isAdmin)) {
    return { error: 'Só a dupla adversária ou o admin podem confirmar este placar.' }
  }

  const { error: updErr } = await adminClient
    .from('tournament_matches')
    .update({ result_status: 'confirmed', confirmed_by: user.id })
    .eq('id', matchId)
  if (updErr) return { error: 'Erro ao confirmar placar. Tente novamente.' }
  return {}
}
```

- [ ] **Step 4: Adicionar `removeEntry` (cancelar inscrição)**

```ts
// Aluno cancela a própria inscrição enquanto 'open'; admin remove qualquer um.
export async function removeEntry(
  tournamentId: string,
  playerId?: string,
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
  const isAdmin = membership?.role === 'admin'

  const target = isAdmin && playerId ? playerId : user.id

  const { data: tournament } = await adminClient
    .from('tournaments')
    .select('status')
    .eq('id', tournamentId)
    .eq('organization_id', orgId)
    .single()
  if (!tournament) return { error: 'Torneio não encontrado.' }
  if (!isAdmin && tournament.status !== 'open') {
    return { error: 'Só é possível cancelar a inscrição com inscrições abertas.' }
  }

  const { error: delErr } = await adminClient
    .from('tournament_entries')
    .delete()
    .eq('tournament_id', tournamentId)
    .eq('player_id', target)
    .eq('organization_id', orgId)
  if (delErr) return { error: 'Erro ao cancelar inscrição. Tente novamente.' }
  return {}
}
```

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: erros restantes só nas telas/`MatchResult.tsx` (assinatura antiga de `recordMatchResult`) — corrigidos nas Tasks 16-18.

- [ ] **Step 6: Commit**

```bash
git add features/torneios/actions.ts
git commit -m "feat(torneios): reportar/confirmar placar + recordMatchResult por games + removeEntry"
```

---

## Task 14: Coleta de gênero (perfil self-service + createStudent)

**Files:**
- Modify: `features/organizations/actions.ts` (action `createStudent` + uma nova `selfSetGender`)
- Create: `features/perfil/GenderForm.tsx`
- Modify: `app/(dashboard)/perfil/page.tsx`

**Contexto:** `gender` é identidade (em `profiles`). Alunos existentes preenchem no `/perfil`; admin pode setar ao criar aluno. O perfil da pessoa é criado pelo trigger `handle_new_user`; o `gender` não vai no metadata, então gravamos via `update` após a criação.

- [ ] **Step 1: `selfSetGender` em `features/organizations/actions.ts`**

Adicione ao final do arquivo:

```ts
// Aluno define o próprio gênero (identidade em profiles).
export async function selfSetGender(
  gender: 'M' | 'F' | null,
): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }
  if (gender !== 'M' && gender !== 'F' && gender !== null) {
    return { error: 'Gênero inválido.' }
  }
  const admin = createAdminClient()
  const { error } = await admin.from('profiles').update({ gender }).eq('id', user.id)
  if (error) return { error: 'Erro ao salvar gênero. Tente novamente.' }
  revalidatePath('/perfil')
  return {}
}
```

(Confirme que `createClient`, `createAdminClient` e `revalidatePath` já estão importados no arquivo — estão, pois `createStudent` os usa.)

- [ ] **Step 2: `createStudent` grava gênero**

No arquivo `features/organizations/actions.ts`, localize a definição de `CreateStudentInput` e adicione o campo opcional `gender?: 'M' | 'F'`. Depois, em `createStudent`, após o bloco `if (input.partner) { ... }` e antes de `revalidatePath('/admin/alunos')`, adicione:

```ts
  // Gênero (identidade) — opcional na criação.
  if (input.gender === 'M' || input.gender === 'F') {
    await admin.from('profiles').update({ gender: input.gender }).eq('id', created.user.id)
  }
```

- [ ] **Step 3: Componente `features/perfil/GenderForm.tsx`**

```tsx
'use client'
// features/perfil/GenderForm.tsx
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { selfSetGender } from '@/features/organizations/actions'

interface GenderFormProps {
  current: 'M' | 'F' | null
}

export function GenderForm({ current }: GenderFormProps) {
  const [value, setValue] = useState<'M' | 'F' | ''>(current ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handleSave() {
    setError(null)
    setSaved(false)
    startTransition(async () => {
      const res = await selfSetGender(value === '' ? null : value)
      if (res.error) setError(res.error)
      else {
        setSaved(true)
        router.refresh()
      }
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {(['M', 'F'] as const).map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => setValue(g)}
            className={`flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ${
              value === g
                ? 'border-brand-500 bg-brand-600/20 text-white'
                : 'border-surface-border text-slate-400 hover:text-white'
            }`}
          >
            {g === 'M' ? 'Masculino' : 'Feminino'}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <Button size="sm" loading={isPending} onClick={handleSave}>
          Salvar
        </Button>
        {saved && <span className="text-xs text-green-400">Salvo!</span>}
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Renderizar no perfil**

Em `app/(dashboard)/perfil/page.tsx`:

1. No `select` da identidade (linha ~24-28), troque `.select('full_name')` por `.select('full_name, gender')`.
2. Adicione `import { GenderForm } from '@/features/perfil/GenderForm'` junto aos demais imports.
3. Antes da seção "Ficha Médica", adicione:

```tsx
      {/* Gênero (identidade) — usado em torneios por categoria */}
      <section>
        <SectionHeader title="Gênero" />
        <div className="bg-surface-card border border-surface-border rounded-xl p-4">
          <p className="text-xs text-slate-500 mb-4">
            Usado para inscrição em torneios das categorias masculino/feminino/misto.
          </p>
          <GenderForm current={(identity?.gender ?? null) as 'M' | 'F' | null} />
        </div>
      </section>
```

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: sem erro nestes arquivos.

- [ ] **Step 6: Commit**

```bash
git add features/organizations/actions.ts features/perfil/GenderForm.tsx "app/(dashboard)/perfil/page.tsx"
git commit -m "feat(torneios): coleta de gênero (perfil self-service + createStudent)"
```

---

## Task 15: Componente de Classificação (`features/torneios/StandingsTable.tsx`)

**Files:**
- Create: `features/torneios/StandingsTable.tsx`

Recebe `StandingRow[]` já computadas no servidor + mapa de nomes; só renderiza.

- [ ] **Step 1: Criar o componente**

```tsx
// features/torneios/StandingsTable.tsx
import type { StandingRow } from '@/types'

interface StandingsTableProps {
  rows: StandingRow[]
  nameById: Record<string, string>
}

export function StandingsTable({ rows, nameById }: StandingsTableProps) {
  if (rows.length === 0) {
    return <p className="text-slate-400 text-sm">Sem classificação ainda.</p>
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-surface-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-surface-card text-slate-400 text-xs uppercase tracking-wide">
            <th className="px-3 py-2 text-left">#</th>
            <th className="px-3 py-2 text-left">Jogador</th>
            <th className="px-3 py-2 text-center">J</th>
            <th className="px-3 py-2 text-center">V</th>
            <th className="px-3 py-2 text-center">Games</th>
            <th className="px-3 py-2 text-center">Saldo</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.playerId} className="border-t border-surface-border">
              <td className="px-3 py-2 text-slate-400">{i + 1}</td>
              <td className="px-3 py-2 text-white">{nameById[r.playerId] ?? r.playerId}</td>
              <td className="px-3 py-2 text-center text-slate-300">{r.played}</td>
              <td className="px-3 py-2 text-center text-slate-300">{r.wins}</td>
              <td className="px-3 py-2 text-center text-slate-400">
                {r.gamesFor}/{r.gamesAgainst}
              </td>
              <td
                className={`px-3 py-2 text-center font-semibold ${
                  r.diff > 0 ? 'text-green-400' : r.diff < 0 ? 'text-red-400' : 'text-slate-300'
                }`}
              >
                {r.diff > 0 ? `+${r.diff}` : r.diff}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 2: Build + commit**

Run: `npm run build`
Expected: sem erro.

```bash
git add features/torneios/StandingsTable.tsx
git commit -m "feat(torneios): StandingsTable (classificação individual)"
```

---

## Task 16: Form de criação de torneio (`CreateTournamentForm.tsx`)

**Files:**
- Modify: `app/(admin)/admin/torneios/CreateTournamentForm.tsx`

Adiciona esporte, categoria, tipo de participante, formato (só Americano habilitado) e config de placar.

- [ ] **Step 1: Reescrever o form**

```tsx
'use client'
// app/(admin)/torneios/CreateTournamentForm.tsx
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { createTournament } from '@/features/torneios/actions'
import { SPORTS } from '@/lib/arenas/sports'
import type {
  StudentLevel,
  TournamentCategory,
  ParticipantType,
  TournamentFormat,
} from '@/types'

const LEVEL_OPTIONS: StudentLevel[] = ['iniciante', 'D', 'C', 'B', 'A']
const CATEGORY_OPTIONS: { value: TournamentCategory; label: string }[] = [
  { value: 'livre', label: 'Livre' },
  { value: 'masculino', label: 'Masculino' },
  { value: 'feminino', label: 'Feminino' },
  { value: 'misto', label: 'Misto' },
]
const PARTICIPANT_OPTIONS: { value: ParticipantType; label: string }[] = [
  { value: 'dupla_revezando', label: 'Dupla Revezando (Americano)' },
  { value: 'dupla_fixa', label: 'Dupla Fixa' },
  { value: 'individual', label: 'Individual' },
]
const FORMAT_OPTIONS: { value: TournamentFormat; label: string; enabled: boolean }[] = [
  { value: 'americano', label: 'Americano (Super N)', enabled: true },
  { value: 'round_robin', label: 'Round-robin (em breve)', enabled: false },
  { value: 'eliminatoria', label: 'Eliminatória (em breve)', enabled: false },
]

const selectClass =
  'w-full rounded-lg bg-surface-card border border-surface-border px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-brand-500'

export function CreateTournamentForm() {
  const [name, setName] = useState('')
  const [date, setDate] = useState('')
  const [sport, setSport] = useState(SPORTS[0].slug)
  const [category, setCategory] = useState<TournamentCategory>('livre')
  const [participantType, setParticipantType] = useState<ParticipantType>('dupla_revezando')
  const [format, setFormat] = useState<TournamentFormat>('americano')
  const [level, setLevel] = useState<StudentLevel>('C')
  const [gamesPerSet, setGamesPerSet] = useState(6)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !date) {
      setError('Preencha nome e data.')
      return
    }
    setError(null)
    startTransition(async () => {
      const result = await createTournament({
        name: name.trim(),
        date,
        sport,
        category,
        participant_type: participantType,
        format,
        level,
        scoring: { sets_to_win: 1, games_per_set: gamesPerSet, tiebreak_games: true },
      })
      if (result.error) setError(result.error)
      else {
        setName('')
        setDate('')
        router.refresh()
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-2">
      <Input label="Nome do torneio" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Americano Nível C Junho" required />
      <Input label="Data" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-slate-300">Esporte</label>
        <select value={sport} onChange={(e) => setSport(e.target.value)} className={selectClass}>
          {SPORTS.map((s) => (
            <option key={s.slug} value={s.slug}>{s.emoji} {s.label}</option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-slate-300">Categoria</label>
        <select value={category} onChange={(e) => setCategory(e.target.value as TournamentCategory)} className={selectClass}>
          {CATEGORY_OPTIONS.map((c) => (<option key={c.value} value={c.value}>{c.label}</option>))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-slate-300">Participação</label>
        <select value={participantType} onChange={(e) => setParticipantType(e.target.value as ParticipantType)} className={selectClass}>
          {PARTICIPANT_OPTIONS.map((p) => (<option key={p.value} value={p.value}>{p.label}</option>))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-slate-300">Formato</label>
        <select value={format} onChange={(e) => setFormat(e.target.value as TournamentFormat)} className={selectClass}>
          {FORMAT_OPTIONS.map((f) => (
            <option key={f.value} value={f.value} disabled={!f.enabled}>{f.label}</option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-slate-300">Nível</label>
        <select value={level} onChange={(e) => setLevel(e.target.value as StudentLevel)} className={selectClass}>
          {LEVEL_OPTIONS.map((l) => (
            <option key={l} value={l}>{l === 'iniciante' ? 'Iniciante' : `Nível ${l}`}</option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-slate-300">Games por set</label>
        <select value={gamesPerSet} onChange={(e) => setGamesPerSet(Number(e.target.value))} className={selectClass}>
          {[4, 6, 8, 9].map((g) => (<option key={g} value={g}>{g} games</option>))}
        </select>
      </div>

      {error && <p className="text-xs text-red-400 sm:col-span-2">{error}</p>}

      <div className="sm:col-span-2">
        <Button type="submit" loading={isPending}>Criar Torneio</Button>
      </div>
    </form>
  )
}
```

- [ ] **Step 2: Build + commit**

Run: `npm run build`
Expected: sem erro neste arquivo.

```bash
git add "app/(admin)/admin/torneios/CreateTournamentForm.tsx"
git commit -m "feat(torneios): form de criação com esporte/categoria/participação/formato/placar"
```

---

## Task 17: Card de placar unificado (`MatchScoreCard.tsx`)

**Files:**
- Create: `features/torneios/MatchScoreCard.tsx`

Substitui `MatchResult.tsx` (baseado em vencedor) por um card por games + fluxo de confirmação. Serve admin (lança confirmado) e jogador (reporta / confirma).

- [ ] **Step 1: Criar o componente**

```tsx
'use client'
// features/torneios/MatchScoreCard.tsx
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import {
  reportMatchResult,
  confirmMatchResult,
  recordMatchResult,
} from './actions'
import {
  canReportResult,
  canConfirmResult,
  type EligibilityMatch,
} from '@/lib/torneios/eligibility'

export interface ScoreMatch {
  id: string
  player1_id: string
  partner1_id: string | null
  player2_id: string
  partner2_id: string | null
  games1: number | null
  games2: number | null
  result_status: 'pending' | 'confirmed' | null
  reported_by: string | null
  player1?: { full_name: string } | null
  partner1?: { full_name: string } | null
  player2?: { full_name: string } | null
  partner2?: { full_name: string } | null
}

interface MatchScoreCardProps {
  match: ScoreMatch
  currentUserId: string
  isAdmin: boolean
}

function sideLabel(name?: string | null, partner?: string | null): string {
  const n = name ?? 'TBD'
  return partner ? `${n} / ${partner}` : n
}

export function MatchScoreCard({ match, currentUserId, isAdmin }: MatchScoreCardProps) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [g1, setG1] = useState<string>(match.games1?.toString() ?? '')
  const [g2, setG2] = useState<string>(match.games2?.toString() ?? '')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const elig: EligibilityMatch = {
    player1_id: match.player1_id,
    partner1_id: match.partner1_id,
    player2_id: match.player2_id,
    partner2_id: match.partner2_id,
    reported_by: match.reported_by,
  }
  const iCanReport = isAdmin || canReportResult(currentUserId, elig)
  const iCanConfirm =
    match.result_status === 'pending' && canConfirmResult(currentUserId, elig, isAdmin)

  const p1 = sideLabel(match.player1?.full_name, match.partner1?.full_name)
  const p2 = sideLabel(match.player2?.full_name, match.partner2?.full_name)

  function save() {
    const n1 = Number(g1)
    const n2 = Number(g2)
    if (!Number.isInteger(n1) || !Number.isInteger(n2) || n1 < 0 || n2 < 0) {
      setError('Informe um placar válido (games por lado).')
      return
    }
    setError(null)
    startTransition(async () => {
      const res = isAdmin
        ? await recordMatchResult(match.id, n1, n2)
        : await reportMatchResult(match.id, n1, n2)
      if (res.error) setError(res.error)
      else {
        setEditing(false)
        router.refresh()
      }
    })
  }

  function confirm() {
    setError(null)
    startTransition(async () => {
      const res = await confirmMatchResult(match.id)
      if (res.error) setError(res.error)
      else router.refresh()
    })
  }

  const hasScore = match.games1 !== null && match.games2 !== null

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-slate-300">{p1}</span>
        <span className="text-sm font-mono text-white">{hasScore ? match.games1 : '–'}</span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-slate-300">{p2}</span>
        <span className="text-sm font-mono text-white">{hasScore ? match.games2 : '–'}</span>
      </div>

      <div className="flex items-center gap-2">
        {match.result_status === 'confirmed' && <Badge variant="success">Confirmado</Badge>}
        {match.result_status === 'pending' && <Badge variant="warning">Aguardando confirmação</Badge>}
      </div>

      {editing ? (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              type="number"
              min={0}
              value={g1}
              onChange={(e) => setG1(e.target.value)}
              placeholder="Games dupla 1"
              className="w-24 rounded-lg bg-surface border border-surface-border px-2 py-1 text-white text-sm"
            />
            <input
              type="number"
              min={0}
              value={g2}
              onChange={(e) => setG2(e.target.value)}
              placeholder="Games dupla 2"
              className="w-24 rounded-lg bg-surface border border-surface-border px-2 py-1 text-white text-sm"
            />
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-2">
            <Button size="sm" loading={isPending} onClick={save}>Salvar</Button>
            <Button size="sm" variant="ghost" disabled={isPending} onClick={() => { setEditing(false); setError(null) }}>Cancelar</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2 pt-1">
          {iCanReport && match.result_status !== 'confirmed' && (
            <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
              {hasScore ? 'Editar placar' : 'Lançar placar'}
            </Button>
          )}
          {isAdmin && match.result_status === 'confirmed' && (
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Corrigir</Button>
          )}
          {iCanConfirm && (
            <Button size="sm" onClick={confirm} loading={isPending}>Confirmar placar</Button>
          )}
          {match.result_status === 'pending' && !iCanConfirm && !isAdmin && (
            <span className="text-xs text-slate-500 self-center">Aguardando a outra dupla confirmar.</span>
          )}
          {error && <p className="text-xs text-red-400 w-full">{error}</p>}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Remover `MatchResult.tsx` e `AdminMatchCard.tsx` antigos (usavam winner)**

```bash
git rm features/torneios/MatchResult.tsx "app/(admin)/admin/torneios/[id]/AdminMatchCard.tsx"
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: quebra nas páginas que importavam `AdminMatchCard`/`MatchResult` — corrigido nas Tasks 18-19. Confirme que `MatchScoreCard.tsx` compila.

- [ ] **Step 4: Commit**

```bash
git add features/torneios/MatchScoreCard.tsx
git commit -m "feat(torneios): MatchScoreCard (placar por games + reportar/confirmar)"
```

---

## Task 18: Rewrite das páginas de detalhe (admin + aluno)

**Files:**
- Create: `app/(admin)/admin/torneios/[id]/GenerateBracketButton.tsx`
- Modify: `app/(admin)/admin/torneios/[id]/page.tsx`
- Modify: `app/(dashboard)/torneios/[id]/page.tsx`
- Modify: `app/(dashboard)/torneios/[id]/RegisterButton.tsx`

> Contexto: `AdminMatchCard` e `MatchResult` foram removidos na Task 17. `tournament_registrations` é substituída por `tournament_entries`. `MatchScoreCard`, `StandingsTable` e `FORMATS` foram criados nas Tasks anteriores.

- [ ] **Step 1: Criar `GenerateBracketButton` (cliente)**

```tsx
// app/(admin)/admin/torneios/[id]/GenerateBracketButton.tsx
'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { generateBracket } from '@/features/torneios/actions'

export function GenerateBracketButton({ tournamentId }: { tournamentId: string }) {
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handle() {
    setError(null)
    startTransition(async () => {
      const res = await generateBracket(tournamentId)
      if (res.error) setError(res.error)
      else router.refresh()
    })
  }

  return (
    <div className="space-y-1">
      <Button onClick={handle} loading={isPending} size="sm">
        Gerar chave
      </Button>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}
```

- [ ] **Step 2: Reescrever `app/(admin)/admin/torneios/[id]/page.tsx`**

```tsx
// app/(admin)/admin/torneios/[id]/page.tsx
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createAdminClient, getCurrentOrgId } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { MatchScoreCard } from '@/features/torneios/MatchScoreCard'
import { StandingsTable } from '@/features/torneios/StandingsTable'
import { GenerateBracketButton } from './GenerateBracketButton'
import { formatDate } from '@/lib/utils/dateHelpers'
import { FORMATS } from '@/lib/torneios/formats'
import type { Tournament, TournamentStatus, ScoringConfig } from '@/types'
import type { MatchResultInput } from '@/lib/torneios/types'

const STATUS_LABELS: Record<TournamentStatus, string> = {
  draft: 'Rascunho',
  open: 'Inscrições Abertas',
  in_progress: 'Em Andamento',
  finished: 'Encerrado',
}
const STATUS_VARIANTS: Record<TournamentStatus, 'default' | 'success' | 'warning' | 'danger'> = {
  draft: 'default', open: 'success', in_progress: 'warning', finished: 'danger',
}

function normalizeProf<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v
}

interface PageProps { params: { id: string } }

export default async function AdminTorneioDetailPage({ params }: PageProps) {
  const adminClient = createAdminClient()
  const orgId = await getCurrentOrgId()
  if (!orgId) notFound()

  const { data: tournament, error } = await adminClient
    .from('tournaments')
    .select('*')
    .eq('id', params.id)
    .eq('organization_id', orgId)
    .single()
  if (error || !tournament) notFound()

  const t = tournament as Tournament

  // Entradas (tournament_entries) com nome e gênero do jogador (identidade em profiles)
  const { data: entriesRaw } = await adminClient
    .from('tournament_entries')
    .select(`id, player_id, partner_id, seed, created_at,
      player:profiles!tournament_entries_player_id_fkey(id, full_name, gender),
      partner:profiles!tournament_entries_partner_id_fkey(id, full_name)`)
    .eq('tournament_id', params.id)
    .order('created_at', { ascending: true })

  type EntryRow = {
    id: string; player_id: string; partner_id: string | null; seed: number | null; created_at: string
    player: { id: string; full_name: string; gender: string | null } | { id: string; full_name: string; gender: string | null }[] | null
    partner: { id: string; full_name: string } | { id: string; full_name: string }[] | null
  }
  const entries = (entriesRaw ?? []) as unknown as EntryRow[]

  // Nível por-academia (membership desta org, não profiles)
  const playerIds = entries.map((e) => e.player_id)
  const { data: levelMemsRaw } = playerIds.length > 0
    ? await adminClient.from('memberships').select('user_id, level').in('user_id', playerIds).eq('organization_id', orgId)
    : { data: [] }
  const levelByPlayer = new Map<string, string>()
  for (const m of (levelMemsRaw ?? []) as { user_id: string; level: string }[]) {
    levelByPlayer.set(m.user_id, m.level)
  }

  // Confrontos com as novas colunas de placar/status
  const { data: matchesRaw } = await adminClient
    .from('tournament_matches')
    .select(`id, tournament_id, round, match_no,
      player1_id, player2_id, partner1_id, partner2_id,
      games1, games2, result_status, reported_by, confirmed_by,
      player1:profiles!player1_id(id, full_name),
      player2:profiles!player2_id(id, full_name),
      partner1:profiles!partner1_id(id, full_name),
      partner2:profiles!partner2_id(id, full_name)`)
    .eq('tournament_id', params.id)
    .order('round', { ascending: true })
    .order('match_no', { ascending: true })

  type ScoreMatchRaw = {
    id: string; tournament_id: string; round: number; match_no: number | null
    player1_id: string | null; player2_id: string | null; partner1_id: string | null; partner2_id: string | null
    games1: number | null; games2: number | null; result_status: string | null
    reported_by: string | null; confirmed_by: string | null
    player1: { id: string; full_name: string } | { id: string; full_name: string }[] | null
    player2: { id: string; full_name: string } | { id: string; full_name: string }[] | null
    partner1: { id: string; full_name: string } | { id: string; full_name: string }[] | null
    partner2: { id: string; full_name: string } | { id: string; full_name: string }[] | null
  }
  const matches = ((matchesRaw ?? []) as unknown as ScoreMatchRaw[]).map((m) => ({
    ...m,
    player1: normalizeProf(m.player1),
    player2: normalizeProf(m.player2),
    partner1: normalizeProf(m.partner1),
    partner2: normalizeProf(m.partner2),
  }))

  // Classificação computada no servidor pelo formato
  const entryRefs = entries.map((e) => ({ playerId: e.player_id, partnerId: e.partner_id ?? null }))
  const scoring: ScoringConfig = {
    sets_to_win: (t as unknown as { sets_to_win: number | null }).sets_to_win ?? 1,
    games_per_set: (t as unknown as { games_per_set: number | null }).games_per_set ?? 6,
    tiebreak_games: (t as unknown as { tiebreak_games: boolean | null }).tiebreak_games ?? true,
  }
  const fmt = FORMATS[(t as unknown as { format: string }).format ?? 'americano']
  // matches do DB têm campos nullable mais amplos que MatchResultInput — cast seguro
  // pois computeStandings filtra result_status !== 'confirmed' e ignora nulls.
  const standings = fmt ? fmt.computeStandings(entryRefs, matches as unknown as MatchResultInput[], scoring) : []

  const nameById: Record<string, string> = {}
  for (const e of entries) {
    const p = normalizeProf(e.player)
    if (p) nameById[p.id] = p.full_name
    const pt = normalizeProf(e.partner)
    if (pt) nameById[pt.id] = pt.full_name
  }

  const tAny = t as unknown as { sport?: string; format?: string; category?: string }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Link href="/admin/torneios" className="text-slate-400 hover:text-white transition-colors mt-1">←</Link>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-white">{t.name}</h1>
            <Badge variant={STATUS_VARIANTS[t.status]}>{STATUS_LABELS[t.status]}</Badge>
          </div>
          <p className="text-sm text-slate-400 mt-0.5">
            {formatDate(t.date, "dd 'de' MMMM 'de' yyyy")} · Nível {t.level.toUpperCase()}
            {tAny.sport && ` · ${tAny.sport}`}
            {tAny.format && ` · ${tAny.format}`}
            {tAny.category && ` · ${tAny.category}`}
          </p>
          {t.status === 'open' && (
            <div className="mt-3"><GenerateBracketButton tournamentId={t.id} /></div>
          )}
        </div>
      </div>

      {/* Inscrições */}
      <section>
        <h2 className="text-lg font-semibold text-white mb-3">Inscrições ({entries.length})</h2>
        {entries.length === 0 ? (
          <p className="text-slate-400 text-sm">Nenhuma inscrição ainda.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {entries.map((entry) => {
              const p = normalizeProf(entry.player)
              const pt = normalizeProf(entry.partner)
              const lvl = levelByPlayer.get(entry.player_id)
              return (
                <Card key={entry.id}>
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm text-white font-medium">{p?.full_name ?? entry.player_id}</p>
                      {pt && <p className="text-xs text-slate-400">Parceiro: {pt.full_name}</p>}
                    </div>
                    {lvl && <Badge variant="level">{lvl.toUpperCase()}</Badge>}
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </section>

      {/* Classificação */}
      {standings.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-white mb-3">Classificação</h2>
          <StandingsTable rows={standings} nameById={nameById} />
        </section>
      )}

      {/* Confrontos */}
      <section>
        <h2 className="text-lg font-semibold text-white mb-3">Confrontos</h2>
        {matches.length === 0 ? (
          <p className="text-slate-400 text-sm">Nenhum confronto gerado ainda.</p>
        ) : (
          <div className="space-y-8">
            {Array.from(
              matches.reduce((acc, m) => {
                acc.set(m.round, [...(acc.get(m.round) ?? []), m])
                return acc
              }, new Map<number, typeof matches>()),
            )
              .sort(([a], [b]) => a - b)
              .map(([round, roundMatches]) => (
                <div key={round}>
                  <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">
                    Rodada {round}
                  </h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {roundMatches.map((match) => (
                      <MatchScoreCard key={match.id} match={match} isAdmin currentUserId="" />
                    ))}
                  </div>
                </div>
              ))}
          </div>
        )}
      </section>
    </div>
  )
}
```

- [ ] **Step 3: Atualizar `RegisterButton` para suportar `dupla_fixa` com seleção de parceiro**

```tsx
// app/(dashboard)/torneios/[id]/RegisterButton.tsx
'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { registerForTournament } from '@/features/torneios/actions'

interface RegisterButtonProps {
  tournamentId: string
  participantType: string
  potentialPartners: { id: string; full_name: string }[]
}

export function RegisterButton({ tournamentId, participantType, potentialPartners }: RegisterButtonProps) {
  const [partnerId, setPartnerId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  const needsPartner = participantType === 'dupla_fixa'

  function handleRegister() {
    setError(null)
    startTransition(async () => {
      const res = await registerForTournament(tournamentId, needsPartner ? partnerId || undefined : undefined)
      if (res.error) setError(res.error)
      else router.refresh()
    })
  }

  return (
    <div className="space-y-2">
      {needsPartner && (
        <div>
          <label className="block text-xs text-slate-400 mb-1">Selecione seu parceiro</label>
          <select
            value={partnerId}
            onChange={(e) => setPartnerId(e.target.value)}
            className="w-full bg-surface-card border border-surface-border rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-500"
          >
            <option value="">Selecione...</option>
            {potentialPartners.map((p) => (
              <option key={p.id} value={p.id}>{p.full_name}</option>
            ))}
          </select>
        </div>
      )}
      <Button
        loading={isPending}
        onClick={handleRegister}
        disabled={needsPartner && !partnerId}
      >
        Inscrever-se
      </Button>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}
```

- [ ] **Step 4: Reescrever `app/(dashboard)/torneios/[id]/page.tsx`**

```tsx
// app/(dashboard)/torneios/[id]/page.tsx
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient, getActiveOrgId } from '@/lib/supabase/server'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { MatchScoreCard } from '@/features/torneios/MatchScoreCard'
import { StandingsTable } from '@/features/torneios/StandingsTable'
import { RegisterButton } from './RegisterButton'
import { formatDate } from '@/lib/utils/dateHelpers'
import { FORMATS } from '@/lib/torneios/formats'
import type { Tournament, TournamentStatus, ScoringConfig } from '@/types'
import type { MatchResultInput } from '@/lib/torneios/types'

const STATUS_LABELS: Record<TournamentStatus, string> = {
  draft: 'Rascunho', open: 'Inscrições Abertas', in_progress: 'Em Andamento', finished: 'Encerrado',
}
const STATUS_VARIANTS: Record<TournamentStatus, 'default' | 'success' | 'warning' | 'danger'> = {
  draft: 'default', open: 'success', in_progress: 'warning', finished: 'danger',
}

function normalizeProf<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v
}

interface PageProps { params: { id: string } }

export default async function TorneioDetailPage({ params }: PageProps) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const orgId = await getActiveOrgId()
  const { data: tournament, error } = await supabase
    .from('tournaments')
    .select('*')
    .eq('id', params.id)
    .eq('organization_id', orgId)
    .single()

  if (error || !tournament) notFound()
  if ((tournament as Tournament).status === 'draft') notFound()

  const t = tournament as Tournament
  const tAny = t as unknown as {
    sport?: string; format?: string; category?: string; participant_type?: string
    sets_to_win?: number | null; games_per_set?: number | null; tiebreak_games?: boolean | null
  }

  // Verificar inscrição do aluno (tournament_entries)
  const { count: regCount } = await supabase
    .from('tournament_entries')
    .select('id', { count: 'exact', head: true })
    .eq('tournament_id', params.id)
    .eq('player_id', user.id)
  const isRegistered = (regCount ?? 0) > 0

  // Todas as entradas (para classificação e nameById)
  const { data: entriesRaw } = await supabase
    .from('tournament_entries')
    .select(`player_id, partner_id,
      player:profiles!tournament_entries_player_id_fkey(id, full_name),
      partner:profiles!tournament_entries_partner_id_fkey(id, full_name)`)
    .eq('tournament_id', params.id)

  type EntryRow = {
    player_id: string; partner_id: string | null
    player: { id: string; full_name: string } | { id: string; full_name: string }[] | null
    partner: { id: string; full_name: string } | { id: string; full_name: string }[] | null
  }
  const entries = (entriesRaw ?? []) as unknown as EntryRow[]

  // Confrontos com colunas de placar
  const { data: matchesRaw } = await supabase
    .from('tournament_matches')
    .select(`id, tournament_id, round, match_no,
      player1_id, player2_id, partner1_id, partner2_id,
      games1, games2, result_status, reported_by, confirmed_by,
      player1:profiles!player1_id(id, full_name),
      player2:profiles!player2_id(id, full_name),
      partner1:profiles!partner1_id(id, full_name),
      partner2:profiles!partner2_id(id, full_name)`)
    .eq('tournament_id', params.id)
    .order('round', { ascending: true })
    .order('match_no', { ascending: true })

  type ScoreMatchRaw = {
    id: string; tournament_id: string; round: number; match_no: number | null
    player1_id: string | null; player2_id: string | null; partner1_id: string | null; partner2_id: string | null
    games1: number | null; games2: number | null; result_status: string | null
    reported_by: string | null; confirmed_by: string | null
    player1: { id: string; full_name: string } | { id: string; full_name: string }[] | null
    player2: { id: string; full_name: string } | { id: string; full_name: string }[] | null
    partner1: { id: string; full_name: string } | { id: string; full_name: string }[] | null
    partner2: { id: string; full_name: string } | { id: string; full_name: string }[] | null
  }
  const matches = ((matchesRaw ?? []) as unknown as ScoreMatchRaw[]).map((m) => ({
    ...m,
    player1: normalizeProf(m.player1),
    player2: normalizeProf(m.player2),
    partner1: normalizeProf(m.partner1),
    partner2: normalizeProf(m.partner2),
  }))

  // Confrontos do aluno logado
  const myMatches = matches.filter((m) =>
    m.player1_id === user.id || m.player2_id === user.id ||
    m.partner1_id === user.id || m.partner2_id === user.id
  )

  // Classificação
  const entryRefs = entries.map((e) => ({ playerId: e.player_id, partnerId: e.partner_id ?? null }))
  const scoring: ScoringConfig = {
    sets_to_win: tAny.sets_to_win ?? 1,
    games_per_set: tAny.games_per_set ?? 6,
    tiebreak_games: tAny.tiebreak_games ?? true,
  }
  const fmt = FORMATS[tAny.format ?? 'americano']
  // matches do DB têm campos nullable mais amplos — cast seguro (computeStandings filtra nulls)
  const standings = fmt ? fmt.computeStandings(entryRefs, matches as unknown as MatchResultInput[], scoring) : []

  const nameById: Record<string, string> = {}
  for (const e of entries) {
    const p = normalizeProf(e.player)
    if (p) nameById[p.id] = p.full_name
    const pt = normalizeProf(e.partner)
    if (pt) nameById[pt.id] = pt.full_name
  }

  // Parceiros disponíveis para dupla_fixa (memberships com role=student nesta org, exceto o próprio aluno)
  // RLS de memberships permite alunos da mesma org lerem os registros da org.
  const needsPartner = tAny.participant_type === 'dupla_fixa'
  let potentialPartners: { id: string; full_name: string }[] = []
  if (needsPartner && t.status === 'open') {
    const { data: membRaw } = await supabase
      .from('memberships')
      .select('user_id, profiles:profiles!memberships_user_id_fkey(full_name)')
      .eq('organization_id', orgId)
      .eq('role', 'student')
      .neq('user_id', user.id)
    type MembRow = { user_id: string; profiles: { full_name: string } | { full_name: string }[] | null }
    potentialPartners = ((membRaw ?? []) as unknown as MembRow[]).map((m) => {
      const prof = normalizeProf(m.profiles as { full_name: string } | { full_name: string }[])
      return { id: m.user_id, full_name: prof?.full_name ?? '' }
    }).filter((p) => p.full_name)
  }

  return (
    <div className="p-4 space-y-5">
      {/* Header */}
      <div className="flex items-start gap-2">
        <Link href="/torneios" className="text-slate-400 hover:text-white transition-colors mt-0.5">←</Link>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-white">{t.name}</h1>
          <p className="text-sm text-slate-400 mt-0.5">{formatDate(t.date, "dd 'de' MMMM 'de' yyyy")}</p>
        </div>
      </div>

      {/* Info card */}
      <Card>
        <div className="flex flex-wrap gap-2">
          <Badge variant={STATUS_VARIANTS[t.status]}>{STATUS_LABELS[t.status]}</Badge>
          <Badge variant="level">Nível {t.level.toUpperCase()}</Badge>
          {tAny.category && <Badge variant="default">{tAny.category}</Badge>}
          {tAny.format && <Badge variant="default">{FORMATS[tAny.format]?.label ?? tAny.format}</Badge>}
        </div>
      </Card>

      {/* Inscrição */}
      {t.status === 'open' && (
        <Card>
          {isRegistered ? (
            <div className="flex items-center gap-2">
              <Badge variant="success">Inscrito</Badge>
              <span className="text-sm text-slate-400">Você já está inscrito neste torneio.</span>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-slate-300">Inscrições abertas. Participe!</p>
              <RegisterButton
                tournamentId={t.id}
                participantType={tAny.participant_type ?? 'dupla_revezando'}
                potentialPartners={potentialPartners}
              />
            </div>
          )}
        </Card>
      )}

      {/* Meus confrontos */}
      {myMatches.length > 0 && (
        <section>
          <h2 className="text-base font-semibold text-white mb-3">Meus confrontos</h2>
          <div className="space-y-3">
            {myMatches.map((match) => (
              <MatchScoreCard key={match.id} match={match} currentUserId={user.id} isAdmin={false} />
            ))}
          </div>
        </section>
      )}

      {/* Classificação */}
      {standings.length > 0 && (
        <section>
          <h2 className="text-base font-semibold text-white mb-3">Classificação</h2>
          <StandingsTable rows={standings} nameById={nameById} />
        </section>
      )}

      {/* Todos os confrontos */}
      {matches.length > 0 && (
        <section>
          <h2 className="text-base font-semibold text-white mb-3">Todos os confrontos</h2>
          <div className="space-y-6">
            {Array.from(
              matches.reduce((acc, m) => {
                acc.set(m.round, [...(acc.get(m.round) ?? []), m])
                return acc
              }, new Map<number, typeof matches>()),
            )
              .sort(([a], [b]) => a - b)
              .map(([round, roundMatches]) => (
                <div key={round}>
                  <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Rodada {round}</h3>
                  <div className="space-y-2">
                    {roundMatches.map((match) => (
                      <MatchScoreCard key={match.id} match={match} currentUserId={user.id} isAdmin={false} />
                    ))}
                  </div>
                </div>
              ))}
          </div>
        </section>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: sem erros de tipo. A quebra dos imports de `AdminMatchCard`/`MatchResult`/`BracketView` e da referência a `tournament_registrations` deve ter sido corrigida pela reescrita.

- [ ] **Step 6: Commit**

```bash
git add "app/(admin)/admin/torneios/[id]/GenerateBracketButton.tsx" \
        "app/(admin)/admin/torneios/[id]/page.tsx" \
        "app/(dashboard)/torneios/[id]/page.tsx" \
        "app/(dashboard)/torneios/[id]/RegisterButton.tsx"
git commit -m "feat(torneios): páginas de detalhe — tournament_entries, MatchScoreCard, classificação"
```

---

## Task 19: Comunidade — revisão de RLS e Storage

**Files:**
- Review: `app/(dashboard)/comunidade/` (páginas existentes)
- Review: migrações que definem RLS de `posts`, `post_likes`, `post_comments`
- Create (se necessário): `supabase/migrations/20260626000800_comunidade_rls_fix.sql`

> Objetivo: confirmar que o módulo de Comunidade já existente tem RLS org-scoped e Storage correto. Não há nova lógica a implementar — apenas revisar e corrigir se houver lacuna.

- [ ] **Step 1: Verificar RLS de posts/comentários/likes nas migrações**

```bash
grep -n "posts\|post_likes\|post_comments" supabase/migrations/002_rls_policies.sql | head -60
```

Confirmar que existem políticas com cláusula `organization_id = auth_org_id()` (ou `organization_id IN (SELECT auth_org_ids())`) para `SELECT`, `INSERT`, `UPDATE`, `DELETE`. Se houver alguma política sem filtragem de org, criar a migration corretiva abaixo.

- [ ] **Step 2: Verificar se Storage bucket `post-images` tem política org-scoped**

No Supabase Dashboard → Storage → Buckets, confirmar que existe bucket `post-images` (ou similar) com políticas que restringem leitura/escrita por organização (ou ao menos autenticação). Documenta observação no comentário do commit.

- [ ] **Step 3: Verificar páginas de comunidade existentes**

```bash
find "app/(dashboard)/comunidade" -name "*.tsx" | head -20
```

Ler a página principal e verificar que:
- Leitura de `posts` é filtrada por `organization_id` (via `getActiveOrgId()`).
- `INSERT` de post passa `organization_id`.
- `post_likes` e `post_comments` seguem o mesmo padrão.

Se qualquer query estiver sem filtro `organization_id`, corrigir na própria página (sem migration).

- [ ] **Step 4: Se RLS estiver faltando org-scope, criar migration corretiva**

Só criar se necessário após Step 1. Template:

```sql
-- supabase/migrations/20260626000800_comunidade_rls_fix.sql
-- Adiciona org-scope às políticas de Comunidade que estavam sem filtro.
-- Substituir <POLICY_NAME> pelo nome real encontrado no Step 1.

alter policy "<POLICY_NAME>" on posts using (organization_id in (select auth_org_ids()));
-- Repetir para post_likes e post_comments se necessário.
```

> ⚠️ Se RLS já estiver correto, não criar a migration (não commitar arquivo vazio).

- [ ] **Step 5: Build + commit**

Run: `npm run build`
Expected: sem erros.

```bash
# Se não criou migration (RLS já estava ok):
git commit --allow-empty -m "chore(comunidade): RLS org-scoped confirmado — sem alteração necessária"

# Se criou migration:
git add supabase/migrations/20260626000800_comunidade_rls_fix.sql
git commit -m "fix(comunidade): RLS org-scoped em posts/likes/comments"
```

---

## Task 20: Verificação Final

**Files:** nenhum novo arquivo — verificação end-to-end.

- [ ] **Step 1: Testes unitários**

Run: `npm run test:run`
Expected: todos os testes passam.

Checar especificamente:
- `lib/torneios/schedule/americano.test.ts` — property tests N=4,6,8,10,12,16 ✅
- `lib/torneios/eligibility.test.ts` ✅
- `lib/torneios/standings.test.ts` ✅
- `lib/torneios/formats.test.ts` ✅
- `lib/utils/levelAccess.test.ts` — testes pré-existentes seguem passando ✅
- `lib/utils/creditRules.test.ts` ✅

- [ ] **Step 2: Build de produção**

Run: `npm run build`
Expected: 0 erros de tipo, 0 warnings críticos.

- [ ] **Step 3: Roteiro de teste manual (após migrations aplicadas)**

Roteiro a executar no ambiente local (`npm run dev`) após aplicar as migrations manualmente no Supabase SQL Editor:

```
MIGRAÇÕES A APLICAR (na ordem, no SQL Editor):
  1. supabase/migrations/20260626000400_profiles_gender.sql
  2. supabase/migrations/20260626000500_tournaments_generalize.sql
  3. supabase/migrations/20260626000600_tournament_entries.sql
  4. supabase/migrations/20260626000700_tournament_matches_result.sql
  (se necessário: 20260626000800_comunidade_rls_fix.sql)

ROTEIRO:
[ ] Admin → Torneios → Criar torneio (esporte=beach_tennis, categoria=livre,
    participantes=dupla_revezando, formato=americano, nível=B, 6 games/set)
[ ] Admin → detalhe do torneio → status draft → mudar para "open"
[ ] Aluno 1 (M) → /torneios → abre torneio → Inscrever-se → confirma inscrição
[ ] Aluno 2 (M) → Inscrever-se
[ ] Aluno 3 (M) → Inscrever-se
[ ] Aluno 4 (M) → Inscrever-se
[ ] Admin → detalhe → botão "Gerar chave" → rodadas aparecem (N=4: 3 rodadas, 1 bye)
[ ] Aluno 1 abre confronto → lança placar (ex.: 6-4) → status "pendente"
[ ] Aluno 3 (adversário) abre mesmo confronto → botão "Confirmar placar" aparece → confirma
[ ] Admin → classificação atualiza com 1 vitória para Aluno 1
[ ] Admin → recordMatchResult via card (isAdmin=true) → confirma direto sem aprovação

GÊNERO:
[ ] Aluno → /perfil → seção Gênero → selecionar M ou F → salva → aparece corretamente

CATEGORIA MISTO (dupla_fixa):
[ ] Admin cria torneio categoria=misto, participant_type=dupla_fixa
[ ] Aluno M tenta se inscrever sem parceiro → erro "Selecione seu parceiro"
[ ] Aluno M escolhe parceiro F → inscrição OK (validation 1M+1F na action)
[ ] Aluno M tenta escolher parceiro M → action deve retornar erro de gênero misto
```

- [ ] **Step 4: Push para `develop`**

```bash
git push origin develop
```

> ⚠️ **Lembrete:** Nunca fazer merge para `main` sem autorização explícita do usuário.
> ⚠️ **Migrations:** Aplicar manualmente no Supabase SQL Editor — nunca via `supabase db push` em produção sem autorização.
