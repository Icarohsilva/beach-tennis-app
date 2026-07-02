# Torneios — Home "Meus Torneios/Próximo jogo" + Agendamento de confronto

**Data:** 2026-07-02
**Status:** Aprovado (design) — aguardando review da spec escrita

## Contexto

O módulo de torneios já tem inscrição, geração de chave (Americano), placar com
confirmação, classificação, lista de espera e cobrança. Faltam duas coisas que o
usuário (dono da academia) pediu:

1. **Visibilidade dos "meus torneios" na home.** Hoje a home só mostra "Próximos
   Torneios" (torneios com inscrições abertas na academia). O aluno não vê em lugar
   nenhum da home os torneios em que **está inscrito**, nem o seu **próximo jogo**.
   Só descobre entrando na página do torneio.

2. **Marcar data e hora de cada confronto.** Os confrontos são gerados sem
   data/hora. O usuário quer poder **informar a data e hora de um jogo** — tanto o
   admin quanto os próprios alunos daquele confronto — e que a home mostre o
   **próximo confronto** com a data/hora quando houver.

## Decisões já tomadas (perguntas de esclarecimento)

- **Marcação de horário = livre (último a salvar vale).** Admin da academia **ou**
  qualquer participante do confronto define/edita a data e hora sem etapa de
  confirmação do adversário. Modelo simples, adequado ao contexto casual.
- **Home mostra os três blocos:** card "Próximo jogo" + seção "Meus Torneios" +
  a seção atual "Próximos Torneios" (mantida).
- **"Meus Torneios" = apenas ativos:** torneios com status `open` ou `in_progress`
  em que tenho inscrição. Some da home quando o torneio encerra. Mantém a home limpa.
- **Guardar só data e hora por confronto** (sem quadra/local). YAGNI.
- **"Próximo jogo" mostra o confronto de hoje em diante.** Regra: o confronto
  **não confirmado** cujo `played_at` é `>=` início do dia de hoje, escolhendo o de
  horário mais próximo. Assim um jogo das 18h que atrasou continua aparecendo às 19h
  até alguém lançar o placar.

## Descobertas importantes do código

- **Sem migration.** A coluna `tournament_matches.played_at timestamptz` (nullable)
  **já existe** desde `001_initial_schema.sql` e está sem uso. É onde a data/hora do
  confronto será gravada.
- **Sem mudança de RLS.** A ação de agendar roda via `createAdminClient()`
  (service role, ignora RLS) e a permissão é validada no próprio código
  (admin da org **ou** participante do confronto) — mesmo padrão de
  `reportMatchResult`/`recordMatchResult`.
- O componente `MatchScoreCard` já é renderizado **nas duas telas** de detalhe
  (aluno: `app/(dashboard)/torneios/[id]/page.tsx` linha ~207/251; admin:
  `app/(admin)/admin/torneios/[id]/page.tsx` linha ~427). Adicionar o controle de
  agendamento nele faz o recurso aparecer nos dois lugares de uma vez.
- **Os dois selects de `tournament_matches` não trazem `played_at` hoje** — precisam
  incluir a coluna e o tipo `ScoreMatchRaw`/`ScoreMatch` precisa do campo.
- A elegibilidade "sou participante do confronto" já existe: `canReportResult` em
  `lib/torneios/eligibility.ts` recebe `{ player1_id, partner1_id, player2_id,
  partner2_id, reported_by }` e diz se o usuário participa.

## Arquitetura

Reaproveitar `played_at` + uma ação `scheduleMatch` + estender `MatchScoreCard`.
Na home, um **helper de dados isolado** + **componentes de apresentação**, para não
inchar `home/page.tsx` (já com ~440 linhas) e manter a regra de "próximo jogo"
testável.

Alternativas descartadas:
- Colocar as queries e o render inline na home → incha um arquivo já grande e mistura
  responsabilidades.
- Fluxo "propor → confirmar" para o horário → o usuário escolheu marcação livre.

### Feature 1 — Agendar data/hora do confronto

**Dados:** `tournament_matches.played_at` (existente). Valor `null` = sem horário.

**Fuso horário (decisão explícita):** o `<input type="datetime-local">` devolve
hora local sem fuso (ex.: `2026-07-05T18:00`). O componente cliente converte esse
valor para um ISO com **offset de Brasília (-03:00)** antes de enviar à ação, que
grava direto em `timestamptz`. A exibição usa `America/Sao_Paulo` (pt-BR). Isso evita
o bug de o servidor (UTC na Vercel) reinterpretar o horário. Helper de conversão fica
junto ao card (ou em `lib/torneios/`), com a constante de offset `-03:00`.

**Ação `scheduleMatch(matchId: string, playedAtIso: string | null)`** em
`features/torneios/actions.ts`:

1. `getUser()`; se não houver, `{ error: 'Não autenticado.' }`.
2. `orgId = await getActiveOrgId()`; se vazio, `{ error: 'Academia ativa não encontrada.' }`.
3. Carrega o confronto via `adminClient` filtrando por `id` **e** `organization_id`
   (org-scoped): `id, player1_id, partner1_id, player2_id, partner2_id`. Se não achar,
   `{ error: 'Confronto não encontrado.' }`.
4. **Permissão:** busca `role` da membership do usuário na org. `canEdit = role === 'admin'
   || canReportResult(user.id, match)`. Se `!canEdit`, `{ error: 'Sem permissão.' }`.
5. Se `playedAtIso` não é `null`: valida que é uma data parseável
   (`!Number.isNaN(new Date(playedAtIso).getTime())`), senão `{ error: 'Data/hora inválida.' }`.
6. `update({ played_at: playedAtIso }).eq('id', matchId).eq('organization_id', orgId)`.
   Em erro, `{ error: 'Erro ao salvar a data/hora. Tente novamente.' }`.
7. `revalidatePath('/torneios/' + tournamentId)`, `revalidatePath('/admin/torneios/' + tournamentId)`,
   `revalidatePath('/home')`. Retorna `{}`. (O `tournament_id` do confronto é lido no passo 3.)

**UI no `MatchScoreCard`:**
- Assinatura mínima: adicionar só `played_at: string | null` em `ScoreMatch`. Não é
  preciso passar `tournamentId` — a ação `scheduleMatch` recebe apenas `matchId` e lê
  o `tournament_id` do banco para revalidar.
- Exibição: quando `played_at != null`, mostrar uma linha "📅 sáb, 05/07 · 18:00"
  (formatada em BRT/pt-BR) no cabeçalho do card, ao lado do `roundLabel`.
- Edição: `canSchedule = isAdmin || mySide !== null` (participante). `mySide` já é
  calculado no card. Quando `canSchedule`, mostrar botão **"Marcar data/hora"**
  (ou "Editar data/hora" se já houver) que abre um `datetime-local` inline com
  **Salvar** e **Limpar** (limpar envia `null`). Usa `useTransition` +
  `router.refresh()`, igual ao fluxo de placar existente. Erros exibidos no rodapé.
- Quem não pode agendar apenas vê a linha da data (quando houver).

### Feature 2 — Home: "Próximo jogo" + "Meus Torneios"

**Função pura `pickNextMatch(matches, now)`** — novo `lib/torneios/nextMatch.ts`:
```ts
export interface SchedulableMatch {
  id: string
  played_at: string | null
  result_status: 'pending' | 'confirmed' | null
}
// Retorna o confronto NÃO confirmado com played_at != null cujo horário é o mais
// próximo a partir do início do dia de `now` (inclui jogos de hoje já atrasados).
// Retorna null se nenhum se qualifica.
export function pickNextMatch<T extends SchedulableMatch>(matches: T[], now: Date): T | null
```
Regra: descarta `played_at == null`, descarta `result_status === 'confirmed'`,
descarta `played_at < startOfToday(now)`; entre os restantes, escolhe o menor
`played_at`. `startOfToday` = meia-noite local (BRT) do dia de `now`.

**Helper de dados `getStudentTournamentHome({ orgId, userId })`** — novo
`features/torneios/studentHome.ts` (usa `createAdminClient`, org-scoped):
1. Minhas inscrições na org: `tournament_entries` onde `organization_id = orgId` e
   (`player_id = userId` **ou** `partner_id = userId`) via
   `.or('player_id.eq.<id>,partner_id.eq.<id>')`. Coleta `tournament_id`s (distintos).
2. `myTournaments`: `tournaments` com `id in (...)`, `organization_id = orgId`,
   `status in ('open','in_progress')`, `order by date asc`. Se não houver ids → `[]`.
3. `nextMatch`: se houver torneios ativos, buscar `tournament_matches` onde
   `organization_id = orgId`, `tournament_id in (<ativos>)`, e o usuário é um dos 4
   participantes (`.or('player1_id.eq,partner1_id.eq,player2_id.eq,partner2_id.eq')`),
   trazendo `id, tournament_id, played_at, result_status` + nomes dos 4 jogadores
   (join em `profiles`, admin client) + nome do torneio. Aplicar `pickNextMatch(...)`
   com `new Date()`. Montar um `NextMatchSummary` com: `tournamentId`, `tournamentName`,
   `playedAt`, e os rótulos dos dois times (reusar `teamLabel` de `lib/torneios/display`).
4. Retorna `{ myTournaments, nextMatch }` com tipos próprios do helper
   (`MyTournamentSummary[]`, `NextMatchSummary | null`).

**UI na home (`app/(dashboard)/home/page.tsx`):**
- Chamar o helper depois de resolver `orgId`/`user`.
- **`NextMatchCard`** (novo `features/torneios/NextMatchCard.tsx`, apresentacional):
  card em destaque logo **após** o `CheckinProgressCard` e **antes** de "Aulas de hoje".
  Mostra "Próximo jogo", data/hora (BRT), "time A vs time B" e o nome do torneio;
  o card inteiro é `Link` para `/torneios/<tournamentId>`. Só renderiza quando
  `nextMatch != null`.
- **Seção "Meus Torneios"**: lista simples (reusa `Card` + `Badge`), cada item com
  nome, data (`formatDate`) e badge de status ("Inscrições Abertas"/"Em Andamento"),
  `Link` para `/torneios/<id>`. Renderiza a seção só quando `myTournaments.length > 0`.
  Fica **acima** da seção "Próximos Torneios".
- **"Próximos Torneios" (ajuste):** a query atual busca `tournaments` `status='open'`
  da org. Passa a **excluir** os torneios em que já estou inscrito (senão duplicaria
  com "Meus Torneios"). Excluir usando os `tournament_id`s das minhas inscrições
  (`.not('id','in','(...)')`) ou filtrando o resultado em memória. Se a lista ficar
  vazia, a seção some (já é condicional a `tournaments.length > 0`).

## Arquivos

**Novos:**
- `lib/torneios/nextMatch.ts` + `lib/torneios/nextMatch.test.ts` (função pura, TDD).
- `features/torneios/studentHome.ts` (helper de dados da home).
- `features/torneios/NextMatchCard.tsx` (apresentacional).

**Editados:**
- `features/torneios/actions.ts` — nova ação `scheduleMatch`.
- `features/torneios/MatchScoreCard.tsx` — `played_at` em `ScoreMatch`, exibição da
  data e controle de agendamento (`canSchedule`, input datetime-local, conversão BRT).
- `app/(dashboard)/torneios/[id]/page.tsx` — incluir `played_at` no select e no tipo
  `ScoreMatchRaw`; passar `played_at` para o `MatchScoreCard`.
- `app/(admin)/admin/torneios/[id]/page.tsx` — mesma inclusão de `played_at`.
- `app/(dashboard)/home/page.tsx` — chamar o helper, renderizar `NextMatchCard` e a
  seção "Meus Torneios", e excluir torneios já inscritos de "Próximos Torneios".

## Tratamento de erros

- Ação `scheduleMatch`: retorna `{ error }` legível em cada falha (não autenticado,
  sem org, confronto inexistente, sem permissão, data inválida, erro de escrita). O
  card exibe no rodapé, mesmo padrão do placar.
- Data/hora inválida barrada tanto no cliente (input) quanto na ação (parse).
- Helper da home é tolerante a vazio: sem inscrições → seções não renderizam; sem
  confronto agendado → sem card.

## Testes

**Unitário (vitest) — `lib/torneios/nextMatch.test.ts`:**
- lista vazia → `null`.
- todos com `played_at == null` → `null`.
- ignora confronto `result_status === 'confirmed'` mesmo com horário futuro.
- ignora confronto com `played_at` anterior ao início de hoje.
- inclui confronto de hoje já passado do horário (mas ainda hoje).
- com vários elegíveis, escolhe o de `played_at` mais próximo.

**Verificação manual (smoke):**
- `npm run test:run` (toda a suíte segue passando) e `npm run build` sem erros de tipo.
- Como aluno participante: marcar data/hora de um confronto meu; conferir que aparece
  no card e que o "Próximo jogo" surge na home.
- Como admin: marcar/editar a data/hora de qualquer confronto; conferir na tela admin.
- Home: aluno inscrito vê "Meus Torneios"; torneio já inscrito não duplica em
  "Próximos Torneios"; ao encerrar o torneio, ele some de "Meus Torneios".

## Fora de escopo

- Quadra/local do confronto, notificações/lembretes de jogo, exportar agenda,
  confirmação do adversário, e histórico de torneios encerrados na home.
