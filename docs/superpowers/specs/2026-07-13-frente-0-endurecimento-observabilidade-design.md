# Frente 0 — Endurecimento + Observabilidade

**Data:** 2026-07-13
**Status:** Design aprovado (aguardando revisão do spec)
**Programa:** item 0 de 5 (0. Endurecimento+Observabilidade · 1. Comunicação · 2. BI · 3. Financeiro BR · 4. Escala & Qualidade)

## Contexto e objetivo

A auditoria fria do sistema apontou que o produto é maduro (agenda, créditos, Mercado Pago, Wellhub, torneios, multi-tenant), mas **não há visibilidade de produção**: 42 `console.error` soltos, crons e webhooks que podem falhar em silêncio, e nenhum error tracking. Antes de ligar integrações novas nas frentes seguintes (WhatsApp, Web Push, régua de inadimplência), precisamos **enxergar falhas em produção**. Ligar integração sem observabilidade é voar cego.

Esta frente é deliberadamente enxuta: **observabilidade com Sentry** + um **endurecimento pontual** (auth dos crons), sem mudança de comportamento para o usuário final.

### Correção de escopo (achado da leitura fria do código)

A auditoria de segurança sugeriu três fixes; a leitura do código real derrubou dois:

- **Webhook Mercado Pago *fail-closed* — DESCARTADO.** O caminho `?org=` sem HMAC é intencional e seguro: toda notificação com `?org=` é gatilho não confiável e é **re-consultada na API do MP com o token da própria academia** antes de qualquer escrita (`handleStudentRecurringPayment` reconfirma e amarra `sub.organization_id !== orgId` em `studentHandlers.ts:119-123`; `handleOrgCheckoutPayment` reconfirma e casa `external_reference` com `.eq('organization_id', orgId)` + piso de valor em `checkoutHandlers.ts:32-59`). Forçar 401 geral **quebraria** todas as assinaturas recorrentes e checkouts de aluno, que nunca carregam HMAC.
- **Validar `active_org_id` do cookie — JÁ IMPLEMENTADO.** `resolveActiveOrg` (`lib/org/activeOrg.ts:24`) já valida o cookie contra as memberships reais (`ids.includes(cookieOrgId)`) e `getActiveOrgId` (`lib/supabase/server.ts:79-82`) usa isso com as memberships do banco. Cookie forjado para org que o usuário não tem cai fora. Nada a fazer.
- **Cron secret timing-safe — MANTIDO.** Baixo risco (ataque de timing sobre a rede na Vercel é teórico), mas o fix é trivial e o ganho real é DRY: um helper único nos 4 crons.

## Escopo

### Dentro
1. Instrumentação Sentry (`@sentry/nextjs`) em client, server e edge.
2. Captura explícita de exceção em crons e webhooks, garantindo que **não falhem em silêncio**.
3. Regra de alerta por e-mail (passo de dashboard) → `contatoicarosilva@outlook.com`.
4. Helper `verifyCronSecret()` timing-safe aplicado aos 4 crons.
5. Teste unitário do helper + verificação manual de evento chegando no Sentry.

### Fora (frentes seguintes ou não aplicável)
- Qualquer canal de notificação ao usuário (WhatsApp/Push/Email) → Frente 1.
- Dashboards de BI → Frente 2.
- Régua de inadimplência → Frente 3.
- Paginação, testes de fluxo, e2e, i18n → Frente 4.
- Sentry Cron Monitoring (check-ins de "o cron deixou de rodar") → **opcional documentado**, ver abaixo. Não implementado nesta frente.
- Rate-limiting de webhooks → não incluído (risco atual baixo; reavaliar se surgir abuso).

## Bloco 1 — Observabilidade com Sentry

### Componentes

**Pacote:** `@sentry/nextjs` (v8+, compatível com Next.js 14.2 App Router).

**Arquivos de configuração** (na raiz do projeto):

| Arquivo | Papel |
|---|---|
| `instrumentation.ts` | `register()` importa `sentry.server.config` / `sentry.edge.config` conforme `NEXT_RUNTIME`; exporta `onRequestError = Sentry.captureRequestError` (captura erros de Server Components, middleware e route handlers). |
| `sentry.server.config.ts` | `Sentry.init` para runtime Node (DSN, `tracesSampleRate`: 1.0 em dev / 0.1 em prod). |
| `sentry.edge.config.ts` | `Sentry.init` para runtime Edge (middleware). |
| `sentry.client.config.ts` | `Sentry.init` do browser (erros de client components / PWA). |
| `next.config.js` | Envolver o export com `withSentryConfig(nextConfig, { org, project, silent: !process.env.CI })`. |

**Variáveis de ambiente (Vercel — Production + Development):**

| Var | Uso |
|---|---|
| `NEXT_PUBLIC_SENTRY_DSN` | DSN do projeto (client + server leem o mesmo). |
| `SENTRY_ORG` | slug da org no Sentry (upload de source maps no build). |
| `SENTRY_PROJECT` | slug do projeto. |
| `SENTRY_AUTH_TOKEN` | token para upload de source maps no build (apenas CI/build; nunca exposto ao client). |

Source maps podem ser desativados no primeiro corte se o `SENTRY_AUTH_TOKEN` não estiver pronto — a captura de erro funciona sem eles (só o stack trace fica menos legível).

### Captura por camada

- **Server Components / route handlers / middleware:** cobertos automaticamente por `onRequestError` + a instrumentação do `withSentryConfig`. Sem código manual por rota.
- **Server actions (`features/**/actions.ts`):** onde há `try/catch` que hoje só faz `console.error`, adicionar `Sentry.captureException(e)` antes/no lugar do log. Não é obrigatório envolver toda action com `withServerActionInstrumentation` nesta frente (fica como melhoria opcional); o mínimo é **não engolir exceção sem reportar**.
- **Webhooks (`app/api/webhooks/**`):** nos blocos `catch` que retornam 500, adicionar `Sentry.captureException(e)` com contexto (`action`, `orgParam`, `resourceId`). Os `console.error` de falha de API/DB do MP passam a também reportar ao Sentry.
- **Crons (`app/api/cron/**`):** hoje `monthly-credit-renewal` e `credit-backfill` **não têm try/catch** — uma exceção vira 500 opaco. Envolver o corpo de cada cron em try/catch que faz `Sentry.captureException(e)` e retorna 500 com mensagem. `waitlist-notifications` já retorna 500 em erro de DB, mas o loop por entrada não captura falha individual — reportar por iteração sem abortar o loop inteiro.

### Alerta

Após o primeiro deploy com DSN configurado: criar uma **Issue Alert** no painel do Sentry (regra "quando um novo evento de erro ocorrer" → notificar por e-mail `contatoicarosilva@outlook.com`). Documentado como passo manual pós-deploy; não é código.

### Opcional documentado — Cron Monitoring

O Sentry oferece "Cron Monitoring" (check-ins que alertam quando um job **deixou de rodar**, não só quando quebra). É valioso para os 4 crons (renovação de crédito, waitlist, backfill, refresh de token MP), mas fica fora desta frente para mantê-la enxuta. Caminho futuro: `Sentry.captureCheckIn` no início/fim de cada cron. Registrado aqui para não se perder.

## Bloco 2 — `verifyCronSecret()` timing-safe

### Problema

Os 4 crons repetem:

```ts
const authHeader = req.headers.get('authorization')
if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}
```

Comparação `!==` não é timing-safe e o trecho está duplicado em `monthly-credit-renewal`, `waitlist-notifications`, `credit-backfill`, `mp-token-refresh`.

### Solução

Novo módulo `lib/auth/cronAuth.ts` exportando uma função pura e testável:

```ts
export function isValidCronAuth(authHeader: string | null, secret: string | undefined): boolean
```

- Retorna `false` se `secret` ausente/vazio (fail-closed) ou `authHeader` ausente.
- Compara `authHeader` com `` `Bearer ${secret}` `` usando `crypto.timingSafeEqual` sobre buffers; **guarda de comprimento primeiro** (`timingSafeEqual` lança se os buffers tiverem tamanhos diferentes) — se os comprimentos diferem, retorna `false` sem comparar.

Um wrapper fino `verifyCronSecret(req: NextRequest): boolean` lê o header e o env e chama `isValidCronAuth`. Cada uma das 4 rotas troca o bloco duplicado por:

```ts
if (!verifyCronSecret(req)) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}
```

Comportamento externo idêntico (mesmo 401), só endurecido e centralizado.

## Bloco 3 — Testes e verificação

### Testes automatizados (Vitest)
- `lib/auth/cronAuth.test.ts`:
  - secret correto → `true`;
  - secret errado (mesmo comprimento) → `false`;
  - header ausente → `false`;
  - `CRON_SECRET` ausente/vazio → `false` (fail-closed);
  - comprimentos diferentes → `false` sem lançar exceção.

### Verificação manual (pós-deploy)
- `GET` num cron com `Authorization` errado → 401; com o correto → 200.
- `POST` no webhook MP com assinatura inválida e **sem** `?org=` → 401 (comportamento já existente, confirmar não regrediu).
- Disparar um erro proposital (ou usar a rota de teste do Sentry) e confirmar o evento no painel + e-mail de alerta chegando.
- Rodar `npm run build` (confirma que `withSentryConfig` compõe sem quebrar o build) e `npm run test:run -- lib/auth/cronAuth.test.ts`.

## Arquivos afetados (resumo)

| Arquivo | Ação |
|---|---|
| `package.json` | adicionar `@sentry/nextjs` |
| `instrumentation.ts` | novo |
| `sentry.server.config.ts` / `sentry.edge.config.ts` / `sentry.client.config.ts` | novos |
| `next.config.js` | envolver com `withSentryConfig` |
| `lib/auth/cronAuth.ts` | novo (helper timing-safe) |
| `lib/auth/cronAuth.test.ts` | novo (unit) |
| `app/api/cron/*/route.ts` (4) | usar `verifyCronSecret` + try/catch com `captureException` |
| `app/api/webhooks/mercadopago/route.ts` (+ handlers) | `captureException` nos catch |
| `app/api/webhooks/wellhub/route.ts` | `captureException` no catch |
| `features/**/actions.ts` (onde há catch que só loga) | `captureException` junto do log |

## Riscos e considerações

- **Build/source maps:** `withSentryConfig` roda upload de source maps no build; sem `SENTRY_AUTH_TOKEN` ele apenas pula o upload (com `silent: !CI`) — não quebra o build. Configurar o token na Vercel quando disponível.
- **Edge runtime:** `middleware.ts` roda em Edge; `sentry.edge.config.ts` cobre isso. Confirmar que a instrumentação Edge não importa nada de Node.
- **`onRequestError` é hook do Next 15:** no Next 14.2 ele não é chamado pelo framework (exportá-lo é inócuo). A captura de erro de route handlers/actions vem da auto-instrumentação aplicada pelo `withSentryConfig` + `captureException` explícito nos catch — não dependemos do `onRequestError` para o essencial nesta versão. Mantê-lo já deixa o upgrade para Next 15 pronto.
- **Custo/ruído:** `tracesSampleRate` 0.1 em prod limita volume de tracing; erros são sempre capturados. Ajustar depois se o plano gratuito apertar.
- **PWA:** `next.config.js` hoje **não** usa o wrapper do `@ducanh2912/next-pwa` (o service worker não está de fato ligado — achado da auditoria). Esta frente não mexe nisso; só adiciona `withSentryConfig`. Se a PWA for religada depois, os dois wrappers precisarão compor (`withSentryConfig(withPWA(nextConfig), ...)`).
