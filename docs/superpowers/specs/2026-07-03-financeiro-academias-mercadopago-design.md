# Financeiro das Academias — Pagamento de Planos via Mercado Pago (design)

**Data:** 2026-07-03
**Status:** aprovado em brainstorming (usuário validou as 3 seções)

## Objetivo

Hoje o admin atribui planos manualmente e a academia cobra o aluno por fora do app.
Esta fase transforma o financeiro em cobrança real dentro da plataforma: cada academia
conecta a **própria conta Mercado Pago** (OAuth marketplace), o aluno **assina o plano
pelo app** com cobrança recorrente automática no cartão, e compra **aula avulsa** e
**day use** com PIX/cartão. O dinheiro cai direto na conta MP da academia. A plataforma
fica preparada para reter comissão por transação (hoje 0%) e coleta solicitações de
integração de outros bancos/gateways.

## Decisões de produto (validadas com o usuário)

| Decisão | Escolha |
|---|---|
| Conexão MP da academia | **OAuth marketplace** (sem colar chaves; token por academia) |
| Cobrança de planos | **Recorrência automática** no cartão via MP Assinaturas (preapproval) |
| Quem inicia | **Aluno assina sozinho** + **admin indica plano**; atribuição manual continua |
| Venda avulsa | **Aula avulsa (créditos) + day use pago** via Checkout Pro (PIX/cartão) |
| Outros gateways | **Formulário de solicitação** + camada de gateway abstraída; só MP implementado |
| Comissão da plataforma | **0% agora, preparado** (`platform_fee_pct` por academia) |
| Periodicidades | **Flexíveis por plano**: mensal, bimestral, trimestral, semestral, anual |
| Mecânica (abordagem A) | Planos = preapproval com token da academia; avulso = Checkout Pro |

### Referências de mercado

- Tecnofit/NextFit/EVO/Pacto: recorrência automática no cartão é o padrão (NextFit
  anuncia +25% retenção); PIX/boleto como alternativas; taxa por transação como modelo
  de receita (Tecnofit ~R$3,98/aluno/mês + taxa).
- MP Assinaturas suporta frequência em meses (1–12) → cobre mensal a anual.
- MP OAuth marketplace: token por vendedor com validade ~6 meses (renovação via
  `refresh_token`); split via `marketplace_fee`/`application_fee`.

## Fora de escopo desta fase

- Recorrência via PIX para planos (abordagem C — evolução futura sem retrabalho).
- Régua de cobrança própria (retries são do MP), boleto, emissão de nota fiscal,
  relatórios financeiros avançados.
- Implementação de um 2º gateway (apenas o formulário de interesse).
- Checkout transparente/Bricks (v1 usa redirect: init_point / Checkout Pro).

---

## 1. Modelo de dados

### 1.1 Novas tabelas (migration `supabase/migrations/`, aplicada pelo usuário)

**`org_gateway_accounts`** — conexão MP por academia (única por org+gateway):

| Coluna | Tipo/Notas |
|---|---|
| `id` | uuid pk |
| `organization_id` | fk organizations, not null |
| `gateway` | text, `'mercadopago'` |
| `status` | `'connected' \| 'disconnected' \| 'expired'` |
| `mp_user_id` | text — id do vendedor no MP |
| `access_token_enc`, `refresh_token_enc` | text — **criptografados** (AES-256-GCM, chave em env `GATEWAY_TOKEN_KEY`) |
| `public_key` | text |
| `token_expires_at` | timestamptz |
| `connected_by`, `connected_at`, `updated_at` | auditoria |

RLS **deny-all** (nenhuma policy de select/insert para authenticated) — somente service
role acessa. Nenhuma server action retorna tokens ao client.

**`plan_billing_options`** — periodicidades por plano:

| Coluna | Tipo/Notas |
|---|---|
| `id` | uuid pk |
| `organization_id` | fk, not null |
| `plan_id` | fk subscription_plans |
| `periodicity` | `'monthly' \| 'bimonthly' \| 'quarterly' \| 'semiannual' \| 'annual'` |
| `price` | numeric ≥ 0 |
| `is_enabled` | boolean |

Única por `(plan_id, periodicity)`. **Migração de dados:** para cada plano,
`price_monthly/price_quarterly/price_annual` com valor > 0 viram linhas
(monthly/quarterly/annual, `is_enabled=true`); depois as 3 colunas antigas são
removidas de `subscription_plans`.

**`gateway_integration_requests`** — solicitações de outros bancos/gateways:
`organization_id`, `requested_by`, `gateway_name` (text), `notes` (text),
`status` (`'pending' | 'reviewed'`), `created_at`.

**`plan_recommendations`** — indicação de plano pelo admin:
`organization_id`, `student_id`, `plan_id`, `billing_option_id`, `created_by`,
`status` (`'pending' | 'completed' | 'dismissed'`), `created_at`.

### 1.2 Alterações em tabelas existentes

- **`student_subscriptions`**: + `billing_option_id` (fk), + snapshot `periodicity` e
  `price` (contratado; imune a mudanças futuras do plano), + `current_period_end`
  (timestamptz), + `gateway` (`'manual' | 'mercadopago'`, default `'manual'`).
  Status ganha `'pending_payment'` e `'past_due'` (hoje: active/paused/cancelled).
- **`payments.type`**: + `'day_use'` (hoje: subscription | per_class | trial).
- **`credit_transactions.type`**: + `'purchased'` (compra avulsa).
- **`organizations`**: + `platform_fee_pct numeric not null default 0`.
- **`dayuse_bookings.status`**: + `'pending_payment'` (ocupa vaga aguardando checkout).

Tipos correspondentes atualizados em `types/index.ts`.

### 1.3 Novos módulos em `lib/billing/`

- `periodicity.ts` — meses por periodicidade, cálculo de `current_period_end`,
  labels pt-BR. **TDD.**
- `tokenCrypto.ts` — encrypt/decrypt AES-256-GCM com `GATEWAY_TOKEN_KEY`. **TDD.**
- `oauthState.ts` — assina/valida o `state` do OAuth (HMAC + expiração 10 min). **TDD.**
- `mpClient.ts` — chamadas à API do MP (oauth/token, preapproval, preferences,
  payments) sempre com o token correto (academia ou plataforma); único lugar com
  `fetch` para `api.mercadopago.com`.
- `gatewayAccounts.ts` — carrega/salva conta da academia (decripta token, verifica
  status), usado por actions e webhook.

## 2. Conexão OAuth (marketplace)

1. **Pré-requisito manual (usuário/plataforma):** criar aplicação no painel dev do MP
   com redirect `https://<domínio>/api/integrations/mercadopago/callback`.
   Novos envs na Vercel: `MP_APP_ID`, `MP_APP_SECRET`, `GATEWAY_TOKEN_KEY`.
   Os envs atuais `MERCADOPAGO_ACCESS_TOKEN` (SaaS academia→plataforma) e
   `MERCADOPAGO_WEBHOOK_SECRET` (assinatura do webhook da aplicação) permanecem.
2. **Conectar:** em `/admin/financeiro/integracoes`, o **dono** clica "Conectar
   Mercado Pago" → server action gera `state` assinado (orgId + userId + exp) e
   redireciona para `https://auth.mercadopago.com.br/authorization?...`.
3. **Callback** (`/api/integrations/mercadopago/callback`): valida `state`
   (assinatura + expiração + usuário é dono da org), troca `code` por
   `access_token/refresh_token/user_id/public_key` (`POST /oauth/token`), grava
   criptografado em `org_gateway_accounts` (`status='connected'`), redireciona para a
   tela com feedback. Erro em qualquer passo → redirect com mensagem amigável,
   nada persistido pela metade.
4. **Renovação:** cron semanal `/api/cron/mp-token-refresh` (padrão `isAuthorizedCron`)
   renova via `refresh_token` os tokens com `token_expires_at` < 30 dias. Falha →
   `status='expired'`; UI mostra "Reconectar"; checkouts novos bloqueados com
   mensagem "pagamento online indisponível".
5. **Desconectar:** `status='disconnected'`; webhook continua processando assinaturas
   MP existentes; novos checkouts bloqueados.

## 3. Fluxos de cobrança

### 3.1 Assinatura de plano (recorrente, cartão)

1. Aluno abre a página de planos, escolhe plano + periodicidade → "Assinar".
2. `subscribeToPlan(planId, billingOptionId, studentId?)`:
   - Valida: MP conectado; opção habilitada; sem assinatura ativa; não Wellhub/TotalPass.
   - Responsável pode assinar para dependente (`studentId`); pagador = usuário logado
     (mesma regra do fluxo manual: `payer_id`).
   - Cria `student_subscription` `pending_payment` com snapshot preço/periodicidade.
   - Cria preapproval no MP **com token da academia**: `transaction_amount` = preço,
     `frequency` = meses da periodicidade, `frequency_type='months'`,
     `external_reference` = id da assinatura, `back_url` = página de planos,
     `payer_email` = email do pagador.
   - Salva `gateway_subscription_id` (preapproval id) e redireciona ao `init_point`.
3. MP cobra o cartão a cada período automaticamente (retries do MP).
4. Assinaturas `pending_payment` com mais de 24h sem autorização são marcadas
   `cancelled` de forma **lazy**: ao listar planos/assinaturas do aluno e antes de
   criar uma nova assinatura (não bloqueiam nova tentativa). Sem cron novo para isso.

### 3.2 Webhook (refatoração de `app/api/webhooks/mercadopago/route.ts`)

Mantém: fail-closed sem secret, validação HMAC `x-signature`, re-confirmação na API
antes de qualquer efeito, idempotência. Muda a resolução multi-tenant:

- **`subscription_preapproval`**: busca preapproval id em
  `student_subscriptions.gateway_subscription_id`.
  - Achou → billing aluno→academia: consulta a API **com o token da academia dona**;
    mapeia status: `authorized` → `active` + créditos iniciais (reconciliação de
    matrículas, igual ao manual) + `plan_recommendation` correspondente vira
    `completed`; `paused` → `past_due`; `cancelled` → `cancelled` (+ expira créditos,
    lógica local existente).
  - Não achou → fluxo atual de `platform_subscriptions` (SaaS), **intocado**.
- **`subscription_authorized_payment`**: idem resolução; cobrança aprovada → insere
  `payments` (`type='subscription'`, `status='paid'`, idempotente por
  `gateway_payment_id`), avança `current_period_end` += meses da periodicidade e
  garante `status='active'`.
- **`payment.*`**: um pagamento novo de Checkout Pro ainda não tem
  `gateway_payment_id` no nosso banco, então a resolução da academia não pode partir
  dele. Solução: toda preferência de checkout é criada com
  `notification_url = /api/webhooks/mercadopago?org=<orgId>`. A notificação com
  `?org=` é tratada como **gatilho não confiável**: valida a assinatura HMAC quando
  presente e, sempre, re-consulta o pagamento na API do MP **com o token daquela
  academia**; só então casa `external_reference` com a linha de `payments`, grava o
  `gateway_payment_id` e aplica o efeito conforme o `type` (`per_class` → créditos,
  `day_use` → confirmar booking — ver 3.4/3.5). Sem `?org=`, mantém o fluxo atual
  (busca por `gateway_payment_id`, billing SaaS etc.).

### 3.3 Créditos, inadimplência e cancelamento

- Cadência de créditos continua **mensal** (cron dia 1 / reconciliação de matrículas),
  independente da periodicidade de cobrança.
- Para `gateway='mercadopago'`, assinatura "em dia" exige `current_period_end >= hoje`;
  vencida → reconciliação pula o aluno e ele entra em **inadimplentes** no painel
  (junto do critério atual de último pagamento falho).
- **Cancelar** (aluno ou admin): primeiro `PUT /preapproval {status:'cancelled'}` no MP
  com token da academia; **só se der certo** roda a lógica local (status + expirar
  créditos). Falha na API → erro ao usuário, nada muda localmente (nunca deixar o MP
  cobrando plano morto).
- Fluxo manual (`gateway='manual'`) continua exatamente como hoje
  (`adminSubscribeStudentToPlan` / cancelamentos locais).

### 3.4 Aula avulsa (créditos)

- Admin configura em `/admin/financeiro/planos`: preço unitário + toggle de venda
  online (`system_settings` key/value: `single_class_price`, `single_class_sale_enabled`).
- Aluno compra N créditos (entrada: página financeiro e tela de agendar com saldo 0)
  → `payments` `pending` (`type='per_class'`, `amount = N × preço`) + preferência
  Checkout Pro (PIX/cartão) com token da academia, `external_reference` = payment id,
  `notification_url` com `?org=` (ver 3.2) → redirect.
- Webhook `payment` aprovado → `paid` → `adjust_credits` +N `type='purchased'`,
  **sem expiração**.

### 3.5 Day use pago

Day use tem capacidade (RPC `book_dayuse_atomic`), então **reserva → paga → confirma**:

1. Admin define preço do day use + toggle (`system_settings`: `day_use_price`,
   `day_use_sale_enabled`).
2. Reserva cria booking `pending_payment` (ocupa vaga) + `payments` pending
   (`type='day_use'`) + preferência → redirect. A RPC `book_dayuse_atomic` passa a
   contar como ocupadas: `confirmed` + `pending_payment` com menos de 30 min.
3. Webhook aprovado → booking `confirmed` — **somente se** ainda estiver
   `pending_payment` dentro do prazo. Pagamento aprovado fora do prazo (vaga pode ter
   sido retomada): o `payment` fica `paid`, o booking segue cancelado e o caso aparece
   no painel financeiro como "reembolso pendente" para o admin estornar no MP.
4. Sem pagamento em **30 min** → a vaga é liberada automaticamente (a contagem da RPC
   ignora pendentes vencidos); o booking é marcado `cancelled` de forma lazy quando
   lido (lista do aluno/admin). Sem cron novo para isso.
5. MP desconectado ou preço 0/venda desligada → fluxo atual (reserva direta, paga na
   recepção).

### 3.6 Comissão da plataforma (preparada, desligada)

- Preferências de checkout (avulso/day use) enviam
  `marketplace_fee = round(valor × platform_fee_pct)`; hoje `platform_fee_pct = 0` →
  fee 0. Ativar = `UPDATE organizations SET platform_fee_pct = X` (sem deploy).
- **Limitação documentada:** split em assinaturas (preapproval) depende de suporte do
  MP; quando a comissão for ativada, vale de imediato para avulso/day use e o suporte
  a recorrência é reavaliado na ocasião.

## 4. Interfaces

### 4.1 Admin (owner-only, como hoje via `requireOwner()`)

- **`/admin/financeiro`** (visão geral): KPIs (receita do mês, pendentes,
  inadimplentes — pagamentos reais MP + manual), pagamentos recentes com origem,
  card de status da integração MP (ou CTA para conectar), card parceiros
  Wellhub/TotalPass mantido.
- **`/admin/financeiro/planos`**: CRUD de planos (nome, descrição, aulas/semana,
  créditos/mês) + editor de periodicidades (toggle + preço por periodicidade) +
  configuração de aula avulsa e day use (preço + toggle).
- **`/admin/financeiro/integracoes`**: card Mercado Pago (conectar OAuth, status,
  reconectar, desconectar) + card "Usa outro banco/gateway?" (formulário →
  `gateway_integration_requests`).
- **`/admin/alunos/[id]`**: mantém "Atribuir plano" (manual) + novo **"Indicar
  plano"** (plano + periodicidade → `plan_recommendation`); exibe status da
  assinatura MP (em dia / vencida / aguardando pagamento).

### 4.2 Aluno (`/financeiro`, novo no grupo dashboard, entra na navegação)

- **Meu plano**: plano atual, periodicidade, valor, próxima cobrança, status,
  cancelar (reusa/evolui `SubscriptionCard`).
- **Planos disponíveis**: vitrine dos planos ativos com seletor de periodicidade;
  "Assinar" (MP conectado) ou "Fale com a academia" (não conectado). Banner da
  indicação do admin aqui e no `/home`.
- **Histórico de pagamentos**: reusa `PaymentHistory`.
- **Comprar aula avulsa**: aqui e na tela de agendar com saldo 0.
- **Retorno do checkout** (`back_url`): tela de status com polling leve
  ("Aprovado — créditos liberados" / "Aguardando confirmação"). O retorno é só
  informativo; **efeitos só via webhook**.

## 5. Segurança

- Tokens de academia criptografados (AES-256-GCM) + RLS deny-all; nunca vão ao client.
- OAuth `state` HMAC com expiração 10 min; callback confirma que o usuário é dono da org.
- Webhook: fail-closed, HMAC, re-confirmação na API, idempotência por
  `gateway_payment_id`; crédito/confirmação **somente** via webhook.
- Server actions seguem o padrão do repo: checagem de membership admin/owner e escopo
  `organization_id` em toda query com `createAdminClient()`.

## 6. Testes e verificação

- **TDD (Vitest, co-locado):** `periodicity`, `tokenCrypto`, `oauthState`; handlers do
  webhook extraídos como funções puras (mock fetch/DB) cobrindo authorized/paused/
  cancelled, pagamento recorrente idempotente, avulso aprovado, day use
  aprovado/expirado.
- **Gates:** `npm run test:run` + `npm run build`.
- **Smoke manual em sandbox MP:** conectar conta de teste via OAuth, assinar plano com
  cartão de teste, verificar webhook → créditos; compra avulsa PIX de teste.
- Migrations aplicadas pelo usuário (`supabase db push` / SQL Editor), como de costume.
