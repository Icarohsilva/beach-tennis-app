# Cota de aulas por plano e desativação de aluno

**Data:** 2026-07-28
**Status:** aprovado, pronto para plano de implementação

## Contexto

`subscription_plans.classes_per_week` existe desde o início e **não é lido por nenhuma
regra**. Aparece na vitrine (`features/financeiro/PlanStorefront.tsx:66`), no card de
assinatura e no painel de planos, e nada mais. Em `lib/utils/accessRules.ts:33`, plano é
acesso ilimitado:

```ts
if (input.hasActivePlan) return { grant: 'plan' }  // "não consome nada, ilimitado"
```

Isso foi **deliberado**. O spec de 2026-07-16 (`2026-07-16-regras-acesso-credito-design.md`)
decidiu "O que limita quem tem plano → Nada" e rebaixou `classes_per_week` a "texto
comercial". A prática desmentiu a decisão: sem limite, o plano de 2x/semana virou plano
ilimitado, e a academia perdeu o controle de quem ocupa vaga.

Palavras do admin da academia:

> *"Senão a pessoa vai lá e coloca o nome dela a semana inteira na lista, e ela só pode
> fazer duas aulas. Ah, mas eu vou ver ela lá todo dia — mas aí a cabeça não funciona. Quando
> você tá dando aula ali, você dá duas aulas seguidas, tem 16 pessoas, oito em cada aula.
> Como é que você vai analisar que aquela pessoa ali tá fazendo aula a mais?"*

Segundo furo no mesmo lugar: `enrollStudentInClass` exige plano ou parceiro, mas não conta
quantas turmas fixas o plano permite. Hoje o admin vincula um aluno de plano 2x/semana a
cinco turmas fixas sem nenhum aviso.

### Escopo

Cobre:

- Cota de aulas por ciclo, derivada da contagem de reservas.
- Teto de aulas por dia.
- Validação da cota na reserva do aluno **e** na matrícula fixa feita pelo admin.
- Reembolso de vaga em cancelamento tardio, configurável por plano.
- Desativação de aluno (`contract_active` deixa de ser decorativo).

**Fora de escopo, spec próprio:**

- **Crédito bônus de período** — o admin quer, na semana de jogos, conceder aulas extras em
  massa ("*gera dois créditos a mais pra todo mundo*"), com a regra "se usar antes, acabou".
  Precisa de ajuste de cota por aluno com validade, e não bloqueia nada deste spec.

## Decisões

| Questão | Decisão |
|---|---|
| Cota armazenada ou derivada | **Derivada.** Conta reservas no ciclo; nada de saldo novo. |
| Janela da cota | Propriedade do plano: `weekly` ou `monthly`. |
| Fronteira da semana | Segunda a domingo, em BRT. |
| Plano emite crédito? | **Não.** Crédito continua sendo só avulsa comprada. |
| Cota bloqueia aula fixa? | Nunca. Ver `max()` em §2. |
| Wellhub/TotalPass | Fora da cota. Quem tem plano **e** parceiro segue sem limite. |
| Adição pelo admin | Fura a cota, de propósito. |
| Teto diário sem plano | Cai num default da academia (`system_settings`). |
| Ativação da regra | Flag por academia, desligada na migração. |

## Por que derivada, e não crédito emitido pelo plano

O modelo que o admin descreveu é o plano emitindo crédito por ciclo, com o que sobra
expirando. Foi avaliado e rejeitado por três razões:

1. **`lib/utils/creditLots.ts:51` consome FIFO por data de criação, não por vencimento.** Um
   aluno que comprou 5 avulsas em janeiro e recebe 8 do plano em fevereiro gastaria as
   compradas primeiro; as 8 do plano venceriam sem uso. Ele perde o que pagou. Consertar
   exige ordenar por vencimento e distinguir lote de plano de lote comprado.
2. **`credits_balance` é cache**, com a verdade em `credit_transactions`. Emitir por ciclo
   acrescenta um cron de emissão e outro de expiração — dois modos de falha silenciosa novos
   sobre um valor que já pode divergir.
3. A cota derivada é **auto-corretiva**: ela é recalculada a cada consulta a partir das
   reservas, que são a realidade. Não existe estado para dessincronizar.

O aluno passa a ver dois números — "3 de 8 aulas do plano" e "2 créditos avulsos" — em vez
de um saldo só. É mais honesto: são duas coisas diferentes, e é o que a academia vende.

## Arquitetura

### 1. Campos do plano

`subscription_plans` ganha três colunas; `classes_per_week` deixa de ser decorativo.

| Campo | Tipo | Default | Papel |
|---|---|---|---|
| `classes_per_week` | int | — | **passa a valer**: aulas por semana que o plano dá |
| `cycle` | `plan_cycle` enum | `'monthly'` | alcance do remanejamento |
| `max_classes_per_day` | int | 2 | teto diário |
| `refund_on_late_cancel` | bool | true | cancelou fora da janela: devolve a vaga ou queima |

`cycle` é **só o alcance do remanejamento**, não a cobrança (que já vive em
`PlanBillingOption.periodicity`). Semanal zera no domingo; mensal deixa o aluno puxar aula da
semana 4 para a semana 1 — o caso que o admin descreveu:

> *"Ela quer fazer essa semana quatro aulas, porque ela vai viajar na última; ela ia lá na
> última semana, tirava as duas aulas dela e colocava nessa semana aqui."*

### 2. `lib/utils/classQuota.ts` (novo)

Módulo puro, sem I/O, no padrão de `accessRules.ts` e `creditLots.ts`.

```ts
export type PlanCycle = 'weekly' | 'monthly'

export interface PlanQuota {
  classesPerWeek: number
  cycle: PlanCycle
  maxClassesPerDay: number
  refundOnLateCancel: boolean
}

export interface QuotaBooking {
  sessionDate: string          // yyyy-MM-dd
  status: 'confirmed' | 'cancelled'
  /** Cancelada fora da janela de cancelamento (creditRules.canCancelWithRefund). */
  cancelledLate: boolean
}

/** Janela [from, to] do ciclo que contém `dateStr`, em BRT. */
export function cycleWindow(dateStr: string, cycle: PlanCycle): { from: string; to: string }

/** Semanas seg–dom que COMEÇAM dentro da janela. Semanal → 1; mensal → 4 ou 5. */
export function countCycleWeeks(from: string, to: string): number

export function resolveQuota(input: {
  plan: PlanQuota
  cycleWeeks: number
  bookings: QuotaBooking[]
  /** Sessões que as matrículas fixas ativas do aluno produzem no ciclo. */
  fixedSessionsInCycle: number
}): { limit: number; used: number; remaining: number }

export function canBookOn(
  quota: ReturnType<typeof resolveQuota>,
  plan: PlanQuota,
  bookings: QuotaBooking[],
  dateStr: string,
): { ok: true } | { ok: false; reason: 'quota_exhausted' | 'daily_cap' }
```

O cálculo:

```
limit = max(
  classesPerWeek × cycleWeeks,   // o que o plano vende
  fixedSessionsInCycle           // o que o aluno já tem direito
)

used = reservas 'confirmed' no ciclo
     + reservas 'cancelled' com cancelledLate, se refundOnLateCancel = false
```

**O `max()` é a peça central.** Sem ele, num mês com cinco sábados o aluno de plano
2x/semana teria 9 ou 10 sessões fixas contra uma cota de 8, e seria barrado na própria aula
que assinou. O primeiro termo cobre o caso oposto: aluno com plano e nenhuma turma fixa, que
só reserva avulso, precisa da cota vinda do plano.

`countCycleWeeks` conta segundas-feiras dentro da janela porque é a única contagem
determinística de "semanas do mês" (4 ou 5). O descasamento de até uma unidade para alunos
com fixa em outro dia da semana é absorvido pelo `max()`.

**Fuso:** toda data é `yyyy-MM-dd` em BRT, produzida por `lib/utils/gridSchedule.ts`
(`brtToday`, `addDaysStr`). Nenhuma conversão de `Date` local. Errar isso desloca a fronteira
do ciclo em um dia e o aluno perde ou ganha uma aula na virada.

### 3. `lib/billing/planEligibility.ts` — de booleano para configuração

`hasActiveSubscriptionPlan` devolve `boolean` e é chamada em quatro lugares
(`classDebt`, `enrollStudentInClass`, `bookSession`, `addStudentToSession`). A cota precisa
da configuração do plano, não de um sim/não. A função ganha uma irmã:

```ts
export async function getActivePlan(
  client: AdminClient, studentId: string, orgId: string,
): Promise<PlanQuota | null>
```

Faz o mesmo `student_subscriptions` com `status='active'` + `isSubscriptionCurrent`, e junta
`subscription_plans` por `plan_id`. `hasActiveSubscriptionPlan` passa a ser
`(await getActivePlan(...)) !== null`, preservando os call sites que só querem o booleano.

### 4. `lib/utils/accessRules.ts` — dois eixos novos

Precedência nova, em ordem:

| # | Condição | Resultado |
|---|---|---|
| 1 | `hasOpenDebt` | `denied: 'blocked_by_debt'` |
| 2 | `!contractActive` | `denied: 'inactive'` |
| 3 | `partner` | `grant: 'partner'` |
| 4 | reservas no dia `>= maxClassesPerDay` | `denied: 'daily_cap'` |
| 5 | `plan` com cota restante | `grant: 'plan'` |
| 6 | `creditsBalance >= 1` | `grant: 'credit'` |
| 7 | `plan` sem cota restante | `denied: 'quota_exhausted'` |
| 8 | senão | `grant: 'debt'` |

O teto diário é avaliado **antes** da cota (eixo 4) porque é um limite absoluto: nem crédito
comprado o compra. Sem essa ordem, os eixos 5, 6 e 7 se sobreporiam quando o teto estoura com
cota ainda disponível.

Três coisas a notar:

- **Parceiro é isento dos dois limites** (eixo 3 vem antes do 4). É o que a academia pediu:
  quem tem Wellhub e plano ao mesmo tempo, o Wellhub prevalece.
- **Cota estourada cai para crédito comprado (6) antes de negar (7).** É literalmente a
  regra do admin: *"ou ela tinha que comprar mais aulas, ou tirar as dela pra frente."*
- **Aluno com plano e cota estourada é negado, não vira dívida.** Deixar cair em `debt`
  significaria cobrar avulsa de quem tem plano, que não é o que a academia quer. Eixo 8
  segue valendo para quem nunca teve plano — comportamento atual, preservado.

O teto diário vale também para quem paga com crédito: a queixa do admin é sobre ocupar vaga,
não sobre quem pagou. Para aluno sem plano, o teto vem de `system_settings.max_classes_per_day`
(novo, default 2).

### 5. Pontos de chamada

| Lugar | Mudança |
|---|---|
| `features/aulas/actions.ts:208` `bookSession` | busca reservas do ciclo + fixas do ciclo e passa ao `resolveClassAccess`; mensagens de erro por motivo |
| `features/aulas/adminActions.ts` `enrollStudentInClass` | valida `matrículas fixas ativas + 1 <= classesPerWeek`; hoje não valida nada |
| `features/aulas/adminActions.ts` `addStudentToSession` | **inalterado** — o admin fura a cota |
| `features/aulas/creditReconciliation.ts` | **inalterado** — o `max()` garante que fixa nunca é barrada |
| `lib/checkin/ingest.ts` | **inalterado** — parceiro está fora da cota |

`addStudentToSession` continuar furando é deliberado, e é o que o admin descreveu:

> *"Se tiver vaga na próxima aula, você pode ficar e pode fazer a aula, mas você não pode
> ocupar uma vaga."*

O aluno não reserva além do teto; o professor ainda encaixa quem aparecer.

### 6. Desativação de aluno

`memberships.contract_active` já existe e é lido em quatro lugares — contador do dashboard
(`app/(admin)/admin/dashboard/page.tsx:49`), selo "(inativo)" na lista e na ficha, permissão
de postar na comunidade (`features/comunidade/actions.ts:245`) e destinatários da notificação
da grade (`features/aulas/gridNotify.ts:40`). **Não bloqueia reserva nenhuma, e não existe
botão para alterá-lo.**

Desativar passa a fazer três coisas:

1. **Bloquear reserva e cancelamento** — eixo 2 do `resolveClassAccess`.
2. **Expirar os créditos** — `adjust_credits` com `p_type='expired'`, deixando rastro em
   `credit_transactions`. Reativar não devolve; o plano recomeça no ciclo seguinte.
3. **Sair das aulas fixas futuras** — reuso direto de `cancelFutureEnrollmentBookings`
   (`features/aulas/adminActions.ts`), construída em 2026-07-28 para o `cancelEnrollment`.

Login continua liberado: o aluno precisa ver o histórico e a tela de pagamento para voltar.

**Armadilha a corrigir junto:** `addDependentSelf` grava `contract_active: false`
(`features/aulas/adminActions.ts:294`) enquanto `addDependent` grava `true`. Hoje isso é
inócuo. No momento em que o campo vira load-bearing, **todo dependente cadastrado pelo
responsável nasce bloqueado**. A migração precisa normalizar os dependentes existentes e a
action precisa passar a gravar `true`.

## Migração

**Schema:**

1. `create type plan_cycle as enum ('weekly', 'monthly')`.
2. `alter table subscription_plans` — `cycle` (default `'monthly'`), `max_classes_per_day`
   (default 2), `refund_on_late_cancel` (default true).
3. `system_settings`: chave `max_classes_per_day`, default 2, por academia.
4. `system_settings`: chave `quota_enforcement_enabled`, default **false**.
5. `update memberships set contract_active = true where is_dependent and not contract_active` —
   conserta os dependentes criados por `addDependentSelf`.

**A regra nasce desligada.** `quota_enforcement_enabled = false` faz `resolveClassAccess`
pular os eixos 4 e 7 e tratar o eixo 5 como incondicional (`plan` → `grant`), que é
exatamente o comportamento de hoje. A academia liga quando tiver
conferido os planos. Sem isso, a migração bloqueia alunos no meio de um ciclo já em curso,
sem aviso — o pior momento possível.

Nenhum dado histórico é reescrito: a cota é derivada das reservas que já existem.

## UI

- **Painel de planos** (`PlansManager.tsx`): os três campos novos no formulário de criação e
  edição. `classes_per_week` deixa de ser rótulo e passa a ter peso — a tela precisa dizer
  isso.
- **Vitrine e card de assinatura**: "2x por semana · até 2 por dia · remaneja dentro do mês".
- **Aluno, em `/agendar` e `/home`**: "3 de 8 aulas neste mês" ao lado do saldo de créditos
  avulsos. São dois números distintos, exibidos como tal.
- **Bloqueio na reserva**, com o caminho de saída explícito:
  - cota: "Você já usou suas 8 aulas deste mês. Cancele uma aula futura ou compre uma avulsa."
  - teto diário: "Você já tem 2 aulas reservadas neste dia."
  - inativo: "Seu acesso está desativado. Fale com a academia."
- **Ficha do aluno (admin)**: botão Ativar/Desativar, com confirmação listando o efeito
  (créditos expiram, matrículas fixas futuras são soltas).
- **Configurações**: `max_classes_per_day` da academia e a chave de ativação da cota.

## Testes

Vitest, co-locado, no padrão do repo.

- **`lib/utils/classQuota.test.ts`** — `cycleWindow` semanal (segunda e domingo como bordas
  exatas) e mensal; `countCycleWeeks` num mês de 4 e num de 5 segundas; `resolveQuota` com o
  `max()` mordendo (mês de 5 sábados, fixa > cota do plano); aluno com plano e zero fixas;
  cancelamento tardio contando com `refundOnLateCancel: false` e não contando com `true`;
  `canBookOn` no teto diário exato.
- **`lib/utils/accessRules.test.ts`** (estendido) — matriz de precedência dos oito eixos:
  dívida antes de inativo; parceiro furando a cota; cota estourada caindo para crédito;
  cota estourada sem crédito negando em vez de virar dívida; `quota_enforcement_enabled`
  desligado preservando o comportamento anterior.
- **`enrollStudentInClass`** — rejeita a fixa que ultrapassa `classes_per_week`; aceita a que
  bate no limite exato.
- **Desativação** — expira crédito, solta fixas futuras, bloqueia reserva; reativar não
  devolve crédito.
- **`getActivePlan`** — assinatura `active` com período vencido devolve `null`, mesmo critério
  de `hasActiveSubscriptionPlan`.

## Riscos

| Risco | Mitigação |
|---|---|
| Ativar a cota bloqueia alunos no meio do ciclo | `quota_enforcement_enabled` nasce falso; a academia liga quando quiser |
| Dependentes nascem bloqueados quando `contract_active` vira load-bearing | Migração normaliza os existentes; `addDependentSelf` passa a gravar `true`; teste dedicado |
| Fuso deslocando a fronteira do ciclo | Datas só via `gridSchedule` (BRT); teste de borda em segunda 00:00 e domingo 23:59 |
| Mês de 5 semanas barrando aula fixa | `max()` em `resolveQuota`; teste dedicado |
| Contagem do ciclo pesando na reserva | A janela é curta (7 ou 31 dias) e a consulta é indexada por `student_id` + `session_date`; medir antes de otimizar |
| Aluno com plano exausto sem entender o motivo | Mensagem de bloqueio nomeia as duas saídas (cancelar futura, comprar avulsa) |
