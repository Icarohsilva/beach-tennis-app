# Motor de Torneios — Fundação (Super N / Americano) — Design

**Data:** 2026-06-26
**Status:** Aprovado (brainstorming)
**Sub-projeto:** 1 de 4 da sequência "Motor de Torneios genérico"

---

## Contexto

O app já tem um esqueleto de torneios (criar, fluxo de status, inscrição, lançar
resultado, visualizar chave), mas com **dois furos que o quebram em produção**:

1. A tabela `tournament_registrations` é referenciada pelo código (inscrição,
   listagem) e pela RLS (guardada por `to_regclass`), mas **nenhuma migration a
   cria** — inscrever-se falha em prod.
2. **Não existe geração de chaveamento.** Quando o admin põe o torneio "em
   andamento", a tela mostra "Nenhum confronto gerado ainda" — nada sorteia/gera
   os confrontos a partir das inscrições.

Além de consertar isso, o objetivo é transformar os torneios num **motor
genérico e multi-esporte**, inspirado no LetzPlay. O usuário quer suportar:
vários esportes (beach tennis, padel, futevôlei, vôlei de praia, tênis),
unidades individual / dupla fixa / dupla revezando, formatos Super 8 (revezando),
round-robin, eliminatória e ranking, e categorias Masculino / Feminino / Misto +
nível.

Isso é grande demais para uma spec só. Foi **decomposto** em sub-projetos
sequenciais (cada um com spec → plano → implementação própria):

- **Sub-projeto 1 — Fundação (esta spec):** modelo flexível + **Americano
  (Super N revezando)** ponta a ponta, com geração + classificação + confirmação
  de placar. Inclui a revisão da Comunidade.
- **Sub-projeto 2 — Formatos adicionais:** round-robin (individual/dupla fixa) e
  eliminatória, plugando na mesma interface de "gerador de formato".
- **Sub-projeto 3 — Ranking de temporada:** competições por ranking que acumulam
  pontos entre vários torneios (conceito de ranking do LetzPlay).
- **Sub-projeto 4 — Revisão da Comunidade:** incluída neste ciclo (ver §6).

## Objetivo

Entregar, ponta a ponta: criar torneio (esporte/categoria/formato/nível + config
de placar) → inscrição individual com trava de gênero → gerar chave do Americano
(Super N revezando) → lançar/confirmar resultados → **classificação individual ao
vivo**, com o schema já generalizado para os demais formatos plugarem depois sem
reescrever as actions.

## Esporte como metadado

`lib/arenas/sports.ts` já define `SPORTS` (beach_tennis, padel, futevolei,
volei_praia, tenis) como lista fixa, sem tabela. O torneio aponta para um slug
dessa lista. Sem nova fonte de esportes.

---

## 1. Modelo de Dados

Migrations novas (nunca editar as antigas). Numeração `20260626xxxxxx_*`.

### 1.1 `profiles.gender`

`gender text` aceitando `'M' | 'F' | null`. É **identidade** (não por-academia),
então mora em `profiles` (slim pós-cutover). Coletado no cadastro, editável no
`/perfil`, e o admin pode setar ao criar aluno. Alunos existentes ficam `null`
até preencher. Constraint: `check (gender in ('M','F') or gender is null)`.

### 1.2 `tournaments` (generalizar)

Colunas novas:

- `sport text not null default 'beach_tennis'` — slug de `SPORTS`.
- `category text not null default 'livre'` — `masculino | feminino | misto | livre`.
- `participant_type text not null default 'dupla_revezando'` —
  `individual | dupla_fixa | dupla_revezando`. Substitui o uso de `modality` na
  lógica nova; `modality` é mantida para compatibilidade e backfillada.
- `format` passa a aceitar `americano | round_robin | eliminatoria | ranking`.
  Backfill dos existentes (`super8`) → `americano`.
- Placar configurável: `sets_to_win int not null default 1`,
  `games_per_set int not null default 6`, `tiebreak_games boolean not null default true`.

Backfill idempotente dos torneios existentes:
`modality='dupla_revezando' → participant_type='dupla_revezando'`,
`modality='dupla_fixa' → participant_type='dupla_fixa'`, `format='super8' → 'americano'`,
`category='livre'`, `sport='beach_tennis'`.

### 1.3 `tournament_entries` (tabela nova — peça que falta)

Uma linha por **unidade inscrita** (cobre individual e dupla):

```
id uuid pk default gen_random_uuid()
organization_id uuid not null references organizations(id)
tournament_id uuid not null references tournaments(id) on delete cascade
player_id uuid not null references profiles(id)
partner_id uuid references profiles(id)        -- null p/ individual e revezando
seed int                                         -- opcional, ordenação manual
created_at timestamptz not null default now()
unique (tournament_id, player_id)
```

Substitui a `tournament_registrations` (que o código referencia mas **nunca
existiu** em prod). Nome novo porque "entry" cobre individual e dupla. A RLS
órfã guardada por `to_regclass` de `tournament_registrations` fica inofensiva.
RLS org-scoped nova para `tournament_entries` (mesmo padrão das demais tabelas).

Índice: `(tournament_id)`.

### 1.4 `tournament_matches` (generalizar resultado + confirmação)

Mantém `round, player1_id, partner1_id, player2_id, partner2_id, tournament_id,
organization_id`. Adicionar:

- `match_no int` — ordem/quadra dentro da rodada.
- `result jsonb` — `{ "sets": [[6,4]], "games1": 6, "games2": 4 }`.
- `games1 int`, `games2 int` — denormalizados (total de games por lado) para a
  classificação.
- `result_status text` — `null` (sem placar) | `pending` | `confirmed`.
- `reported_by uuid references profiles(id)` — quem lançou.
- `confirmed_by uuid references profiles(id)` — quem confirmou.

`winner_id` (existente) vira **derivado/opcional** (não obrigatório no Americano).

---

## 2. Motor de Geração + Classificação (núcleo puro, `lib/torneios/`)

O coração da feature são **funções puras** (sem banco) → TDD rigoroso, actions
finas.

### 2.1 Registro de formatos (`lib/torneios/formats.ts`)

Mapa `format → { generate, computeStandings, label }`. As actions chamam o motor
pelo registro, nunca por `if/else`. Na Fundação só `americano` é registrado;
formatos futuros entram adicionando uma entrada no mapa, sem tocar nas actions.

```ts
export interface FormatEngine {
  label: string
  generate(playerIds: string[]): RoundPlan[]
  computeStandings(
    entries: EntryRef[],
    matches: MatchResult[],
    config: ScoringConfig,
  ): StandingRow[]
}
export const FORMATS: Record<string, FormatEngine>
```

### 2.2 Geração do Americano (`lib/torneios/schedule/americano.ts`)

```ts
generateAmericanoSchedule(playerIds: string[]): RoundPlan[]
// RoundPlan = { round: number; matches: { p1; partner1; p2; partner2 }[]; resting: string[] }
```

- Usa **tabelas de rotação pré-computadas** por tamanho (4, 6, 8, 10, 12, 16).
  Cada tabela é validada por teste: todo jogador joga o mesmo nº de partidas
  (±1), parcerias se repetem o mínimo possível, e os byes (descanso, quando N não
  é múltiplo de 4) são distribuídos igualmente.
- Tamanho não suportado → erro claro
  ("Americano só aceita 4–16 jogadores por enquanto").
- **Pura:** recebe IDs já embaralhados, devolve o plano (determinística no teste;
  o shuffle fica na action).

### 2.3 Classificação (`lib/torneios/standings.ts`)

```ts
computeStandings(entries, matches, config): StandingRow[]
// StandingRow = { playerId; played; wins; gamesFor; gamesAgainst; diff; points }
```

- Agrega **por jogador individual** (no Americano cada um soma os games das
  duplas que formou).
- Ordenação fixa na Fundação: (1) saldo de games `diff`, (2) games a favor,
  (3) vitórias, (4) confronto direto quando aplicável.
- Conta **só** partidas com `result_status = 'confirmed'`; ignora `pending` e sem
  resultado.

### 2.4 Elegibilidade (`lib/torneios/eligibility.ts`)

```ts
canRegister(playerGender, tournamentCategory): { ok: boolean; reason?: string }
canReportResult(userId, match): boolean      // é um dos 4 jogadores
canConfirmResult(userId, match, isAdmin): boolean  // dupla oposta à de reported_by, ou admin
```

- `canRegister`: `masculino`→M, `feminino`→F, `misto`/`livre`→qualquer. Jogador
  sem gênero em torneio M/F é barrado com mensagem pedindo para completar o perfil.
- `canConfirmResult`: quem está na **dupla de `reported_by` não pode confirmar**;
  a dupla adversária ou o admin podem.

**Misto — escopo na Fundação:** em `dupla_fixa` + categoria `misto`, a inscrição
valida 1 M + 1 F na dupla (em `registerForTournament`). Em `dupla_revezando`
(Americano) categoria `misto` significa apenas **pool misto**: as duplas são
sorteadas pela rotação sem restrição de gênero por par (impor 1M+1F por par
gerado restringiria demais a combinatória — fica para sub-projeto futuro se
desejado).

---

## 3. Server Actions + Telas

### 3.1 Actions (`features/torneios/actions.ts`, generalizar as existentes)

- `createTournament(input)` — admin. Recebe `sport, category, participant_type,
  format, level, scoring{sets_to_win, games_per_set, tiebreak_games}`. Mantém
  fluxo de status `draft→open→in_progress→finished`.
- `registerForTournament(tournamentId, partnerId?)` — aluno. Grava em
  `tournament_entries`. Valida: torneio `open`, nível
  (`canStudentAttendLevel`), gênero (`canRegister`), duplicidade. `dupla_fixa`
  exige `partnerId`; em `misto` valida 1 M + 1 F na dupla.
- `generateBracket(tournamentId)` — admin. **Nova.** Lê entries, **embaralha**,
  chama `FORMATS[format].generate`, insere os `tournament_matches` de forma
  idempotente (regenerar limpa a chave anterior: delete + insert). Só com nº de
  inscritos válido. Mover para `in_progress` pode disparar a geração.
- `reportMatchResult(matchId, result)` — qualquer um dos 4 jogadores. Grava
  `result`, `games1/games2`, `reported_by = user`, `result_status = 'pending'`.
- `confirmMatchResult(matchId)` — dupla adversária ou admin →
  `result_status = 'confirmed'`, `confirmed_by = user`.
- `recordMatchResult(matchId, result)` — admin. Grava **já confirmado**; pode
  corrigir um confirmado.
- `unregister` / `removeEntry` — aluno cancela própria inscrição enquanto `open`;
  admin remove inscrito.

Todas seguem o padrão atual: `getActiveOrgId` + checagem de `role` na membership
+ escopo por `organization_id`. Retornam `{ error?: string }` em pt-BR.

### 3.2 Tela admin (`app/(admin)/admin/torneios/...`)

- **Criar**: form com esporte (select de `SPORTS`), categoria, tipo de
  participante, formato (só Americano habilitado na Fundação), nível, config de
  placar.
- **Detalhe**: inscritos (com gênero/nível), botão **"Gerar chave"** (confirmação
  ao regenerar), rodadas com `AdminMatchCard` editável (placar por set) e
  **tabela de Classificação** ao vivo. Reaproveita `BracketView`/`AdminMatchCard`.

### 3.3 Tela aluno (`app/(dashboard)/torneios/...`)

- Lista de torneios (filtra por esporte/categoria/status).
- Detalhe: **inscrever-se** (individual; ou escolher parceiro em dupla fixa), ver
  minha agenda de rodadas, e a **classificação**.
- Na minha partida: campo de placar (se sem resultado); se há `pending` que eu
  posso confirmar → botão **"Confirmar placar"**; se eu/minha dupla reportou →
  "aguardando confirmação da outra dupla".
- `RegisterButton` adaptado: valida gênero/perfil incompleto com mensagem clara.

### 3.4 Componente de Classificação (`features/torneios/StandingsTable.tsx`)

Novo. Recebe `StandingRow[]` já computadas no servidor; só renderiza (posição,
nome, J/V, games pró/contra, saldo).

### Tratamento de erro

Toda action devolve `{ error?: string }` em pt-BR. Geração com nº inválido de
inscritos ou tamanho não suportado retorna mensagem específica. Perfil sem gênero
em torneio M/F orienta o aluno a completar o cadastro.

---

## 4. Confirmação de placar (fluxo)

1. Jogador A (de uma das duplas) abre sua partida e lança o placar →
   `result_status='pending'`, `reported_by=A`.
2. Qualquer jogador da **dupla adversária** vê "Confirmar placar" → confirma →
   `result_status='confirmed'`. (A própria dupla de A **não** confirma.)
3. Alternativamente, o **admin** lança/confirma direto (`recordMatchResult`),
   inclusive corrigindo um já confirmado.
4. A classificação só conta `confirmed` — `pending` aparece como "aguardando
   confirmação" e não pontua (evita manipulação de saldo).

---

## 5. Testes

Vitest co-locado, foco nas funções puras (onde mora o risco):

- `americano.test.ts` — tamanhos 4–16: todos jogam (±1), parcerias mínimas
  repetidas, byes distribuídos igualmente; tamanho inválido lança erro.
- `standings.test.ts` — agregação por jogador, ordenação (saldo→games→vitórias),
  ignora `pending`/sem resultado.
- `eligibility.test.ts` — gênero por categoria; `canReport` (um dos 4);
  `canConfirm` (dupla própria não confirma; admin sempre pode).

Actions ficam finas e são cobertas por `npm run build` + smoke manual.

---

## 6. Revisão da Comunidade (incluída neste ciclo)

Passe rápido, sem features novas:

- Confirmar que o **bucket de Storage** das imagens de post existe e tem policy
  correta.
- Conferir RLS de `posts` / `post_likes` / `post_comments`.
- Testar fluxo em prod: criar post com foto, curtir, comentar.
- Corrigir o que estiver quebrado.

---

## 7. Verificação final

1. `npm run test:run` — suite verde (inclui os novos testes puros).
2. `npm run build` — sem erro de tipo após os novos campos/tipos.
3. **Roteiro manual:** criar Americano de 8 → inscrever (testando trava de
   gênero) → gerar chave → aluno reporta placar + adversário confirma → ver
   classificação atualizar → encerrar.
4. Migrations aplicadas manualmente pelo usuário no SQL Editor.

---

## Arquivos críticos

- **Migrations novas** (`20260626xxxxxx_*`): `profiles.gender`;
  generalizar `tournaments`; criar `tournament_entries` + RLS; generalizar
  `tournament_matches`.
- `types/index.ts` — `TournamentFormat` ampliado, `TournamentCategory`,
  `ParticipantType`, `Gender`, `TournamentEntry`, `ScoringConfig`,
  `StandingRow`; `Tournament` e `Profile` atualizados.
- `lib/torneios/formats.ts`, `lib/torneios/schedule/americano.ts`,
  `lib/torneios/standings.ts`, `lib/torneios/eligibility.ts` (+ testes).
- `features/torneios/actions.ts` — generalizar + `generateBracket`,
  `reportMatchResult`, `confirmMatchResult`.
- `features/torneios/StandingsTable.tsx` (novo); `BracketView`/`AdminMatchCard`
  adaptados ao resultado por games + confirmação.
- `app/(admin)/admin/torneios/*` e `app/(dashboard)/torneios/*` — forms e detalhe.
- Cadastro/perfil — coleta de `gender`.

## Fora de escopo (sub-projetos futuros)

- Round-robin e eliminatória (Sub-projeto 2).
- Americano com placar/critério de desempate configurável além do fixado.
- Ranking de temporada cross-torneio (Sub-projeto 3).
- Features estilo LetzPlay: H2H, estatísticas de carreira, página pública de
  torneio, compartilhamento.
