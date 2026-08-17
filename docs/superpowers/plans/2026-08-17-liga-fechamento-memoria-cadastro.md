# Plano: fechamento que fala, temporada que deixa rastro, cadastro que se explica

Spec: [2026-08-17-liga-fechamento-memoria-cadastro-design.md](../specs/2026-08-17-liga-fechamento-memoria-cadastro-design.md)

Sem migration: os três itens leem dados que já existem.

## Bloco A — aviso de fechamento

**A1. `lib/liga/seasonCloseNotice.ts` + teste**
`seasonCloseOutcome()` e `seasonCloseText()`. Casos: zero ponto devolve null; campeão que
subiu vira um único desfecho; rebaixado com ponto recebe convite; quem não se moveu e não
foi campeão devolve null.

**A2. `features/liga/seasonClose.ts` despacha**
Depois de calcular os moves e antes de virar a temporada, montar por (esporte, divisão)
quem foi campeão, cruzar com os moves e notificar. Um push por aluno, prioridade
campeão-que-subiu > campeão > subiu > caiu. `notifyUsers` com `['inapp', 'push']`, tipo
`liga_season_closed`. Best-effort: falha de notificação não pode abortar o fechamento —
a temporada tem que virar de qualquer jeito.

**A3. Teste do despacho**
`seasonClose` já tem teste? Se não, cobrir só a montagem da lista de avisos numa função
exportada e pura o suficiente para testar sem Supabase.

## Bloco B — memória das temporadas

**B1. `getSeasonHistory()` em `features/liga/queries.ts`**
Temporadas `closed` da academia, mais recentes primeiro (limite 6). Para cada uma: linha
do aluno naquele esporte (divisão, posição na divisão, pontos) e o campeão da divisão mais
alta ocupada. Duas queries no total, não uma por temporada.

**B2. `features/liga/SeasonHistory.tsx`**
Bloco "Temporadas anteriores". Não renderiza nada quando a lista vem vazia.

**B3. Montar em `app/(dashboard)/liga/page.tsx`**
Depois do ranking da divisão, antes das medalhas — é continuação do assunto "onde eu
estou".

**B4. Campeões em `/admin/liga`**
Reusar a mesma leitura, sem o recorte do aluno: uma linha por temporada × esporte.

## Bloco C — o que falta no cadastro

**C1. `lib/liga/profileComplete.ts` + teste**
`missingProfileFields()` / `isProfileComplete()`. Caso central: academia com uma
modalidade só não exige declarar modalidade.

**C2. `checkProfileComplete` passa a usar a função pura**
Só a leitura do banco fica em `extraPoints.ts`.

**C3. `getProfileBonusStatus(orgId, studentId)`**
Devolve `{ points, alreadyEarned, missing }`. `null` quando a Liga está desligada ou o
peso é zero — a tela não decide isso sozinha.

**C4. Card no Perfil**
`features/perfil/ProfileBonusCard.tsx`, montado em `app/(dashboard)/perfil/page.tsx`.

## Fechamento

**F1.** `npm run test:run`, `npm run build`, `npm run lint`.
**F2.** Conferir no navegador (rota de preview temporária) o bloco de temporadas e o card
do cadastro; apagar a rota.
**F3.** Atualizar `CLAUDE.md` e abrir a PR.
