# Integração check-in Wellhub (webhook) + criar aluno com senha temporária

**Data:** 2026-06-25
**Status:** Design aprovado (aguardando revisão do spec)

## Problema

Hoje o check-in de Wellhub/TotalPass é **manual**: o admin registra na mão (`validation='manual'`). A spec de 2026-06-15 deixou de propósito o esqueleto pronto — tabela `checkins`, `monthly_checkin_target`, progresso mensal, e uma camada de adaptador (`lib/checkin/validator.ts`, `features/checkin/actions.ts`) — para plugar a integração real depois sem refatorar regra de negócio.

Esta entrega faz duas coisas que se complementam:

1. **Integração real de check-in Wellhub por webhook:** a Wellhub avisa o ArenaHub quando um aluno faz check-in pelo app dela; o sistema casa o aluno pelo `wellhub_id`, registra o check-in (e a presença, se for dia de aula) ou parqueia como pendente.
2. **Criação de aluno pelo admin** com e-mail + senha temporária gerada pelo sistema, forçando troca de senha no primeiro login — para o admin onboardar alunos parceiros direto, sem depender do link de convite.

## Decisões (confirmadas com o usuário)

- **Modelo de check-in:** webhook/push — a Wellhub notifica o ArenaHub (aluno faz check-in pelo app da Wellhub). Bate com a intenção original no CLAUDE.md ("check-ins via webhook, não manual"). O check-in manual de hoje **permanece** como rede de segurança.
- **Identidade do aluno:** o admin cadastra o `wellhub_id` no perfil **antes** (campo já existe na `memberships`). O webhook casa por esse ID.
- **Config da integração:** tabela dedicada `org_integrations` (por academia), genérica para encaixar TotalPass e futuros parceiros.
- **Check-in órfão** (ID não cadastrado ou desconhecido): guardado numa fila de pendentes para o admin resolver. Nada se perde; o webhook sempre confirma o recebimento.
- **Progresso do aluno:** incluído nesta entrega (card read-only no app do aluno), reusando `computeProgress`.
- **Criar aluno:** só o **admin/dono da academia** (`role='admin'` na academia ativa). Super_admin fica para o plano do painel de super-admin. Senha temporária **gerada pelo sistema** e exibida uma vez ao admin para repassar.

## Arquitetura

Princípio central: toda a parte específica da Wellhub (formato do payload, assinatura) fica isolada num **parser trocável**. O núcleo que grava check-in é **compartilhado** entre o webhook e o botão manual do admin. Quando a doc autenticada da Wellhub for confirmada (depende das credenciais do Hudson), ajustamos só o parser e o método de verificação de assinatura — nenhuma regra de negócio muda. É o mesmo princípio do adaptador `CheckinValidator` já existente.

### 1. Modelo de dados (migrations novas em `supabase/migrations/`)

**`org_integrations`** — config da integração por academia:

| campo | tipo | nota |
|---|---|---|
| `id` | uuid pk default gen_random_uuid() | |
| `organization_id` | uuid not null → organizations(id) on delete cascade | |
| `partner` | checkin_partner not null | reusa o enum (`wellhub`/`totalpass`) |
| `gym_id` | text not null | id da unidade na Wellhub; roteia o webhook → academia |
| `webhook_secret` | text not null | verifica a autenticidade do evento |
| `status` | text not null default 'connected' | `connected` / `disconnected` |
| `connected_at` | timestamptz not null default now() | |
| `created_at` | timestamptz not null default now() | |

- Índice único `(partner, gym_id)` — um gym_id mapeia exatamente uma academia.
- Índice `(organization_id, partner)` — uma config por parceiro por academia.

**`pending_checkins`** — fila de check-ins órfãos:

| campo | tipo | nota |
|---|---|---|
| `id` | uuid pk default gen_random_uuid() | |
| `organization_id` | uuid not null → organizations(id) on delete cascade | |
| `partner` | checkin_partner not null | |
| `partner_member_id` | text not null | ID Wellhub que não casou |
| `checkin_date` | date not null | |
| `external_ref` | text null | referência da transação Wellhub |
| `payload` | jsonb not null | evento cru, para auditoria |
| `resolved` | boolean not null default false | |
| `created_at` | timestamptz not null default now() | |

- Índice `(organization_id, resolved)` para listar pendentes.
- Índice único parcial `(partner, external_ref) where external_ref is not null` para dedupe.

**`checkins.validation`** já aceita texto livre; passa a usar `'wellhub'` além de `'manual'`. Sem mudança de schema na tabela.

**Flag de troca de senha:** `user_metadata.must_change_password` no Auth (não em tabela) — é sobre a identidade global do usuário, não sobre uma academia. Setada na criação do aluno, limpa após a troca.

**RLS:** escrita por `createAdminClient()` (service role) — webhook e admin. Leitura: `org_integrations` e `pending_checkins` apenas para admin da academia (espelha policies de config existentes); `checkins` legível pelo próprio aluno (progresso). Migration espelha o padrão das policies atuais.

### 2. Parser Wellhub (a peça isolada) — `lib/checkin/wellhub.ts`

```ts
export interface CanonicalCheckinEvent {
  gymId: string
  partnerMemberId: string
  checkinDate: string        // yyyy-MM-dd
  externalRef: string | null
}

// Normaliza o payload cru da Wellhub para o formato canônico.
// Lança erro se o payload for malformado.
export function parseWellhubEvent(rawBody: string): CanonicalCheckinEvent

// Verifica a assinatura do corpo cru com o segredo da academia.
export function verifyWellhubSignature(rawBody: string, signature: string, secret: string): boolean
```

Implementados agora contra um **payload de exemplo documentado** (assunção registrada no topo do arquivo). Quando a doc real chegar, só estas duas funções mudam. São puras → testáveis isoladamente.

### 3. Núcleo de ingestão compartilhado — `features/checkin/actions.ts`

Refactor: extrair a lógica de gravação do `recordCheckin` atual (que exige `requireAdmin`) para uma função **sem exigência de auth**, que recebe `orgId` explícito (o webhook não tem sessão de admin):

```ts
ingestPartnerCheckin(input: {
  orgId: string
  partner: CheckinPartner
  partnerMemberId: string
  date: string
  externalRef: string | null
  payload: unknown
  createdBy?: string | null
}): Promise<{ recorded: boolean; pending: boolean; linkedSessionId?: string | null }>
```

1. Acha o aluno na academia por `wellhub_id == partnerMemberId` (em `memberships`, partner-scoped) — `totalpass_id` quando `partner='totalpass'`.
2. **Não achou** → insere em `pending_checkins` (com `payload` cru). Retorna `{ recorded:false, pending:true }`.
3. **Achou** → idempotência por `external_ref` (não duplica); insere em `checkins` com `validation` do parceiro; se a data cai em aula fixa com reserva confirmada, marca presença (`attendance`, `source=partner`) — reusa `findLinkedSession` existente. Retorna `{ recorded:true, pending:false, linkedSessionId }`.

`recordCheckin` (manual/admin) e o webhook passam a ser **dois chamadores** do mesmo núcleo. O botão manual do admin continua idêntico.

### 4. Endpoint do webhook — `app/api/webhooks/wellhub/route.ts`

`export const runtime = 'nodejs'` (precisa do raw body). Fluxo do POST:

1. Lê o corpo cru (`await req.text()`).
2. `parseWellhubEvent(rawBody)` → `{ gymId, partnerMemberId, checkinDate, externalRef }`. Malformado → 400 + log.
3. `org_integrations` por `(partner='wellhub', gym_id, status='connected')`. Não achou → **200** + log (gym desconhecido, nada a fazer).
4. `verifyWellhubSignature(rawBody, header, integration.webhook_secret)`. Inválida → **401**.
5. `ingestPartnerCheckin({ orgId, partner:'wellhub', partnerMemberId, date:checkinDate, externalRef, payload })`.
6. **Sempre 200** para evento genuíno (mesmo órfão), para a Wellhub não reenviar.

Segue o padrão do webhook do Mercado Pago já existente no projeto (`app/api/webhooks/mercadopago`).

### 5. Telas

**Admin → Integrações** (`app/(admin)/admin/integracoes/page.tsx` + client; item novo na sidebar; guard admin/owner):
- Card Wellhub: status (conectado/desconectado), campos para o **gym_id** e o **webhook_secret**, e a **URL do webhook** para copiar (informada à Wellhub). Actions `connectIntegration(partner, { gymId, webhookSecret })` e `disconnectIntegration(partner)`.
- **Fila de pendentes:** lista `pending_checkins` não resolvidos (ID Wellhub + data); botão "Vincular a um aluno" → seleciona o aluno, chama o núcleo de ingestão para criar o check-in real e marca `resolved=true`.

**Admin → Alunos** (`app/(admin)/admin/alunos/`): botão "Criar aluno" abre form (nome, e-mail; opcional: tipo Mensalista/Wellhub/TotalPass com `wellhub_id` + meta). Action `createStudent` (ver 6). Mostra a senha gerada **uma vez** num bloco "copie e repasse ao aluno".

**Tela definir senha** (`app/(auth)/definir-senha/page.tsx`): usuário **logado** define nova senha via `supabase.auth.updateUser({ password })`; action limpa `must_change_password`. Distinta da `/nova-senha` (fluxo de link de recuperação PKCE).

**Progresso do aluno** (read-only): card no `app/(dashboard)/home` (ou `/perfil`) — se a membership é `wellhub`/`totalpass`, mostra "Check-ins do mês: feitos × meta" reusando `computeProgress`. Sem botão de ação (o check-in é feito no app da Wellhub).

Componentes seguem `components/ui/` (Button, Card, Badge, Input).

### 6. Criar aluno + troca forçada — `features/organizations/actions.ts`

`createStudent` (junto do `createProfessor`, mesmo padrão; guard admin/owner da academia ativa):
1. Gera senha temporária aleatória (`crypto`, ~10 chars legíveis, sem caracteres ambíguos).
2. `createAdminClient().auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name, org_invite_code: <invite da academia ativa>, must_change_password: true } })` → o trigger `handle_new_user` cria perfil + membership na academia (padrão existente).
3. Opcional: se tipo parceiro informado, chama `setStudentType` (já existe) para gravar `wellhub_id`/meta.
4. E-mail já existente (conta global) → mensagem clara em pt-BR.
5. Retorna a senha gerada uma vez (não persistida em lugar nenhum).

**Gate de troca forçada:** em `app/(dashboard)/layout.tsx` e `app/(admin)/layout.tsx`, se `user.user_metadata.must_change_password === true`, redireciona para `/definir-senha`, bloqueando o resto do app até trocar.

### 7. Erros e segurança

- Webhook: gym desconhecido → 200 + log; assinatura inválida → 401; payload malformado → 400; órfão → pendente (não perde). Idempotência por `external_ref`.
- `webhook_secret` é sensível: nunca logar. O raw body é obrigatório para verificar assinatura — a rota não pode depender do parsing automático.
- Criar aluno / conectar integração / resolver pendente: só `role='admin'` na academia ativa (reusa `requireAdmin`).
- Senha temporária: nunca persistida; exibida uma única vez.

### 8. Testes

- **Puros (Vitest):** `parseWellhubEvent` (exemplo → canônico; malformado → erro); `verifyWellhubSignature` (válida/inválida); gerador de senha (tamanho/charset/sem ambíguos); `computeProgress` (já coberto).
- **Núcleo `ingestPartnerCheckin`** (client mockado/manual): casa por `wellhub_id` → cria check-in; sem match → pendente; idempotência por `external_ref`; dia de aula fixa com reserva → marca presença `source=wellhub`.

## Fora de escopo (follow-ups)

- Parser e método de assinatura **reais** da Wellhub — dependem da doc autenticada (credenciais do Hudson). Construído contra exemplo documentado; troca isolada no parser.
- TotalPass (mesmo desenho, parser próprio).
- Painel super-admin e criação de aluno pelo super_admin.
- Self-service de iniciar check-in pelo ArenaHub (não se aplica ao modelo webhook).
- Notificar o aluno/admin a cada check-in recebido.

## Dependências externas

Para ativar de verdade em produção, o Hudson precisa confirmar com a Wellhub: acesso de API/webhook liberado, `gym_id` da unidade, `webhook_secret` (ou esquema de assinatura), e a doc técnica do Access Control API. Até lá, a feature é construída e testada com payload de exemplo e fica pronta para a troca do parser.
