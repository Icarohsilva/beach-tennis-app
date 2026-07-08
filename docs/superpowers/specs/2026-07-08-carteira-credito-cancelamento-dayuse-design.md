# Carteira de crédito por cancelamento de day use — Design

**Data:** 2026-07-08
**Status:** Aprovado (brainstorming)

## Problema

Quando um aluno paga um day use e depois cancela a reserva, o dinheiro não
volta pra ele. Hoje o `cancelDayUseBooking` só marca a reserva como `cancelled`
e o pagamento continua `paid` — a academia fica com o dinheiro e o aluno não
recebe nada de volta. O caso aparece na seção "Reembolsos pendentes (day use)"
do `/admin/financeiro`, mas o reembolso é manual (o admin precisa estornar no
painel do Mercado Pago).

Estorno em dinheiro no MP marketplace tem atrito real: taxa da transação,
necessidade de saldo na conta da academia, e complexidade do split payment.

## Solução

Em vez de devolver dinheiro, o cancelamento com antecedência gera um **crédito
em carteira (saldo em reais)** que o aluno pode usar em compras futuras dentro
da mesma academia. O dinheiro nunca sai do Mercado Pago — a academia recebeu
uma vez e presta o serviço uma vez (só deslocado pra outra reserva/compra),
então fica quitada, sem lidar com estornos.

### Decisões de escopo (v1)

- **Natureza do crédito:** saldo em reais (carteira), não contagem de usos.
- **Onde gastar:** day use + aula avulsa (os dois fluxos que já passam pelo
  checkout do MP). Torneio fica pra depois (hoje é PIX manual, caminho de
  pagamento separado).
- **Janela de antecedência:** configurável por academia. Cancelou com mais de
  X horas de antecedência do horário do slot → crédito integral. Dentro da
  janela ou depois → forfeit (sem crédito, academia fica com o dinheiro).
- **Validade:** o saldo expira em N dias (configurável por academia).
- **Uso no checkout:** o saldo só é usado quando cobre o valor **inteiro** da
  compra (sem "paga a diferença com MP" na v1). Se cobre → confirma na hora sem
  passar pelo MP. Se não cobre → fluxo normal do MP, carteira intocada.

## Modelo de dados

### Tabela `wallet_credits`

Uma linha por crédito concedido:

| Coluna | Tipo | Nota |
|---|---|---|
| `id` | uuid PK | |
| `organization_id` | uuid | carteira é por academia |
| `student_id` | uuid | |
| `amount` | numeric | valor original concedido (reais) |
| `remaining` | numeric | quanto ainda resta (reais) |
| `currency` | text | 'BRL' |
| `source` | text | ex. `dayuse_cancel` |
| `source_ref` | uuid null | id da reserva/origem |
| `expires_at` | timestamptz | agora + N dias na concessão |
| `created_at` | timestamptz | |

- **Saldo disponível** = `sum(remaining)` das linhas com `expires_at > now()` e
  `remaining > 0`, escopado por `(student_id, organization_id)`.
- **Unidade:** numeric em reais, pra casar com `payments.amount` e os preços já
  usados (`day_use_price`, `single_class_price`) e evitar conversão no checkout.
- **Sem cache:** o saldo é calculado na leitura (SUM). A carteira aparece em
  poucos lugares (financeiro + checkout), então compute-on-read evita bugs de
  saldo dessincronizado. (Contraste com `credits_balance`, que é cacheado por
  aparecer no cabeçalho de várias páginas.)

### RPCs atômicas

- `grant_wallet_credit(p_student, p_org, p_amount, p_source, p_source_ref, p_expiry_days)`
  — insere uma linha de crédito.
- `spend_wallet(p_student, p_org, p_amount, p_purpose, p_ref)` — consome FIFO
  (linhas mais antigas primeiro, não expiradas), reduzindo `remaining`
  (parcial permitido). Lock por aluno (`pg_advisory_xact_lock`) pra evitar
  double-spend. Retorna sucesso/falha; falha se saldo disponível < `p_amount`.

## Fluxos

### A) Cancelar day use → gerar crédito

Em `cancelDayUseBooking`:

1. Busca a reserva + o `payment` associado (por `dayuse_booking_id`).
2. Se a reserva está paga (`payment.status = 'paid'`), `day_use_refund_enabled`
   está ligado, e a diferença entre agora e o `slot.date + slot.start_time` é
   maior que `day_use_refund_window_hours`:
   - chama `grant_wallet_credit(..., amount = payment.amount, source =
     'dayuse_cancel', source_ref = booking.id, expiry_days =
     wallet_credit_expiry_days)`.
3. Marca a reserva `cancelled` normalmente. O `payment` original permanece
   `paid` (academia não devolve dinheiro).
4. Dentro da janela / depois / feature desligada → só cancela, sem crédito.

Idempotência: não conceder crédito duas vezes pra mesma reserva (checar se já
existe `wallet_credits` com aquele `source_ref` antes de inserir; ou constraint
única parcial em `(source, source_ref)`).

### B) Usar o saldo no checkout (day use + aula avulsa)

Para cada um dos dois fluxos (`bookDayUse` no caminho pago e
`buySingleClassCredits`):

1. Antes de criar a preferência do MP, calcula o saldo disponível.
2. Se `saldo >= valor da compra`:
   - Uma RPC atômica: `spend_wallet(valor)` + confirma a reserva
     (`confirmed`) / concede os créditos de aula (`per_class`), e registra um
     `payment` com `gateway = 'wallet'`, `status = 'paid'`. **Não passa pelo MP.**
   - A action retorna algo como `{ walletPaid: true }` em vez de `initPoint`;
     o client atualiza a UI sem redirecionar.
3. Se `saldo < valor`:
   - Fluxo normal do MP (cria preferência, retorna `initPoint`). Carteira
     intocada.

### C) Expiração

- Créditos com `expires_at < now()` simplesmente não entram no cálculo de saldo.
- Opcional: uma limpeza no cron diário (`monthly-credit-renewal` ou um passo
  no cron existente) zera o `remaining` de linhas expiradas, só pra higiene da
  tabela. Não é essencial pro funcionamento correto.

## Configurações do admin (`system_settings`, por academia)

Na mesma tela de vendas (`/admin/financeiro/planos`, `SalesSettingsCard`):

- `day_use_refund_enabled` — liga/desliga a feature (default `false`).
- `day_use_refund_window_hours` — antecedência mínima pra ganhar crédito
  (ex. `12`).
- `wallet_credit_expiry_days` — validade do saldo (ex. `90`).

## Contabilidade e reembolsos

### Receita não conta duas vezes

Um `payment` com `gateway = 'wallet'` **não** é receita nova — o dinheiro já
entrou no day use original que gerou o saldo. Portanto:

- Excluir `gateway = 'wallet'` do cálculo de "Receita do mês" e do breakdown por
  origem em `/admin/financeiro`.

### Ajuste dos "Reembolsos pendentes (day use)"

Hoje a seção mostra qualquer `day_use` pago com reserva `cancelled`, instruindo
estorno manual no MP. Com a carteira:

- Cancelamento voluntário do aluno com antecedência → resolvido via crédito
  (não é reembolso pendente).
- Cancelamento voluntário dentro da janela → forfeit (academia fica com o
  dinheiro de propósito, não é reembolso pendente).
- **Só o caso de timeout de pagamento** (a reserva `pending_payment` que expira
  em 30min e é auto-cancelada, mas o pagamento chega depois → aluno pagou e não
  tem reserva válida, sem culpa dele) merece estorno manual.

Para distinguir, marcar a reserva cancelada pelo sweep de timeout com um motivo
próprio (ex. coluna `cancel_reason = 'payment_timeout'` em `dayuse_bookings`, ou
flag equivalente). A query de reembolsos pendentes passa a filtrar só esse
motivo.

## UI do aluno

- **`/financeiro`:** um card "Saldo em carteira: R$X" com a data de expiração do
  saldo mais próximo (ou "expira em DD/MM"). Some quando o saldo é zero.
- **Checkout day use / aula avulsa:** quando o saldo cobre o valor, o botão vira
  "Usar saldo (R$20)" em vez de "Pagar R$20", e a confirmação acontece na hora
  (sem redirect pro MP).

## Componentes e arquivos afetados

| Arquivo | Mudança |
|---|---|
| `supabase/migrations/*_wallet_credits.sql` | tabela + RPCs `grant_wallet_credit`, `spend_wallet` |
| `supabase/migrations/*_dayuse_cancel_reason.sql` | coluna `cancel_reason` em `dayuse_bookings` |
| `lib/billing/wallet.ts` (novo) | helpers de leitura de saldo |
| `features/dayuse/actions.ts` | `cancelDayUseBooking` gera crédito; `bookDayUse` usa saldo |
| `features/financeiro/checkoutActions.ts` | `buySingleClassCredits` usa saldo |
| `features/dayuse/DayUseBookingCard.tsx` | botão "Usar saldo" |
| `features/financeiro/BuyCreditsCard.tsx` | botão "Usar saldo" |
| `app/(dashboard)/financeiro/page.tsx` | card de saldo |
| `features/financeiro/WalletCard.tsx` (novo) | card de saldo |
| `app/(admin)/admin/financeiro/planos/SalesSettingsCard.tsx` | 3 configs novas |
| `app/(admin)/admin/financeiro/adminActions.ts` | salvar as configs |
| `app/(admin)/admin/financeiro/page.tsx` | excluir `wallet` da receita; ajustar reembolsos pendentes |
| `types/index.ts` | tipos `WalletCredit`, `gateway = 'wallet'` |

## Fora de escopo (evoluções futuras)

- Pagar parte com saldo e a diferença com MP (split wallet+MP).
- Usar saldo em torneios.
- Reembolso em dinheiro (estorno no MP) como alternativa à carteira.

## Testes

- `grant_wallet_credit` / `spend_wallet`: concessão, gasto FIFO, gasto parcial,
  falha por saldo insuficiente, ignorar expirados, idempotência por `source_ref`.
- Janela: cancelamento antes/depois do limite gera/não gera crédito.
- Checkout: saldo cobre → confirma sem MP; saldo não cobre → MP normal.
- Contabilidade: `gateway = 'wallet'` não entra na receita.
- Reembolsos pendentes: só `payment_timeout` aparece.
