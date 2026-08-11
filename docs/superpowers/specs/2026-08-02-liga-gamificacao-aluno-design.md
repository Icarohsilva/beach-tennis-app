# Liga — gamificação do aluno (ranking, medalhas, comunidade e mural) — Design

Data: 2026-08-02

## Contexto

O espaço "Vídeo" ([2026-07-31](2026-07-31-video-cameras-iframe-design.md)) entregou o link do
sistema de câmeras, mas é uma tela de uma linha: não dá motivo pro aluno voltar. A ideia aqui é
transformar aquele espaço na aba **Liga** — o "Sub-projeto 3" que
[2026-06-26-motor-torneios-fundacao-design.md](2026-06-26-motor-torneios-fundacao-design.md)
listou como fora de escopo, e para o qual
[2026-08-02-esportes-do-aluno-e-modalidade-da-turma-design.md](2026-08-02-esportes-do-aluno-e-modalidade-da-turma-design.md)
já entregou o dado de base (`memberships.sports`, `classes.sport`).

Objetivo de produto: dar ao aluno um motivo recorrente para abrir o app e algo para mostrar aos
amigos. O link do vídeo continua lá, como um bloco dentro da Liga.

## O princípio que guia o desenho

Pesquisa que fundamenta as decisões:

1. **Premiar constância, não talento.** O troféu *Local Legend* do Strava não vai para quem é
   mais rápido, vai para quem repetiu o trajeto mais vezes em 90 dias — de propósito, porque a
   maioria nunca vencerá o mais rápido, mas qualquer um pode vencer na frequência, e frequência
   é o comportamento que retém. Traduzindo: o aluno nível A já ganha troféu nos torneios; quem
   precisa da Liga é o aluno nível D que não falta uma terça há seis semanas.
2. **Divisões, não um ranking único.** Ver-se em 47º lugar desmotiva. O modelo de ligas do
   Duolingo (grupos pequenos de ritmo parecido, com reset periódico) existe justamente para que
   todos tenham uma disputa ganhável.
3. **Temporada que zera é obrigatória.** Ranking eterno cria hierarquia permanente: quem entra
   depois nunca alcança e desiste.
4. **Ponto por elogio é a única parte fraudável do sistema.** No momento em que dar elogio vale
   ponto, as pessoas param de elogiar e começam a farmar. Precisa de trava explícita (§Fase 3).

## Decisões

1. **A aba se chama "Liga"** e substitui "Vídeo" no `BottomNav` (a aba "Arena" já é torneios).
   Vídeo passa a ser um bloco dentro da Liga.
2. **Toda pontuação é por esporte.** O esporte é dimensão do próprio ponto, não filtro de tela.
   O aluno pode ser Ouro no beach tennis e Bronze no padel simultaneamente.
3. **Divisões por pontos, com promoção e rebaixamento** (Bronze → Prata → Ouro → Diamante), não
   por nível técnico. `memberships.level` segue dormente — a Liga **não** o reativa.
4. **Temporada mensal**, fechada por cron no dia 1º.
5. **Fonte da verdade é um extrato** (`liga_points`); a posição (`liga_standings`) é cache. Mesmo
   padrão de `credit_transactions` → `memberships.credits_balance`.
6. **Escrita ledger+cache é atômica via RPC `security definer`**, espelhando `adjust_credits`.
7. **Ranking público por padrão, com opt-out** por aluno.
8. **Aula sem modalidade não pontua**, exceto quando a academia oferece exatamente um esporte.
9. **Presença em esporte não declarado pontua e adiciona o esporte ao aluno.**
10. **Sequência (streak) é por esporte.** Medalhas de aula/torneio/divisão são por esporte;
    sociais e de tempo de casa são globais.

## Estado atual do código (verificado)

| O que | Onde | Detalhe que o desenho depende |
|---|---|---|
| Esportes do aluno | `memberships.sports text[]` | Por academia; índice GIN `memberships_org_sports_idx` |
| Modalidade da turma | `classes.sport text` **nullable** | Informativa, **zero gating** |
| Esporte do torneio | `tournaments.sport text` | Default `'beach_tennis'`, sem check constraint |
| Cardápio da academia | `organizations.sports text[]` | Domínio válido; `getOrgSports()` em `lib/arenas/orgSports.ts` |
| Slugs de esporte | `lib/arenas/sports.ts` | 15 slugs + `custom:`; `normalizeSportForOrg`, `sportLabel`, `sportEmoji` |
| Presença | tabela `attendance` (`status: 'present'\|'absent'`, `unique(student_id, session_id)`) | `markAttendance(sessionId, studentId, present)` e `markAttendanceBulk(...)` em `features/aulas/actions.ts` — reversíveis via upsert |
| Inscrição em torneio | `tournament_entries` (`entry_status`, `payment_status`) | `registerForTournament`, `confirmWaitlistOffer` |
| Pódio de torneio | `tournaments.winner{1,2,3}_id` (+`_partner_id`) | `closeTournament(id)` calcula; `updateWinners` corrige |
| Ledger→cache de crédito | RPC `adjust_credits` (`security definer`, atômica) | Padrão a espelhar |
| Crons | `vercel.json` — 4 entradas, todas diárias/semanais | **Não há cron mensal**; auth por `verifyCronSecret` (`lib/auth/cronAuth.ts`) |
| Storage | buckets `org-logos` (server action) e o do feed (client-side) | Reuso na Fase 4 |
| Config por academia | `system_settings (organization_id, key, value)` | Onde os pesos da Liga vão |

Correção a registrar: o `CLAUDE.md` afirma que `profiles.credits_balance` é o cache de créditos.
Está desatualizado — a coluna foi removida em `20260624000100_drop_profiles_per_org_columns.sql`
e o cache vive em `memberships.credits_balance`. Corrigir junto com esta entrega.

---

# Fase 1 — Motor de pontos, divisões e temporada

Fase autossuficiente: vai ao ar sozinha e já entrega valor.

## Dados

Migration `supabase/migrations/20260803000000_liga_foundation.sql`:

```sql
create table liga_seasons (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  starts_on date not null,
  ends_on date not null,
  status text not null default 'active' check (status in ('active','closed')),
  created_at timestamptz not null default now(),
  unique (organization_id, starts_on)
);

-- Extrato: fonte da verdade.
create table liga_points (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  season_id uuid not null references liga_seasons(id) on delete cascade,
  student_id uuid not null references profiles(id) on delete cascade,
  sport text not null,
  points int not null,
  reason text not null check (reason in (
    'attendance','streak','tournament_entry','tournament_result',
    'manual','kudos_given','kudos_received'
  )),
  source_id uuid,
  note text,
  awarded_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- Idempotência: marcar presença duas vezes não credita duas vezes.
create unique index liga_points_dedup_idx
  on liga_points (season_id, student_id, sport, reason, coalesce(source_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Cache da posição.
create table liga_standings (
  organization_id uuid not null references organizations(id) on delete cascade,
  season_id uuid not null references liga_seasons(id) on delete cascade,
  student_id uuid not null references profiles(id) on delete cascade,
  sport text not null,
  division text not null default 'bronze' check (division in ('bronze','prata','ouro','diamante')),
  points int not null default 0,
  streak_weeks int not null default 0,
  primary key (season_id, student_id, sport)
);

create index liga_standings_rank_idx on liga_standings (season_id, sport, division, points desc);

-- Opt-out do ranking (§Telas). Continua acumulando; só não aparece para os outros.
alter table memberships add column if not exists liga_opted_out boolean not null default false;
```

`liga_standings.streak_weeks` também é cache: a verdade é derivável de `attendance` por
`computeStreakWeeks`, e o cron de sequência reescreve o valor.

O índice único de deduplicação é o coração da robustez. Sem ele, qualquer chamada dupla de
`markAttendance` (retry de rede, duplo clique na chamada) infla pontos de forma invisível — o
cache é o que aparece na tela, então ninguém descobriria por semanas.

RLS: `liga_points` e `liga_standings` com `select` para membros autenticados da própria
organização; nenhum `insert`/`update` para `authenticated` — toda escrita passa pela RPC.

## RPC atômica

```sql
create or replace function liga_award_points(
  p_org uuid, p_season uuid, p_student uuid, p_sport text,
  p_points int, p_reason text, p_source_id uuid, p_note text, p_awarded_by uuid
) returns void language plpgsql security definer set search_path = public as $$ ... $$;

create or replace function liga_revoke_points(
  p_season uuid, p_student uuid, p_sport text, p_reason text, p_source_id uuid
) returns void language plpgsql security definer set search_path = public as $$ ... $$;
```

`liga_award_points` faz três coisas na mesma transação:

1. `insert into liga_points ... on conflict do nothing` (idempotente);
2. `insert into liga_standings ... on conflict (season_id, student_id, sport) do update set points = liga_standings.points + excluded.points` — só soma se o insert do passo 1 realmente inseriu;
3. quando `p_sport` não está em `memberships.sports` do aluno naquela academia, adiciona
   (`sports = array_append(...)`), para que ele entre no ranking daquele esporte sem estado
   intermediário.

`liga_revoke_points` remove a linha do extrato e subtrai do cache — usada quando o professor
desmarca presença.

Motivo de ser RPC e não dois `update` do lado do Next.js: se o segundo falhasse, extrato e cache
divergiriam permanentemente.

## Config por academia (`system_settings`)

| Chave | Default | O que é |
|---|---|---|
| `liga_enabled` | `false` | Liga ligada. Desligada, a aba mostra só o bloco de vídeo |
| `liga_points_attendance` | `10` | Ponto por presença |
| `liga_points_streak_week` | `5` | Base do bônus semanal de sequência |
| `liga_points_tournament_entry` | `30` | Por se inscrever num torneio |
| `liga_points_tournament_win` | `50` | Bônus do 1º lugar (2º e 3º recebem fração) |
| `liga_promote_<divisão>` | `10 / 5 / 3` | Quantos sobem daquela divisão (bronze, prata, ouro) |
| `liga_demote_<divisão>` | `3` | Corte de baixo daquela divisão (prata, ouro, diamante) |
| `liga_demote_mode_<divisão>` | `ultimos` | `ultimos` (descem os N últimos) ou `permanecem` (só os N primeiros ficam) |

O corte é **por divisão**, não por academia: o funil aperta conforme se sobe, e o topo
aceita o modelo "só o campeão permanece" — que `ultimos` não consegue escrever, porque
lá o número que importa é quem fica, e não quantos caem.

As chaves antigas `liga_promote_count` / `liga_demote_count`, de quando o corte era um
número só para a escada inteira, continuam sendo lidas como fallback de todas as
divisões. Academia que já tinha configurado não muda de comportamento até distribuir os
cortes nas Configurações.

## Regra pura (com teste Vitest)

Padrão a seguir: função pura + wrapper que injeta ambiente, como
`isValidCronAuth` / `verifyCronSecret` em `lib/auth/cronAuth.ts`.

**`lib/liga/sportForPoints.ts`**

```ts
// Qual esporte um ponto de presença credita. null = não pontua.
export function sportForAttendance(
  classSport: string | null,
  orgSports: string[],
): string | null
```

Regra: `classSport` quando presente; senão, `orgSports[0]` quando a academia oferece
exatamente um esporte; senão `null`. Mesma filosofia conservadora do backfill da migration de
esportes — chutar entre várias modalidades seria pior que não pontuar.

**`lib/liga/streak.ts`**

```ts
// Semanas consecutivas (seg–dom) com ao menos uma presença naquele esporte, terminando na
// semana de `today`. A semana corrente conta assim que houver uma presença.
export function computeStreakWeeks(attendanceDates: string[], today: Date): number
```

**`lib/liga/points.ts`**

```ts
export interface LigaWeights { attendance: number; streakWeek: number; tournamentEntry: number; tournamentWin: number }
export function pointsForAttendance(w: LigaWeights): number
export function pointsForStreakWeek(streakWeeks: number, w: LigaWeights): number  // cresce com a sequência
export function pointsForTournamentResult(place: 1 | 2 | 3 | null, w: LigaWeights): number
```

**`lib/liga/divisions.ts`**

```ts
export type Division = 'bronze' | 'prata' | 'ouro' | 'diamante'
export interface StandingRow { studentId: string; points: number; division: Division }
export interface DivisionMove { studentId: string; from: Division; to: Division }

export type DemoteMode = 'ultimos' | 'permanecem'
export interface DivisionCut { promote: number; demoteMode: DemoteMode; demote: number }
export type DivisionCuts = Record<Division, DivisionCut>

// Ordena por pontos desc dentro de cada divisão e aplica o corte DAQUELA divisão.
// Diamante não promove, bronze não rebaixa. Aluno com 0 ponto nunca é promovido (senão
// divisão vazia promoveria quem não jogou).
export function computeDivisionMoves(rows: StandingRow[], cuts: DivisionCuts): DivisionMove[]

// Cortes já resolvidos pela posição na escada — é o que as telas desenham.
export function promoteLimit(cuts: DivisionCuts, division: Division): number
export function firstDemotedPosition(cuts: DivisionCuts, division: Division, size: number): number
```

No modo `permanecem` o corte é medido de cima e soma o `promoteLimit`: sobem os N, ficam
os K seguintes, o resto desce. É isso que impede o corte de morder quem acabou de subir —
e no topo, onde ninguém sobe, a conta vira "só os K primeiros ficam".

Casos de teste obrigatórios: divisão com menos gente que o corte; empate em pontos
(desempate estável por `studentId`); todos com 0 ponto; Diamante no topo; Bronze na base;
cortes diferentes por divisão; modo `permanecem` com e sem promoção na mesma divisão.

## Onde os pontos entram

| Evento | Gatilho | Idempotência |
|---|---|---|
| Presença | `markAttendance` / `markAttendanceBulk`, após o upsert em `attendance` | `source_id = session_id`; `present=false` chama `liga_revoke_points` |
| Sequência | Cron diário, uma vez por semana por aluno/esporte | `source_id` = uuid derivado da semana ISO |
| Inscrição em torneio | `registerForTournament` e `confirmWaitlistOffer`, quando `entry_status='confirmed'` | `source_id = tournament_id` |
| Resultado de torneio | `closeTournament` e `updateWinners` | `source_id = tournament_id`; `updateWinners` revoga e recredita |
| Bônus manual | Server action nova `awardLigaBonus`, admin only | `source_id = null`, `note` obrigatório |

O crédito de pontos é **best-effort e nunca derruba a operação principal** — mesmo padrão do
`ensureClassDebt`, que já é chamado dentro de `markAttendance` sem poder quebrar a chamada. Falha
vai para o Sentry; a passada diária do cron reconcilia.

`note` obrigatório no bônus manual não é burocracia: é o que aparece no extrato do aluno como
*"+20 · Destaque da aula de quinta — Prof. Hudson"*. Para o aluno isso vale mais que os pontos.

## Fechamento de temporada

Cron novo `app/api/cron/liga-season-close/route.ts`, `vercel.json` com `0 5 1 * *`
(dia 1º, 05:00 UTC), seguindo o padrão dos 4 existentes: `GET`, `verifyCronSecret`, 401 se
inválido, `createAdminClient()`, `Sentry.captureException(e, { tags: { cron: 'liga-season-close' } })`,
resposta JSON com contadores.

Por organização com `liga_enabled`:

1. marca a temporada ativa como `closed`;
2. para cada esporte, calcula `computeDivisionMoves` sobre os standings;
3. cria a temporada do mês corrente;
4. cria os standings iniciais com `points = 0`, `division` já movida e `streak_weeks` copiado da
   temporada anterior. A sequência é do aluno **naquele esporte** e atravessa temporadas: zerá-la
   no dia 1º puniria justamente quem nunca faltou.

Idempotente: se rodar duas vezes no mesmo mês, o `unique (organization_id, starts_on)` impede a
segunda temporada e o passo 1 não tem efeito.

## Telas

**Aluno** — `app/(dashboard)/liga/page.tsx` (Server Component; `export const dynamic = 'force-dynamic'`):

- Seletor de esporte no topo, **só quando o aluno tem mais de um** em `memberships.sports`.
  Esporte escolhido via query param (`?esporte=`), como `/agendar` já faz.
- `features/liga/SeasonCard.tsx` — divisão, pontos, posição, barra de progresso até subir.
- `features/liga/StreakCard.tsx` — semanas seguidas, medalhas, elogios dados (Fase 3).
- `features/liga/DivisionRanking.tsx` — ranking da divisão, aluno destacado.
- `features/liga/PointsLedger.tsx` — extrato do aluno ("de onde vieram meus pontos").
- Bloco de vídeo (migrado de `VideoClient.tsx`).
- Estado vazio quando `liga_enabled` é falso ou não há temporada.

**Admin** — `app/(admin)/admin/liga/page.tsx`:

- Ranking geral por esporte;
- `LigaBonusForm.tsx` — dar bônus manual (aluno, esporte, pontos, motivo obrigatório);
- `LigaSettingsForm.tsx` — pesos e promoção/rebaixamento, no padrão dos forms de
  `admin/configuracoes/`;
- Aviso *"N aulas deste mês sem modalidade não estão pontuando"* com link para a grade.

**Menu** — `components/ui/BottomNav.tsx`: `/video` → `/liga`, ícone `Trophy` (lucide).
`/video` continua respondendo, com redirect para `/liga`.

**Opt-out** — `memberships.liga_opted_out boolean not null default false`; toggle em
`app/(dashboard)/perfil/`, espelhando `SportsForm` / `selfSetSports`. Quem optou por sair não
aparece em ranking nenhum, mas continua acumulando pontos e medalhas (só ele vê).

---

# Fase 2 — Medalhas e comemoração

## Dados

```sql
create table liga_medals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  student_id uuid not null references profiles(id) on delete cascade,
  medal_key text not null,
  sport text,                    -- null = medalha global
  earned_at timestamptz not null default now(),
  seen_at timestamptz,
  unique (student_id, medal_key, coalesce(sport, ''))
);
```

## Catálogo em código, não em banco

`lib/liga/medals.ts` — medalha é regra, não dado:

```ts
export interface MedalStats {
  attendanceCount: number       // do esporte, ou total quando a medalha é global
  streakWeeks: number
  tournamentEntries: number
  tournamentWins: number
  division: Division
  kudosGiven: number            // Fase 3
  kudosReceived: number         // Fase 3
  monthsSinceJoined: number
  earlyClassCount: number       // aulas que começam antes das 07:00
}

export interface MedalDef {
  key: string
  label: string
  description: string
  icon: string                  // nome do ícone lucide
  scope: 'sport' | 'global'
  check: (s: MedalStats) => boolean
}

export const MEDALS: MedalDef[]
export function evaluateMedals(stats: MedalStats, scope: 'sport' | 'global'): string[]
```

Catálogo inicial (só dados que já existem):

| Escopo | Medalhas |
|---|---|
| Por esporte | 10ª / 50ª / 100ª / 250ª aula · sequência de 4 / 8 / 12 / 24 semanas · 1º torneio · 1ª vitória · chegou ao Ouro · chegou ao Diamante · Madrugador (10 aulas antes das 07:00) |
| Global | 6 / 12 / 24 meses de casa · 10 e 50 elogios dados · 10 e 50 elogios recebidos (Fase 3) |

Avaliação após `markAttendance` e `closeTournament`, mais passada diária no cron de sequência.
Medalha não dá ponto — se desse, o catálogo viraria uma alavanca de inflação a cada medalha nova.

## Comemoração

Medalha nova nasce com `seen_at` nulo. Na próxima abertura da Liga,
`features/liga/MedalCelebration.tsx` mostra a conquista com animação (CSS puro, sem lib nova) e
um botão "compartilhar no feed" que cria um post (Fase 3) ou fica oculto até ela existir. É o
momento em que o aluno mostra o app para o amigo — conquista individual virando conteúdo social
sem ele precisar escrever nada.

---

# Fase 3 — Comunidade dentro da Liga e elogios

## Mover a comunidade

O feed de `features/comunidade/` passa a ser seção da Liga. `/comunidade` continua respondendo,
com redirect para `/liga`. Nenhum dado migra — `posts`, `post_comments` e `post_likes` ficam como
estão.

Acrescenta `posts.is_pinned boolean not null default false` para o mural de comunicados da
academia: post fixado do admin no topo do feed. É a peça que faltava para o espaço servir de
canal oficial, e não só de conversa.

## Elogios

```sql
create table liga_kudos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  season_id uuid not null references liga_seasons(id) on delete cascade,
  sport text not null,
  from_student_id uuid not null references profiles(id) on delete cascade,
  to_student_id uuid not null references profiles(id) on delete cascade,
  category text not null check (category in ('evoluiu','parceiro','incentiva','dedicado')),
  message text not null,
  iso_week text not null,        -- 'YYYY-Www', base das travas
  created_at timestamptz not null default now(),
  check (from_student_id <> to_student_id),
  -- organization_id no unique: a mesma dupla pode treinar em duas academias, e a trava é
  -- por academia.
  unique (organization_id, from_student_id, to_student_id, iso_week)
);
```

## Anti-farming — quatro travas

Esta é a única parte fraudável do sistema, e sem trava o ranking viraria "quem clica mais" em
duas semanas.

1. **Teto semanal** de elogios que pontuam (`liga_kudos_weekly_cap`, default `3`). Acima do teto
   o elogio é registrado e aparece no feed, mas não credita ponto.
2. **Um elogio por colega por semana** — garantido pelo `unique` acima, no banco, não só na UI.
3. **Recíproco na mesma semana não pontua**: se B elogia A na mesma semana em que A elogiou B, o
   segundo não credita. Mata o combinado "eu te elogio, você me elogia".
4. **Quem recebe ganha mais que quem dá** (`liga_points_kudos_received` default `15`,
   `liga_points_kudos_given` default `5`). A trava mais importante das quatro: alinha o incentivo
   com *ser elogiável*, não com distribuir elogio.

Não se pode elogiar a si mesmo (`check` no banco). Elogio é sempre atrelado a um esporte que os
dois praticam.

`lib/liga/kudos.ts` — função pura, com teste:

```ts
export interface KudosContext { weeklyPaidCount: number; reciprocalSameWeek: boolean; weeklyCap: number }
// Se este elogio credita ponto.
export function kudosEarnsPoints(ctx: KudosContext): boolean
```

UI: `features/liga/KudosForm.tsx` (escolher colega, categoria e recado) e o elogio renderizado no
feed, com o crédito visível para os dois.

---

# Fase 4 — Mural de fotos dos torneios

```sql
create table tournament_photos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  tournament_id uuid not null references tournaments(id) on delete cascade,
  storage_path text not null,
  caption text,
  uploaded_by uuid not null references profiles(id),
  created_at timestamptz not null default now()
);
```

Só a academia sobe — sem fila de moderação e sem risco de conteúdo impróprio. Upload por **server
action** com `requireAdmin`, no padrão de `updateBranding` (`features/branding/actions.ts`), não
client-side: o bucket não precisa de policy de escrita para `authenticated`. Bucket novo
`tournament-photos`, path `${orgId}/${tournamentId}/${uuid}.${ext}`.

Aluno vê a galeria do torneio dentro da Liga e na página do torneio. Sem curtida nesta fase
(YAGNI) — a galeria é o valor.

---

## Testes

Regra pura com Vitest, no padrão de `lib/checkin/monthlyProgress.test.ts` e
`lib/arenas/sports.test.ts` (casos nomeados em pt-BR):

| Arquivo | Cobre |
|---|---|
| `lib/liga/divisions.test.ts` | Promoção/rebaixamento: divisão menor que o corte, empate, todos com 0 ponto, topo e base da escada |
| `lib/liga/streak.test.ts` | Semanas consecutivas, semana corrente parcial, virada de ano ISO, falta no meio |
| `lib/liga/points.test.ts` | Pesos, crescimento do bônus de sequência, pódio 1º/2º/3º |
| `lib/liga/sportForPoints.test.ts` | Turma com modalidade; sem modalidade e academia com 1 esporte; sem modalidade e academia com vários |
| `lib/liga/medals.test.ts` | Cada medalha do catálogo no limite (49ª vs 50ª aula), escopo esporte vs global |
| `lib/liga/kudos.test.ts` | Teto semanal, recíproco na mesma semana, primeiro elogio da semana |

Verificação manual por fase, via preview: ranking com dois esportes e alternância entre eles;
presença creditando e desmarcação revogando; bônus manual aparecendo no extrato; fechamento de
temporada (chamando o cron com `CRON_SECRET` local).

`npm run test:run` (via PowerShell — `test:run` pelo Bash é instável neste projeto),
`npm run lint` e `npm run build` verdes antes de cada fase fechar.

## Documentação a atualizar (convenção do projeto)

- `docs/faq/capture.mjs`: capturar `/liga` no lugar de `/video`; prints em `docs/faq/images/` e
  cópia em `public/faq/images/`.
- `docs/faq/aluno.md`: seção da Liga (divisões, pontos, sequência, medalhas, elogios).
- `docs/faq/academia.md`: configurar pesos, dar bônus manual, subir fotos, e o aviso de aulas sem
  modalidade.
- `CLAUDE.md`: registrar a Liga; corrigir a afirmação de que `profiles.credits_balance` é o cache
  de créditos (é `memberships.credits_balance`).

## Fora de escopo

- Categoria/nível do aluno **por esporte**: as divisões da Liga são por pontos, então o dado não
  é necessário. `memberships.level` segue dormente.
- Recompensa material (desconto, brinde) por posição ou medalha.
- Ranking entre academias diferentes — tudo é escopado por `organization_id`.
- Curtida ou comentário em foto do mural.
- Notificação push de mudança de posição: o app já tem push
  ([2026-07-15](2026-07-15-push-pwa-notificacoes-design.md)), mas notificar a cada ultrapassagem
  seria ruído. Reavaliar depois de a Fase 1 estar em uso.
- Gating por modalidade em reserva de aula: a spec de esportes decidiu explicitamente pelo zero
  gating, e a Liga não reintroduz isso por outro nome.
