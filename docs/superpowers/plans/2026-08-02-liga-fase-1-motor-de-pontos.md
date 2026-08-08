# Liga — Fase 1: motor de pontos, divisões e temporada — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir a aba "Vídeo" por uma aba "Liga" onde o aluno vê sua divisão, pontos, posição e sequência por esporte, com pontos creditados automaticamente por presença e torneio, mais bônus manual do professor e fechamento mensal de temporada.

**Architecture:** Um extrato append-only (`liga_points`) é a fonte da verdade e uma tabela de posição (`liga_standings`) é cache; as duas são escritas atomicamente por RPCs `security definer`, espelhando o `adjust_credits` que o projeto já usa para créditos. Toda pontuação carrega o esporte como dimensão, aproveitando `memberships.sports` e `classes.sport` já existentes. A regra de negócio vive em quatro módulos puros e testados em `lib/liga/`, e os hooks de crédito são best-effort dentro das actions existentes — nunca derrubam a operação do professor.

**Tech Stack:** Next.js 14 App Router (Server Components + Server Actions), TypeScript, Supabase (Postgres + RPC `security definer`), Tailwind, Vitest, date-fns, lucide-react, Vercel Cron.

Spec: [docs/superpowers/specs/2026-08-02-liga-gamificacao-aluno-design.md](../specs/2026-08-02-liga-gamificacao-aluno-design.md)

**Ordem e ponto de corte:** as Tasks 1–17 entregam a Liga funcionando para o aluno com pesos default. As Tasks 18–20 (admin de configuração e bônus manual) e 21 (opt-out) podem virar uma entrega seguinte se necessário — mas sem a Task 19 o professor não tem bônus manual, que é o que torna o ranking "da academia dele".

**Convenções deste projeto que valem para todas as tasks:**
- `npm run test:run` deve ser executado via ferramenta **PowerShell**, não Bash — o Vitest falha aleatoriamente pelo Bash neste projeto.
- Nunca importe `@supabase/supabase-js` direto: use `createClient()` / `createAdminClient()` de `lib/supabase/server.ts`.
- Toda query feita com `createAdminClient()` (service role, ignora RLS) precisa de `.eq('organization_id', orgId)`.
- Migrations não são aplicadas por você. Escreva o arquivo e avise no relatório que o usuário precisa rodar `supabase db push`.

---

### Task 1: `lib/liga/divisions.ts` — promoção e rebaixamento

**Files:**
- Create: `lib/liga/divisions.ts`
- Test: `lib/liga/divisions.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/liga/divisions.test.ts
import { describe, it, expect } from 'vitest'
import { computeDivisionMoves, type StandingRow } from './divisions'

function row(studentId: string, points: number, division: StandingRow['division']): StandingRow {
  return { studentId, points, division }
}

describe('computeDivisionMoves', () => {
  it('promove os N primeiros e rebaixa os M últimos da divisão', () => {
    const rows = [
      row('a', 100, 'prata'),
      row('b', 90, 'prata'),
      row('c', 80, 'prata'),
      row('d', 70, 'prata'),
      row('e', 60, 'prata'),
      row('f', 50, 'prata'),
    ]
    const moves = computeDivisionMoves(rows, 2, 2)
    expect(moves).toEqual([
      { studentId: 'a', from: 'prata', to: 'ouro' },
      { studentId: 'b', from: 'prata', to: 'ouro' },
      { studentId: 'e', from: 'prata', to: 'bronze' },
      { studentId: 'f', from: 'prata', to: 'bronze' },
    ])
  })

  it('diamante não promove ninguém, só rebaixa', () => {
    const rows = [row('a', 100, 'diamante'), row('b', 50, 'diamante')]
    const moves = computeDivisionMoves(rows, 1, 1)
    expect(moves).toEqual([{ studentId: 'b', from: 'diamante', to: 'ouro' }])
  })

  it('bronze não rebaixa ninguém, só promove', () => {
    const rows = [row('a', 100, 'bronze'), row('b', 50, 'bronze')]
    const moves = computeDivisionMoves(rows, 1, 1)
    expect(moves).toEqual([{ studentId: 'a', from: 'bronze', to: 'prata' }])
  })

  it('aluno com 0 ponto nunca é promovido', () => {
    const rows = [row('a', 0, 'bronze'), row('b', 0, 'bronze')]
    expect(computeDivisionMoves(rows, 2, 0)).toEqual([])
  })

  it('divisão com menos gente que o corte não promove e rebaixa ao mesmo tempo o mesmo aluno', () => {
    const rows = [row('a', 100, 'prata'), row('b', 90, 'prata')]
    const moves = computeDivisionMoves(rows, 2, 2)
    expect(moves).toEqual([
      { studentId: 'a', from: 'prata', to: 'ouro' },
      { studentId: 'b', from: 'prata', to: 'ouro' },
    ])
  })

  it('empate em pontos desempata de forma estável por studentId', () => {
    const rows = [row('z', 50, 'prata'), row('a', 50, 'prata'), row('m', 50, 'prata')]
    const moves = computeDivisionMoves(rows, 1, 0)
    expect(moves).toEqual([{ studentId: 'a', from: 'prata', to: 'ouro' }])
  })

  it('processa divisões independentemente', () => {
    const rows = [row('a', 100, 'bronze'), row('b', 10, 'bronze'), row('c', 100, 'ouro'), row('d', 10, 'ouro')]
    const moves = computeDivisionMoves(rows, 1, 1)
    expect(moves).toEqual([
      { studentId: 'a', from: 'bronze', to: 'prata' },
      { studentId: 'c', from: 'ouro', to: 'diamante' },
      { studentId: 'd', from: 'ouro', to: 'prata' },
    ])
  })

  it('lista vazia devolve lista vazia', () => {
    expect(computeDivisionMoves([], 5, 3)).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (PowerShell): `npm run test:run -- lib/liga/divisions.test.ts`
Expected: FAIL — `Failed to resolve import "./divisions"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/liga/divisions.ts
// Promoção e rebaixamento no fechamento da temporada (spec §Fase 1).
//
// Regra pura de propósito: não conhece Supabase nem temporada. O cron
// app/api/cron/liga-season-close busca os standings e aplica o resultado.

export type Division = 'bronze' | 'prata' | 'ouro' | 'diamante'

/** Escada, do mais baixo ao mais alto. Índice é a posição. */
export const DIVISION_ORDER: Division[] = ['bronze', 'prata', 'ouro', 'diamante']

export interface StandingRow {
  studentId: string
  points: number
  division: Division
}

export interface DivisionMove {
  studentId: string
  from: Division
  to: Division
}

/**
 * Quem sobe e quem desce ao fim da temporada.
 *
 * Dentro de cada divisão ordena por pontos (desc), desempatando por studentId para
 * que o resultado seja estável — duas execuções do cron devem produzir a mesma lista.
 *
 * Guardas:
 * - Diamante é o teto: não promove. Bronze é o piso: não rebaixa.
 * - Aluno com 0 ponto nunca é promovido. Sem isso, uma divisão com 3 inscritos e
 *   nenhuma presença promoveria os três por inatividade.
 * - Um aluno nunca aparece duas vezes: quando a divisão tem menos gente que
 *   promoteCount + demoteCount, a promoção ganha e o rebaixamento é descartado.
 */
export function computeDivisionMoves(
  rows: StandingRow[],
  promoteCount: number,
  demoteCount: number,
): DivisionMove[] {
  const moves: DivisionMove[] = []

  for (const division of DIVISION_ORDER) {
    const inDivision = rows
      .filter((r) => r.division === division)
      .sort((a, b) => (b.points - a.points) || a.studentId.localeCompare(b.studentId))

    const idx = DIVISION_ORDER.indexOf(division)
    const up = DIVISION_ORDER[idx + 1]
    const down = DIVISION_ORDER[idx - 1]

    const promoted = new Set<string>()

    if (up) {
      for (const r of inDivision.slice(0, Math.max(0, promoteCount))) {
        if (r.points <= 0) continue // inatividade não promove
        promoted.add(r.studentId)
        moves.push({ studentId: r.studentId, from: division, to: up })
      }
    }

    if (down && demoteCount > 0) {
      for (const r of inDivision.slice(-demoteCount)) {
        if (promoted.has(r.studentId)) continue // já subiu; não pode descer também
        moves.push({ studentId: r.studentId, from: division, to: down })
      }
    }
  }

  return moves
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (PowerShell): `npm run test:run -- lib/liga/divisions.test.ts`
Expected: PASS — 8 testes.

- [ ] **Step 5: Commit**

```bash
git add lib/liga/divisions.ts lib/liga/divisions.test.ts
git commit -m "feat(liga): regra de promocao e rebaixamento de divisao"
```

---

### Task 2: `lib/liga/streak.ts` — semanas consecutivas

**Files:**
- Create: `lib/liga/streak.ts`
- Test: `lib/liga/streak.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/liga/streak.test.ts
import { describe, it, expect } from 'vitest'
import { computeStreakWeeks } from './streak'

// Quarta-feira, 2026-08-05. Semana ISO começa segunda 2026-08-03.
const WED = new Date('2026-08-05T12:00:00-03:00')

describe('computeStreakWeeks', () => {
  it('sem presença nenhuma é 0', () => {
    expect(computeStreakWeeks([], WED)).toBe(0)
  })

  it('presença só na semana corrente é 1', () => {
    expect(computeStreakWeeks(['2026-08-04'], WED)).toBe(1)
  })

  it('conta semanas consecutivas incluindo a corrente', () => {
    expect(computeStreakWeeks(['2026-08-04', '2026-07-28', '2026-07-21'], WED)).toBe(3)
  })

  it('duas presenças na mesma semana contam como uma semana', () => {
    expect(computeStreakWeeks(['2026-08-04', '2026-08-05'], WED)).toBe(1)
  })

  it('semana corrente ainda sem treino não quebra a sequência anterior', () => {
    // Ainda é quarta: o aluno tem o resto da semana para treinar.
    expect(computeStreakWeeks(['2026-07-28', '2026-07-21'], WED)).toBe(2)
  })

  it('buraco no meio corta a sequência na lacuna', () => {
    // 2026-07-14 existe mas 2026-07-21 não → sequência para antes dele.
    expect(computeStreakWeeks(['2026-08-04', '2026-07-28', '2026-07-14'], WED)).toBe(2)
  })

  it('presença só em semana antiga, com a anterior vazia, é 0', () => {
    expect(computeStreakWeeks(['2026-06-10'], WED)).toBe(0)
  })

  it('ignora datas futuras', () => {
    expect(computeStreakWeeks(['2026-08-04', '2026-09-01'], WED)).toBe(1)
  })

  it('atravessa a virada de ano', () => {
    // Quinta 2026-01-08; semanas: 2026-01-05, 2025-12-29, 2025-12-22.
    const jan = new Date('2026-01-08T12:00:00-03:00')
    expect(computeStreakWeeks(['2026-01-06', '2025-12-30', '2025-12-23'], jan)).toBe(3)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (PowerShell): `npm run test:run -- lib/liga/streak.test.ts`
Expected: FAIL — `Failed to resolve import "./streak"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/liga/streak.ts
// Sequência de semanas treinando, por esporte (spec §Decisões 10).
//
// date-fns com semana ISO (segunda a domingo), mesma convenção de
// lib/utils/dateHelpers.ts.
import { startOfISOWeek, differenceInCalendarWeeks, parseISO } from 'date-fns'

/**
 * Semanas consecutivas com ao menos uma presença, terminando na semana de `today`.
 *
 * Decisão importante: se o aluno ainda NÃO treinou na semana corrente, a contagem
 * termina na semana anterior em vez de zerar. Do contrário todo aluno abriria o app
 * na segunda-feira com a sequência zerada, o que puniria quem não faltou — ele ainda
 * tem o resto da semana para treinar.
 *
 * `attendanceDates` são datas 'YYYY-MM-DD' de presenças CONFIRMADAS naquele esporte;
 * duplicadas e datas futuras são ignoradas.
 */
export function computeStreakWeeks(attendanceDates: string[], today: Date): number {
  if (attendanceDates.length === 0) return 0

  const currentWeek = startOfISOWeek(today)

  // Distância em semanas entre a semana da presença e a semana corrente.
  const weeksAgo = new Set<number>()
  for (const date of attendanceDates) {
    const diff = differenceInCalendarWeeks(currentWeek, startOfISOWeek(parseISO(date)), {
      weekStartsOn: 1,
    })
    if (diff >= 0) weeksAgo.add(diff)
  }

  const start = weeksAgo.has(0) ? 0 : 1
  if (!weeksAgo.has(start)) return 0

  let count = 0
  while (weeksAgo.has(start + count)) count++
  return count
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (PowerShell): `npm run test:run -- lib/liga/streak.test.ts`
Expected: PASS — 9 testes.

- [ ] **Step 5: Commit**

```bash
git add lib/liga/streak.ts lib/liga/streak.test.ts
git commit -m "feat(liga): regra de sequencia de semanas treinando"
```

---

### Task 3: `lib/liga/points.ts` — pesos e valores

**Files:**
- Create: `lib/liga/points.ts`
- Test: `lib/liga/points.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/liga/points.test.ts
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_LIGA_WEIGHTS,
  pointsForAttendance,
  pointsForStreakWeek,
  pointsForTournamentResult,
  type LigaWeights,
} from './points'

const w: LigaWeights = {
  attendance: 10,
  streakWeek: 5,
  tournamentEntry: 30,
  tournamentWin: 50,
}

describe('pointsForAttendance', () => {
  it('devolve o peso configurado', () => {
    expect(pointsForAttendance(w)).toBe(10)
  })
})

describe('pointsForStreakWeek', () => {
  it('primeira semana vale o peso base', () => {
    expect(pointsForStreakWeek(1, w)).toBe(5)
  })

  it('cresce com a sequência', () => {
    expect(pointsForStreakWeek(2, w)).toBe(10)
    expect(pointsForStreakWeek(3, w)).toBe(15)
  })

  it('estabiliza no teto de 4x para não inflacionar sem limite', () => {
    expect(pointsForStreakWeek(4, w)).toBe(20)
    expect(pointsForStreakWeek(12, w)).toBe(20)
    expect(pointsForStreakWeek(99, w)).toBe(20)
  })

  it('sequência 0 não vale ponto', () => {
    expect(pointsForStreakWeek(0, w)).toBe(0)
  })
})

describe('pointsForTournamentResult', () => {
  it('primeiro lugar leva o peso cheio', () => {
    expect(pointsForTournamentResult(1, w)).toBe(50)
  })

  it('segundo leva 60% e terceiro 30%, arredondados', () => {
    expect(pointsForTournamentResult(2, w)).toBe(30)
    expect(pointsForTournamentResult(3, w)).toBe(15)
  })

  it('fora do pódio não pontua no resultado', () => {
    expect(pointsForTournamentResult(null, w)).toBe(0)
  })

  it('arredonda em vez de deixar fração', () => {
    const odd: LigaWeights = { ...w, tournamentWin: 55 }
    expect(pointsForTournamentResult(2, odd)).toBe(33)
    expect(pointsForTournamentResult(3, odd)).toBe(17)
  })
})

describe('DEFAULT_LIGA_WEIGHTS', () => {
  it('bate com os defaults documentados na spec', () => {
    expect(DEFAULT_LIGA_WEIGHTS).toEqual({
      attendance: 10,
      streakWeek: 5,
      tournamentEntry: 30,
      tournamentWin: 50,
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (PowerShell): `npm run test:run -- lib/liga/points.test.ts`
Expected: FAIL — `Failed to resolve import "./points"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/liga/points.ts
// Quanto vale cada evento na Liga (spec §Fase 1 / Config por academia).
//
// Os pesos vêm de system_settings por academia; estes são os defaults. A leitura
// fica em features/liga/settings.ts — aqui só a aritmética, pura e testável.

export interface LigaWeights {
  attendance: number
  streakWeek: number
  tournamentEntry: number
  tournamentWin: number
}

export const DEFAULT_LIGA_WEIGHTS: LigaWeights = {
  attendance: 10,
  streakWeek: 5,
  tournamentEntry: 30,
  tournamentWin: 50,
}

/** Teto do multiplicador de sequência: a partir daqui o bônus semanal estabiliza. */
const STREAK_MULTIPLIER_CAP = 4

export function pointsForAttendance(w: LigaWeights): number {
  return w.attendance
}

/**
 * Bônus da semana, crescente com a sequência e com teto.
 *
 * O teto existe porque sem ele o aluno de 40 semanas ganharia 200 pontos por semana
 * e nenhum novato jamais entraria na disputa — o oposto do que a temporada que zera
 * está tentando resolver.
 */
export function pointsForStreakWeek(streakWeeks: number, w: LigaWeights): number {
  if (streakWeeks <= 0) return 0
  return w.streakWeek * Math.min(streakWeeks, STREAK_MULTIPLIER_CAP)
}

/** Bônus de pódio. Fora do pódio o aluno já recebeu `tournamentEntry` por participar. */
export function pointsForTournamentResult(place: 1 | 2 | 3 | null, w: LigaWeights): number {
  if (place === 1) return w.tournamentWin
  if (place === 2) return Math.round(w.tournamentWin * 0.6)
  if (place === 3) return Math.round(w.tournamentWin * 0.3)
  return 0
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (PowerShell): `npm run test:run -- lib/liga/points.test.ts`
Expected: PASS — 10 testes.

- [ ] **Step 5: Commit**

```bash
git add lib/liga/points.ts lib/liga/points.test.ts
git commit -m "feat(liga): pesos e valores de pontuacao"
```

---

### Task 4: `lib/liga/sportForPoints.ts` — qual esporte um ponto credita

**Files:**
- Create: `lib/liga/sportForPoints.ts`
- Test: `lib/liga/sportForPoints.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/liga/sportForPoints.test.ts
import { describe, it, expect } from 'vitest'
import { sportForAttendance } from './sportForPoints'

describe('sportForAttendance', () => {
  it('usa a modalidade da turma quando ela existe', () => {
    expect(sportForAttendance('padel', ['beach_tennis', 'padel'])).toBe('padel')
  })

  it('turma sem modalidade cai no único esporte da academia', () => {
    expect(sportForAttendance(null, ['beach_tennis'])).toBe('beach_tennis')
  })

  it('turma sem modalidade em academia multi-modalidade não pontua', () => {
    expect(sportForAttendance(null, ['beach_tennis', 'padel'])).toBeNull()
  })

  it('turma sem modalidade em academia sem cardápio não pontua', () => {
    expect(sportForAttendance(null, [])).toBeNull()
  })

  it('modalidade da turma vale mesmo se a academia parou de oferecer', () => {
    // updateClass preserva a modalidade já gravada (spec de esportes); o histórico
    // de pontos não pode mudar de esporte porque o cardápio mudou depois.
    expect(sportForAttendance('futevolei', ['beach_tennis'])).toBe('futevolei')
  })

  it('string vazia é tratada como sem modalidade', () => {
    expect(sportForAttendance('', ['beach_tennis'])).toBe('beach_tennis')
    expect(sportForAttendance('', ['beach_tennis', 'padel'])).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (PowerShell): `npm run test:run -- lib/liga/sportForPoints.test.ts`
Expected: FAIL — `Failed to resolve import "./sportForPoints"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/liga/sportForPoints.ts
// Qual ranking recebe o ponto de uma presença (spec §Decisões 8).

/**
 * Esporte que um ponto de presença credita. `null` = não pontua.
 *
 * `classes.sport` é nullable e informativo (spec de esportes decidiu por zero
 * gating), então a Liga precisa de um fallback. O fallback é deliberadamente
 * conservador: só resolve quando não há ambiguidade nenhuma, isto é, quando a
 * academia oferece exatamente uma modalidade. Chutar entre várias seria pior que
 * não pontuar — o admin veria pontos aparecendo no ranking errado sem entender
 * por quê. Mesma filosofia do backfill em 20260802000000_sports_membership_and_class.sql.
 *
 * A turma sem modalidade em academia multi-modalidade fica visível no admin como
 * "N aulas não estão pontuando", que é o empurrão para preencher o campo.
 */
export function sportForAttendance(
  classSport: string | null | undefined,
  orgSports: string[],
): string | null {
  if (classSport) return classSport
  return orgSports.length === 1 ? orgSports[0] : null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (PowerShell): `npm run test:run -- lib/liga/sportForPoints.test.ts`
Expected: PASS — 6 testes.

- [ ] **Step 5: Commit**

```bash
git add lib/liga/sportForPoints.ts lib/liga/sportForPoints.test.ts
git commit -m "feat(liga): resolve o esporte que uma presenca credita"
```

---

### Task 5: Migration das tabelas

**Files:**
- Create: `supabase/migrations/20260803000000_liga_foundation.sql`

- [ ] **Step 1: Escrever a migration**

```sql
-- Liga: motor de pontos, divisões e temporada (spec 2026-08-02-liga-gamificacao-aluno).
--
-- Padrão: liga_points é o extrato (fonte da verdade) e liga_standings é cache da
-- posição, exatamente como credit_transactions → memberships.credits_balance. As duas
-- só são escritas pelas RPCs de 20260803000100_liga_rpcs.sql.
--
-- Esporte é dimensão do ponto, não filtro de tela: presença em turma de padel e em
-- turma de beach tennis são pontos em rankings diferentes por construção. O slug vem de
-- lib/arenas/sports.ts, sem tabela — mesmo modelo de organizations.sports,
-- tournaments.sport e classes.sport.

create table if not exists liga_seasons (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  starts_on date not null,
  ends_on date not null,
  status text not null default 'active' check (status in ('active', 'closed')),
  created_at timestamptz not null default now(),
  unique (organization_id, starts_on)
);

create index if not exists liga_seasons_active_idx
  on liga_seasons (organization_id, status);

create table if not exists liga_points (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  season_id uuid not null references liga_seasons(id) on delete cascade,
  student_id uuid not null references profiles(id) on delete cascade,
  sport text not null,
  points int not null,
  reason text not null check (reason in (
    'attendance', 'streak', 'tournament_entry', 'tournament_result',
    'manual', 'kudos_given', 'kudos_received'
  )),
  source_id uuid,
  note text,
  awarded_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- Idempotência. Sem isto, um duplo clique na chamada ou um retry de rede creditaria o
-- ponto duas vezes, e como o cache é o que aparece na tela ninguém descobriria por
-- semanas. coalesce porque 'manual' e 'streak' podem não ter source_id de origem.
create unique index if not exists liga_points_dedup_idx
  on liga_points (
    season_id, student_id, sport, reason,
    coalesce(source_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

create index if not exists liga_points_student_idx
  on liga_points (season_id, student_id, sport, created_at desc);

create table if not exists liga_standings (
  organization_id uuid not null references organizations(id) on delete cascade,
  season_id uuid not null references liga_seasons(id) on delete cascade,
  student_id uuid not null references profiles(id) on delete cascade,
  sport text not null,
  division text not null default 'bronze'
    check (division in ('bronze', 'prata', 'ouro', 'diamante')),
  points int not null default 0,
  streak_weeks int not null default 0,
  primary key (season_id, student_id, sport)
);

-- Consulta do ranking: temporada + esporte + divisão, ordenado por pontos.
create index if not exists liga_standings_rank_idx
  on liga_standings (season_id, sport, division, points desc);

-- Opt-out do ranking. Continua acumulando pontos e medalhas; só não aparece para os
-- outros alunos (spec §Telas).
alter table memberships add column if not exists liga_opted_out boolean not null default false;

-- RLS: leitura para membros da própria academia; escrita SÓ pelas RPCs security definer.
alter table liga_seasons   enable row level security;
alter table liga_points    enable row level security;
alter table liga_standings enable row level security;

drop policy if exists liga_seasons_read_own_org on liga_seasons;
create policy liga_seasons_read_own_org on liga_seasons for select to authenticated
  using (organization_id in (
    select organization_id from memberships where user_id = auth.uid()
  ));

drop policy if exists liga_points_read_own_org on liga_points;
create policy liga_points_read_own_org on liga_points for select to authenticated
  using (organization_id in (
    select organization_id from memberships where user_id = auth.uid()
  ));

drop policy if exists liga_standings_read_own_org on liga_standings;
create policy liga_standings_read_own_org on liga_standings for select to authenticated
  using (organization_id in (
    select organization_id from memberships where user_id = auth.uid()
  ));
```

- [ ] **Step 2: Verificar que o SQL é sintaticamente válido**

Não há linter de SQL no projeto e você não tem credencial para aplicar a migration. Releia o arquivo confirmando: todo `create table` tem `if not exists`; todo FK aponta para tabela existente (`organizations`, `profiles`, `liga_seasons`); todo `check` lista os mesmos valores usados nos tipos TypeScript da Task 7.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260803000000_liga_foundation.sql
git commit -m "feat(liga): migration das tabelas de temporada, extrato e posicao"
```

- [ ] **Step 4: Reportar que a migration precisa ser aplicada**

No relatório final, avisar: **o usuário precisa rodar `supabase db push`** antes das tasks que leem/escrevem essas tabelas funcionarem em runtime.

---

### Task 6: Migration das RPCs

**Files:**
- Create: `supabase/migrations/20260803000100_liga_rpcs.sql`

- [ ] **Step 1: Escrever a migration**

```sql
-- RPCs da Liga: escrita atômica de extrato + cache.
--
-- Espelha public.adjust_credits (20260624000000_profiles_identity_cutover.sql): o app
-- NUNCA faz update direto em liga_standings.points. Se o app fizesse os dois updates,
-- uma falha entre eles deixaria extrato e cache divergentes para sempre — e o cache é
-- o que aparece na tela.

create or replace function public.liga_award_points(
  p_org uuid,
  p_season uuid,
  p_student uuid,
  p_sport text,
  p_points int,
  p_reason text,
  p_source_id uuid default null,
  p_note text default null,
  p_awarded_by uuid default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted int;
begin
  if p_sport is null or p_sport = '' then
    raise exception 'LIGA_SPORT_REQUIRED';
  end if;

  -- 1. Extrato. on conflict do nothing torna a chamada idempotente: o índice
  --    liga_points_dedup_idx é quem decide se este evento já foi creditado.
  insert into liga_points (
    organization_id, season_id, student_id, sport, points, reason,
    source_id, note, awarded_by
  )
  values (
    p_org, p_season, p_student, p_sport, p_points, p_reason,
    p_source_id, p_note, p_awarded_by
  )
  on conflict do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return; -- já creditado; não mexe no cache
  end if;

  -- 2. Cache da posição, na mesma transação.
  insert into liga_standings (organization_id, season_id, student_id, sport, points)
  values (p_org, p_season, p_student, p_sport, p_points)
  on conflict (season_id, student_id, sport)
  do update set points = liga_standings.points + excluded.points;

  -- 3. Quem treinou, participa: se o esporte não estava na lista do aluno naquela
  --    academia, entra agora (spec §Decisões 9). Sem isto ele receberia ponto num
  --    ranking que a própria tela não listaria para ele.
  update memberships
     set sports = array_append(sports, p_sport)
   where user_id = p_student
     and organization_id = p_org
     and not (p_sport = any(sports));
end;
$$;

revoke all on function public.liga_award_points(uuid, uuid, uuid, text, int, text, uuid, text, uuid)
  from public, anon, authenticated;

-- Revogação: usada quando o professor DESMARCA a presença. Remove exatamente a linha
-- daquele evento e desconta o mesmo valor do cache.
create or replace function public.liga_revoke_points(
  p_season uuid,
  p_student uuid,
  p_sport text,
  p_reason text,
  p_source_id uuid default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_points int;
begin
  delete from liga_points
   where season_id = p_season
     and student_id = p_student
     and sport = p_sport
     and reason = p_reason
     and coalesce(source_id, '00000000-0000-0000-0000-000000000000'::uuid)
       = coalesce(p_source_id, '00000000-0000-0000-0000-000000000000'::uuid)
  returning points into v_points;

  if v_points is null then
    return; -- nada a revogar
  end if;

  -- greatest(0, ...): o cache nunca fica negativo, mesmo que o extrato tenha sido
  -- mexido à mão em produção.
  update liga_standings
     set points = greatest(0, points - v_points)
   where season_id = p_season
     and student_id = p_student
     and sport = p_sport;
end;
$$;

revoke all on function public.liga_revoke_points(uuid, uuid, text, text, uuid)
  from public, anon, authenticated;
```

- [ ] **Step 2: Revisar a lógica**

Releia confirmando: `liga_award_points` retorna cedo quando o insert não inseriu (idempotência); o `on conflict` do standings usa a PK correta `(season_id, student_id, sport)`; `liga_revoke_points` usa o mesmo `coalesce` do índice único, senão não acharia a linha.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260803000100_liga_rpcs.sql
git commit -m "feat(liga): RPCs atomicas de credito e revogacao de pontos"
```

---

### Task 7: Tipos e leitura de configuração

**Files:**
- Modify: `types/index.ts` (acrescentar ao final, antes de qualquer `export type` agregador)
- Create: `features/liga/settings.ts`

- [ ] **Step 1: Acrescentar os tipos em `types/index.ts`**

```ts
// --- Liga (gamificação do aluno) -------------------------------------------
// A divisão é definida em lib/liga/divisions.ts junto da regra de movimentação: a
// regra pura não pode depender deste arquivo (que importa tipos de Supabase). Aqui só
// o alias, para que as telas não precisem importar de lib/liga.
import type { Division } from '@/lib/liga/divisions'

export type LigaDivision = Division

export type LigaPointReason =
  | 'attendance'
  | 'streak'
  | 'tournament_entry'
  | 'tournament_result'
  | 'manual'
  | 'kudos_given'
  | 'kudos_received'

export interface LigaSeason {
  id: string
  organization_id: string
  starts_on: string // YYYY-MM-DD
  ends_on: string // YYYY-MM-DD
  status: 'active' | 'closed'
  created_at: string
}

export interface LigaPointEntry {
  id: string
  organization_id: string
  season_id: string
  student_id: string
  sport: string
  points: number
  reason: LigaPointReason
  source_id: string | null
  note: string | null
  awarded_by: string | null
  created_at: string
}

export interface LigaStanding {
  organization_id: string
  season_id: string
  student_id: string
  sport: string
  division: LigaDivision
  points: number
  streak_weeks: number
}
```

- [ ] **Step 2: Criar a leitura de configuração**

```ts
// features/liga/settings.ts
// Configuração da Liga por academia, em system_settings (key/value), mesmo mecanismo
// de video_feed_url e dos pesos de crédito.
import { createAdminClient } from '@/lib/supabase/server'
import { DEFAULT_LIGA_WEIGHTS, type LigaWeights } from '@/lib/liga/points'

export interface LigaSettings {
  enabled: boolean
  weights: LigaWeights
  promoteCount: number
  demoteCount: number
}

export const DEFAULT_LIGA_SETTINGS: LigaSettings = {
  // Nasce DESLIGADA de propósito: academia que não preencheu a modalidade das turmas
  // veria um ranking quase vazio. O dono liga quando estiver pronto.
  enabled: false,
  weights: DEFAULT_LIGA_WEIGHTS,
  promoteCount: 5,
  demoteCount: 3,
}

function intOr(value: string | undefined, fallback: number): number {
  const n = Number(value)
  return Number.isInteger(n) && n >= 0 ? n : fallback
}

/** Lê a config da Liga de uma academia. Chaves ausentes caem no default. */
export async function getLigaSettings(orgId: string | null | undefined): Promise<LigaSettings> {
  if (!orgId) return DEFAULT_LIGA_SETTINGS

  const admin = createAdminClient()
  const { data } = await admin
    .from('system_settings')
    .select('key, value')
    .eq('organization_id', orgId)

  const map = new Map((data ?? []).map((r: { key: string; value: string }) => [r.key, r.value]))
  const d = DEFAULT_LIGA_SETTINGS

  return {
    enabled: map.get('liga_enabled') === 'true',
    weights: {
      attendance: intOr(map.get('liga_points_attendance'), d.weights.attendance),
      streakWeek: intOr(map.get('liga_points_streak_week'), d.weights.streakWeek),
      tournamentEntry: intOr(map.get('liga_points_tournament_entry'), d.weights.tournamentEntry),
      tournamentWin: intOr(map.get('liga_points_tournament_win'), d.weights.tournamentWin),
    },
    promoteCount: intOr(map.get('liga_promote_count'), d.promoteCount),
    demoteCount: intOr(map.get('liga_demote_count'), d.demoteCount),
  }
}
```

- [ ] **Step 3: Verificar o build**

Run: `npm run build`
Expected: compila sem erro de tipo.

- [ ] **Step 4: Commit**

```bash
git add types/index.ts features/liga/settings.ts
git commit -m "feat(liga): tipos e leitura de configuracao por academia"
```

---

### Task 8: Temporada ativa (buscar ou criar)

**Files:**
- Create: `features/liga/season.ts`

- [ ] **Step 1: Criar o módulo**

```ts
// features/liga/season.ts
// Temporada corrente de uma academia. Mensal: começa no dia 1º e termina no último dia.
import { createAdminClient } from '@/lib/supabase/server'
import type { LigaSeason } from '@/types'

/** Primeiro e último dia (YYYY-MM-DD) do mês de `ref`, no fuso local do servidor. */
export function monthBounds(ref: Date): { startsOn: string; endsOn: string } {
  const y = ref.getFullYear()
  const m = ref.getMonth()
  const pad = (n: number) => String(n).padStart(2, '0')
  const last = new Date(y, m + 1, 0).getDate()
  return {
    startsOn: `${y}-${pad(m + 1)}-01`,
    endsOn: `${y}-${pad(m + 1)}-${pad(last)}`,
  }
}

/**
 * Temporada ativa da academia, criando a do mês corrente se ainda não existir.
 *
 * Criar sob demanda em vez de depender só do cron: se o cron falhar ou a academia
 * ligar a Liga no meio do mês, o primeiro ponto creditado já cria a temporada. O
 * unique (organization_id, starts_on) garante que duas chamadas concorrentes não
 * criem duas temporadas.
 */
export async function getOrCreateActiveSeason(
  orgId: string,
  now: Date = new Date(),
): Promise<LigaSeason | null> {
  const admin = createAdminClient()
  const { startsOn, endsOn } = monthBounds(now)

  const { data: existing } = await admin
    .from('liga_seasons')
    .select('*')
    .eq('organization_id', orgId)
    .eq('starts_on', startsOn)
    .maybeSingle()

  if (existing) return existing as LigaSeason

  const { data: created } = await admin
    .from('liga_seasons')
    .insert({ organization_id: orgId, starts_on: startsOn, ends_on: endsOn, status: 'active' })
    .select('*')
    .maybeSingle()

  if (created) return created as LigaSeason

  // Corrida perdida: outra chamada criou entre o select e o insert. Lê de novo.
  const { data: raced } = await admin
    .from('liga_seasons')
    .select('*')
    .eq('organization_id', orgId)
    .eq('starts_on', startsOn)
    .maybeSingle()

  return (raced as LigaSeason | null) ?? null
}
```

- [ ] **Step 2: Verificar o build**

Run: `npm run build`
Expected: compila sem erro.

- [ ] **Step 3: Commit**

```bash
git add features/liga/season.ts
git commit -m "feat(liga): temporada mensal ativa com criacao sob demanda"
```

---

### Task 9: Creditar e revogar pontos (wrapper das RPCs)

**Files:**
- Create: `features/liga/awardPoints.ts`

- [ ] **Step 1: Criar o módulo**

```ts
// features/liga/awardPoints.ts
// Ponte entre as actions e as RPCs da Liga. Nunca escreve nas tabelas direto.
import * as Sentry from '@sentry/nextjs'
import { createAdminClient } from '@/lib/supabase/server'
import type { LigaPointReason } from '@/types'

type AdminClient = ReturnType<typeof createAdminClient>

export interface AwardPointsInput {
  orgId: string
  seasonId: string
  studentId: string
  sport: string
  points: number
  reason: LigaPointReason
  sourceId?: string | null
  note?: string | null
  awardedBy?: string | null
}

/**
 * Credita pontos via RPC atômica. Nunca lança.
 *
 * Best-effort de propósito: todos os callers são operações que o professor ou o aluno
 * está fazendo por outro motivo (marcar presença, se inscrever num torneio). A Liga
 * falhando não pode derrubar nenhuma delas — mesmo contrato do ensureClassDebt em
 * features/aulas/actions.ts. A passada diária do cron reconcilia o que escapar.
 */
export async function awardLigaPoints(
  admin: AdminClient,
  input: AwardPointsInput,
): Promise<void> {
  try {
    const { error } = await admin.rpc('liga_award_points', {
      p_org: input.orgId,
      p_season: input.seasonId,
      p_student: input.studentId,
      p_sport: input.sport,
      p_points: input.points,
      p_reason: input.reason,
      p_source_id: input.sourceId ?? null,
      p_note: input.note ?? null,
      p_awarded_by: input.awardedBy ?? null,
    })
    if (error) throw new Error(error.message)
  } catch (err) {
    console.error('[liga] awardLigaPoints falhou', {
      studentId: input.studentId,
      sport: input.sport,
      reason: input.reason,
      error: err instanceof Error ? err.message : String(err),
    })
    Sentry.captureException(err, {
      tags: { feature: 'liga' },
      extra: { ...input },
    })
  }
}

export interface RevokePointsInput {
  seasonId: string
  studentId: string
  sport: string
  reason: LigaPointReason
  sourceId?: string | null
}

/** Remove um crédito específico (professor desmarcou a presença). Nunca lança. */
export async function revokeLigaPoints(
  admin: AdminClient,
  input: RevokePointsInput,
): Promise<void> {
  try {
    const { error } = await admin.rpc('liga_revoke_points', {
      p_season: input.seasonId,
      p_student: input.studentId,
      p_sport: input.sport,
      p_reason: input.reason,
      p_source_id: input.sourceId ?? null,
    })
    if (error) throw new Error(error.message)
  } catch (err) {
    console.error('[liga] revokeLigaPoints falhou', {
      studentId: input.studentId,
      sport: input.sport,
      reason: input.reason,
      error: err instanceof Error ? err.message : String(err),
    })
    Sentry.captureException(err, { tags: { feature: 'liga' }, extra: { ...input } })
  }
}
```

- [ ] **Step 2: Verificar o build**

Run: `npm run build`
Expected: compila sem erro.

- [ ] **Step 3: Commit**

```bash
git add features/liga/awardPoints.ts
git commit -m "feat(liga): wrapper best-effort das RPCs de pontos"
```

---

### Task 10: Creditar presença — hook em `markAttendance` e `markAttendanceBulk`

**Files:**
- Create: `features/liga/attendancePoints.ts`
- Modify: `features/aulas/actions.ts` (dentro de `markAttendance` e `markAttendanceBulk`)

- [ ] **Step 1: Criar o helper de sincronização**

```ts
// features/liga/attendancePoints.ts
// Reflete a marcação de presença na Liga (spec §Fase 1 / Onde os pontos entram).
import { createAdminClient } from '@/lib/supabase/server'
import { getOrgSports } from '@/lib/arenas/orgSports'
import { sportForAttendance } from '@/lib/liga/sportForPoints'
import { pointsForAttendance } from '@/lib/liga/points'
import { getLigaSettings } from './settings'
import { getOrCreateActiveSeason } from './season'
import { awardLigaPoints, revokeLigaPoints } from './awardPoints'

type AdminClient = ReturnType<typeof createAdminClient>

/** Modalidade da turma daquela sessão. null quando a turma não tem modalidade. */
async function sessionClassSport(
  admin: AdminClient,
  orgId: string,
  sessionId: string,
): Promise<string | null> {
  const { data } = await admin
    .from('class_sessions')
    .select('classes(sport)')
    .eq('id', sessionId)
    .eq('organization_id', orgId)
    .maybeSingle()

  // O join vem como objeto ou array de um, dependendo da inferência do supabase-js.
  const raw = (data as { classes: { sport: string | null } | { sport: string | null }[] } | null)?.classes
  const cls = Array.isArray(raw) ? raw[0] : raw
  return cls?.sport ?? null
}

/**
 * Presente → credita; ausente → revoga o crédito daquela aula.
 *
 * Nunca lança: a marcação de presença é a operação do professor e não pode falhar
 * porque a Liga falhou. Mesmo contrato de ensureClassDebt e syncMissedCheckin.
 */
export async function syncLigaAttendancePoints(
  admin: AdminClient,
  input: { orgId: string; studentId: string; sessionId: string; present: boolean },
): Promise<void> {
  const { orgId, studentId, sessionId, present } = input

  try {
    const settings = await getLigaSettings(orgId)
    if (!settings.enabled) return

    const [classSport, orgSports] = await Promise.all([
      sessionClassSport(admin, orgId, sessionId),
      getOrgSports(orgId),
    ])

    const sport = sportForAttendance(classSport, orgSports)
    if (!sport) return // turma sem modalidade em academia multi-modalidade

    const season = await getOrCreateActiveSeason(orgId)
    if (!season) return

    if (present) {
      await awardLigaPoints(admin, {
        orgId,
        seasonId: season.id,
        studentId,
        sport,
        points: pointsForAttendance(settings.weights),
        reason: 'attendance',
        sourceId: sessionId,
      })
    } else {
      await revokeLigaPoints(admin, {
        seasonId: season.id,
        studentId,
        sport,
        reason: 'attendance',
        sourceId: sessionId,
      })
    }
  } catch (err) {
    console.error('[liga] syncLigaAttendancePoints falhou', {
      sessionId,
      studentId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
```

- [ ] **Step 2: Ligar em `markAttendance`**

Em `features/aulas/actions.ts`, acrescente o import no topo do arquivo, junto aos outros imports de feature:

```ts
import { syncLigaAttendancePoints } from '@/features/liga/attendancePoints'
```

Dentro de `markAttendance`, imediatamente ANTES da linha
`const missed = await syncMissedCheckin(adminClient, { orgId, studentId, sessionId, present })`,
acrescente:

```ts
  // Liga: presente credita, ausente revoga. Best-effort, igual à dívida acima.
  await syncLigaAttendancePoints(adminClient, { orgId, studentId, sessionId, present })
```

- [ ] **Step 3: Ligar em `markAttendanceBulk`**

Em `markAttendanceBulk`, dentro do laço `for (const studentId of allStudentIds)` que chama
`syncMissedCheckin`, acrescente a chamada da Liga logo antes do `syncMissedCheckin`:

```ts
  for (const studentId of allStudentIds) {
    await syncLigaAttendancePoints(adminClient, {
      orgId, studentId, sessionId, present: presentSet.has(studentId),
    })
    const effect = await syncMissedCheckin(adminClient, {
      orgId, studentId, sessionId, present: presentSet.has(studentId),
    })
    if (effect) missedByStudent[studentId] = effect
  }
```

- [ ] **Step 4: Verificar build e testes**

Run: `npm run build`
Expected: compila sem erro.

Run (PowerShell): `npm run test:run`
Expected: toda a suíte existente continua passando (nenhum teste novo nesta task — o
comportamento depende de banco; a regra pura já foi testada nas Tasks 1–4).

- [ ] **Step 5: Commit**

```bash
git add features/liga/attendancePoints.ts features/aulas/actions.ts
git commit -m "feat(liga): credita e revoga pontos na marcacao de presenca"
```

---

### Task 11: Creditar torneio — inscrição e pódio

**Files:**
- Create: `features/liga/tournamentPoints.ts`
- Modify: `features/torneios/actions.ts` (em `registerForTournament`, `confirmWaitlistOffer`, `closeTournament`, `updateWinners`)

- [ ] **Step 1: Criar o helper**

```ts
// features/liga/tournamentPoints.ts
// Pontos de torneio na Liga: participar e subir no pódio (spec §Fase 1).
import { createAdminClient } from '@/lib/supabase/server'
import { pointsForTournamentResult } from '@/lib/liga/points'
import { getLigaSettings } from './settings'
import { getOrCreateActiveSeason } from './season'
import { awardLigaPoints, revokeLigaPoints } from './awardPoints'

type AdminClient = ReturnType<typeof createAdminClient>

interface TournamentRow {
  sport: string | null
  winner1_id: string | null
  winner1_partner_id: string | null
  winner2_id: string | null
  winner2_partner_id: string | null
  winner3_id: string | null
  winner3_partner_id: string | null
}

async function loadTournament(
  admin: AdminClient,
  orgId: string,
  tournamentId: string,
): Promise<TournamentRow | null> {
  const { data } = await admin
    .from('tournaments')
    .select(
      'sport, winner1_id, winner1_partner_id, winner2_id, winner2_partner_id, winner3_id, winner3_partner_id',
    )
    .eq('id', tournamentId)
    .eq('organization_id', orgId)
    .maybeSingle()
  return (data as TournamentRow | null) ?? null
}

/** Crédito por participar. Chamado quando a inscrição fica confirmada. */
export async function awardTournamentEntry(
  admin: AdminClient,
  input: { orgId: string; tournamentId: string; studentId: string },
): Promise<void> {
  try {
    const settings = await getLigaSettings(input.orgId)
    if (!settings.enabled) return

    const tournament = await loadTournament(admin, input.orgId, input.tournamentId)
    const sport = tournament?.sport
    if (!sport) return

    const season = await getOrCreateActiveSeason(input.orgId)
    if (!season) return

    await awardLigaPoints(admin, {
      orgId: input.orgId,
      seasonId: season.id,
      studentId: input.studentId,
      sport,
      points: settings.weights.tournamentEntry,
      reason: 'tournament_entry',
      sourceId: input.tournamentId,
    })
  } catch (err) {
    console.error('[liga] awardTournamentEntry falhou', {
      tournamentId: input.tournamentId,
      studentId: input.studentId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

/**
 * Recredita o pódio inteiro do torneio.
 *
 * Idempotente e corrigível: revoga o crédito de resultado de todos os envolvidos antes
 * de creditar de novo. É o que faz `updateWinners` (correção manual do pódio pelo
 * admin) funcionar sem deixar ponto de vencedor antigo para trás.
 */
export async function syncTournamentResultPoints(
  admin: AdminClient,
  input: { orgId: string; tournamentId: string; previousWinnerIds?: string[] },
): Promise<void> {
  const { orgId, tournamentId } = input

  try {
    const settings = await getLigaSettings(orgId)
    if (!settings.enabled) return

    const tournament = await loadTournament(admin, orgId, tournamentId)
    const sport = tournament?.sport
    if (!sport) return

    const season = await getOrCreateActiveSeason(orgId)
    if (!season) return

    const podium: { studentIds: string[]; place: 1 | 2 | 3 }[] = [
      { studentIds: [tournament.winner1_id, tournament.winner1_partner_id].filter(Boolean) as string[], place: 1 },
      { studentIds: [tournament.winner2_id, tournament.winner2_partner_id].filter(Boolean) as string[], place: 2 },
      { studentIds: [tournament.winner3_id, tournament.winner3_partner_id].filter(Boolean) as string[], place: 3 },
    ]

    // Revoga o resultado anterior de todo mundo que já teve ou tem pódio.
    const toRevoke = new Set<string>([
      ...(input.previousWinnerIds ?? []),
      ...podium.flatMap((p) => p.studentIds),
    ])
    for (const studentId of toRevoke) {
      await revokeLigaPoints(admin, {
        seasonId: season.id,
        studentId,
        sport,
        reason: 'tournament_result',
        sourceId: tournamentId,
      })
    }

    for (const { studentIds, place } of podium) {
      const points = pointsForTournamentResult(place, settings.weights)
      if (points <= 0) continue
      for (const studentId of studentIds) {
        await awardLigaPoints(admin, {
          orgId,
          seasonId: season.id,
          studentId,
          sport,
          points,
          reason: 'tournament_result',
          sourceId: tournamentId,
          note: `${place}º lugar`,
        })
      }
    }
  } catch (err) {
    console.error('[liga] syncTournamentResultPoints falhou', {
      tournamentId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
```

- [ ] **Step 2: Ligar nas actions de torneio**

Em `features/torneios/actions.ts`, acrescente o import:

```ts
import { awardTournamentEntry, syncTournamentResultPoints } from '@/features/liga/tournamentPoints'
```

Ligue nos quatro pontos, sempre DEPOIS de a operação principal ter sucesso (logo antes do
`return` de sucesso de cada função):

1. Em `registerForTournament`, quando a inscrição resultou em `entry_status === 'confirmed'`:
```ts
  await awardTournamentEntry(adminClient, { orgId, tournamentId, studentId })
```
2. Em `confirmWaitlistOffer`, quando a inscrição passou a confirmada — mesma chamada, com o
   `studentId` daquela inscrição.
3. Em `closeTournament`, depois de gravar `winner*_id` e `status: 'finished'`:
```ts
  await syncTournamentResultPoints(adminClient, { orgId, tournamentId })
```
4. Em `updateWinners`, capturando os vencedores ANTES do update para poder revogar:
```ts
  // antes do update dos winners
  const { data: before } = await adminClient
    .from('tournaments')
    .select('winner1_id, winner1_partner_id, winner2_id, winner2_partner_id, winner3_id, winner3_partner_id')
    .eq('id', tournamentId)
    .eq('organization_id', orgId)
    .maybeSingle()
  const previousWinnerIds = Object.values(before ?? {}).filter(
    (v): v is string => typeof v === 'string',
  )

  // ... update existente dos winners ...

  await syncTournamentResultPoints(adminClient, { orgId, tournamentId, previousWinnerIds })
```

Se os nomes das variáveis locais (`adminClient`, `orgId`, `tournamentId`, `studentId`) diferirem
nessas funções, use os nomes reais do arquivo — leia cada função antes de editar.

- [ ] **Step 3: Verificar build e testes**

Run: `npm run build`
Expected: compila sem erro.

Run (PowerShell): `npm run test:run`
Expected: suíte existente verde (há testes de torneio em `lib/torneios/waitlist.test.ts` que não
podem quebrar).

- [ ] **Step 4: Commit**

```bash
git add features/liga/tournamentPoints.ts features/torneios/actions.ts
git commit -m "feat(liga): pontos por inscricao e podio de torneio"
```

---

### Task 12: Bônus manual do professor

**Files:**
- Create: `features/liga/adminActions.ts`

- [ ] **Step 1: Criar a action**

```ts
'use server'
// features/liga/adminActions.ts
// Bônus manual: o que faz o ranking ser "da academia dele" (spec §Fase 1).
import { revalidatePath } from 'next/cache'
import { createClient, createAdminClient, getActiveOrgId } from '@/lib/supabase/server'
import { getOrgSports } from '@/lib/arenas/orgSports'
import { normalizeSportForOrg } from '@/lib/arenas/sports'
import { getLigaSettings } from './settings'
import { getOrCreateActiveSeason } from './season'
import { awardLigaPoints } from './awardPoints'

const MAX_MANUAL_POINTS = 500

export interface AwardBonusInput {
  studentId: string
  sport: string
  points: number
  note: string
}

/**
 * Dá pontos na mão para um aluno. Admin da academia ativa apenas.
 *
 * `note` é obrigatório porque é o que aparece no extrato do aluno como
 * "+20 · Destaque da aula de quinta". Sem motivo, o ponto manual viraria uma
 * caixa-preta que o professor não consegue justificar quando questionado.
 */
export async function awardLigaBonus(input: AwardBonusInput): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const adminClient = createAdminClient()
  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  const { data: callerMembership } = await adminClient
    .from('memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .single()
  if (callerMembership?.role !== 'admin') return { error: 'Sem permissão.' }

  const note = input.note.trim()
  if (!note) return { error: 'Descreva o motivo do bônus.' }

  if (!Number.isInteger(input.points) || input.points === 0) {
    return { error: 'Pontos devem ser um número inteiro diferente de zero.' }
  }
  if (Math.abs(input.points) > MAX_MANUAL_POINTS) {
    return { error: `Máximo de ${MAX_MANUAL_POINTS} pontos por bônus.` }
  }

  const orgSports = await getOrgSports(orgId)
  const sport = normalizeSportForOrg(input.sport, orgSports)
  if (!sport) return { error: 'Escolha uma modalidade válida.' }

  // O aluno precisa ser da academia.
  const { data: target } = await adminClient
    .from('memberships')
    .select('user_id')
    .eq('user_id', input.studentId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!target) return { error: 'Aluno não encontrado nesta academia.' }

  const settings = await getLigaSettings(orgId)
  if (!settings.enabled) return { error: 'A Liga está desligada nas configurações.' }

  const season = await getOrCreateActiveSeason(orgId)
  if (!season) return { error: 'Não foi possível abrir a temporada.' }

  // sourceId aleatório: bônus manual não tem evento de origem, e vários bônus na
  // mesma temporada precisam coexistir (o índice único inclui source_id).
  await awardLigaPoints(adminClient, {
    orgId,
    seasonId: season.id,
    studentId: input.studentId,
    sport,
    points: input.points,
    reason: 'manual',
    sourceId: crypto.randomUUID(),
    note,
    awardedBy: user.id,
  })

  revalidatePath('/admin/liga')
  return {}
}
```

- [ ] **Step 2: Verificar o build**

Run: `npm run build`
Expected: compila sem erro.

- [ ] **Step 3: Commit**

```bash
git add features/liga/adminActions.ts
git commit -m "feat(liga): server action de bonus manual do professor"
```

---

### Task 13: Cron de sequência semanal

**Files:**
- Create: `features/liga/streakSync.ts`
- Create: `app/api/cron/liga-streak/route.ts`
- Modify: `vercel.json`

- [ ] **Step 1: Criar a sincronização de sequência**

```ts
// features/liga/streakSync.ts
// Recalcula a sequência de semanas e credita o bônus semanal, uma vez por semana
// por aluno/esporte (spec §Fase 1).
import { startOfISOWeek, format } from 'date-fns'
import { createAdminClient } from '@/lib/supabase/server'
import { computeStreakWeeks } from '@/lib/liga/streak'
import { pointsForStreakWeek } from '@/lib/liga/points'
import { sportForAttendance } from '@/lib/liga/sportForPoints'
import { getOrgSports } from '@/lib/arenas/orgSports'
import { getLigaSettings } from './settings'
import { getOrCreateActiveSeason } from './season'
import { awardLigaPoints } from './awardPoints'

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * UUID determinístico da semana, usado como `source_id` do bônus de sequência.
 *
 * Precisa ser estável para que o índice único do extrato impeça o cron de creditar o
 * mesmo bônus duas vezes na mesma semana (ele roda todo dia). Os 12 primeiros dígitos
 * carregam a data da segunda-feira daquela semana.
 */
export function weekSourceId(weekStart: Date): string {
  const ymd = format(weekStart, 'yyyyMMdd')
  return `00000000-0000-4000-8000-${ymd}0000`
}

interface AttendanceRow {
  student_id: string
  session_date: string
  class_sport: string | null
}

/** Presenças confirmadas da academia nas últimas ~30 semanas, com a modalidade da turma. */
async function loadRecentAttendance(
  admin: AdminClient,
  orgId: string,
  sinceIso: string,
): Promise<AttendanceRow[]> {
  const { data } = await admin
    .from('attendance')
    .select('student_id, class_sessions!inner(session_date, classes(sport))')
    .eq('organization_id', orgId)
    .eq('status', 'present')
    .gte('class_sessions.session_date', sinceIso)

  type Raw = {
    student_id: string
    class_sessions:
      | { session_date: string; classes: { sport: string | null } | { sport: string | null }[] }
      | { session_date: string; classes: { sport: string | null } | { sport: string | null }[] }[]
  }

  return ((data ?? []) as Raw[]).map((r) => {
    const session = Array.isArray(r.class_sessions) ? r.class_sessions[0] : r.class_sessions
    const cls = Array.isArray(session?.classes) ? session?.classes[0] : session?.classes
    return {
      student_id: r.student_id,
      session_date: session?.session_date ?? '',
      class_sport: cls?.sport ?? null,
    }
  }).filter((r) => r.session_date !== '')
}

export interface StreakSyncResult {
  studentsTouched: number
  bonusesAwarded: number
}

/**
 * Recalcula `streak_weeks` e credita o bônus da semana corrente para uma academia.
 *
 * Roda todo dia. O bônus é creditado no máximo uma vez por semana por (aluno, esporte)
 * graças ao `weekSourceId` determinístico — rodar cinco vezes na mesma semana credita
 * uma vez só.
 */
export async function syncLigaStreaks(
  admin: AdminClient,
  orgId: string,
  now: Date = new Date(),
): Promise<StreakSyncResult> {
  const settings = await getLigaSettings(orgId)
  if (!settings.enabled) return { studentsTouched: 0, bonusesAwarded: 0 }

  const season = await getOrCreateActiveSeason(orgId, now)
  if (!season) return { studentsTouched: 0, bonusesAwarded: 0 }

  const orgSports = await getOrgSports(orgId)
  // 30 semanas cobre qualquer sequência que o bônus consiga distinguir (teto de 4x).
  const since = new Date(now.getTime() - 30 * 7 * 24 * 3600 * 1000)
  const rows = await loadRecentAttendance(admin, orgId, format(since, 'yyyy-MM-dd'))

  // (aluno, esporte) → datas de presença
  const byStudentSport = new Map<string, string[]>()
  for (const row of rows) {
    const sport = sportForAttendance(row.class_sport, orgSports)
    if (!sport) continue
    const key = `${row.student_id}::${sport}`
    const list = byStudentSport.get(key) ?? []
    list.push(row.session_date)
    byStudentSport.set(key, list)
  }

  const sourceId = weekSourceId(startOfISOWeek(now))
  let studentsTouched = 0
  let bonusesAwarded = 0

  for (const [key, dates] of byStudentSport) {
    const [studentId, sport] = key.split('::')
    const streakWeeks = computeStreakWeeks(dates, now)

    await admin
      .from('liga_standings')
      .update({ streak_weeks: streakWeeks })
      .eq('season_id', season.id)
      .eq('student_id', studentId)
      .eq('sport', sport)
    studentsTouched++

    const points = pointsForStreakWeek(streakWeeks, settings.weights)
    if (points <= 0) continue

    await awardLigaPoints(admin, {
      orgId,
      seasonId: season.id,
      studentId,
      sport,
      points,
      reason: 'streak',
      sourceId,
      note: `${streakWeeks} semana(s) seguidas`,
    })
    bonusesAwarded++
  }

  return { studentsTouched, bonusesAwarded }
}
```

- [ ] **Step 2: Criar a rota do cron**

```ts
// app/api/cron/liga-streak/route.ts
// Recalcula sequências e credita o bônus semanal da Liga. Diário; o bônus é
// idempotente por semana (features/liga/streakSync.ts).
import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { createAdminClient } from '@/lib/supabase/server'
import { verifyCronSecret } from '@/lib/auth/cronAuth'
import { syncLigaStreaks } from '@/features/liga/streakSync'

export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const admin = createAdminClient()
    const now = new Date()

    const { data: settingsRows, error: settingsErr } = await admin
      .from('system_settings')
      .select('organization_id')
      .eq('key', 'liga_enabled')
      .eq('value', 'true')

    if (settingsErr) throw new Error(settingsErr.message)

    const orgIds = [...new Set((settingsRows ?? []).map((r: { organization_id: string }) => r.organization_id))]

    let studentsTouched = 0
    let bonusesAwarded = 0
    let failed = 0

    for (const orgId of orgIds) {
      try {
        const result = await syncLigaStreaks(admin, orgId, now)
        studentsTouched += result.studentsTouched
        bonusesAwarded += result.bonusesAwarded
      } catch (err) {
        failed++
        console.error('[cron/liga-streak] falhou para uma academia', {
          organizationId: orgId,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    return NextResponse.json({ orgs: orgIds.length, studentsTouched, bonusesAwarded, failed })
  } catch (e) {
    Sentry.captureException(e, { tags: { cron: 'liga-streak' } })
    return NextResponse.json({ error: 'Cron failed' }, { status: 500 })
  }
}
```

- [ ] **Step 3: Registrar em `vercel.json`**

Acrescente ao array `crons` (06:00 UTC, depois do `weekly-grid-generation` das 05:00):

```json
    {
      "path": "/api/cron/liga-streak",
      "schedule": "0 6 * * *"
    }
```

- [ ] **Step 4: Verificar build**

Run: `npm run build`
Expected: compila e lista `/api/cron/liga-streak` nas rotas.

- [ ] **Step 5: Commit**

```bash
git add features/liga/streakSync.ts app/api/cron/liga-streak/route.ts vercel.json
git commit -m "feat(liga): cron diario de sequencia com bonus semanal idempotente"
```

---

### Task 14: Cron de fechamento de temporada

**Files:**
- Create: `features/liga/seasonClose.ts`
- Create: `app/api/cron/liga-season-close/route.ts`
- Modify: `vercel.json`

- [ ] **Step 1: Criar o fechamento**

```ts
// features/liga/seasonClose.ts
// Fecha a temporada, move as divisões e abre a temporada nova (spec §Fechamento).
import { createAdminClient } from '@/lib/supabase/server'
import {
  computeDivisionMoves,
  DIVISION_ORDER,
  type Division,
  type StandingRow,
} from '@/lib/liga/divisions'
import { getLigaSettings } from './settings'
import { getOrCreateActiveSeason, monthBounds } from './season'
import type { LigaSeason } from '@/types'

type AdminClient = ReturnType<typeof createAdminClient>

interface StandingDbRow {
  student_id: string
  sport: string
  division: Division
  points: number
  streak_weeks: number
}

export interface SeasonCloseResult {
  closed: boolean
  promoted: number
  demoted: number
  carried: number
}

/**
 * Fecha a temporada anterior de uma academia e cria a do mês corrente.
 *
 * Idempotente: se já existe temporada para o mês corrente, não faz nada. O
 * `unique (organization_id, starts_on)` é a garantia final.
 *
 * `streak_weeks` é copiado para a temporada nova: a sequência é do aluno naquele
 * esporte e atravessa temporadas — zerá-la no dia 1º puniria quem nunca faltou.
 */
export async function closeLigaSeason(
  admin: AdminClient,
  orgId: string,
  now: Date = new Date(),
): Promise<SeasonCloseResult> {
  const empty: SeasonCloseResult = { closed: false, promoted: 0, demoted: 0, carried: 0 }

  const settings = await getLigaSettings(orgId)
  if (!settings.enabled) return empty

  const { startsOn } = monthBounds(now)

  // Já virou o mês? Se a temporada do mês corrente existe, o fechamento já rodou.
  const { data: current } = await admin
    .from('liga_seasons')
    .select('id')
    .eq('organization_id', orgId)
    .eq('starts_on', startsOn)
    .maybeSingle()
  if (current) return empty

  // Temporada a fechar: a ativa mais recente que não é a do mês corrente.
  const { data: previousRaw } = await admin
    .from('liga_seasons')
    .select('*')
    .eq('organization_id', orgId)
    .eq('status', 'active')
    .order('starts_on', { ascending: false })
    .limit(1)
    .maybeSingle()

  const previous = previousRaw as LigaSeason | null

  // Nada a fechar: cria só a temporada nova (academia acabou de ligar a Liga).
  if (!previous) {
    await getOrCreateActiveSeason(orgId, now)
    return { ...empty, closed: false }
  }

  const { data: standingsRaw } = await admin
    .from('liga_standings')
    .select('student_id, sport, division, points, streak_weeks')
    .eq('season_id', previous.id)

  const standings = (standingsRaw ?? []) as StandingDbRow[]

  // Movimentação é calculada por esporte: cada ranking tem sua própria escada.
  const bySport = new Map<string, StandingDbRow[]>()
  for (const row of standings) {
    const list = bySport.get(row.sport) ?? []
    list.push(row)
    bySport.set(row.sport, list)
  }

  const nextDivision = new Map<string, Division>() // `${studentId}::${sport}` → divisão
  let promoted = 0
  let demoted = 0

  for (const [sport, rows] of bySport) {
    const input: StandingRow[] = rows.map((r) => ({
      studentId: r.student_id,
      points: r.points,
      division: r.division,
    }))
    for (const move of computeDivisionMoves(input, settings.promoteCount, settings.demoteCount)) {
      nextDivision.set(`${move.studentId}::${sport}`, move.to)
      // Comparar pelo índice da escada, não pelas strings: a ordem alfabética de
      // Division não reflete a hierarquia ('bronze' < 'diamante' < 'ouro' < 'prata').
      const upward = DIVISION_ORDER.indexOf(move.to) > DIVISION_ORDER.indexOf(move.from)
      if (upward) promoted++
      else demoted++
    }
  }

  await admin.from('liga_seasons').update({ status: 'closed' }).eq('id', previous.id)

  const season = await getOrCreateActiveSeason(orgId, now)
  if (!season) return { closed: true, promoted, demoted, carried: 0 }

  const carriedRows = standings.map((r) => ({
    organization_id: orgId,
    season_id: season.id,
    student_id: r.student_id,
    sport: r.sport,
    division: nextDivision.get(`${r.student_id}::${r.sport}`) ?? r.division,
    points: 0,
    streak_weeks: r.streak_weeks,
  }))

  if (carriedRows.length > 0) {
    await admin
      .from('liga_standings')
      .upsert(carriedRows, { onConflict: 'season_id,student_id,sport' })
  }

  return { closed: true, promoted, demoted, carried: carriedRows.length }
}
```

- [ ] **Step 2: Criar a rota do cron**

```ts
// app/api/cron/liga-season-close/route.ts
// Fecha a temporada da Liga e abre a próxima. Mensal, dia 1º.
import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { createAdminClient } from '@/lib/supabase/server'
import { verifyCronSecret } from '@/lib/auth/cronAuth'
import { closeLigaSeason } from '@/features/liga/seasonClose'

export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const admin = createAdminClient()
    const now = new Date()

    const { data: settingsRows, error: settingsErr } = await admin
      .from('system_settings')
      .select('organization_id')
      .eq('key', 'liga_enabled')
      .eq('value', 'true')

    if (settingsErr) throw new Error(settingsErr.message)

    const orgIds = [...new Set((settingsRows ?? []).map((r: { organization_id: string }) => r.organization_id))]

    let closed = 0
    let promoted = 0
    let demoted = 0
    let failed = 0

    for (const orgId of orgIds) {
      try {
        const result = await closeLigaSeason(admin, orgId, now)
        if (result.closed) closed++
        promoted += result.promoted
        demoted += result.demoted
      } catch (err) {
        failed++
        console.error('[cron/liga-season-close] falhou para uma academia', {
          organizationId: orgId,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    return NextResponse.json({ orgs: orgIds.length, closed, promoted, demoted, failed })
  } catch (e) {
    Sentry.captureException(e, { tags: { cron: 'liga-season-close' } })
    return NextResponse.json({ error: 'Cron failed' }, { status: 500 })
  }
}
```

- [ ] **Step 3: Registrar em `vercel.json`**

```json
    {
      "path": "/api/cron/liga-season-close",
      "schedule": "0 5 1 * *"
    }
```

- [ ] **Step 4: Verificar build**

Run: `npm run build`
Expected: compila e lista `/api/cron/liga-season-close`.

- [ ] **Step 5: Commit**

```bash
git add features/liga/seasonClose.ts app/api/cron/liga-season-close/route.ts vercel.json
git commit -m "feat(liga): cron mensal de fechamento de temporada com promocao e rebaixamento"
```

---

### Task 15: Leitura da Liga para o aluno

**Files:**
- Create: `features/liga/queries.ts`

- [ ] **Step 1: Criar o módulo de leitura**

```ts
// features/liga/queries.ts
// Leituras da Liga para a tela do aluno. Tudo escopado por organization_id.
import { createAdminClient } from '@/lib/supabase/server'
import type { LigaDivision, LigaPointEntry, LigaSeason } from '@/types'

export interface RankingEntry {
  studentId: string
  fullName: string
  avatarUrl: string | null
  points: number
  position: number
  isMe: boolean
}

export interface LigaView {
  season: LigaSeason
  sport: string
  division: LigaDivision
  points: number
  streakWeeks: number
  position: number
  divisionSize: number
  pointsToPromote: number | null
  ranking: RankingEntry[]
  ledger: LigaPointEntry[]
}

/** Esportes em que o aluno tem posição nesta temporada, mais os que ele declarou. */
export async function getStudentLigaSports(
  orgId: string,
  studentId: string,
  seasonId: string,
): Promise<string[]> {
  const admin = createAdminClient()

  const [{ data: membership }, { data: standings }] = await Promise.all([
    admin
      .from('memberships')
      .select('sports')
      .eq('user_id', studentId)
      .eq('organization_id', orgId)
      .maybeSingle(),
    admin
      .from('liga_standings')
      .select('sport')
      .eq('season_id', seasonId)
      .eq('student_id', studentId),
  ])

  const declared = ((membership as { sports: string[] } | null)?.sports ?? [])
  const scored = ((standings ?? []) as { sport: string }[]).map((r) => r.sport)
  return [...new Set([...declared, ...scored])]
}

/**
 * Tudo o que a tela da Liga precisa para um (aluno, esporte).
 *
 * O ranking exclui quem optou por sair (`memberships.liga_opted_out`), exceto o
 * próprio aluno — quem saiu continua vendo a própria posição.
 */
export async function getLigaView(
  orgId: string,
  studentId: string,
  season: LigaSeason,
  sport: string,
  promoteCount: number,
): Promise<LigaView | null> {
  const admin = createAdminClient()

  const { data: mine } = await admin
    .from('liga_standings')
    .select('division, points, streak_weeks')
    .eq('season_id', season.id)
    .eq('student_id', studentId)
    .eq('sport', sport)
    .maybeSingle()

  const standing = (mine as { division: LigaDivision; points: number; streak_weeks: number } | null)
    ?? { division: 'bronze' as LigaDivision, points: 0, streak_weeks: 0 }

  const { data: divisionRows } = await admin
    .from('liga_standings')
    .select('student_id, points')
    .eq('season_id', season.id)
    .eq('sport', sport)
    .eq('division', standing.division)
    .order('points', { ascending: false })

  const rows = ((divisionRows ?? []) as { student_id: string; points: number }[])

  // Nomes e opt-out de todos os envolvidos, numa consulta.
  const ids = rows.map((r) => r.student_id)
  const [{ data: profiles }, { data: memberships }] = await Promise.all([
    ids.length > 0
      ? admin.from('profiles').select('id, full_name, avatar_url').in('id', ids)
      : Promise.resolve({ data: [] as { id: string; full_name: string; avatar_url: string | null }[] }),
    ids.length > 0
      ? admin
          .from('memberships')
          .select('user_id, liga_opted_out')
          .eq('organization_id', orgId)
          .in('user_id', ids)
      : Promise.resolve({ data: [] as { user_id: string; liga_opted_out: boolean }[] }),
  ])

  const profileById = new Map(
    ((profiles ?? []) as { id: string; full_name: string; avatar_url: string | null }[]).map((p) => [p.id, p]),
  )
  const optedOut = new Set(
    ((memberships ?? []) as { user_id: string; liga_opted_out: boolean }[])
      .filter((m) => m.liga_opted_out)
      .map((m) => m.user_id),
  )

  const ranking: RankingEntry[] = rows
    .map((r, i) => ({
      studentId: r.student_id,
      fullName: profileById.get(r.student_id)?.full_name ?? 'Aluno',
      avatarUrl: profileById.get(r.student_id)?.avatar_url ?? null,
      points: r.points,
      position: i + 1,
      isMe: r.student_id === studentId,
    }))
    .filter((e) => e.isMe || !optedOut.has(e.studentId))

  const myPosition = rows.findIndex((r) => r.student_id === studentId) + 1

  // Quanto falta para entrar na zona de promoção — o corte é o último colocado que
  // ainda sobe, então depende do promoteCount configurado pela academia.
  const cutoffIndex = Math.max(0, Math.min(rows.length - 1, promoteCount - 1))
  const promoteCutoff = rows[cutoffIndex]?.points ?? 0
  const alreadyPromoting = myPosition > 0 && myPosition <= promoteCount
  const pointsToPromote =
    standing.division === 'diamante' || alreadyPromoting
      ? null
      : Math.max(1, promoteCutoff - standing.points + 1)

  const { data: ledgerRows } = await admin
    .from('liga_points')
    .select('*')
    .eq('season_id', season.id)
    .eq('student_id', studentId)
    .eq('sport', sport)
    .order('created_at', { ascending: false })
    .limit(30)

  return {
    season,
    sport,
    division: standing.division,
    points: standing.points,
    streakWeeks: standing.streak_weeks,
    position: myPosition > 0 ? myPosition : rows.length + 1,
    divisionSize: rows.length,
    pointsToPromote,
    ranking,
    ledger: (ledgerRows ?? []) as LigaPointEntry[],
  }
}
```

- [ ] **Step 2: Verificar o build**

Run: `npm run build`
Expected: compila sem erro.

- [ ] **Step 3: Commit**

```bash
git add features/liga/queries.ts
git commit -m "feat(liga): leituras da tela do aluno"
```

---

### Task 16: Componentes da tela do aluno

**Files:**
- Create: `features/liga/SeasonCard.tsx`
- Create: `features/liga/StreakCard.tsx`
- Create: `features/liga/DivisionRanking.tsx`
- Create: `features/liga/PointsLedger.tsx`
- Create: `features/liga/SportTabs.tsx`
- Create: `lib/liga/labels.ts`

- [ ] **Step 1: Criar os rótulos de divisão**

```ts
// lib/liga/labels.ts
import type { Division } from './divisions'

export const DIVISION_LABEL: Record<Division, string> = {
  bronze: 'Divisão Bronze',
  prata: 'Divisão Prata',
  ouro: 'Divisão Ouro',
  diamante: 'Divisão Diamante',
}

export const POINT_REASON_LABEL: Record<string, string> = {
  attendance: 'Presença em aula',
  streak: 'Sequência de semanas',
  tournament_entry: 'Inscrição em torneio',
  tournament_result: 'Resultado de torneio',
  manual: 'Bônus da academia',
  kudos_given: 'Elogio enviado',
  kudos_received: 'Elogio recebido',
}
```

- [ ] **Step 2: Criar `SeasonCard.tsx`**

```tsx
// features/liga/SeasonCard.tsx
import { Shield } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { DIVISION_LABEL } from '@/lib/liga/labels'
import { sportLabel } from '@/lib/arenas/sports'
import type { LigaDivision } from '@/types'

interface Props {
  division: LigaDivision
  points: number
  position: number
  divisionSize: number
  pointsToPromote: number | null
  sport: string
  endsOn: string
}

/** Dias restantes até o fim da temporada, contando pelo relógio do servidor. */
function daysLeft(endsOn: string): number {
  const end = new Date(`${endsOn}T23:59:59`)
  return Math.max(0, Math.ceil((end.getTime() - Date.now()) / 86400000))
}

export function SeasonCard({
  division, points, position, divisionSize, pointsToPromote, sport, endsOn,
}: Props) {
  const progress = pointsToPromote === null
    ? 100
    : Math.min(100, Math.round((points / Math.max(1, points + pointsToPromote)) * 100))

  return (
    <Card>
      <div className="flex items-center gap-3 mb-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-500/10 border border-brand-500/30">
          <Shield className="h-6 w-6 text-brand-500" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white truncate">{DIVISION_LABEL[division]}</p>
          <p className="text-xs text-slate-400">
            {position}º de {divisionSize} · {sportLabel(sport)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-semibold text-brand-500 leading-none">{points}</p>
          <p className="text-xs text-slate-400">pontos</p>
        </div>
      </div>

      <div className="h-1.5 rounded-full bg-surface overflow-hidden mb-1.5">
        <div className="h-full rounded-full bg-brand-500" style={{ width: `${progress}%` }} />
      </div>
      <p className="text-xs text-slate-400">
        {pointsToPromote === null
          ? `Temporada termina em ${daysLeft(endsOn)} dia(s)`
          : `${pointsToPromote} ponto(s) para entrar na zona de promoção · termina em ${daysLeft(endsOn)} dia(s)`}
      </p>
    </Card>
  )
}
```

- [ ] **Step 3: Criar `StreakCard.tsx`**

```tsx
// features/liga/StreakCard.tsx
import { Flame } from 'lucide-react'
import { Card } from '@/components/ui/Card'

interface Props {
  streakWeeks: number
}

export function StreakCard({ streakWeeks }: Props) {
  return (
    <Card>
      <div className="flex items-center gap-3">
        <Flame className="h-5 w-5 text-brand-500 shrink-0" />
        <div className="min-w-0">
          <p className="text-lg font-semibold text-white leading-tight">
            {streakWeeks} {streakWeeks === 1 ? 'semana' : 'semanas'}
          </p>
          <p className="text-xs text-slate-400">
            {streakWeeks === 0
              ? 'Treine essa semana para começar sua sequência'
              : 'seguidas treinando — não perca o ritmo'}
          </p>
        </div>
      </div>
    </Card>
  )
}
```

- [ ] **Step 4: Criar `DivisionRanking.tsx`**

```tsx
// features/liga/DivisionRanking.tsx
import { Card } from '@/components/ui/Card'
import { cn } from '@/lib/utils/cn'
import type { RankingEntry } from './queries'

interface Props {
  entries: RankingEntry[]
}

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('')
}

export function DivisionRanking({ entries }: Props) {
  if (entries.length === 0) {
    return (
      <Card>
        <p className="text-sm text-slate-300">
          Ninguém pontuou nessa modalidade ainda. Sua próxima aula já entra no ranking.
        </p>
      </Card>
    )
  }

  return (
    <Card>
      <p className="text-xs text-slate-400 tracking-wide mb-3">RANKING DA DIVISÃO</p>
      <ul>
        {entries.map((e) => (
          <li
            key={e.studentId}
            className={cn(
              'flex items-center gap-2.5 py-1.5',
              e.isMe && 'bg-brand-500/10 border-l-2 border-brand-500 -mx-2 px-2',
            )}
          >
            <span className={cn('w-5 text-xs', e.isMe ? 'text-brand-500 font-medium' : 'text-slate-400')}>
              {e.position}
            </span>
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-border text-[10px] text-slate-300 shrink-0">
              {initials(e.fullName)}
            </span>
            <span className={cn('flex-1 text-sm truncate', e.isMe ? 'text-white font-medium' : 'text-slate-200')}>
              {e.isMe ? 'Você' : e.fullName}
            </span>
            <span className={cn('text-xs', e.isMe ? 'text-brand-500 font-medium' : 'text-slate-400')}>
              {e.points}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  )
}
```

- [ ] **Step 5: Criar `PointsLedger.tsx`**

```tsx
// features/liga/PointsLedger.tsx
import { Card } from '@/components/ui/Card'
import { formatDate } from '@/lib/utils/dateHelpers'
import { POINT_REASON_LABEL } from '@/lib/liga/labels'
import type { LigaPointEntry } from '@/types'

interface Props {
  entries: LigaPointEntry[]
}

/**
 * Extrato do aluno. Existe para que "por que ele tem mais ponto que eu?" tenha
 * resposta — sem extrato, gamificação vira caixa-preta e gera discussão na quadra.
 */
export function PointsLedger({ entries }: Props) {
  if (entries.length === 0) return null

  return (
    <Card>
      <p className="text-xs text-slate-400 tracking-wide mb-3">DE ONDE VIERAM MEUS PONTOS</p>
      <ul className="space-y-2">
        {entries.map((e) => (
          <li key={e.id} className="flex items-start gap-2 text-sm">
            <span className="text-brand-500 font-medium shrink-0 w-12">
              {e.points > 0 ? `+${e.points}` : e.points}
            </span>
            <span className="flex-1 min-w-0">
              <span className="text-slate-200">{POINT_REASON_LABEL[e.reason] ?? e.reason}</span>
              {e.note && <span className="text-slate-400"> — {e.note}</span>}
            </span>
            <span className="text-xs text-slate-500 shrink-0">{formatDate(e.created_at)}</span>
          </li>
        ))}
      </ul>
    </Card>
  )
}
```

- [ ] **Step 6: Criar `SportTabs.tsx`**

```tsx
// features/liga/SportTabs.tsx
import Link from 'next/link'
import { cn } from '@/lib/utils/cn'
import { sportLabel, sportEmoji } from '@/lib/arenas/sports'

interface Props {
  sports: string[]
  active: string
}

/**
 * Alternância entre rankings. Só renderiza com mais de um esporte — quem pratica
 * uma modalidade só nunca vê essa complexidade.
 */
export function SportTabs({ sports, active }: Props) {
  if (sports.length <= 1) return null

  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {sports.map((sport) => (
        <Link
          key={sport}
          href={`/liga?esporte=${encodeURIComponent(sport)}`}
          className={cn(
            'shrink-0 rounded-full border px-3 py-1.5 text-xs transition-colors',
            sport === active
              ? 'border-brand-500 bg-brand-500/10 text-brand-500'
              : 'border-surface-border text-slate-400 hover:text-slate-200',
          )}
        >
          {sportEmoji(sport)} {sportLabel(sport)}
        </Link>
      ))}
    </div>
  )
}
```

- [ ] **Step 7: Verificar o build**

Run: `npm run build`
Expected: compila sem erro (os componentes ainda não são importados por nenhuma rota).

- [ ] **Step 8: Commit**

```bash
git add features/liga/SeasonCard.tsx features/liga/StreakCard.tsx features/liga/DivisionRanking.tsx features/liga/PointsLedger.tsx features/liga/SportTabs.tsx lib/liga/labels.ts
git commit -m "feat(liga): componentes da tela do aluno"
```

---

### Task 17: Rota `/liga`, menu e redirect de `/video`

**Files:**
- Create: `app/(dashboard)/liga/page.tsx`
- Create: `app/(dashboard)/liga/VideoBlock.tsx`
- Modify: `components/ui/BottomNav.tsx`
- Modify: `app/(dashboard)/video/page.tsx` (virar redirect)
- Delete: `app/(dashboard)/video/VideoClient.tsx`

- [ ] **Step 1: Extrair o bloco de vídeo**

O conteúdo atual de `app/(dashboard)/video/VideoClient.tsx` vira um bloco dentro da Liga, sem o
header próprio:

```tsx
'use client'
// app/(dashboard)/liga/VideoBlock.tsx
// Vídeos das quadras dentro da Liga (spec 2026-07-31-video-cameras-iframe).
import { Card } from '@/components/ui/Card'

interface Props {
  videoFeedUrl: string | null
}

export function VideoBlock({ videoFeedUrl }: Props) {
  if (!videoFeedUrl) return null

  return (
    <Card>
      <p className="text-xs text-slate-400 tracking-wide mb-3">VÍDEOS DAS QUADRAS</p>
      <div className="rounded-xl border border-brand-600/40 bg-brand-600/10 p-3 space-y-2 mb-3">
        <p className="text-sm text-slate-200">
          Alguns sites de vídeo não aceitam login dentro do app. Se a tela abaixo não deixar
          entrar, abra em uma aba separada:
        </p>
        <a
          href={videoFeedUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex w-full items-center justify-center rounded-lg bg-gradient-to-r from-brand-600 to-brand-700 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-brand-600/25 transition-all hover:from-brand-500 hover:to-brand-600 active:scale-[0.98]"
        >
          Abrir em nova aba →
        </a>
      </div>
      <p className="text-xs text-slate-500 mb-2">
        Conteúdo do site de vídeos da academia — fora do controle do ArenaHub. Não compartilhe
        senhas de outros serviços aqui.
      </p>
      {/* allow-scripts + allow-same-origin: necessário pro site de vídeos manter sessão de
          login (cookies/localStorage). allow-forms: envio do formulário de login.
          allow-popups: alguns provedores abrem OAuth/2FA em popup. Aceitável pois a URL só
          é definida por um admin da própria academia, nunca por conteúdo de terceiros/usuário. */}
      <iframe
        src={videoFeedUrl}
        className="w-full h-[60vh] rounded-xl border border-surface-border bg-surface-card"
        sandbox="allow-forms allow-scripts allow-same-origin allow-popups"
        title="Vídeos das quadras"
      />
    </Card>
  )
}
```

- [ ] **Step 2: Criar a rota `/liga`**

```tsx
// app/(dashboard)/liga/page.tsx
export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createClient, createAdminClient, getCurrentOrgId } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { getLigaSettings } from '@/features/liga/settings'
import { getOrCreateActiveSeason } from '@/features/liga/season'
import { getLigaView, getStudentLigaSports } from '@/features/liga/queries'
import { SeasonCard } from '@/features/liga/SeasonCard'
import { StreakCard } from '@/features/liga/StreakCard'
import { DivisionRanking } from '@/features/liga/DivisionRanking'
import { PointsLedger } from '@/features/liga/PointsLedger'
import { SportTabs } from '@/features/liga/SportTabs'
import { VideoBlock } from './VideoBlock'

async function readVideoFeedUrl(orgId: string | null): Promise<string | null> {
  if (!orgId) return null
  const { data } = await createAdminClient()
    .from('system_settings')
    .select('value')
    .eq('organization_id', orgId)
    .eq('key', 'video_feed_url')
    .maybeSingle()
  return (data as { value: string } | null)?.value ?? null
}

export default async function LigaPage({
  searchParams,
}: {
  searchParams: { esporte?: string }
}) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const orgId = await getCurrentOrgId()
  const [settings, videoFeedUrl] = await Promise.all([
    getLigaSettings(orgId),
    readVideoFeedUrl(orgId),
  ])

  const header = (
    <div className="sticky top-0 z-10 bg-surface border-b border-surface-border px-4 py-3">
      <SectionHeader title="Liga" />
    </div>
  )

  // Liga desligada: a aba continua servindo o vídeo, que é o que ela já fazia antes.
  if (!settings.enabled || !orgId) {
    return (
      <div className="relative min-h-full pb-24">
        {header}
        <div className="px-4 py-4 space-y-3">
          <VideoBlock videoFeedUrl={videoFeedUrl} />
          {!videoFeedUrl && (
            <Card>
              <p className="text-sm text-slate-300">
                A Liga ainda não foi ativada pela sua academia.
              </p>
            </Card>
          )}
        </div>
      </div>
    )
  }

  const season = await getOrCreateActiveSeason(orgId)
  if (!season) {
    return (
      <div className="relative min-h-full pb-24">
        {header}
        <div className="px-4 py-4 space-y-3">
          <Card>
            <p className="text-sm text-slate-300">A temporada ainda vai começar.</p>
          </Card>
          <VideoBlock videoFeedUrl={videoFeedUrl} />
        </div>
      </div>
    )
  }

  const sports = await getStudentLigaSports(orgId, user.id, season.id)

  if (sports.length === 0) {
    return (
      <div className="relative min-h-full pb-24">
        {header}
        <div className="px-4 py-4 space-y-3">
          <Card>
            <p className="text-sm text-slate-300">
              Escolha suas modalidades no perfil para entrar no ranking da academia.
            </p>
          </Card>
          <VideoBlock videoFeedUrl={videoFeedUrl} />
        </div>
      </div>
    )
  }

  const activeSport = sports.includes(searchParams.esporte ?? '')
    ? (searchParams.esporte as string)
    : sports[0]

  const view = await getLigaView(orgId, user.id, season, activeSport, settings.promoteCount)

  return (
    <div className="relative min-h-full pb-24">
      {header}
      <div className="px-4 py-4 space-y-3">
        <SportTabs sports={sports} active={activeSport} />
        {view && (
          <>
            <SeasonCard
              division={view.division}
              points={view.points}
              position={view.position}
              divisionSize={view.divisionSize}
              pointsToPromote={view.pointsToPromote}
              sport={view.sport}
              endsOn={season.ends_on}
            />
            <StreakCard streakWeeks={view.streakWeeks} />
            <DivisionRanking entries={view.ranking} />
            <PointsLedger entries={view.ledger} />
          </>
        )}
        <VideoBlock videoFeedUrl={videoFeedUrl} />
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Trocar o item do menu**

Em `components/ui/BottomNav.tsx`, troque o import de ícone e o item de menu:

```tsx
import { Home, MapPin, Plus, Trophy, User } from 'lucide-react'
```

```tsx
  { href: '/liga', icon: Trophy, label: 'Liga' },
```

(substituindo a linha `{ href: '/video', icon: Video, label: 'Vídeo' },`)

- [ ] **Step 4: Transformar `/video` em redirect**

Substitua todo o conteúdo de `app/(dashboard)/video/page.tsx` por:

```tsx
// app/(dashboard)/video/page.tsx
// A aba Vídeo virou a Liga (spec 2026-08-02-liga-gamificacao-aluno); o vídeo é um
// bloco lá dentro. Mantido como redirect porque a URL circulou entre alunos.
import { redirect } from 'next/navigation'

export default function VideoPage() {
  redirect('/liga')
}
```

E apague `app/(dashboard)/video/VideoClient.tsx`:

```bash
git rm "app/(dashboard)/video/VideoClient.tsx"
```

- [ ] **Step 5: Verificar build e testes**

Run: `npm run build`
Expected: compila e lista `/liga` e `/video` nas rotas.

Run (PowerShell): `npm run test:run`
Expected: suíte verde.

- [ ] **Step 6: Commit**

```bash
git add "app/(dashboard)/liga/page.tsx" "app/(dashboard)/liga/VideoBlock.tsx" components/ui/BottomNav.tsx "app/(dashboard)/video/page.tsx"
git commit -m "feat(liga): aba Liga substitui Video no menu, com o video como bloco interno"
```

---

### Task 18: Painel do professor — ranking e bônus

**Files:**
- Create: `app/(admin)/admin/liga/page.tsx`
- Create: `app/(admin)/admin/liga/LigaBonusForm.tsx`
- Modify: `app/(admin)/layout.tsx` (item de menu)

- [ ] **Step 1: Criar o formulário de bônus**

```tsx
'use client'
// app/(admin)/admin/liga/LigaBonusForm.tsx
import { useState, useTransition } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { awardLigaBonus } from '@/features/liga/adminActions'
import { sportLabel } from '@/lib/arenas/sports'

const SELECT_CLS = 'w-full bg-surface border border-surface-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-brand-500'

interface Props {
  students: { id: string; name: string }[]
  sports: string[]
}

export function LigaBonusForm({ students, sports }: Props) {
  const [studentId, setStudentId] = useState('')
  const [sport, setSport] = useState(sports[0] ?? '')
  const [points, setPoints] = useState('20')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(null)

    if (!studentId) { setError('Escolha um aluno.'); return }
    const parsed = parseInt(points, 10)
    if (isNaN(parsed) || parsed === 0) { setError('Pontos devem ser um inteiro diferente de zero.'); return }
    if (!note.trim()) { setError('Descreva o motivo — o aluno vê esse texto no extrato.'); return }

    startTransition(async () => {
      const result = await awardLigaBonus({ studentId, sport, points: parsed, note })
      if (result.error) setError(result.error)
      else {
        setSuccess('Bônus lançado.')
        setNote('')
      }
    })
  }

  return (
    <Card>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>
        )}
        {success && (
          <p className="text-sm text-green-400 bg-green-500/10 border border-green-500/30 rounded-lg px-3 py-2">{success}</p>
        )}

        <div className="space-y-1">
          <label className="text-sm text-slate-300 font-medium">Aluno</label>
          <select value={studentId} onChange={(e) => setStudentId(e.target.value)} className={SELECT_CLS}>
            <option value="">Selecione…</option>
            {students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-sm text-slate-300 font-medium">Modalidade</label>
          <select value={sport} onChange={(e) => setSport(e.target.value)} className={SELECT_CLS}>
            {sports.map((s) => <option key={s} value={s}>{sportLabel(s)}</option>)}
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-sm text-slate-300 font-medium">Pontos</label>
          <p className="text-xs text-slate-400">Use número negativo para descontar. Máximo 500 por lançamento.</p>
          <Input type="number" value={points} onChange={(e) => setPoints(e.target.value)} />
        </div>

        <div className="space-y-1">
          <label className="text-sm text-slate-300 font-medium">Motivo</label>
          <p className="text-xs text-slate-400">
            Aparece no extrato do aluno. Ex.: &quot;Destaque da aula de quinta&quot;.
          </p>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Destaque da aula de quinta" />
        </div>

        <Button type="submit" variant="primary" loading={pending}>Lançar bônus</Button>
      </form>
    </Card>
  )
}
```

- [ ] **Step 2: Criar a página do admin**

```tsx
// app/(admin)/admin/liga/page.tsx
import { createAdminClient, getCurrentOrgId, requireOwner } from '@/lib/supabase/server'
import { requirePlatformAccess } from '@/lib/billing/guard'
import { Card } from '@/components/ui/Card'
import { getOrgSports } from '@/lib/arenas/orgSports'
import { sportLabel } from '@/lib/arenas/sports'
import { getLigaSettings } from '@/features/liga/settings'
import { getOrCreateActiveSeason } from '@/features/liga/season'
import { DIVISION_LABEL } from '@/lib/liga/labels'
import { LigaBonusForm } from './LigaBonusForm'
import type { LigaDivision } from '@/types'

export const dynamic = 'force-dynamic'

export default async function AdminLigaPage() {
  await requirePlatformAccess()
  await requireOwner()

  const admin = createAdminClient()
  const orgId = await getCurrentOrgId()
  const [settings, orgSports] = await Promise.all([getLigaSettings(orgId), getOrgSports(orgId)])

  if (!orgId) return null

  if (!settings.enabled) {
    return (
      <div className="space-y-6 max-w-lg">
        <div>
          <h1 className="text-2xl font-bold text-white">Liga</h1>
          <p className="text-slate-400 text-sm mt-1">Ranking de temporada dos seus alunos</p>
        </div>
        <Card>
          <p className="text-sm text-slate-300">
            A Liga está desligada. Ative em <span className="text-brand-500">Configurações</span> para
            começar a pontuar presença, torneios e bônus.
          </p>
        </Card>
      </div>
    )
  }

  const season = await getOrCreateActiveSeason(orgId)

  // Turmas sem modalidade não pontuam (lib/liga/sportForPoints.ts). Só é problema
  // quando a academia tem mais de uma modalidade — com uma só, o fallback resolve.
  const { count: classesWithoutSport } = await admin
    .from('classes')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .is('sport', null)

  const { data: standingsRaw } = season
    ? await admin
        .from('liga_standings')
        .select('student_id, sport, division, points')
        .eq('season_id', season.id)
        .order('points', { ascending: false })
    : { data: [] }

  const standings = (standingsRaw ?? []) as {
    student_id: string
    sport: string
    division: LigaDivision
    points: number
  }[]

  const { data: membersRaw } = await admin
    .from('memberships')
    .select('user_id, profiles(full_name)')
    .eq('organization_id', orgId)
    .eq('role', 'student')

  const members = ((membersRaw ?? []) as {
    user_id: string
    profiles: { full_name: string } | { full_name: string }[] | null
  }[]).map((m) => {
    const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles
    return { id: m.user_id, name: p?.full_name ?? 'Aluno' }
  }).sort((a, b) => a.name.localeCompare(b.name))

  const nameById = new Map(members.map((m) => [m.id, m.name]))

  const bySport = new Map<string, typeof standings>()
  for (const row of standings) {
    const list = bySport.get(row.sport) ?? []
    list.push(row)
    bySport.set(row.sport, list)
  }

  return (
    <div className="space-y-8 max-w-lg">
      <div>
        <h1 className="text-2xl font-bold text-white">Liga</h1>
        <p className="text-slate-400 text-sm mt-1">
          {season ? `Temporada de ${season.starts_on} a ${season.ends_on}` : 'Sem temporada aberta'}
        </p>
      </div>

      {(classesWithoutSport ?? 0) > 0 && orgSports.length > 1 && (
        <Card>
          <p className="text-sm text-amber-300">
            {classesWithoutSport} turma(s) ativa(s) sem modalidade não estão pontuando na Liga.
            Defina a modalidade na Grade de Aulas para que a presença conte.
          </p>
        </Card>
      )}

      <div>
        <h2 className="text-lg font-bold text-white">Dar bônus</h2>
        <p className="text-slate-400 text-sm mt-1">
          Pontos por algo que o sistema não vê: destaque da aula, evolução, ajudou a montar a quadra.
        </p>
      </div>
      <LigaBonusForm students={members} sports={orgSports} />

      <div>
        <h2 className="text-lg font-bold text-white">Ranking</h2>
      </div>
      {bySport.size === 0 ? (
        <Card>
          <p className="text-sm text-slate-300">Ninguém pontuou nesta temporada ainda.</p>
        </Card>
      ) : (
        [...bySport.entries()].map(([sport, rows]) => (
          <Card key={sport}>
            <p className="text-xs text-slate-400 tracking-wide mb-3">{sportLabel(sport).toUpperCase()}</p>
            <ul className="space-y-1.5">
              {rows.map((r, i) => (
                <li key={`${r.student_id}-${r.sport}`} className="flex items-center gap-2 text-sm">
                  <span className="w-5 text-xs text-slate-400">{i + 1}</span>
                  <span className="flex-1 truncate text-slate-200">
                    {nameById.get(r.student_id) ?? 'Aluno'}
                  </span>
                  <span className="text-xs text-slate-500">{DIVISION_LABEL[r.division]}</span>
                  <span className="text-xs text-brand-500 font-medium w-10 text-right">{r.points}</span>
                </li>
              ))}
            </ul>
          </Card>
        ))
      )}
    </div>
  )
}
```

- [ ] **Step 3: Acrescentar o item no menu do admin**

Em `app/(admin)/layout.tsx`, encontre o array de itens de navegação (o que contém
`{ href: '/admin/torneios', ... }`) e acrescente, depois de Torneios:

```tsx
  { href: '/admin/liga', label: 'Liga' },
```

Se os itens tiverem outras propriedades (ícone, área de permissão), copie o formato exato do
item de Torneios vizinho — leia o arquivo antes de editar.

- [ ] **Step 4: Verificar build**

Run: `npm run build`
Expected: compila e lista `/admin/liga`.

- [ ] **Step 5: Commit**

```bash
git add "app/(admin)/admin/liga/page.tsx" "app/(admin)/admin/liga/LigaBonusForm.tsx" "app/(admin)/layout.tsx"
git commit -m "feat(liga): painel do professor com ranking e bonus manual"
```

---

### Task 19: Configuração da Liga em Configurações

**Files:**
- Create: `app/(admin)/admin/configuracoes/LigaSettingsForm.tsx`
- Modify: `app/(admin)/admin/configuracoes/page.tsx`
- Modify: `features/financeiro/actions.ts` (`updateSystemSettings`)

- [ ] **Step 1: Aceitar as chaves novas no server action**

Em `features/financeiro/actions.ts`, na assinatura de `updateSystemSettings`, acrescente:

```ts
  liga_enabled?: boolean
  liga_points_attendance?: number
  liga_points_streak_week?: number
  liga_points_tournament_entry?: number
  liga_points_tournament_win?: number
  liga_promote_count?: number
  liga_demote_count?: number
```

E, junto às outras validações (depois da de `video_feed_url`), acrescente:

```ts
  const ligaInts: [string, number | undefined][] = [
    ['Pontos por presença', settings.liga_points_attendance],
    ['Bônus de sequência', settings.liga_points_streak_week],
    ['Pontos por inscrição em torneio', settings.liga_points_tournament_entry],
    ['Pontos por vitória em torneio', settings.liga_points_tournament_win],
    ['Quantos sobem de divisão', settings.liga_promote_count],
    ['Quantos descem de divisão', settings.liga_demote_count],
  ]
  for (const [label, value] of ligaInts) {
    if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
      return { error: `${label} deve ser um número inteiro não-negativo.` }
    }
  }
```

O mapeamento genérico para `rows` já cobre as chaves novas sem mudança.

- [ ] **Step 2: Criar o formulário**

```tsx
'use client'
// app/(admin)/admin/configuracoes/LigaSettingsForm.tsx
import { useState, useTransition } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { updateSystemSettings } from '@/features/financeiro/actions'

interface Props {
  settings: {
    liga_enabled: boolean
    liga_points_attendance: number
    liga_points_streak_week: number
    liga_points_tournament_entry: number
    liga_points_tournament_win: number
    liga_promote_count: number
    liga_demote_count: number
  }
}

export function LigaSettingsForm({ settings }: Props) {
  const [enabled, setEnabled] = useState(settings.liga_enabled)
  const [attendance, setAttendance] = useState(String(settings.liga_points_attendance))
  const [streak, setStreak] = useState(String(settings.liga_points_streak_week))
  const [entry, setEntry] = useState(String(settings.liga_points_tournament_entry))
  const [win, setWin] = useState(String(settings.liga_points_tournament_win))
  const [promote, setPromote] = useState(String(settings.liga_promote_count))
  const [demote, setDemote] = useState(String(settings.liga_demote_count))
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(null)

    const nums = { attendance, streak, entry, win, promote, demote }
    for (const [key, raw] of Object.entries(nums)) {
      const n = parseInt(raw, 10)
      if (isNaN(n) || n < 0) {
        setError(`Valor inválido em "${key}": use um número inteiro não-negativo.`)
        return
      }
    }

    startTransition(async () => {
      const result = await updateSystemSettings({
        liga_enabled: enabled,
        liga_points_attendance: parseInt(attendance, 10),
        liga_points_streak_week: parseInt(streak, 10),
        liga_points_tournament_entry: parseInt(entry, 10),
        liga_points_tournament_win: parseInt(win, 10),
        liga_promote_count: parseInt(promote, 10),
        liga_demote_count: parseInt(demote, 10),
      })
      if (result.error) setError(result.error)
      else setSuccess('Configuração da Liga salva.')
    })
  }

  return (
    <Card>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>
        )}
        {success && (
          <p className="text-sm text-green-400 bg-green-500/10 border border-green-500/30 rounded-lg px-3 py-2">{success}</p>
        )}

        <label className="flex items-start gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="mt-1 w-4 h-4 accent-brand-500"
          />
          <span>
            Ativar a Liga
            <span className="block text-xs text-slate-500">
              Antes de ligar, defina a modalidade das suas turmas na Grade — turma sem
              modalidade não pontua.
            </span>
          </span>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-sm text-slate-300 font-medium">Presença</label>
            <Input type="number" min="0" value={attendance} onChange={(e) => setAttendance(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-sm text-slate-300 font-medium">Sequência (semana)</label>
            <Input type="number" min="0" value={streak} onChange={(e) => setStreak(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-sm text-slate-300 font-medium">Inscrição em torneio</label>
            <Input type="number" min="0" value={entry} onChange={(e) => setEntry(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-sm text-slate-300 font-medium">Vitória em torneio</label>
            <Input type="number" min="0" value={win} onChange={(e) => setWin(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-sm text-slate-300 font-medium">Sobem de divisão</label>
            <Input type="number" min="0" value={promote} onChange={(e) => setPromote(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-sm text-slate-300 font-medium">Descem de divisão</label>
            <Input type="number" min="0" value={demote} onChange={(e) => setDemote(e.target.value)} />
          </div>
        </div>
        <p className="text-xs text-slate-400">
          O bônus de sequência cresce até 4x e estabiliza, para que quem começou agora ainda
          tenha chance na temporada.
        </p>

        <Button type="submit" variant="primary" loading={pending}>Salvar Liga</Button>
      </form>
    </Card>
  )
}
```

- [ ] **Step 3: Ligar na página de Configurações**

Em `app/(admin)/admin/configuracoes/page.tsx`:

Import:
```tsx
import { LigaSettingsForm } from './LigaSettingsForm'
import { DEFAULT_LIGA_SETTINGS } from '@/features/liga/settings'
```

Depois do `const videoFeedUrl = ...`, acrescente:
```tsx
  const d = DEFAULT_LIGA_SETTINGS
  const liga = {
    liga_enabled: map.get('liga_enabled') === 'true',
    liga_points_attendance: Number(map.get('liga_points_attendance') ?? d.weights.attendance),
    liga_points_streak_week: Number(map.get('liga_points_streak_week') ?? d.weights.streakWeek),
    liga_points_tournament_entry: Number(map.get('liga_points_tournament_entry') ?? d.weights.tournamentEntry),
    liga_points_tournament_win: Number(map.get('liga_points_tournament_win') ?? d.weights.tournamentWin),
    liga_promote_count: Number(map.get('liga_promote_count') ?? d.promoteCount),
    liga_demote_count: Number(map.get('liga_demote_count') ?? d.demoteCount),
  }
```

E no JSX, depois do bloco `<VideoFeedUrlForm .../>`:
```tsx
      <div>
        <h2 className="text-lg font-bold text-white">Liga</h2>
        <p className="text-slate-400 text-sm mt-1">
          Ranking de temporada por modalidade: quanto vale cada coisa e quantos sobem de divisão.
        </p>
      </div>
      <LigaSettingsForm settings={liga} />
```

- [ ] **Step 4: Verificar build e testes**

Run: `npm run build`
Expected: compila sem erro.

Run (PowerShell): `npm run test:run`
Expected: suíte verde.

- [ ] **Step 5: Commit**

```bash
git add "app/(admin)/admin/configuracoes/LigaSettingsForm.tsx" "app/(admin)/admin/configuracoes/page.tsx" features/financeiro/actions.ts
git commit -m "feat(liga): configuracao de pesos e divisoes em Configuracoes"
```

---

### Task 20: Opt-out do ranking no perfil do aluno

**Files:**
- Create: `features/perfil/LigaOptOutForm.tsx`
- Modify: `features/organizations/actions.ts` (nova action `selfSetLigaOptOut`)
- Modify: `app/(dashboard)/perfil/page.tsx`

- [ ] **Step 1: Criar a action**

Em `features/organizations/actions.ts`, acrescente ao final (espelhando `selfSetSports`, que já
existe no arquivo — leia-a antes para copiar o formato exato de resolução de sessão e org):

```ts
/**
 * O aluno se oculta do ranking da Liga. Continua acumulando pontos e medalhas —
 * só não aparece para os outros.
 *
 * Existe porque forçar competição em quem não quer gera abandono; a válvula de escape
 * é barata e evita perder o aluno que se sente exposto.
 */
export async function selfSetLigaOptOut(optedOut: boolean): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  const admin = createAdminClient()
  const { error } = await admin
    .from('memberships')
    .update({ liga_opted_out: optedOut })
    .eq('user_id', user.id)
    .eq('organization_id', orgId)

  if (error) return { error: 'Erro ao salvar preferência.' }

  revalidatePath('/perfil')
  revalidatePath('/liga')
  return {}
}
```

- [ ] **Step 2: Criar o formulário**

```tsx
'use client'
// features/perfil/LigaOptOutForm.tsx
import { useState, useTransition } from 'react'
import { Card } from '@/components/ui/Card'
import { selfSetLigaOptOut } from '@/features/organizations/actions'

interface Props {
  optedOut: boolean
}

export function LigaOptOutForm({ optedOut }: Props) {
  const [checked, setChecked] = useState(optedOut)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function handleToggle(next: boolean) {
    setChecked(next)
    setError(null)
    startTransition(async () => {
      const result = await selfSetLigaOptOut(next)
      if (result.error) {
        setError(result.error)
        setChecked(!next)
      }
    })
  }

  return (
    <Card>
      {error && <p className="text-sm text-red-400 mb-2">{error}</p>}
      <label className="flex items-start gap-2 text-sm text-slate-300">
        <input
          type="checkbox"
          checked={checked}
          disabled={pending}
          onChange={(e) => handleToggle(e.target.checked)}
          className="mt-1 w-4 h-4 accent-brand-500"
        />
        <span>
          Não aparecer no ranking da Liga
          <span className="block text-xs text-slate-500">
            Você continua ganhando pontos e medalhas — só os outros alunos não veem sua posição.
          </span>
        </span>
      </label>
    </Card>
  )
}
```

- [ ] **Step 3: Ligar no perfil**

Em `app/(dashboard)/perfil/page.tsx`, junto de onde `SportsForm` é renderizado (leia o arquivo
para achar o local e como a membership já é carregada), acrescente o import e o componente,
passando `optedOut={membership?.liga_opted_out ?? false}`. Se a membership carregada ali não
seleciona `liga_opted_out`, acrescente a coluna ao `select`.

- [ ] **Step 4: Verificar build**

Run: `npm run build`
Expected: compila sem erro.

- [ ] **Step 5: Commit**

```bash
git add features/perfil/LigaOptOutForm.tsx features/organizations/actions.ts "app/(dashboard)/perfil/page.tsx"
git commit -m "feat(liga): aluno pode se ocultar do ranking"
```

---

### Task 21: Verificação manual no navegador

**Files:** nenhum (verificação)

Pré-requisito: **o usuário precisa ter rodado `supabase db push`** para aplicar
`20260803000000_liga_foundation.sql` e `20260803000100_liga_rpcs.sql`. Sem isso, nada abaixo
funciona.

- [ ] **Step 1: Subir o dev server**

Use a ferramenta de preview (`preview_start` com a config `arenahub-dev`). Não use Bash para
rodar o servidor. Se estiver num worktree, confirme que existe `.env.local` nele — o arquivo é
ignorado pelo git e não vem no worktree; copie do repositório principal se faltar.

- [ ] **Step 2: Liga desligada**

Como aluno, abrir `/liga`: deve mostrar o bloco de vídeo (se houver URL configurada) e o aviso
"A Liga ainda não foi ativada pela sua academia". O menu inferior deve mostrar **Liga** no lugar
de Vídeo. Acessar `/video` deve redirecionar para `/liga`.

- [ ] **Step 3: Ligar a Liga**

Como admin, em `/admin/configuracoes`, marcar "Ativar a Liga" e salvar. Confirmar mensagem de
sucesso.

- [ ] **Step 4: Pontuar uma presença**

Definir a modalidade de uma turma na Grade. Marcar presença de um aluno naquela sessão em
`/admin/grade/[sessionId]`. Depois, como aquele aluno, abrir `/liga`: deve aparecer a divisão
Bronze, os pontos da presença, e o extrato com "Presença em aula".

- [ ] **Step 5: Desmarcar a presença**

Voltar na chamada e desmarcar. Recarregar `/liga`: os pontos daquela aula devem ter desaparecido
do extrato e do total.

- [ ] **Step 6: Bônus manual**

Em `/admin/liga`, lançar 25 pontos para o aluno com o motivo "Destaque da aula". Como o aluno,
confirmar no extrato: "+25 · Bônus da academia — Destaque da aula".

- [ ] **Step 7: Dois esportes**

Adicionar um segundo esporte ao aluno (perfil dele ou `/admin/alunos/[id]`) e pontuar nele.
Confirmar que o seletor de modalidade aparece em `/liga` e que alternar troca ranking, pontos e
extrato.

- [ ] **Step 8: Fechamento de temporada**

Chamar o cron localmente com o `CRON_SECRET` do `.env.local`:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/liga-season-close
```

Esperado: JSON com contadores. Rodar duas vezes: a segunda deve devolver `closed: 0` (idempotente).

- [ ] **Step 9: Opt-out**

Marcar "Não aparecer no ranking" no perfil do aluno. Com outra conta da mesma academia, confirmar
que ele saiu da lista; com a conta dele, confirmar que ele ainda vê a própria posição.

---

### Task 22: Documentação

**Files:**
- Modify: `docs/faq/capture.mjs`
- Modify: `docs/faq/aluno.md`
- Modify: `docs/faq/academia.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Trocar a captura de tela**

Em `docs/faq/capture.mjs`, trocar:
```js
await capture(stu, '/video', 'aluno-video')
```
por:
```js
await capture(stu, '/liga', 'aluno-liga')
```

- [ ] **Step 2: Atualizar o Manual do Aluno**

Em `docs/faq/aluno.md`, substituir a seção "7. Vídeo" por uma seção "7. Liga" que cubra:
divisões (Bronze a Diamante) e o fato de subir/descer no fim do mês; o que dá ponto (presença,
sequência, torneio, bônus do professor); que a sequência é por modalidade; que o ranking é por
modalidade com seletor quando pratica mais de uma; o extrato "de onde vieram meus pontos"; a
opção de não aparecer no ranking; e que os vídeos das quadras agora ficam dentro dessa aba.
Atualizar também as duas menções à barra inferior (introdução e seção da Home) trocando "Vídeo"
por "Liga", o índice, e o resumo do fluxo ao final. Trocar a imagem
`images/aluno-video.png` por `images/aluno-liga.png`.

Acrescentar bloco "🔧 Nos bastidores" explicando: os pontos ficam num extrato
(`liga_points`) e a posição é um cache (`liga_standings`); a temporada fecha por cron no dia 1º;
a sequência não zera na virada da semana enquanto ainda houver dias para treinar.

- [ ] **Step 3: Atualizar o Manual da Academia**

Em `docs/faq/academia.md`, na seção 13 (Configurações), acrescentar o bloco "Liga" à lista de
"Principais blocos". Criar uma seção nova "Liga — ranking dos alunos" cobrindo: ativar a Liga e
por que definir a modalidade das turmas antes; os pesos de cada tipo de ponto; quantos sobem e
descem; dar bônus manual com motivo obrigatório e que o aluno vê esse texto; o aviso de turmas
sem modalidade; e que o aluno pode se ocultar do ranking. Acrescentar ao "🔧 Nos bastidores"
que a escrita de pontos passa por RPC atômica e que há dois crons (sequência diária e
fechamento mensal).

- [ ] **Step 4: Atualizar `CLAUDE.md`**

Duas mudanças:

1. Em "Data Model Key Points", corrigir a linha sobre o cache de créditos:
```markdown
- `memberships.credits_balance` is a **cached** value — source of truth is the `credit_transactions` table, and both are written atomically by the `adjust_credits` RPC (never `update` the balance directly)
```
(substituindo a menção a `profiles.credits_balance`, que não existe mais desde
`20260624000100_drop_profiles_per_org_columns.sql`)

2. Acrescentar a Liga à lista de utilitários de regra de negócio:
```markdown
| [lib/liga/](lib/liga/) | `computeDivisionMoves()`, `computeStreakWeeks()`, `pointsFor*()`, `sportForAttendance()` — regra da Liga (ranking por esporte). Extrato `liga_points` é a verdade; `liga_standings` é cache, escritos pela RPC `liga_award_points` |
```

- [ ] **Step 5: Commit**

```bash
git add docs/faq/capture.mjs docs/faq/aluno.md docs/faq/academia.md CLAUDE.md
git commit -m "docs(liga): manuais, captura de tela e correcao do cache de creditos no CLAUDE.md"
```

- [ ] **Step 6: Avisar sobre os prints**

No relatório, avisar que o usuário precisa rodar `node docs/faq/capture.mjs` (com o dev server no
ar) para regenerar os prints, copiar `docs/faq/images/aluno-liga.png` para
`public/faq/images/`, e remover os órfãos `aluno-video.png` dos dois diretórios. **Não rode o
script automaticamente** — ele cria academia e usuários de teste reais no Supabase conectado.

---

### Task 23: Checagem final

**Files:** nenhum

- [ ] **Step 1: Lint**

Run: `npm run lint`
Expected: sem erros novos.

- [ ] **Step 2: Testes**

Run (PowerShell): `npm run test:run`
Expected: toda a suíte verde, incluindo os 33 testes novos das Tasks 1–4
(`divisions` 8, `streak` 9, `points` 10, `sportForPoints` 6).

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: build completo, com `/liga`, `/admin/liga`, `/api/cron/liga-streak` e
`/api/cron/liga-season-close` nas rotas.

- [ ] **Step 4: Conferir o que ficou pendente do lado do usuário**

Reportar explicitamente:
- `supabase db push` para as duas migrations novas;
- regenerar os prints da FAQ;
- ligar `liga_enabled` na própria academia (nasce desligada de propósito);
- definir a modalidade das turmas ativas antes de ligar, senão a presença não pontua.
