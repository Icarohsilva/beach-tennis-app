# Geração semanal da grade

**Data:** 2026-07-17
**Status:** aprovado, pronto para plano de implementação

## Contexto

Hoje a grade de aulas é gerada em lote de **90 dias**: ao criar uma turma
(`features/aulas/class-form-actions.ts` → `createClass`) e via um botão manual
por turma (`generateSessionsForExistingClass`, também 90 dias). Um cron mensal
(`monthly-credit-renewal`, dia 1) reserva os alunos fixos no mês inteiro. Não há
geração **automática** de sessões configurável, nem controle por dia.

Este spec troca o regime de 90 dias por **geração semanal**: cada execução gera
os próximos 7 dias e reserva os alunos fixos neles. A academia pode gerar
manualmente (um dia da semana ou a semana toda) e/ou ligar a geração automática,
escolhendo dia e hora.

### Escopo

Este é o **spec 2 de 3** da sequência atual (1. regras de acesso/crédito ✅ ·
**2. geração semanal da grade** · 3. fluxo de cobrança/pendência). Cobre:

- Núcleo de geração semanal compartilhado por todos os caminhos.
- Geração na criação de turma (7 dias, não mais 90).
- Geração manual por dia-da-semana e da semana toda.
- Geração automática configurável (dia + hora), resiliente a falha do cron.
- Migração de expurgo das sessões futuras do regime de 90 dias.
- Limpeza do resíduo do Spec 1 e do cron mensal.

**Fora de escopo:** o fluxo de cobrança/pendência (spec 3).

## Decisões

| Questão | Decisão |
|---|---|
| Janela de cada geração | 7 datas corridas incluindo hoje (`[hoje, hoje+6]`) |
| Criar turma | Gera a próxima semana da turma na hora |
| "Gerar um dia" | Um dia-da-semana: todas as turmas daquele dia |
| Auto-geração | **Desligada** por padrão; academia liga e escolhe dia+hora |
| Precisão da hora | Hora cheia BRT (o cron roda de hora em hora) |
| Agendamento do cron | Catch-up com marca d'água (resiliente a atraso/falha) |
| Sessões de 90 dias em prod | Expurgo de hoje em diante, exceto realizadas |
| Cron mensal | Removido (a geração semanal o torna redundante) |
| Repovoar pós-expurgo | Manual (academia clica); migration não regenera |
| Botão por-turma | Substituído por "Gerar [dia]" + "Gerar semana toda" |

## Arquitetura

### 1. Núcleo — `features/aulas/gridGeneration.ts` (novo)

Uma função que **todos** os caminhos chamam:

```ts
export async function generateGrid(
  orgId: string,
  from: string,          // yyyy-MM-dd
  to: string,            // yyyy-MM-dd
  opts?: { dayOfWeek?: number; classId?: string },
): Promise<{ sessionsCreated: number; studentsBooked: number }>
```

Faz duas coisas, nesta ordem:

1. **Gera as sessões.** Busca as turmas ativas da org (filtrando por `dayOfWeek`
   e/ou `classId` quando fornecidos), monta as linhas com `buildSessionRows`
   (`features/aulas/sessionUtils.ts`, já existe) no intervalo `[from, to]`, e faz
   `upsert` em `class_sessions` com `onConflict: 'class_id,session_date',
   ignoreDuplicates: true`. Idempotente: reexecutar não duplica.
2. **Reserva os fixos.** Chama `reconcileAllActiveEnrollments(from, to, orgId)`
   (`features/aulas/creditReconciliation.ts`, já existe) — reserva as matrículas
   fixas elegíveis (plano vigente ou parceiro) nas sessões scheduled do intervalo.
   Já é idempotente e não mexe em crédito desde o Spec 1.

`from`/`to` padrão dos callers: `hoje` e `hoje + 6 dias` (BRT) — 7 datas
corridas, cada dia-da-semana aparecendo exatamente uma vez. (`[hoje, hoje+6]`
seriam 8 datas e duplicariam um dia-da-semana na "semana toda".)

### 2. Os quatro caminhos

**a. Criar turma** (`class-form-actions.ts` → `createClass`): substitui o bloco
de 90 dias por `generateGrid(orgId, hoje, hoje+6, { classId: newClass.id })`. A
turma aparece na grade imediatamente com sua próxima semana.

**b. Botão "Gerar [dia]"** (novo, no cabeçalho de cada dia da grade): server
action `generateGridDay(dayOfWeek)`. Calcula a próxima ocorrência daquele
dia-da-semana dentro de `[hoje, hoje+6]` e chama `generateGrid(orgId, essaData,
essaData, { dayOfWeek })`. Gera as turmas do dia e reserva seus fixos.

**c. Botão "Gerar semana toda"** (novo, no topo da grade): server action
`generateGridWeek()` → `generateGrid(orgId, hoje, hoje+6)`.

**d. Cron automático** (§4): `generateGrid(orgId, hoje, hoje+6)` por org elegível.

As três server actions (`generateGridDay`, `generateGridWeek`, e a chamada em
`createClass`) exigem admin da org ativa (mesmo `requireAdmin` de
`adminActions.ts`) e retornam `{ error?, sessionsCreated?, studentsBooked? }`.

### 3. Configuração da auto-geração

Em `system_settings` (key/value por org — padrão já usado no projeto):

| Key | Default | Significado |
|---|---|---|
| `grid_auto_enabled` | `'false'` | Liga/desliga a auto-geração |
| `grid_auto_day` | `'1'` | Dia-da-semana alvo (0=domingo … 6=sábado) |
| `grid_auto_hour` | `'6'` | Hora cheia BRT (0–23) |
| `grid_auto_last_run` | ausente | Marca d'água ISO da última execução (§4) |

UI: novo bloco no `app/(admin)/admin/configuracoes/SystemSettingsForm.tsx` —
toggle + seletor de dia + seletor de hora. Só o dono/admin edita (a tela já é
gated). `grid_auto_last_run` é interno, não aparece no formulário.

### 4. Cron catch-up — `app/api/cron/weekly-grid-generation/route.ts` (novo)

Registrado no `vercel.json` com schedule `0 * * * *` (de hora em hora).

Fluxo:

1. `verifyCronSecret` (padrão dos outros crons).
2. Lista as orgs com `grid_auto_enabled = 'true'` (query em `system_settings`).
3. Para cada org, lê `grid_auto_day`, `grid_auto_hour`, `grid_auto_last_run` e
   decide via a função pura `shouldRunGridNow` (§5). Se deve rodar:
   `generateGrid(orgId, hoje, hoje+6)` e grava `grid_auto_last_run = now.toISOString()`.
4. Cada org dentro de try/catch — uma falha não aborta o lote. Retorna
   contadores (`orgsProcessed`, `sessionsCreated`, `failed`).

**Por que catch-up e não match exato:** se o Vercel atrasar ou falhar exatamente
na hora configurada, um match exato (`hora == config`) perde a janela e a grade
daquela academia fica vazia até a semana seguinte — justo o que a automação
existe pra evitar. O catch-up gera assim que `agora >= alvo` e a marca d'água
mostra que ainda não rodou para aquele alvo.

### 5. Lógica pura do agendamento — `lib/utils/gridSchedule.ts` (novo)

```ts
export function shouldRunGridNow(
  targetDay: number,      // 0–6
  targetHour: number,     // 0–23, BRT
  lastRunIso: string | null,
  now: Date,
): boolean
```

Calcula o **alvo mais recente**: o instante mais recente (≤ `now`, em BRT) em que
ocorreram `targetDay` + `targetHour`. Retorna `true` se `now >= alvo` **e**
(`lastRun` é null **ou** `lastRun < alvo`). Puro, sem I/O — o fuso BRT é montado
com o mesmo padrão de `lib/utils/sessionTime.ts` (âncora −03:00). É o teste que
pega o bug de fuso.

### 6. Migração de expurgo — `supabase/migrations/<ts>_weekly_grid_reset.sql` (novo)

Apaga as `class_sessions` de **hoje em diante**, **exceto as já realizadas**:

```sql
delete from class_sessions cs
where cs.session_date >= (now() at time zone 'America/Sao_Paulo')::date
  and cs.status <> 'completed'
  and not exists (
    select 1 from attendance a where a.session_id = cs.id
  );
```

- `status <> 'completed'` e `not exists attendance` preservam sessões que já
  aconteceram ou têm presença marcada — desde o Spec 1 a **dívida e o financeiro
  nascem da presença**, então apagar uma sessão com presença destruiria registro
  financeiro irrecuperável.
- **Cascade confirmado no schema** (`001_initial_schema.sql`): `session_bookings.session_id`
  e `attendance.session_id` são `on delete cascade` — as reservas futuras das
  sessões apagadas caem junto. Os alunos fixos voltam a ser reservados na primeira
  geração pós-migration.
- **`payments.session_id` é `on delete set null`** (não cascade): uma dívida/
  pagamento ligado a uma sessão apagada **não** é removido, só perde o vínculo.
  Como toda dívida nasce da presença, e sessões com presença são preservadas, o
  único caso de órfã é a **pré-declaração do admin** (Spec 1: `payments status=paid`
  gravado ao adicionar o aluno, antes da presença) numa sessão futura sem presença
  ainda. Fica um pagamento `paid` com `session_id` null — inofensivo: `hasOpenDebt`
  filtra `session_id is not null` (não bloqueia ninguém) e o valor segue no relatório
  financeiro. Risco prático ~nulo (a feature acabou de ir a prod; poucas ou nenhuma
  pré-declaração futura existirão no momento da migration).
- **A grade futura fica vazia** até a academia gerar de novo. A migration **não**
  regenera — a academia usa "Gerar semana toda" quando quiser (ou liga a auto).

**Ordem de deploy:** código antes da migration (o código novo não depende das
sessões antigas; o expurgo só remove o que o regime velho deixou).

### 7. Limpeza de resíduo

- **Remover** `generateSessionsForExistingClass` e `generateWeeklyBookings`
  (`features/aulas/adminActions.ts`) — substituídos pelo núcleo novo.
- **Remover** `GenerateSessionsButton.tsx` (botão por-turma, ainda mostra o
  "⚠️ sem crédito" obsoleto do pré-Spec-1) e seus usos na grade.
- **Remover** o cron `monthly-credit-renewal` (`app/api/cron/monthly-credit-renewal/route.ts`)
  e sua entrada no `vercel.json`. A geração semanal cobre a reserva dos fixos.
- Manter `reconcileAllActiveEnrollments`/`reconcileEnrollmentCredits` (o núcleo
  os reusa) e `buildSessionRows`.

## UI

- **Grade** (`app/(admin)/admin/grade/page.tsx`): botão "Gerar semana toda" no
  topo (ao lado de "+ Nova Turma"); botão "Gerar [dia]" no cabeçalho de cada dia
  da grade semanal. Ambos mostram o resultado (`N sessões geradas · M alunos
  reservados`). Some o botão por-turma.
- **Configurações** (`SystemSettingsForm.tsx`): bloco "Geração automática da
  grade" com toggle + dia + hora.

## Testes

Vitest, co-locado, seguindo o padrão do repo:

- **`lib/utils/gridSchedule.test.ts`** — `shouldRunGridNow`: roda quando
  `now >= alvo` e nunca rodou; não roda de novo no mesmo alvo (`lastRun >= alvo`);
  roda um alvo atrasado (cron perdeu a hora exata → próxima hora pega); fuso BRT
  (o alvo é calculado em −03:00, não UTC); bordas de virada de dia/semana.
- **`features/aulas/gridGeneration.test.ts`** — `generateGrid`: gera só o
  intervalo de 7 dias; o filtro `dayOfWeek` restringe às turmas do dia;
  idempotência (reexecutar não duplica sessões); chama a reconciliação com a
  janela certa.
- **Recorte do expurgo** — teste da condição SQL como predicado (via função pura
  ou asserção do WHERE): preserva `completed` e sessões com presença; apaga o
  resto de hoje em diante.

## Riscos

| Risco | Mitigação |
|---|---|
| Expurgo apaga sessão com presença (perda financeira) | `status <> 'completed'` + `not exists attendance`; testado |
| Cron perde a hora exata → grade vazia | Catch-up com marca d'água (§4/§5); testado |
| Fuso no cálculo do alvo desloca a geração | `shouldRunGridNow` puro em BRT; teste dedicado |
| Grade vazia surpreende a academia pós-migration | Documentado; botão manual visível; auto opt-in |
| Reserva de fixos em turma cheia | `book_session_atomic` já trata `SESSION_FULL` (skip) |
