# Frente 0 — Endurecimento + Observabilidade — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ganhar visibilidade de produção (Sentry) e centralizar/endurecer a autenticação dos crons, sem mudar comportamento para o usuário final.

**Architecture:** Sentry é instrumentado via `instrumentation.ts` (server/edge) + `sentry.client.config.ts` (browser) + `withSentryConfig` no `next.config.js`. Crons e webhooks passam a capturar exceção explicitamente para não falharem em silêncio. A auth dos 4 crons vira um helper puro `isValidCronAuth` (timing-safe), testável isoladamente, com um wrapper fino `verifyCronSecret(req)`.

**Tech Stack:** Next.js 14.2 App Router, TypeScript, `@sentry/nextjs`, Node `crypto.timingSafeEqual`, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-13-frente-0-endurecimento-observabilidade-design.md`

---

### Task 1: Helper `verifyCronSecret` timing-safe (TDD)

**Files:**
- Create: `lib/auth/cronAuth.ts`
- Test: `lib/auth/cronAuth.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/auth/cronAuth.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { isValidCronAuth } from './cronAuth'

describe('isValidCronAuth', () => {
  const secret = 'super-secret-value'

  it('aceita o header correto', () => {
    expect(isValidCronAuth(`Bearer ${secret}`, secret)).toBe(true)
  })

  it('rejeita secret errado de mesmo comprimento', () => {
    const wrong = 'x'.repeat(secret.length)
    expect(isValidCronAuth(`Bearer ${wrong}`, secret)).toBe(false)
  })

  it('rejeita header ausente', () => {
    expect(isValidCronAuth(null, secret)).toBe(false)
  })

  it('rejeita quando o CRON_SECRET não está configurado (fail-closed)', () => {
    expect(isValidCronAuth(`Bearer ${secret}`, undefined)).toBe(false)
    expect(isValidCronAuth(`Bearer ${secret}`, '')).toBe(false)
  })

  it('rejeita comprimentos diferentes sem lançar', () => {
    expect(() => isValidCronAuth('Bearer short', secret)).not.toThrow()
    expect(isValidCronAuth('Bearer short', secret)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- lib/auth/cronAuth.test.ts`
Expected: FAIL — `Failed to resolve import "./cronAuth"` / `isValidCronAuth is not a function`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/auth/cronAuth.ts`:

```ts
import { timingSafeEqual } from 'crypto'
import type { NextRequest } from 'next/server'

// Comparação em tempo constante do header Authorization contra `Bearer <secret>`.
// Função pura (sem req/env) para ser testável isoladamente.
export function isValidCronAuth(authHeader: string | null, secret: string | undefined): boolean {
  if (!secret) return false // fail-closed: sem secret configurado, nada passa
  if (!authHeader) return false
  const received = Buffer.from(authHeader)
  const wanted = Buffer.from(`Bearer ${secret}`)
  // timingSafeEqual lança se os comprimentos diferem — guarda de comprimento primeiro.
  if (received.length !== wanted.length) return false
  return timingSafeEqual(received, wanted)
}

export function verifyCronSecret(req: NextRequest): boolean {
  return isValidCronAuth(req.headers.get('authorization'), process.env.CRON_SECRET)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- lib/auth/cronAuth.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/auth/cronAuth.ts lib/auth/cronAuth.test.ts
git commit -m "feat(security): helper verifyCronSecret timing-safe para os crons"
```

---

### Task 2: Aplicar `verifyCronSecret` nos 4 crons

Troca do bloco de auth duplicado. Comportamento externo idêntico (mesmo 401).

**Files:**
- Modify: `app/api/cron/monthly-credit-renewal/route.ts`
- Modify: `app/api/cron/credit-backfill/route.ts`
- Modify: `app/api/cron/waitlist-notifications/route.ts`
- Modify: `app/api/cron/mp-token-refresh/route.ts`

- [ ] **Step 1: `monthly-credit-renewal`**

Adicionar o import no topo (após os imports existentes):

```ts
import { verifyCronSecret } from '@/lib/auth/cronAuth'
```

Substituir:

```ts
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
```

por:

```ts
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
```

- [ ] **Step 2: `credit-backfill`** — mesmo import e mesma substituição (bloco idêntico ao do Step 1).

- [ ] **Step 3: `waitlist-notifications`** — mesmo import; substituir (note o comentário acima do bloco, que pode sair junto):

```ts
  // Verify Vercel cron secret
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
```

por:

```ts
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
```

- [ ] **Step 4: `mp-token-refresh`** — mesmo import e mesma substituição do Step 1.

- [ ] **Step 5: Verificar build e lint**

Run: `npm run build`
Expected: build conclui sem erro (todas as rotas de cron compilam).

- [ ] **Step 6: Commit**

```bash
git add app/api/cron/monthly-credit-renewal/route.ts app/api/cron/credit-backfill/route.ts app/api/cron/waitlist-notifications/route.ts app/api/cron/mp-token-refresh/route.ts
git commit -m "refactor(security): crons usam verifyCronSecret centralizado"
```

---

### Task 3: Instalar e configurar Sentry

**Files:**
- Modify: `package.json` (via npm)
- Create: `instrumentation.ts`
- Create: `sentry.server.config.ts`
- Create: `sentry.edge.config.ts`
- Create: `sentry.client.config.ts`
- Modify: `next.config.js`

- [ ] **Step 1: Instalar o pacote**

Run: `npm install @sentry/nextjs`
Expected: `@sentry/nextjs` adicionado às dependencies; `npm install` conclui.

- [ ] **Step 2: Criar `sentry.server.config.ts`** (raiz do projeto)

```ts
import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  // Habilita o envio só quando há DSN configurado (dev local sem DSN = no-op).
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
  // 100% em dev, 10% em prod — erros são sempre capturados; isto é só tracing.
  tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,
})
```

- [ ] **Step 3: Criar `sentry.edge.config.ts`** (raiz do projeto) — usado pelo `middleware.ts` (Edge runtime). Não pode importar nada de Node.

```ts
import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,
})
```

- [ ] **Step 4: Criar `sentry.client.config.ts`** (raiz do projeto)

```ts
import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,
})
```

- [ ] **Step 5: Criar `instrumentation.ts`** (raiz do projeto)

```ts
import * as Sentry from '@sentry/nextjs'

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config')
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config')
  }
}

// No Next 15 este hook captura erros de Server Components/middleware.
// No Next 14.2 ele não é chamado pelo framework (inócuo) — deixa o upgrade pronto.
export const onRequestError = Sentry.captureRequestError
```

- [ ] **Step 6: Atualizar `next.config.js`**

Substituir todo o conteúdo por:

```js
// next.config.js
const { withSentryConfig } = require('@sentry/nextjs')

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Next 14.2: instrumentation.ts só roda com este flag (padrão só no Next 15).
  experimental: {
    instrumentationHook: true,
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.supabase.co' },
    ],
  },
}

module.exports = withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  // Só loga o upload de source maps em CI; sem SENTRY_AUTH_TOKEN o upload é pulado
  // (a captura de erro funciona mesmo sem source maps).
  silent: !process.env.CI,
})
```

- [ ] **Step 7: Verificar build**

Run: `npm run build`
Expected: build conclui. Sem `SENTRY_AUTH_TOKEN`/DSN local, o upload de source maps é pulado com aviso — não é erro. Confirmar que aparece a instrumentação do Sentry no output e que nenhuma rota quebrou.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json instrumentation.ts sentry.server.config.ts sentry.edge.config.ts sentry.client.config.ts next.config.js
git commit -m "feat(observability): instrumentar Sentry (client/server/edge)"
```

---

### Task 4: Crons não falham em silêncio (captureException)

Envolver o corpo de cada cron para reportar exceção ao Sentry e retornar 500 explícito. `mp-token-refresh` já tem try/catch por linha — só adicionar o report no catch existente e cobrir a query externa.

**Files:**
- Modify: `app/api/cron/monthly-credit-renewal/route.ts`
- Modify: `app/api/cron/credit-backfill/route.ts`
- Modify: `app/api/cron/waitlist-notifications/route.ts`
- Modify: `app/api/cron/mp-token-refresh/route.ts`

- [ ] **Step 1: `monthly-credit-renewal`** — adicionar import e try/catch

Import no topo:

```ts
import * as Sentry from '@sentry/nextjs'
```

Envolver o corpo após a checagem de auth:

```ts
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Roda no dia 1 → janela = mês inteiro corrente.
    const { from, to } = getMonthWindow(new Date())
    const summary = await reconcileAllActiveEnrollments(from, to)
    return NextResponse.json({ window: { from, to }, ...summary })
  } catch (e) {
    Sentry.captureException(e, { tags: { cron: 'monthly-credit-renewal' } })
    return NextResponse.json({ error: 'Cron failed' }, { status: 500 })
  }
```

- [ ] **Step 2: `credit-backfill`** — mesmo import; envolver o corpo:

```ts
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { from, to } = getRemainingMonthWindow(new Date())
    const summary = await reconcileAllActiveEnrollments(from, to)
    return NextResponse.json({ window: { from, to }, ...summary })
  } catch (e) {
    Sentry.captureException(e, { tags: { cron: 'credit-backfill' } })
    return NextResponse.json({ error: 'Cron failed' }, { status: 500 })
  }
```

- [ ] **Step 3: `waitlist-notifications`** — mesmo import; reportar no erro de DB e por iteração sem abortar o loop.

Reportar no erro de DB existente:

```ts
  if (error) {
    Sentry.captureException(error, { tags: { cron: 'waitlist-notifications' } })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
```

Trocar o corpo do loop para capturar falha individual sem parar a fila:

```ts
  let processed = 0
  for (const entry of expired ?? []) {
    try {
      // Expire the current offered entry
      await adminClient
        .from('waitlists')
        .update({ status: 'expired' })
        .eq('id', entry.id)

      // Offer to next in queue
      await offerWaitlistSpot(entry.session_id)
      processed++
    } catch (e) {
      Sentry.captureException(e, {
        tags: { cron: 'waitlist-notifications' },
        extra: { entryId: entry.id, sessionId: entry.session_id },
      })
    }
  }
```

- [ ] **Step 4: `mp-token-refresh`** — mesmo import; adicionar o report no catch por-linha já existente (mantendo o `console.error` e a lógica de auth-rejection):

```ts
    } catch (e) {
      const isAuthRejection = e instanceof MpApiError && (e.status === 401 || e.status === 403)
      console.error('[mp-token-refresh] falhou', {
        org: row.organization_id,
        authRejection: isAuthRejection,
        error: e instanceof Error ? e.message : e,
      })
      Sentry.captureException(e, {
        tags: { cron: 'mp-token-refresh', authRejection: String(isAuthRejection) },
        extra: { org: row.organization_id },
      })
      if (isAuthRejection) {
        await setMpAccountStatus(row.organization_id, 'expired')
        expired++
      } else {
        transientFailures++
      }
    }
```

- [ ] **Step 5: Verificar build**

Run: `npm run build`
Expected: build conclui sem erro de tipos nas 4 rotas.

- [ ] **Step 6: Commit**

```bash
git add app/api/cron/monthly-credit-renewal/route.ts app/api/cron/credit-backfill/route.ts app/api/cron/waitlist-notifications/route.ts app/api/cron/mp-token-refresh/route.ts
git commit -m "feat(observability): crons reportam exceção ao Sentry"
```

---

### Task 5: Webhooks não falham em silêncio (captureException)

O webhook do MP tem um catch central; os handlers de aluno/checkout também têm ramos que **engolem** erro com `console.error` e `return` (não sobem para o catch central) — instrumentar esses pontos.

**Files:**
- Modify: `app/api/webhooks/mercadopago/route.ts`
- Modify: `app/api/webhooks/mercadopago/studentHandlers.ts`
- Modify: `app/api/webhooks/mercadopago/checkoutHandlers.ts`
- Modify: `app/api/webhooks/wellhub/route.ts`

- [ ] **Step 1: `mercadopago/route.ts`** — import + report no catch central

Import no topo:

```ts
import * as Sentry from '@sentry/nextjs'
```

No catch de `handleWebhook` (hoje só `console.error`):

```ts
  } catch (e) {
    // Falha transitória (API MP fora, DB): 500 → MP reentrega o evento.
    console.error('[webhook/mercadopago] handler falhou', e)
    Sentry.captureException(e, {
      tags: { webhook: 'mercadopago' },
      extra: { action, resourceId, orgParam },
    })
    return NextResponse.json({ error: 'Handler failed' }, { status: 500 })
  }
```

- [ ] **Step 2: `studentHandlers.ts`** — import + report nos ramos que engolem erro

Import no topo:

```ts
import * as Sentry from '@sentry/nextjs'
```

Nos dois `console.error` que retornam sem lançar (academia sem conta MP), adicionar o report logo após o log. Exemplo em `handleStudentPreapprovalEvent`:

```ts
  const account = await getMpAccount(sub.organization_id)
  if (!account) {
    console.error('[webhook/mp] academia sem conta MP para assinatura', { sub: sub.id })
    Sentry.captureMessage('webhook/mp: academia sem conta MP (assinatura)', {
      level: 'error',
      extra: { subId: sub.id, orgId: sub.organization_id },
    })
    return 'handled'
  }
```

E em `handleStudentRecurringPayment`:

```ts
  const account = await getMpAccount(orgId)
  if (!account) {
    console.error('[webhook/mp] cobrança recorrente sem conta MP', { orgId })
    Sentry.captureMessage('webhook/mp: cobrança recorrente sem conta MP', {
      level: 'error',
      extra: { orgId },
    })
    return
  }
```

- [ ] **Step 3: `checkoutHandlers.ts`** — import + report no ramo sem conta MP

Import no topo:

```ts
import * as Sentry from '@sentry/nextjs'
```

```ts
  const account = await getMpAccount(orgId)
  if (!account) {
    console.error('[webhook/mp] checkout sem conta MP', { orgId })
    Sentry.captureMessage('webhook/mp: checkout sem conta MP', {
      level: 'error',
      extra: { orgId },
    })
    return
  }
```

- [ ] **Step 4: `wellhub/route.ts`** — import + report no catch

Abrir `app/api/webhooks/wellhub/route.ts`, adicionar `import * as Sentry from '@sentry/nextjs'` no topo e, no bloco `catch` que hoje só loga/retorna, adicionar:

```ts
    Sentry.captureException(e, { tags: { webhook: 'wellhub' } })
```

imediatamente após o `console.error` existente, mantendo o retorno atual (o webhook do Wellhub sempre responde 200 de propósito — não alterar o status).

- [ ] **Step 5: Verificar build**

Run: `npm run build`
Expected: build conclui sem erro de tipos.

- [ ] **Step 6: Commit**

```bash
git add app/api/webhooks/mercadopago/route.ts app/api/webhooks/mercadopago/studentHandlers.ts app/api/webhooks/mercadopago/checkoutHandlers.ts app/api/webhooks/wellhub/route.ts
git commit -m "feat(observability): webhooks reportam exceção/erro ao Sentry"
```

---

### Task 6: Verificação final + configuração do alerta

**Files:** nenhum código novo — verificação e passo manual de dashboard.

- [ ] **Step 1: Rodar a suíte de testes de lib**

Run: `npm run test:run -- lib/auth/cronAuth.test.ts`
Expected: PASS (5 tests).

Run: `npx vitest run lib`
Expected: sem novas falhas introduzidas (as falhas pré-existentes do projeto aninhado `octogent/` não contam).

- [ ] **Step 2: Build de produção**

Run: `npm run build`
Expected: conclui; output mostra a instrumentação do Sentry aplicada.

- [ ] **Step 3: Configurar env vars na Vercel (manual)**

No painel da Vercel (Production + Development), definir:
- `NEXT_PUBLIC_SENTRY_DSN` = DSN do projeto Sentry
- `SENTRY_ORG` = slug da org no Sentry
- `SENTRY_PROJECT` = slug do projeto
- `SENTRY_AUTH_TOKEN` = token de upload de source maps (build)

- [ ] **Step 4: Verificação manual pós-deploy**
- `GET` em `/api/cron/monthly-credit-renewal` com `Authorization: Bearer errado` → **401**; com o `CRON_SECRET` correto → **200**.
- `POST` em `/api/webhooks/mercadopago` sem `x-signature` e **sem** `?org=` → **401** (confirmar que não regrediu).
- Disparar um erro proposital (ex.: um cron com dependência quebrada em ambiente de teste, ou o botão de teste do painel do Sentry) e confirmar o evento aparecendo no Sentry.

- [ ] **Step 5: Criar a regra de alerta no Sentry (manual)**

No painel do Sentry → Alerts → Create Alert → Issue Alert: "When a new issue is created" → Action: "Send a notification via email" → destino `contatoicarosilva@outlook.com`. Salvar.

- [ ] **Step 6: Commit final (se houver ajuste)**

Se algum ajuste de código surgir da verificação, commitar. Caso contrário, a frente está concluída — nenhum commit vazio.

---

## Notas de cobertura do spec

- **Server actions (spec Bloco 1):** o alto valor de "não engolir exceção" está nos caminhos que rodam **sem um usuário olhando** — crons (Task 4) e webhooks + seus handlers que engolem erro (Task 5). Erros de server actions disparadas por usuário já sobem para a UI. Uma varredura mais profunda por action fica como follow-up de baixa prioridade, não bloqueia esta frente.
- **Sentry Cron Monitoring:** opcional documentado no spec — não implementado aqui (registrado como caminho futuro).
