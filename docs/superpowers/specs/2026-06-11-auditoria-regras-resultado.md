# Resultado da Auditoria de Regras — 2026-06-11

## Veredito por regra

| Regra | Onde | Veredito |
|---|---|---|
| Hierarquia de nível no agendamento (iniciante < D < C < B < A) | `lib/utils/levelAccess.ts` · `bookSession` · `joinWaitlist` · `registerForTournament` | ok |
| Turma kids exclusiva para dependentes | `bookSession` (check 4) · `joinWaitlist` | ok |
| Limite de 2 aulas confirmadas por dia | `bookSession` (check 5) · `acceptWaitlistSpot` | ok |
| Bloqueio de duplicidade na mesma sessão | `bookSession` (check 6) + `book_session_atomic` → `ALREADY_BOOKED` | ok |
| Capacidade máxima sem overbooking | RPC `book_session_atomic` com `pg_advisory_xact_lock` | ok |
| Wellhub/TotalPass não consomem créditos | `bookNextSession` detecta `payment_type` antes de chamar `bookSession(useCredit=false)` | ok |
| Débito de crédito em agendamento avulso | RPC `adjust_credits(p_delta=-1)` chamada depois de `book_session_atomic`; rollback do booking se débito falha | ok |
| Janela de 5h — operador >= | `canCancelWithRefund`: `diffHours >= windowHours` | corrigida (72a761c) |
| Janela de 5h — fuso de Brasília | `sessionStartIso` monta `YYYY-MM-DDTHH:MM:SS-03:00`; `canCancelWithRefund` recebe ISO com offset | corrigida (5f1f22b, 24d9792) |
| Crédito extra sem vencimento para aluno fixo subscriber que cancela com antecedência | `cancelBooking`: `from_enrollment && payment_type === 'subscriber'` → `adjust_credits` sem `p_expires_at` | ok |
| Crédito de reposição 30 dias (`system_settings.credit_expiry_days`) | `cancelBooking`: lê `credit_expiry_days`, calcula `getMakeupCreditExpiry`, passa `p_expires_at` | ok |
| Consistência `credits_balance` × `credit_transactions` (atômico via RPC) | RPC `adjust_credits`: UPDATE + INSERT em única transação PL/pgSQL; SECURITY DEFINER, revogado de public/anon/authenticated | corrigida (78806cd, ff969f9) |
| Aluno fixo sempre ganha reposição ao sair de aula específica (`skipEnrollmentSession`) | `skipEnrollmentSession`: sempre chama `adjust_credits(delta=+1)` independente de horário/antecedência | corrigida (ff969f9) |
| Reagendamento após cancelamento (reativação de booking — unique constraint) | `book_session_atomic`: detecta row cancelada e faz UPDATE para `confirmed` em vez de INSERT | corrigida (7128000) |
| STUDENT_NOT_FOUND distinguido de INSUFFICIENT_CREDITS | RPC `adjust_credits`: `perform 1 from profiles` → `raise STUDENT_NOT_FOUND` vs `INSUFFICIENT_CREDITS` | corrigida (7128000) |
| Fila: nível e kids validados no `joinWaitlist` | `joinWaitlist`: `canStudentAttendLevel` + kids check antes de inserir | corrigida (115ed72) |
| Fila: limite diário validado no `acceptWaitlistSpot` | `acceptWaitlistSpot`: conta bookings confirmados na mesma data, bloqueia se >= 2 | corrigida (115ed72) |
| Fila: 1h para aceitar oferta | `acceptWaitlistSpot`: compara `new Date()` com `notified_at + 1h` | ok |
| Fila: avanço automático ao desistir ou expirar | `leaveWaitlist` (status=offered) e `acceptWaitlistSpot` (SESSION_FULL) chamam `offerWaitlistSpot` | ok |
| Day use: sem consumo de crédito | `bookDayUse`: nenhuma chamada a `adjust_credits`; insert direto em `dayuse_bookings` | ok |
| Day use: capacidade | Coluna `capacity` em `dayuse_slots`; validação em `validateDayUseSlot` | pendente (ver achados) |
| Torneios: inscrição valida nível e status | `registerForTournament`: `status === 'open'`, `canStudentAttendLevel`, dedup | ok |
| Dependentes: `payer_id = parent_id` | `subscribeToPlan` e `adminSubscribeStudentToPlan`: `is_dependent && parent_id ? parent_id : user.id` | ok |

---

## Bugs encontrados e corrigidos

**1 — Janela de cancelamento usava `>` em vez de `>=` (Task 1 · SHA 72a761c)**
A função `canCancelWithRefund` comparava `diffHours > windowHours`, excluindo o caso exato de 5h antes. O aluno que cancelava exatamente no limite perdia o crédito de reposição. Corrigido para `diffHours >= windowHours`.

**2 — Janela de 5h calculada no fuso do servidor, não em Brasília (Task 2 · SHAs 5f1f22b + 24d9792)**
O código anterior concatenava `session_date + ' ' + start_time` sem fuso, gerando um instante interpretado no fuso do servidor (UTC ou outro). Em servidores não-BRT a janela ficava defasada em horas. Criada `sessionStartIso()` em `lib/utils/sessionTime.ts` que monta `YYYY-MM-DDTHH:MM:SS-03:00`, ancorada no offset fixo de Brasília. A função valida o formato e lança erro em entradas corrompidas (fail-fast).

**3 — Capacidade e crédito não eram atômicos; reagendamento após cancelamento quebrava (Task 3 · SHAs 7128000 + 78806cd)**
O insert em `session_bookings` e o débito em `credit_transactions`/`profiles.credits_balance` eram operações separadas, permitindo overbooking ou saldo negativo em corridas concorrentes. Criadas as RPCs `book_session_atomic` (lock por sessão via `pg_advisory_xact_lock`) e `adjust_credits` (UPDATE + INSERT em transação única, bloqueia saldo negativo). A RPC `book_session_atomic` também resolve a violação de unique constraint: quando existe um booking cancelado para o mesmo par `(student_id, session_id)`, reativa o registro via UPDATE em vez de tentar INSERT.

**4 — Actions chamavam tabelas diretamente; aluno fixo não ganhava reposição em `skipEnrollmentSession`; upsert faltava em `skipEnrollmentNoBooking` (Task 4 · SHA ff969f9)**
`cancelBooking` e `bookSession` operavam diretamente nas tabelas em vez das RPCs atômicas, mantendo a janela de corrida. `skipEnrollmentSession` não emitia crédito de reposição para alunos fixos. `skipEnrollmentNoBooking` usava `insert` simples e poderia violar unique constraint em caso de retry. Corrigidos: todas as paths de booking/crédito passaram a usar as RPCs; `skipEnrollmentSession` sempre chama `adjust_credits(+1)` independente de antecedência; `skipEnrollmentNoBooking` usa `upsert` com `onConflict: 'student_id,session_id'`.

**5 — Fila de espera não validava nível/kids/limite diário (Task 5 · SHA 115ed72)**
`joinWaitlist` não verificava se o aluno tinha nível adequado nem se era dependente (para turmas kids), permitindo entrar na fila mesmo sem elegibilidade. `acceptWaitlistSpot` não checava o limite diário de 2 aulas, potencialmente convertendo a oferta em booking inválido. Adicionados os checks em ambas as funções.

---

## Pendências e riscos aceitos

- **Migration `20260611000000_booking_and_credit_rpcs.sql` ainda não aplicada no Supabase remoto.** O CLI estava sem autenticação durante a fase de auditoria. Aplicar via `supabase db push` (ou SQL manual no dashboard) **antes do deploy em produção**. Sem a migration, as RPCs `book_session_atomic` e `adjust_credits` não existem e todas as chamadas a `adminClient.rpc(...)` falham com 404.

- **`p_max_students` passado como parâmetro da action para a RPC `book_session_atomic`.** A RPC não relê `max_students` do banco — ela confia no valor informado pelo caller. Isso é um design aceito (caller usa service role e leu o valor na mesma requisição), mas um caller malicioso com acesso à chave service role poderia burlar a capacidade. Mitigação futura: a RPC pode ler `max_students` diretamente da tabela `classes` via JOIN.

- **Crédito extra sem vencimento pode acumular para alunos fixos não-subscribers.** `skipEnrollmentSession` concede crédito de reposição sem vencimento a qualquer aluno `from_enrollment`, independente do `payment_type`. Para alunos com `payment_type = 'avulso'` ou `null` isso pode gerar saldo ilimitado sem contrapartida contratual. Regra de negócio confirmada pelo usuário como comportamento esperado na fase atual; revisar quando houver controle de planos mais granular.

- **`validateDayUseSlot` valida apenas horário e capacidade mínima; não garante que a data não é passada.** Um admin pode criar um slot para uma data no passado. Baixo impacto operacional (admin-only), mas pode gerar dados sujos de relatório.

- **`cancelBooking` não emite `offerWaitlistSpot` via `cancelSubscription`/`adminCancelStudentPlan`.** O cancelamento de assinatura não percorre os bookings ativos do aluno nem libera vagas na fila. Se um aluno tem sessões futuras confirmadas e cancela o contrato, as vagas ficam presas. Impacto: outros alunos na fila não são notificados automaticamente. Mitigação futura: cancelamento de contrato deve cancelar bookings futuros e chamar `offerWaitlistSpot` para cada sessão.

---

## Achados novos (não corrigidos nesta fase)

**[DAYUSE-1] `bookDayUse` não verifica capacidade do slot antes de inserir**
Arquivo: `features/dayuse/actions.ts`, linha 60 (`supabase.from('dayuse_bookings').insert(...)`).
Severidade: **média**. A coluna `capacity` existe em `dayuse_slots`, mas `bookDayUse` não conta bookings confirmados antes de inserir. Dois alunos podem reservar simultaneamente o mesmo slot de capacidade 1. Não há RPC atômica análoga a `book_session_atomic` para day use. Solução: adicionar contagem de bookings confirmados ou criar RPC `book_dayuse_atomic`.

**[DAYUSE-2] `bookDayUse` não verifica se o slot está ativo (`is_active`) nem se a data não é passada**
Arquivo: `features/dayuse/actions.ts`, linhas 53–58. O `.select` busca pelo `id` sem filtrar `is_active = true` ou `date >= today`. Um aluno pode reservar um slot desativado ou com data passada.
Severidade: **baixa** (admin-only para criação; impacto visual apenas).

**[FINANCEIRO-1] `subscribeToPlan` e `adminSubscribeStudentToPlan` atualizam `credits_balance` com SET absoluto, não incremental**
Arquivo: `features/financeiro/actions.ts`, linhas 96–98 e 203–205.
```ts
.update({ credits_balance: credits })
```
Se o aluno já possui saldo residual de créditos anteriores, o valor é sobrescrito (não somado), zerando eventuais créditos de reposição não usados. Para ser consistente com o invariante `credits_balance = soma de credit_transactions`, deveria usar `adjust_credits(delta=+credits)` em vez de SET direto.
Severidade: **alta**. Pode causar perda silenciosa de créditos existentes ao renovar ou migrar de plano.

**[FINANCEIRO-2] `cancelSubscription` não invalida créditos do tipo `'renewed'` sem vencimento**
Arquivo: `features/financeiro/actions.ts`, linhas 249–253. O filtro `.not('expires_at', 'is', null)` exclui apenas transações de reposição com vencimento (`expires_at IS NOT NULL`). Créditos mensais do tipo `renewed` (inseridos sem `expires_at`) não são expirados ao cancelar a assinatura. Se a regra de negócio for "créditos mensais expiram com o contrato", esta função está incompleta.
Severidade: **média** (depende da política de negócio; pode ser intencional se créditos mensais não-usados devem ser honrados).

**[TORNEIOS-1] `registerForTournament` não verifica capacidade máxima do torneio**
Arquivo: `features/torneios/actions.ts`, linhas 95–116. A inscrição é aceita sem limite de participantes — não há coluna `max_participants` nem contagem de inscrições antes do insert. Em torneios com bracket fixo (chaveamento), inscrições em excesso gerariam brackets quebrados.
Severidade: **média** (problema operacional; não há campo de capacidade no schema atual — é uma lacuna de modelagem).

**[TORNEIOS-2] `recordMatchResult` não verifica se o match já possui resultado**
Arquivo: `features/torneios/actions.ts`, linhas 163–168. O UPDATE sobrescreve `score` e `winner_id` sem checar se o confronto já foi finalizado. Permite correção acidental de resultado já publicado sem confirmação de idempotência.
Severidade: **baixa** (admin-only; pode ser comportamento intencional).
