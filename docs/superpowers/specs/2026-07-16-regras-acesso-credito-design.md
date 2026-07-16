# Regras de acesso e crédito

**Data:** 2026-07-16
**Status:** aprovado, pronto para plano de implementação

## Contexto

As regras de negócio de acesso a aula mudaram. Hoje o plano de assinatura **concede
créditos** — `reconcileEnrollmentCredits` faz, para cada sessão de aula fixa, um par
concede/debita de 1 crédito (`features/aulas/creditReconciliation.ts:128-158`). Crédito
virou, na prática, a moeda interna de tudo: plano, avulso e reposição.

A regra nova separa os dois conceitos. **Plano é acesso**; **crédito é pré-pagamento de
aula avulsa**. O plano deixa de emitir crédito, e crédito passa a existir só para quem não
tem plano nem parceiro.

### Escopo

Este é o **spec 1 de 3**. Cobre:

- Regras de elegibilidade para entrar numa aula (plano / parceiro / crédito / dívida).
- Fim da emissão de crédito por plano.
- Restrição de matrícula fixa a quem tem plano ou parceiro.
- Adição de aluno avulso pelo admin/professor, com motivo.
- Nascimento da pendência financeira (o registro; não o fluxo de cobrança).
- Check-in dentro da janela de ±1h marcando presença.

**Fora de escopo, em specs próprios:**

- **Spec 2 — geração semanal da grade:** troca da janela de 90 dias por semanal;
  geração automática configurável (dia + hora) e manual (um dia ou todos).
- **Spec 3 — pendência financeira (fluxo):** relatório financeiro, baixa manual,
  cobrança por email e push, bloqueio na UI do aluno, pagamento via PIX no app com
  upload de comprovante.

A fronteira entre este spec e o 3: **aqui nasce o registro da dívida e a regra de acesso
que ela dispara**; lá se constrói tudo que se faz com ela depois.

## Decisões

| Questão | Decisão |
|---|---|
| O que limita quem tem plano | Nada. Plano é acesso ilimitado. |
| Estorno de cancelamento | Só para quem gastou crédito. |
| Fixas de aluno sem plano/parceiro | Desvinculadas na migração. |
| Adição pelo admin | Admin escolhe o motivo (experimental / pago na hora / em aberto). |
| Modelo da pendência | Reusa a tabela `payments`. |
| Cancelamento tardio | Dívida nunca nasce; crédito continua perdido (assimetria aceita). |
| Gatilho da dívida | Marcação de presença. |

## Arquitetura

### 1. Elegibilidade — `lib/utils/accessRules.ts` (novo)

Função pura, sem I/O, testável isoladamente:

```ts
export type AccessGrant = 'partner' | 'plan' | 'credit' | 'debt'
export type AccessDenial = 'blocked_by_debt'

export function resolveClassAccess(input: {
  partner: CheckinPartner | null
  hasActivePlan: boolean
  creditsBalance: number
  hasOpenDebt: boolean
}): { grant: AccessGrant } | { denied: AccessDenial }
```

Precedência, nesta ordem:

1. `hasOpenDebt` → `{ denied: 'blocked_by_debt' }`. Vale **mesmo para quem tem plano**: a
   dívida trava tudo até a baixa.
2. `partner` (Wellhub/TotalPass) → `{ grant: 'partner' }`. Não consome nada.
3. `hasActivePlan` → `{ grant: 'plan' }`. Não consome nada, ilimitado.
4. `creditsBalance >= 1` → `{ grant: 'credit' }`. Debita 1 na reserva.
5. Senão → `{ grant: 'debt' }`. Reserva permitida; pendência nasce se houver presença.

`partner` vem antes de `plan` por convenção — para quem tem os dois o custo é o mesmo
(zero), e a ordem só determina o rótulo exibido.

**Definição de `hasActivePlan`:** existe `student_subscriptions` do par (aluno, academia)
com `status = 'active'` **e** período vigente segundo `isSubscriptionCurrent`
(`lib/billing/periodicity.ts`). Assinatura `active` com período vencido **não** dá acesso —
é o critério que a reconciliação já usa hoje (`creditReconciliation.ts:229`), e divergir
dele criaria duas noções de "plano ativo" no mesmo sistema. Quem cai nesse estado é tratado
como aluno sem plano: precisa de crédito, ou gera pendência.

**O admin ignora o passo 1.** Admin/professor adiciona qualquer aluno a qualquer aula,
sempre, inclusive um aluno bloqueado por dívida — ele pode estar quitando no balcão
naquele instante.

### 2. Matrícula fixa

`enrollStudentInClass` (`features/aulas/adminActions.ts:66`) passa a exigir `partner` ou
`hasActivePlan`. Sem isso, retorna erro. **Crédito não compra vaga fixa.**

Quando um plano **vence**, o aluno mantém a matrícula fixa mas deixa de ser elegível. A
reconciliação simplesmente para de reservá-lo — já é o comportamento atual
(`creditReconciliation.ts:239`) — e a grade passa a sinalizar o aluno.

### 3. Créditos

`reconcileEnrollmentCredits` **para de mexer em crédito por completo**. Passa a fazer só a
reserva. Removidos: `requiresCredit`, o par concede/debita e o `checkLowCreditThreshold`
interno. A função cai para ~40 linhas: "reserva as fixas do aluno no intervalo".

Cascata:

- `subscription_plans.credits_per_month` é dropado.
- `subscription_plans.classes_per_week` **permanece**, como texto comercial. Deixa de ser
  regra de negócio.
- O cron `monthly-credit-renewal` deixa de renovar (plano não emite mais crédito) e passa a
  fazer **só a expiração** de créditos vencidos, via `credit_expiry_days`.
- Crédito nasce de exatamente duas fontes:
  - **compra avulsa** (`purchased`) — fluxo existente, inalterado;
  - **estorno de cancelamento antecipado** (`refunded`) — só quando o `credit_used` da
    reserva era `true`.
- `credit_expiry_days` e `cancellation_window_hours` já existem em `system_settings` e já
  estão no formulário de configurações (`app/(admin)/admin/configuracoes/SystemSettingsForm.tsx:11-12`).
  Nada a construir.

### 4. Pendência — reuso de `payments`

A tabela `payments` já tem tudo: `session_id`, `amount`, `status`, `type`, `gateway`,
`paid_at` (`supabase/migrations/001_initial_schema.sql:162-175`), e o relatório financeiro
do admin já lê dela (`app/(admin)/admin/financeiro/page.tsx:53`).

**Colisão a respeitar:** a compra de crédito avulso já usa `type='per_class'`
(`features/financeiro/checkoutActions.ts:207-220`). As duas se distinguem assim:

| | `session_id` | `credits_qty` |
|---|---|---|
| Compra de crédito | `null` | `N` |
| Pendência de aula | preenchido | `null` |

**`hasOpenDebt`** = existe `payments` com `status='pending'` **e `session_id is not null`**.
O `session_id is not null` é obrigatório: sem ele, uma compra de crédito abandonada no
checkout do Mercado Pago (que fica `pending` com `session_id=null`) bloquearia o aluno
para sempre.

**Valor:** `amount = system_settings.single_class_price ?? 0`. Se a academia não configurou
o preço, a pendência **ainda é criada**, com `amount = 0` — ela precisa enxergar que o aluno
entrou sem pagar. Nota: `single_class_sale_enabled` gateia a **venda online** de crédito, não
o preço da dívida; a pendência não consulta essa flag.

### 5. A dívida nasce na presença

Não na reserva. Isso elimina casos especiais em vez de tratá-los:

| Situação | Resultado |
|---|---|
| Cancelou cedo | Dívida nunca existiu |
| Cancelou tarde | Dívida nunca existiu |
| No-show | Dívida nunca existiu |
| Compareceu | Dívida criada |

Consequências assumidas:

- **Bloqueio mais frouxo.** O aluno só trava depois de frequentar uma aula sem pagar; até
  lá consegue reservar outras. Na primeira que frequentar, trava.
- **Depende de presença ser marcada.** Sem marcação manual e sem check-in de parceiro, a
  dívida não nasce. O aviso na reserva continua aparecendo ao admin, mas o valor só entra no
  relatório se a presença for registrada.

O **crédito continua sendo debitado na reserva** — é o que garante a vaga e o que a janela
de 5h protege. Só a dívida migra para a presença.

#### Assimetria assumida

Quem cancela tarde **tendo crédito perde o crédito** (janela de 5h, `lib/utils/creditRules.ts:9-18`,
inalterada). Quem cancela tarde **tendo dívida não paga nada** — a dívida nunca chegou a
nascer. O aluno que pré-pagou sai pior que o que entrou devendo.

Isso é deliberado. Quem tem crédito **já pagou**: a janela protege a vaga que ele tirou de
circulação. Quem tem dívida ainda não pagou nada, e cobrar uma aula não assistida gera
atrito de cobrança que não compensa o valor. A alternativa — manter a pendência no
cancelamento tardio — foi avaliada e rejeitada.

#### `features/financeiro/classDebt.ts` (novo)

Presença é marcada em três lugares: `markAttendance` (`features/aulas/actions.ts:534`),
`markAttendanceBulk` (`features/aulas/actions.ts:582`) e `recordResolvedCheckin`
(`lib/checkin/ingest.ts:98`). Os três passam a chamar:

```ts
ensureClassDebt(client, { orgId, studentId, sessionId }): Promise<void>
```

Que não cria dívida quando:

- a `session_bookings` do par (aluno, sessão) tem `credit_used = true` — já foi paga com crédito;
- o aluno tem `partner` ou plano ativo;
- já existe `payments` para o par (aluno, sessão) — garantido pelo índice único parcial abaixo.

Só é chamada para presença `present`. Marcar `absent` não gera dívida.

**Idempotência por schema**, não por lógica:

```sql
create unique index payments_session_student_unique
  on payments (student_id, session_id)
  where session_id is not null;
```

### 6. Adição pelo admin, com motivo

O seletor de motivo aparece **só** quando o aluno não tem plano, parceiro nem crédito. Com
crédito, o caminho normal debita e pronto — perguntar seria ruído.

O motivo é uma **pré-declaração**: ele grava a linha `payments` na hora, e o índice único
faz essa linha **suprimir** a dívida automática quando a presença for marcada. Não há
segundo mecanismo de supressão.

| Motivo | `type` | `status` | `amount` | Efeito na presença |
|---|---|---|---|---|
| Experimental | `trial` | `paid` | 0 | Suprime a dívida |
| Pago na hora | `per_class` | `paid` | preço | Suprime a dívida |
| Deixar em aberto | — | — | — | Nada gravado; a presença cria a pendência normalmente |

"Deixar em aberto" não grava nada de propósito: o caminho automático da presença já faz
exatamente o que ele quer.

Se o aluno marcado como experimental ou pago-na-hora não comparecer, a linha permanece.
Para experimental é inócua (`amount = 0`); para pago na hora está correta — ele pagou.

### 7. Check-in na janela de ±1h

#### `lib/checkin/sessionWindow.ts` (novo)

```ts
findSessionInWindow(
  sessions: { id: string; startsAt: string }[],
  checkinAt: string,
  windowHours = 1,
): string | null   // casa [start - 1h, start + 1h]; empate → a mais próxima
```

#### Mudanças em `lib/checkin/ingest.ts`

1. `findLinkedSession` passa a receber o **instante** do check-in, não só a data, e filtra
   pela janela.
2. Hoje ela só considera turmas com **matrícula fixa** (`ingest.ts:19-26`) — uma reserva
   avulsa nunca marca presença. Passa a casar por **reserva confirmada** em qualquer sessão
   do dia, que é o que a regra diz ("a aula onde o aluno está vinculado").
3. O `upsert` com `onConflict` (`ingest.ts:98-108`) **sobrescreve** presença existente. A
   regra "exceto quando o processo já realizou" exige `ignoreDuplicates`: um check-in
   repetido não pode reescrever uma presença que o professor já ajustou na mão.

#### Fuso — risco principal

`session_date` + `class.start_time` são hora local; o check-in chega em UTC. A janela tem
que ser montada em `America/Sao_Paulo`. Errar aqui desloca a janela em 3h e o recurso
simplesmente não funciona. Coberto por teste dedicado.

## Migração

**Schema:**

1. Dropa `subscription_plans.credits_per_month`.
2. Cria `payments_session_student_unique` (índice único parcial, acima).

**Desvinculação:** desativa (`is_active = false`, `cancelled_at = now()`) toda `enrollments`
ativa de aluno sem plano ativo e sem `partner`.

- **As reservas futuras já feitas são mantidas.** Esses alunos já tiveram crédito debitado
  por aquelas sessões; apagá-las seria confisco. Elas só deixam de ser renovadas.
- **Notificação in-app via SQL**, direto na tabela `notifications` (`user_id`, `type`,
  `title`, `body` — `001_initial_schema.sql:245-253`). Email e push ficam de fora:
  `notifyUsers` é TypeScript e não roda dentro de migration.

**Saldos de crédito existentes são preservados.** O par concede/debita atual se anula, então
os saldos vivos já são majoritariamente crédito legítimo (comprado ou estornado). Continuam
válidos como crédito de avulsa e seguem a expiração configurada.

## UI

- **Grade** (`app/(admin)/admin/grade/page.tsx:108`): o alerta atual `⚠️ N sem crédito` fica
  **incorreto** — ele testa saldo e ignora plano, e em aula fixa crédito deixou de importar.
  Vira `⚠️ N sem plano ativo`, que é o que passa a valer numa fixa.
- **Adição de aluno pelo admin**: seletor de motivo (experimental / pago na hora / deixar em
  aberto), visível só quando o aluno não tem plano, parceiro nem crédito.
- **Aviso de pendência**: na lista de presença da sessão, aluno com `grant: 'debt'` aparece
  sinalizado — a academia vê antes de marcar presença que aquilo vai virar dívida.

O relatório financeiro, a baixa e a cobrança são do **spec 3**.

## Testes

Vitest, co-locado, seguindo o padrão do repo:

- **`lib/utils/accessRules.test.ts`** — matriz de precedência: dívida bloqueia mesmo com
  plano; parceiro e plano não consomem; crédito debita; nada → dívida.
- **`lib/checkin/sessionWindow.test.ts`** — bordas exatas de −1h e +1h, duas sessões com
  janelas sobrepostas (vence a mais próxima), e o fuso `America/Sao_Paulo`.
- **`features/financeiro/classDebt.test.ts`** — idempotência (duas marcações = uma dívida);
  não criar dívida para plano, parceiro, `credit_used = true`, nem para `absent`.
- **`features/aulas/creditReconciliation`** — asserção de que nenhuma chamada a
  `adjust_credits` é emitida.
- **`enrollStudentInClass`** — rejeita quem não tem plano nem parceiro.

## Riscos

| Risco | Mitigação |
|---|---|
| Fuso na janela de check-in desloca tudo em 3h | Teste dedicado com `America/Sao_Paulo`; janela montada em hora local |
| Dívida não nasce porque presença não é marcada | Aceito e documentado; o aviso na reserva dá visibilidade antecipada à academia |
| Desvinculação em massa surpreende alunos | Notificação in-app na migração; reservas futuras preservadas |
| Compra de crédito pendente bloqueando aluno | `hasOpenDebt` filtra `session_id is not null`; coberto por teste |
