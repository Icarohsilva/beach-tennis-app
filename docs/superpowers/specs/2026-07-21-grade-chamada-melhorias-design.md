# Melhorias de Grade & Chamada + Push de geração — Design

**Data:** 2026-07-21
**Contexto:** feedback de uso da geração semanal da grade (spec 2026-07-17, já em produção). O admin/professor relatou confusão na visualização e um caso de "aula sem ninguém pra chamada". A investigação mostrou que os "0 reservados" e a chamada vazia **não são bug de lógica**: a reserva do fixo exige plano/parceiro ativo, e alunos com plano vencido continuam matriculados mas não são reservados. Decisão do usuário: **manter a regra** (só plano/parceiro ativo reserva) e melhorar a **transparência + UX**. Além disso, novas pedidas: gerenciar alunos na edição da turma, info de geração por turma, e **push por academia** ao gerar a grade.

## Objetivo

Melhorar a área de Grade & Chamada do admin/professor (clareza dos números, status do aluno, gestão de alunos na turma, info de geração) e disparar **push multi-tenant** convidando os alunos quando uma grade (dia ou semana) é gerada.

## Decisões

| Tema | Decisão |
|---|---|
| Regra de reserva do fixo | **Mantida**: só reserva quem tem plano ativo vigente OU parceiro **confirmado** (`memberships.partner`) |
| Status do aluno na grade | 3 estados: **Elegível** (verde), **A confirmar** (azul — `pending_partner` sem confirmar), **Sem plano** (amarelo) |
| Wellhub/TotalPass autodeclarado (`pending_partner`) | Mostra "a confirmar" (não é "sem plano"); **não** é reservado até confirmar |
| Feedback do botão "Gerar" | Detalha: `N sessões · X reservados · Y a confirmar · Z sem plano` |
| Números da grade | Rotular: `matriculados · reservados` (reservados = matriculados elegíveis) |
| "Ver alunos" (card) | Leva pra tela de **Editar Turma** (hub de ver/gerenciar alunos) |
| Editar Turma | Lista alunos com status + "Faltar em…" (tira o aluno de **uma data**, sem desmatricular) |
| Info de geração por turma | "Próxima gerada: [data] · gerada [há X]" no card |
| Chamada vazia | Estado claro + "Adicionar aluno" e "Regerar hoje" em destaque |
| Push ao gerar | Em "Gerar dia", "Gerar semana" e no cron — **não** no criar-turma |
| Anti-spam do push | Só notifica quando houve **inserção real** de sessão (não em regeração idempotente) |
| Destinatários do push | Todos os alunos ativos da academia (push só chega em quem tem subscription) |
| Canais | `push` + `inapp` (central de notificações) |
| Conteúdo do push | Por academia: título/corpo com o **nome da academia** que gerou |

---

## 1. Status do aluno (elegível / a confirmar / sem plano)

Hoje a grade só computa `noPlanMap` (sem `partner` E sem plano ativo) e mostra um único `⚠️ N sem plano ativo` ([grade/page.tsx:121-129, 228-232](../../../app/(admin)/admin/grade/page.tsx)). Isso mistura o Wellhub autodeclarado com quem não tem nada.

**Novo cálculo por aluno matriculado** (buscar também `pending_partner` da membership):

- **Elegível** — `partner` (confirmado) **ou** plano ativo vigente (`isSubscriptionCurrent`). → é reservado.
- **A confirmar** — não elegível, mas tem `pending_partner` (Wellhub/TotalPass autodeclarado, ainda não confirmado). → **não** reservado; rótulo neutro (azul), **não** conta como "sem plano".
- **Sem plano** — não elegível e sem `pending_partner`. → não reservado; alerta (amarelo).

**A regra de reserva NÃO muda** (`reconcileAllActiveEnrollments` continua reservando só elegíveis). `pending_partner` é só um estado de **exibição** mais honesto — não torna o aluno reservável.

Onde aplica o mesmo cálculo: grade (`page.tsx`), editar turma (nova seção), e a chamada (`[sessionId]/page.tsx`, que já tem `wouldOweDebt`).

## 2. Feedback do "Gerar" enriquecido

As server actions `generateGridDay`/`generateGridWeek` passam a retornar, além de `sessionsCreated`, a composição de status dos alunos das turmas geradas. O componente [GridGenerateButtons.tsx](../../../app/(admin)/admin/grade/GridGenerateButtons.tsx) mostra:

> `3 sessões geradas · 4 reservados · 🔵 1 a confirmar · ⚠️ 2 sem plano`

Substitui o atual "3 sessões geradas · 0 alunos reservados", que não explicava o porquê.

## 3. Números consistentes na grade

Hoje o card semanal mostra `matriculados/max` ("vagas") e a seção "Hoje" mostra `reservados/max` (bookings confirmados) — números diferentes pra mesma turma, sem rótulo claro.

- **Card semanal:** `X matriculados · Y reservados / max`, onde **Y = matriculados elegíveis** (os que serão reservados). Mais os pills de status (✅/🔵/⚠️).
- **Card "Hoje":** mantém `reservados/max` = **bookings confirmados reais** da sessão de hoje (é a verdade operacional do dia).

## 4. Card da grade redesenhado + info de geração

Layout do card semanal (ver mockup aprovado):

```
Terça 18h                         [Editar]
18:00 – 19:00
5 matriculados · 3 reservados / 8
✅ 3 elegíveis  🔵 1 a confirmar  ⚠️ 1 sem plano
Próxima gerada: 22/07 · gerada há 2h
Ver alunos →                     [Excluir]
```

- **"Próxima gerada: [data]"** = maior `session_date` (status `scheduled`) já criado pra turma. Se não houver sessão futura → "não gerada".
- **"gerada em [data] (há X)"** = `max(created_at)` das sessões da turma. `class_sessions` **não tem** `created_at` hoje → **migration adiciona** `created_at timestamptz not null default now()`; linhas existentes recebem `now()` no deploy (a data de geração passada se perde — aceitável, sem risco destrutivo).
- **"Ver alunos →"** navega pra Editar Turma.

## 5. "Ver alunos" → Editar Turma (hub de alunos)

O `Ver alunos` do card leva pra `/admin/grade/[classId]/editar`, que passa a ser a tela única de ver/gerenciar alunos (evita duplicar a lista em popover no card).

## 6. Editar Turma: lista de alunos + "Faltar em…"

A tela [editar/page.tsx](../../../app/(admin)/admin/grade/[sessionId]/editar/page.tsx) hoje só tem o `EditClassForm`. Adiciona a seção **"Alunos da turma"**:

- Lista os matriculados ativos, cada um com nome, avatar (iniciais) e **status** (✅ Plano ativo / ✅ Parceiro / 🔵 Wellhub a confirmar / ⚠️ Sem plano).
- Por aluno, botão **"Faltar em…"** → abre as próximas **datas geradas** da turma (sessões `scheduled` futuras) → ao escolher uma, cria uma reserva `cancelled` pra aquela sessão (skip pontual).
  - **Não** desmatricula: a matrícula fixa continua; só aquela data é pulada.
  - Reaproveita a mecânica de skip existente (reserva `cancelled`; a reconciliação já respeita reservas em qualquer status e não re-reserva — [creditReconciliation.ts:51-63](../../../features/aulas/creditReconciliation.ts)).
  - Se o aluno já está pulando uma data → mostrar "Faltando em [data] · desfazer" (remove o skip; a próxima geração/reconciliação volta a reservar se elegível).

## 7. Chamada: estado vazio + regerar hoje

Na [chamada](../../../app/(admin)/admin/grade/[sessionId]/page.tsx), quando a sessão não tem reservas:

- Em vez de `AttendanceSheet` vazio silencioso, mostrar estado claro: *"Ninguém reservado ainda."* com **"+ Adicionar aluno"** (o `AddStudentToSession` já existe) em destaque.
- Botão **"Regerar hoje"** = chama `generateGridDay(dow de hoje)`, que re-roda a reconciliação e reserva quem virou elegível (ex.: aluno regularizou o plano de manhã). Resolve o caso dos "30 min antes" sem lógica nova: **a sessão de hoje já é gerada** (janela `[hoje, hoje+6]`); o que faltava era re-reservar sob demanda.

## 8. Push de geração (por academia)

Ao gerar uma grade (dia ou semana) — pelo botão ou pelo cron — dispara push + in-app convidando os alunos.

- **Onde:** dentro de `generateGridDay`, `generateGridWeek` (após sucesso) e no cron `weekly-grid-generation` (por-org, no laço que já existe). **Não** em `createClass` (criar turma não deve dar blast).
- **Gate anti-spam:** só dispara se **houve inserção real** de sessão (ver §9). Regeração idempotente (segundo clique, cron regerando a mesma semana) → 0 inserções → **não** notifica.
- **Destinatários:** todos os alunos da academia (`memberships.role = 'student'`, `organization_id = orgId`). `notifyUsers` com canal `push` só entrega a quem tem `push_subscriptions`; `inapp` registra pra todos na central.
- **Multi-tenant:** conteúdo puxa o **nome da academia** (`organizations.name`). O cron itera por-org, então cada academia manda a sua mensagem pros seus alunos. Um aluno em duas academias recebe mensagens separadas, cada uma da sua org.
- **Conteúdo:**
  - Semana → título: `Novas aulas na {academia} 🎾`; corpo: `A grade da semana já está disponível. Agende sua aula!`
  - Dia → título: `Aulas de {diaDaSemana} na {academia} 🎾`; corpo: `Já dá pra agendar. Bora treinar!`
- **Canais:** `['push', 'inapp']` via `notifyUsers` ([dispatch.ts](../../../lib/notifications/dispatch.ts)).
- **Dependência:** push real exige VAPID configurado no ambiente (setup manual pendente, ver memória push/PWA). `inapp` funciona independente. A ausência de VAPID não deve derrubar a geração — `notifyUsers` já isola falhas de push por-subscription no Sentry.

## 9. `generateGrid`: contar inserções reais

Hoje `generateGrid` retorna `sessionsCreated = rows.length` (linhas **tentadas**), não inseridas — impreciso (upsert com `ignoreDuplicates` pula as existentes). Muda para contar **inserções reais**:

- No upsert, usar `.select()` — com `ignoreDuplicates: true`, o retorno traz **só as linhas inseridas** (conflitos são pulados e não retornam). `sessionsCreated = data.length`.
- Isso corrige a contagem exibida **e** habilita o gate anti-spam do push (§8). Callers (`generateGridDay/Week`, cron) usam esse número pra decidir notificar.
- `createClass` continua chamando `generateGrid`, mas **não** notifica (o push fica nos callers de dia/semana e no cron).

## Riscos e bordas

- **Push spam:** mitigado pelo gate de inserção real (§9). Um segundo "Gerar" ou o cron diário na mesma semana → 0 inserções → sem push.
- **VAPID ausente em prod:** push não entrega até configurar; `inapp` cobre nesse meio-tempo. Não quebra a geração.
- **`class_sessions.created_at` (novo):** o "gerada em/há X" exige migration que adiciona a coluna. Backfill das linhas existentes = `now()` no deploy; sem risco destrutivo. Aplicada manualmente pelo usuário (padrão do projeto), junto com a de expurgo ainda pendente.
- **Aluno "sem plano" que assiste:** continua não sendo reservado nem cobrado automaticamente — a cobrança por presença é a **Spec 3 (cobrança/pendência), fora de escopo aqui**. O admin ainda pode adicioná-lo avulso na chamada (já existe).
- **Blast grande:** `notifyUsers` faz loop por subscription; ok pra escala de academia. Se crescer muito, fan-out por-org (o cron já é por-org).
- **`pending_partner` em várias telas:** precisa ser buscado na grade, no editar e na chamada — garantir consistência do cálculo de status (idealmente um helper puro compartilhado).

## Fora de escopo

- Cobrança/pendência por presença de quem está "sem plano" (Spec 3).
- Mudar a regra de elegibilidade da reserva (mantida: só plano/parceiro confirmado).
- Preferências de notificação por-aluno (usa o opt-in implícito da subscription de push).
- Setup de VAPID (passo manual de infra, já mapeado na memória push/PWA).

## Cobertura (o que cada pedido do usuário virou)

| Pedido | Seção |
|---|---|
| Melhorar visualização/organização | 3, 4 |
| "0 reservados" sem explicação | 1, 2 |
| Chamada de hoje vazia / "30 min antes" | 7 |
| Editar turma: ver e remover aluno de um dia | 5, 6 |
| Info "próxima turma gerada" + data da geração | 4 |
| Wellhub não deve aparecer como "sem plano" | 1 |
| Push por academia ao gerar (dia/semana) | 8, 9 |
