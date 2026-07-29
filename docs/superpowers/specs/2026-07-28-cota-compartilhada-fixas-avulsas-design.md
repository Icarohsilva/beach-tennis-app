# Cota compartilhada entre fixas e avulsas — Design

**Goal:** Hoje a cota do plano só trava reserva avulsa — a matrícula fixa nunca é bloqueada, de propósito (`resolveQuota`'s `max()`). Este design muda isso: fixa e avulsa passam a disputar o **mesmo saldo mensal**. Se o aluno gastar avulsa demais, ou tiver mais matrículas fixas do que o plano atual permite, a geração da grade deixa de vinculá-lo numa aula fixa naquela semana — e avisa o aluno e o admin.

**Contexto:** Segue os planos [`2026-07-28-cota-de-aulas-por-plano.md`](../plans/2026-07-28-cota-de-aulas-por-plano.md) e [`2026-07-28-editar-planos-existentes.md`](../plans/2026-07-28-editar-planos-existentes.md), já em produção. Este design **reverte deliberadamente** a garantia documentada em `lib/utils/classQuota.ts` ("a matrícula fixa NUNCA pode ser bloqueada pela cota") — essa garantia foi correta pro desenho original, mas o dono do produto decidiu que fixa e avulsa devem competir pelo mesmo saldo.

## Comportamento hoje vs. novo

| | Hoje | Novo |
|---|---|---|
| Fixa consome cota? | Não — sempre gerada, `max()` protege | Sim — mesma cota que a avulsa |
| Avulsa extra afeta fixa futura no mês? | Não | Sim — pode zerar o saldo antes da próxima geração |
| Mais fixas que o plano atual permite? | `max()` absorve, nunca bloqueia | As excedentes (mais novas por `enrolled_at`) não contam pro cálculo do limite, e competem pelo saldo igual uma avulsa |
| Mês com 5 ocorrências do dia da fixa (ex: dia 31 cai na aula dele) | Ganha o extra (9 em vez de 8) | **Continua igual** — não muda |
| Geração da grade verifica cota? | Não, nunca | Sim, quando `quota_enforcement_enabled = true` |

## Arquitetura

### 1. `features/aulas/quotaUsage.ts` — `getQuotaSnapshot` só conta fixas até o limite do plano atual

Hoje, `fixedSessionsInCycle` soma as ocorrências de **todas** as matrículas ativas do aluno. Passa a somar só as ocorrências das matrículas até o limite de `plan.classes_per_week`, escolhidas pelas mais **antigas** (`enrolled_at` ascendente) — as excedentes (mais novas) contam como 0 nesse cálculo.

Isso sozinho resolve o caso "plano foi reduzido depois de o aluno já ter mais fixas": as matrículas excedentes deixam de inflar o limite artificialmente.

**`resolveQuota` (`lib/utils/classQuota.ts`) não muda.** O `max(classes_per_week × semanas, fixas)` continua existindo e continua sendo o que garante o caso do mês de 31 dias (a fixa que *conta* dentro do limite do plano ainda ganha o extra quando o dia dela cai 5 vezes no mês) — a mudança é só em **quais matrículas** entram nesse cálculo, não na fórmula em si. Isso significa: zero risco de regressão nos 18 testes já existentes de `resolveQuota`.

### 2. `features/aulas/creditReconciliation.ts` — a reconciliação passa a checar cota

`reconcileAllActiveEnrollments(from, to, orgId)` hoje itera todas as matrículas ativas e reserva via `book_session_atomic`, sem checar nada. Passa a, **só quando `isQuotaEnforced(orgId)` e o aluno tem plano ativo não-parceiro**:

1. Agrupar as matrículas por aluno.
2. Pra cada aluno: buscar o retrato da cota (`getQuotaSnapshot`) uma vez no início da execução — dá o `remaining` disponível.
3. Ordenar as matrículas desse aluno que têm sessão a gerar nesta rodada por `classes.day_of_week` (e `start_time` como desempate) — terça antes de quinta, por exemplo.
4. Processar nessa ordem: enquanto `remaining > 0`, reconcilia normalmente e decrementa; quando `remaining` chega a 0, as matrículas restantes daquele aluno **não são reservadas nesta rodada** — entram na lista de "puladas por falta de cota".
5. Aluno parceiro (Wellhub/TotalPass) ou sem cota ligada: comportamento **inalterado**, nunca entra nesse fluxo.

**Fora deste design:** aluno sem plano ativo e sem parceiro, mas com matrícula fixa (estado hoje só possível se a assinatura foi cancelada depois da matrícula) — isso já é uma inconsistência pré-existente fora do escopo da Task 10 original, e continua fora daqui.

### 3. Aviso — reusa a infraestrutura de notificação já existente

Cada matrícula pulada por falta de cota gera duas notificações via `notifyUsers` (`lib/notifications/dispatch.ts`), mesmo padrão de `features/aulas/gridNotify.ts` (`channels: ['push', 'inapp']`, tipo novo `'fixa_sem_cota'`):

- **Pro aluno:** título "Sem cota disponível", corpo explicando qual aula e por quê ("Você não foi vinculado à aula de {nome da turma} ({dia da semana}) esta semana — sua cota mensal já foi usada.").
- **Pra todo `admin` da academia** (inclusive quem é chamado de "professor" — não existe papel separado, ver conversa anterior): título "Aluno sem cota", corpo com nome do aluno + turma ("{nome do aluno} não foi vinculado à aula de {turma} esta semana por falta de cota. Revise o plano dele.").

Essas notificações já ficam visíveis no sino de notificações (`NotificationBell.tsx`) tanto pro aluno quanto pro admin — não precisa de tela nova.

### 4. Resumo no painel, ao gerar a grade

`app/(admin)/admin/grade/GridGenerateButtons.tsx` já mostra um resumo inline ao gerar ("X sessões · Y reservados"), vindo de `generateGridWeek`/`generateGridDay` (`features/aulas/gridActions.ts`). O resumo ganha mais um número: **quantos alunos ficaram sem cota nesta geração** (ex: "2 sem cota"). Não precisa de log persistido — segue o mesmo padrão já usado hoje (resultado efêmero, só na tela de quem gerou), e as notificações individuais já servem de registro duradouro pra quem foi afetado.

## Fluxo de dados

Admin clica "Gerar semana" → `generateGridWeek` cria as `class_sessions` da semana → `reconcileAllActiveEnrollments` agrupa matrículas por aluno → pra cada aluno com plano ativo e cota ligada, busca `getQuotaSnapshot`, ordena as matrículas da semana por dia, reserva enquanto sobrar saldo, registra as puladas → dispara notificação pro aluno + admins de cada pulada → devolve o resultado (incluindo a contagem de puladas) → `GridGenerateButtons` mostra o resumo.

## Testes

- **`features/aulas/quotaUsage.test.ts`** (estendido): aluno com 3 matrículas ativas mas plano permite só 1 → só a mais antiga conta pro `fixedSessionsInCycle`; as outras duas contam 0.
- **`features/aulas/creditReconciliation.test.ts`** (estendido): aluno com cota estourada por avulsa extra não é reconciliado na fixa da vez seguinte, na ordem certa (dia mais cedo tem prioridade); aluno parceiro não é afetado; cota desligada preserva o comportamento de hoje (sempre reconcilia).
- **Notificação**: teste de que `notifyUsers` é chamado com os parâmetros certos (aluno + cada admin) quando uma matrícula é pulada — sem precisar testar a entrega real (`notifyUsers` já é testado isoladamente).

## Fora deste design

- Log persistido de gerações passadas (não existe hoje pra nada relacionado à grade; mantém o padrão efêmero já usado).
- Aluno sem plano ativo e sem parceiro mas ainda com matrícula fixa (inconsistência pré-existente, fora do escopo).
- Qualquer mudança em `addStudentToSession` (admin adicionando aluno avulso numa sessão) — continua furando a cota, como sempre.
