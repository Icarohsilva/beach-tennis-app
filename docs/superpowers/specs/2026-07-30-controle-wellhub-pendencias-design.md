# Controle Wellhub — pendências de check-in — Design

**Data:** 2026-07-30
**Branch:** claude/wellhub-checkin-pendencias-rwt7ya

## Contexto

Academias que atendem alunos Wellhub/TotalPass só recebem o repasse do parceiro quando o
check-in acontece. O app já registrava o check-in (webhook + manual), contava o progresso
contra `memberships.monthly_checkin_target` e calculava o repasse
(`partner_checkin_rates` + `computePartnerRevenue`) — mas **não tinha nenhum registro do
check-in que deixou de acontecer**. Aluno desmarca, não vai à aula, esquece de bipar, e a
academia perde dinheiro sem saber quanto nem de quem.

Pior: `resolveClassAccess` dava ao parceiro um passe livre
(`if (input.partner) return { grant: 'partner' }`) — isento de cota e de teto diário — então
quem gerava o prejuízo era exatamente quem nunca era barrado.

## Decisões tomadas (com o usuário)

| Tema | Decisão |
|---|---|
| Gatilho | **Só ao marcar ausente** na chamada. Nada automático |
| Valor | Config própria por academia (`missed_checkin_price`); em 0, cai no `partner_checkin_rates` |
| Bloqueio | Barra novas entradas **e cancela as reservas futuras**, liberando a vaga |
| Contagem do mês | Dias distintos — implementa a spec `2026-07-29-checkin-diario-unico` |

## Nomenclatura

O código usa **`missed_checkins`** (UI: "pendência de check-in"). Três coisas parecidas já
existiam e **não** foram tocadas:

| Já existia | O que é |
|---|---|
| `pending_checkins` | fila de check-in do webhook cujo `partner_member_id` não casou com aluno |
| `payments` pendente com `session_id` | pendência **financeira** de aula avulsa (`ensureClassDebt`) |
| `memberships.pending_partner` | parceiro autodeclarado no cadastro, à espera de confirmação |

---

## 1. Modelo de dados

`supabase/migrations/20260730000000_missed_checkins.sql`:

```sql
create table missed_checkins (
  id, organization_id, student_id, session_id, partner,
  session_date date not null,   -- desnormalizado: msg de WhatsApp e ordenação sem join
  amount numeric(10,2),         -- reais, congelado no momento da falta
  status text check (status in ('open','paid','waived')),
  payment_id uuid references payments(id),   -- null quando amount = 0
  resolved_at, resolved_by, resolution_note, created_by, created_at
);
create unique index missed_checkins_student_session_idx on missed_checkins (student_id, session_id);
```

RLS: `select` para `is_org_admin(organization_id)` e para o próprio aluno
(`student_id = auth.uid()`). Escrita só via service role.

Configs novas em `system_settings` (seed 0 em toda org):
`missed_checkin_block_limit` (0 = bloqueio desligado) e `missed_checkin_price`
(0 = usa o repasse do parceiro).

`supabase/migrations/20260730000100_payments_missed_checkin_flag.sql`:
`payments.missed_checkin boolean` + trigger `payments_sync_missed_checkin`.

### Por que a flag em `payments`

A pendência com valor > 0 cria um `payments` para reusar de graça as trilhas de pagamento que
já existem (PIX+comprovante, Mercado Pago, baixa manual). Sem a flag ela também cairia no
bloqueio por carência (`debt_block_grace_days`, `isBlockingDebt`) — **dois bloqueios para a
mesma falta**, um deles por regra que o dono não configurou. Com a flag, `bookSession`,
`getOrgDebtors` e `chargeDebt` filtram `missed_checkin = false`: a dívida de avulsa segue
governada pela carência, e a pendência de check-in **só** pelo limite de contagem.

A sincronização da baixa é **trigger**, não chamada nos callers, porque a baixa acontece em
quatro lugares independentes (webhook do MP, `approveDebtReceipt`, `markDebtPaid`,
`markAllDebtsPaid`) e esquecer um deles deixaria o aluno bloqueado depois de pagar.

## 2. Regras puras

`lib/checkin/missedCheckins.ts` — `isMissedCheckinBlocked(openCount, blockLimit)` (limite ≤ 0
= regra desligada), `summarizeMissedCheckins(rows, blockLimit)`,
`buildMissedCheckinMessage(input)`. O mesmo builder alimenta o link do `wa.me` e o corpo do
`notifyUsers`, então o aluno lê o mesmo texto pelos dois caminhos.

`lib/checkin/monthlyProgress.ts` — `countDistinctDays(rows)` e
`countDistinctCheckinDays(client, studentId, orgId, window)`.

## 3. Nascimento da pendência

`features/checkin/missedCheckins.ts` é o ponto único, no mesmo papel de `classDebt.ts`.
`ensureMissedCheckin` **não** cria quando o aluno não tem `partner` ou quando já existe
`checkins` naquela data (ele bipou; o repasse veio). `23505` é idempotência.

`markAttendance`/`markAttendanceBulk` chamam `syncMissedCheckin`: ausente → cria + aplica o
bloqueio; presente → `clearMissedCheckin`. Best-effort com Sentry — a pendência **nunca**
derruba a marcação de presença, que é a operação do professor.

## 4. Bloqueio

`AccessDenial` ganha `blocked_by_missed_checkins`, e `AccessInput` ganha `openMissedCheckins`
+ `missedCheckinBlockLimit`. A checagem fica **entre `hasOpenDebt` e o grant de parceiro** —
se ficasse junto da cota nunca rodaria para quem gera a pendência, porque o parceiro é isento
de cota e de teto.

Cinco portas vinculam aluno a aula, e todas foram fechadas:

| Onde | Comportamento |
|---|---|
| `bookSession` | erro com a contagem e o caminho para regularizar |
| `addStudentToSession` | `missedBlocked`, furável pelo `force` que já existia |
| `enrollStudentInClass` | barra a matrícula fixa, **sem** force |
| `reconcileAllActiveEnrollments` | pula o bloqueado na geração da grade, agrupando as turmas num aviso por aluno; contagem por academia, não por aluno |
| `acceptWaitlistSpot` | única porta que não passa por `resolveClassAccess` — checada na mão; sem isso a fila de espera era o furo |

`enforceMissedCheckinBlock` cancela as reservas futuras (fixa **e** avulsa, estornando
crédito), oferece as vagas para a fila de espera e avisa aluno e admins. Reserva em
`cancelled` também impede a regeração de re-reservar, porque a reconciliação já pula sessão
com reserva em qualquer status. `cancelFutureBookings` foi extraído de
`cancelFutureEnrollmentBookings` para as duas situações compartilharem a mecânica.

## 5. Chamada

`AttendanceSheet`: selo do parceiro **sempre** visível (antes só aparecia depois da
marcação, e só quando o webhook já tinha chegado); toggle único → `[Presente] [Faltou]`
(ausente e não-marcado eram indistinguíveis, e a pendência depende dessa diferença);
feedback do que a falta causou; e **`Registrar check-in`** no parceiro presente sem check-in
do dia, reusando `recordCheckin` — o caminho de recuperar o repasse quando o webhook falha
ou o aluno esquece de bipar.

## 6. Controle Wellhub — fila de trabalho, não relatório

Rota `/admin/wellhub`, área `wellhub` **não** owner-only (quem faz a chamada é o professor);
só o card de regras exige dono.

**A lista mostra apenas alunos com pendência em aberto.** Pendência é o piso da lista, não um
filtro opcional: quem está em dia não aparece. A tela é a fila de trabalho da academia; os números
gerais ficam nos KPIs do topo (alunos de parceiro, check-ins do mês, pendências abertas,
**deixou de receber**, bloqueados).

Por aluno: pendências com valor, estado (N pendências / bloqueado, com "bloqueia com N a mais"),
link de WhatsApp com as datas, cobrança multicanal (individual e em lote), baixa por pendência ou
em lote, e perdão com motivo. Perdoada sai da contagem do bloqueio e apaga a cobrança, mas
continua no total de "deixou de receber" — perdoar não é fingir que não houve perda.

Filtros por GET (com pendência / só bloqueados, e parceiro) e navegação por mês via
`shiftWindow`, então o histórico sai de graça.

### Acompanhamento do mês fica em Alunos

O progresso de check-ins (`feitos / meta`) de **todo** aluno de parceiro vive nos cards de
`/admin/alunos`, com barra e o texto "faltam N para a meta" — é a tela que o professor abre no dia
a dia, e um aluno abaixo da meta ainda não é um problema a cobrar, é um aluno a acompanhar. O KPI
"Alunos de parceiro" do Controle Wellhub linka para lá, com a contagem de quantos estão abaixo da
meta.

Reuso: `countDistinctDays` + `computeProgress` + `getOrgDefaultCheckinTarget` (meta 0 na membership
cai no default da academia, senão o card mostraria "3 / 0"). Uma query de `checkins` do mês para
todos os alunos de parceiro da lista, agrupada em memória.

### Telefone do aluno

O link de WhatsApp depende de `profiles.phone`, e "Sem telefone" só aparece quando é isso mesmo —
`hasPhone` é passado separado do `whatsappUrl` justamente para o aviso não mentir. O formulário
"Criar aluno" passou a pedir o WhatsApp (opcional): antes o aluno cadastrado pelo próprio admin
nascia sem telefone e a academia não tinha como cobrá-lo por aqui. O valor entra em
`user_metadata.phone` e o trigger `handle_new_user()` grava em `profiles.phone`, mesmo caminho do
cadastro público.

## 7. Aluno

`/financeiro` ganha `MissedCheckinSection`, espelhando `DebtSection`, com as duas trilhas
sobre o `payments` vinculado. A home avisa: card em destaque quando bloqueado, linha discreta
com "mais N e seu agendamento é bloqueado" quando só acumulou. `/agendar` mostra o bloqueio
antes de o aluno tentar.

## 8. Check-in diário único

A spec `2026-07-29-checkin-diario-unico` estava aprovada e nunca aplicada. Sem ela o número
da tela nova divergiria da home e da ficha. Aplicada nos três lugares: home do aluno, ficha
do admin (`Set` sobre as linhas já buscadas, sem query nova) e `monthlyProgress()`.
`partnerRevenueActions` **não** muda — a spec exclui explicitamente.

## Riscos e bordas

- **`session_id` com `on delete cascade`:** excluir a aula apaga a pendência. Aceito (a
  pendência de uma aula que não existe não faz sentido), mas um futuro expurgo de sessões
  antigas levaria o histórico junto.
- **Fuso no `checkin_date`:** herdado do comportamento atual (data do servidor, UTC); um
  check-in tarde da noite pode cair no dia seguinte. Fora de escopo, como nas specs anteriores.
- **Limite 0 é o default:** ninguém é bloqueado até o dono ligar. Deliberado — ligar bloqueio
  é decisão dele, não efeito colateral do deploy.
- **Pendência de R$ 0** (nenhum valor configurado) continua sendo criada: a academia precisa
  ver a perda. Só não gera `payments` nem cobrança no app.
- **Dependentes** contam igual a qualquer aluno (sem filtro de `is_dependent`), mesma regra do
  repasse. Quem paga é o responsável — o fluxo de pagamento é o mesmo do `DebtSection`.

## Fora de escopo (sugerido para depois)

- **Lembrete pré-aula** por push no dia da aula ("não esqueça de fazer o check-in"). Ataca a
  causa raiz em vez de só cobrar depois; a infra de cron e push já existe.
- **Pendência automática** — varredura "aulas de ontem sem check-in" com confirmação em lote.
  Fora por decisão explícita (gatilho só manual).
- **Booking API da Wellhub** — reserva feita no app do parceiro já entra como aula; elimina
  parte das faltas na origem. Já registrado como fase futura na spec
  `2026-07-15-eixos-cobranca-parceiro-independentes`.

## Verificação

1. `npm run test:run` — 664 testes, incluindo `missedCheckins.test.ts`,
   `monthlyProgress.test.ts`, os casos novos de `accessRules` e de
   `creditReconciliation`.
2. `npm run build` e `npm run lint` limpos.
3. As duas migrations são aplicadas manualmente pelo usuário (SQL Editor), padrão do projeto,
   antes do deploy.
