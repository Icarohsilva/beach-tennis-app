# Plano 3 — Cobrança do SaaS (academia → plataforma)

> Design validado em brainstorming (2026-06-17). Implementação **sequenciada APÓS** o
> trabalho de experiência/posicionamento (rebrand + landing + aula experimental por região),
> a pedido do usuário. Esta spec preserva o design aprovado.

## Contexto

O app é multi-tenant (Planos 1 e 2 completos): academias se cadastram sozinhas e alunos
entram por link de convite. Falta o modelo de receita da **plataforma**: a academia paga
uma mensalidade para usar o sistema. Isso é **separado** do billing aluno→academia que já
existe (`subscription_plans`/`student_subscriptions`/`payments`/`credit_transactions` +
webhook MercadoPago que libera créditos).

## Decisões (todas confirmadas com o usuário)

- **Pagamento automático via MercadoPago** (não manual/Pix).
- **Preço fixo R$ 49,90/mês**, sem tiers.
- **Primeiro mês grátis** (trial de 30 dias a partir da criação da academia).
- **Sem cartão no início**: a academia usa 30 dias grátis sem informar cartão; ao
  aproximar/vencer o trial, aparece o convite para assinar.
- **Bloqueio só do admin/professores** quando inadimplente; **alunos seguem usando**.
- **Abordagem A — MercadoPago Assinaturas (Preapproval)**: o MP hospeda o formulário de
  cartão, cobra mensalmente e faz dunning; nosso webhook só sincroniza status.

## Arquitetura

A plataforma cobra na **própria conta MercadoPago** (a do dono da plataforma). Uma server
action cria uma assinatura (Preapproval) e redireciona o admin ao `init_point` do MP. O MP
cuida de captura de cartão, cobrança recorrente e retentativas. Um branch novo no webhook
existente sincroniza o status na tabela `platform_subscriptions`. O acesso ao painel admin é
calculado das datas em tempo de request (sem cron).

## Componentes

### 1. Modelo de dados — `platform_subscriptions`

```sql
create table platform_subscriptions (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null unique references organizations(id) on delete cascade,
  status             text not null default 'trialing'
                       check (status in ('trialing','active','past_due','canceled')),
  trial_ends_at      timestamptz,        -- fim dos 30 dias grátis
  current_period_end timestamptz,        -- pago até (empurrado a cada cobrança confirmada)
  mp_preapproval_id  text,               -- id da assinatura no MercadoPago
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
```

**Regra de acesso (derivada, sem coluna extra):** admin liberado se
`(status='active' AND current_period_end > now())` **OU**
`(status='trialing' AND trial_ends_at > now())`. Caso contrário → paywall.

- `organizations.status` (`active/suspended`) continua sendo o eixo **operacional**
  (suspensão manual pelo super-admin, Plano 4). O acesso por cobrança é independente.
- Uma assinatura por academia (`unique organization_id`).

### 2. Config + acesso

- `lib/billing/platformPlan.ts`:
  ```ts
  export const PLATFORM_PLAN = {
    priceMonthly: 49.9,
    currency: 'BRL',
    reason: 'Assinatura Plataforma — Beach Tennis App',
  } as const
  ```
- `computePlatformAccess({ status, trialEndsAt, currentPeriodEnd }, now)` → `{ allowed, daysLeft }`
  — **função pura, testada no Vitest** (espelha `lib/org/permissions.test.ts`). É o coração do enforcement.
- `getPlatformAccess(orgId)` em `lib/billing/access.ts` — lê `platform_subscriptions` e
  retorna `{ allowed, status, trialEndsAt, currentPeriodEnd, daysLeft }`.

### 3. Assinatura — `features/platform-billing/actions.ts`

`subscribeToPlatform()`:
1. `requireOwner()` (só o dono assina; professor não).
2. Busca a org + e-mail do owner.
3. `POST https://api.mercadopago.com/preapproval` com `Authorization: Bearer MERCADOPAGO_ACCESS_TOKEN`:
   ```jsonc
   {
     "reason": "Assinatura Plataforma — Beach Tennis App",
     "auto_recurring": { "frequency": 1, "frequency_type": "months",
                          "transaction_amount": 49.9, "currency_id": "BRL" },
     "payer_email": "<email do owner>",
     "back_url": "https://<DOMINIO>/admin/assinatura?retorno=1",
     "external_reference": "<organization_id>",
     "status": "pending"
   }
   ```
4. Guarda `mp_preapproval_id` em `platform_subscriptions`; devolve `init_point`.
5. Redireciona o admin ao `init_point` (cartão no MP; não tocamos no cartão).

A volta pela `back_url` mostra "processando…"; a **fonte da verdade é o webhook**.

**Novo env var:** `MERCADOPAGO_ACCESS_TOKEN` (access token da conta MP da plataforma).
Hoje só existe `MERCADOPAGO_WEBHOOK_SECRET`. O `back_url` depende do **domínio final**
(ver dependência com o trabalho de rebrand/domínio).

### 4. Enforcement + paywall

- Gate em `app/(admin)/layout.tsx`, após auth + role: se `!allowed` → `redirect('/admin/assinatura')`.
- `/admin/assinatura` é **isenta do gate** (senão loop de redirect).
- `app/(dashboard)/*` (alunos) **não ganha gate** — só admin bloqueia.
- Página `/admin/assinatura` (server component) varia por estado:
  - **Em trial (liberado):** informativa, "seu mês grátis termina em X dias" + botão **Assinar agora**.
  - **Bloqueado** (trial venceu / `past_due` / `canceled`): paywall, "assine para continuar".
  - **Professor (não-owner) em academia bloqueada:** "fale com o dono pra regularizar" (sem botão).
- **Banner suave** no topo do admin quando `trialing` e `daysLeft <= 7` (não bloqueia).

### 5. Webhook (estende o existente)

Estender `app/api/webhooks/mercadopago/route.ts` com branch por tipo de evento; o fluxo de
pagamento do aluno (`payment.*`) fica **intocado**.

- `subscription_preapproval`: `GET /preapproval/{id}` no MP → lê `status` + `external_reference`
  (= `organization_id`). MP `authorized`→`active`, `cancelled`→`canceled`, `paused`→`past_due`.
- `subscription_authorized_payment` (cobrança mensal aprovada): acha a org pelo
  `mp_preapproval_id`, seta `status='active'` e empurra `current_period_end = now + 1 mês`.
- **Idempotente** (upsert de status/data). `external_reference` é a ponte para a org.

### 6. Trial no cadastro + backfill

- `createAcademy()` passa a inserir `platform_subscriptions` com `status='trialing'`,
  `trial_ends_at = now + 30 dias`.
- Migration de backfill idempotente (`on conflict (organization_id) do nothing`):
  - **Hudson Barros (org #1):** `status='active'`, `current_period_end='2099-12-31'`
    (vitalício, nunca cai no paywall; sem special-case no gate).
  - **Arena Teste:** `status='trialing'`, `trial_ends_at = now + 30 dias`.
- **Sem cron:** o gate calcula o acesso das datas no request; trial vencido é detectado
  preguiçosamente no próximo acesso do admin.

## Testes

- **Unitário:** `computePlatformAccess` (Vitest) — trial ativo/vencido, active no prazo/vencido,
  past_due, canceled, cálculo de `daysLeft`.
- **Integração (MP + webhook):** smoke test manual em produção (norma do projeto: migrations
  aplicadas à mão, e2e manual).

## Dependências externas / pré-requisitos

- `MERCADOPAGO_ACCESS_TOKEN` configurado (Vercel + `.env.local`).
- **Domínio final definido** antes do go-live (o `back_url` e os links de convite usam a URL
  de produção) — por isso o rebrand/domínio vem antes da cobrança.
- Habilitar eventos de assinatura no webhook da conta MP.

## Fora de escopo (outros planos)

- Painel super-admin para ver/gerenciar pagamentos das academias → Plano 4.
- Tiers de preço, cupons, cobrança por uso → futuro (YAGNI).
- Multi-conta MP por academia para o billing aluno→academia → fora deste plano.
