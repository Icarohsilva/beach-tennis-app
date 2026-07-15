# Push / PWA — Canal push + prompt de permissão + instalar app — Design

**Data:** 2026-07-15
**Contexto no programa:** feature intercalada antes da Frente 2 (BI). Completa o canal
**Push**, que foi deixado explicitamente fora da Frente 1 (Comunicação) por exigir
service worker, tabela `push_subscriptions`, VAPID e fluxo de permissão.

## Objetivo

Entregar três coisas acopladas:

1. **Canal de notificação push** funcionando de verdade (web push), como 4º canal do
   dispatch central `notifyUsers` — cobrindo automaticamente todos os eventos já
   existentes (broadcast do admin + 4 gatilhos transacionais + crédito baixo).
2. **Prompt in-app de permissão** — um card na home que alerta o usuário a ativar as
   notificações, mais um toggle liga/desliga no perfil.
3. **Botão "Instalar app"** — adicionar o app à tela inicial direto do navegador,
   funcionando em Android e iOS.

## Estado atual (auditado)

**Já existe:**
- `public/manifest.json` completo (`display: standalone`, ícones 192/512, theme color),
  linkado em `app/layout.tsx`; `appleWebApp.capable: true`.
- Dependência `@ducanh2912/next-pwa` presente no `package.json`, **porém NÃO ligada** no
  `next.config.js` → nenhum service worker é gerado hoje.
- Dispatch central `notifyUsers` (`lib/notifications/dispatch.ts`) com canais **in-app +
  e-mail** funcionando; WhatsApp presente porém desligado por decisão de negócio.
- Broadcast do admin (`features/comunidade/actions.ts` → `sendNotification`) com a UI
  mantendo o checkbox de **push desabilitado** ("push chega na próxima etapa").

**Falta (tudo desta feature):**
- Service worker, `web-push`, chaves VAPID, tabela `push_subscriptions`, canal `push` no
  dispatch, UI de permissão e botão de instalar.

## Restrição de plataforma que molda o design

- **Android / Chrome (mobile e desktop):** o evento `beforeinstallprompt` permite um
  botão "Instalar" que dispara o prompt nativo. Push funciona mesmo na aba do navegador,
  sem instalar.
- **iOS / Safari:** web push **só funciona com o app instalado** na tela inicial
  (iOS 16.4+, modo standalone). O iOS **não** expõe prompt de instalação programático — a
  instalação é manual (Compartilhar → "Adicionar à Tela de Início"). Logo, no iPhone
  "instalar" e "ativar push" ficam acoplados: instalar primeiro, pedir permissão depois.

## Decisões tomadas (via brainstorming)

- **Escopo do push:** reusar `notifyUsers` — push vira o 4º canal e cobre todos os
  eventos existentes automaticamente.
- **Prompt de permissão:** banner dispensável na home **+** toggle no perfil.
- **Botão instalar:** dentro de um **card de onboarding único** na home, que junta
  "instalar" e "ativar notificações" na ordem inteligente (iOS: instalar → push).
- **Service worker:** **mínimo, escrito à mão** (`public/sw.js`), sem ligar o next-pwa.
  Evita mexer no `next.config.js` recém-estabilizado (episódio do wizard do Sentry) e
  entrega os três pedidos com o menor risco de build. Sem cache offline (YAGNI).

## Arquitetura

### Banco de dados

Nova tabela `push_subscriptions`:

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | uuid PK default `gen_random_uuid()` | |
| `user_id` | uuid → `profiles(id)` on delete cascade | dono da inscrição |
| `organization_id` | uuid → `organizations(id)` | escopo multi-tenant (broadcast filtra por org) |
| `endpoint` | text **unique** | URL do push service (identifica a inscrição) |
| `p256dh` | text | chave pública do client (do `PushSubscription`) |
| `auth` | text | segredo de auth do client |
| `user_agent` | text null | diagnóstico |
| `created_at` | timestamptz default now() | |

- **RLS:** `authenticated` só enxerga/insere/apaga linhas com `user_id = auth.uid()`;
  `service_role` full (o dispatch envia via admin client). `anon` sem acesso.
- **`organization_id`:** preenchido explicitamente pela server action a partir de
  `getActiveOrgId()` (mesmo padrão de `posts`/`post_likes`), não por trigger.
- Índice em `(user_id)` e em `(organization_id)` para as buscas do dispatch/broadcast.

### VAPID / web-push

- Env vars:
  - `NEXT_PUBLIC_VAPID_PUBLIC_KEY` — pública, exposta no client (necessária para inscrever).
  - `VAPID_PRIVATE_KEY` — server-only.
  - `VAPID_SUBJECT` — `mailto:contato@arenahub.website` (exigido pelo protocolo).
- Geradas uma vez (`web-push generate-vapid-keys`). A privada **nunca** é impressa/ecoada;
  vai direto para os envs da Vercel (Production + Development) pelo usuário.
- **Fail-closed:** sem as chaves, `sendPush` faz no-op + `console.log` (idêntico ao
  `sendEmail`/`sendWhatsApp`). Nada quebra em dev local sem VAPID.

### Service worker (`public/sw.js`)

Arquivo estático mínimo, registrado pelo client:
- `install`/`activate`: `skipWaiting()` + `clients.claim()`.
- `push`: parseia o payload JSON e chama
  `self.registration.showNotification(title, { body, icon, badge, data: { url } })`.
- `notificationclick`: fecha a notificação e foca uma aba existente do app ou abre a
  `data.url`.
- `fetch`: handler **no-op** (repassa `fetch(event.request)`) — só para satisfazer o
  critério de instalabilidade do Chrome. Sem estratégia de cache.

### Dispatch — novo canal `push`

Em `lib/notifications/dispatch.ts`, `notifyUsers` ganha o canal `'push'`:
- Quando `'push'` está nos canais, busca as `push_subscriptions` dos `userIds`
  destinatários (via admin client).
- Para cada inscrição: `sendPush({ subscription, title, body, url })` dentro de
  try/catch. Falha por inscrição → `Sentry.captureException` (tags
  `{ channel: 'push' }`), **nunca propaga** (o in-app continua sendo o único canal que
  pode lançar).
- **Poda de inscrições mortas:** se `sendPush` sinalizar `expired` (status 404/410 do
  push service), o dispatch apaga aquela linha de `push_subscriptions`.
- `url` default `/home`; eventos podem passar deep-links (ex.: `/agenda`) no futuro
  (fora de escopo agora — todos usam `/home`).

### Módulo server `lib/notifications/push.ts`

- `sendPush({ subscription, title, body, url }): Promise<'ok' | 'expired' | 'skipped'>`
  - Sem VAPID → retorna `'skipped'` (no-op + log).
  - Chama `webpush.sendNotification(subscription, JSON.stringify({ title, body, url }))`.
  - Erro com `statusCode` 404 ou 410 → retorna `'expired'` (para o dispatch podar).
  - Outros erros → relança `Error` (o dispatch isola em try/catch e manda pro Sentry).

### Server actions `features/notifications/pushActions.ts`

- `savePushSubscription(sub)` — upsert por `endpoint` (idempotente ao reinscrever);
  grava `user_id` do usuário autenticado + `organization_id` de `getActiveOrgId()`.
- `deletePushSubscription(endpoint)` — apaga a inscrição do usuário (toggle off).

### Client `lib/pwa/pushClient.ts`

- `registerServiceWorker()` — `navigator.serviceWorker.register('/sw.js')`.
- `subscribeToPush()` — pede permissão, `pushManager.subscribe({ userVisibleOnly: true,
  applicationServerKey: <VAPID public> })`, serializa e chama `savePushSubscription`.
- `unsubscribeFromPush()` — `subscription.unsubscribe()` + `deletePushSubscription`.
- Guarda de suporte: se `!('serviceWorker' in navigator)` ou `!('PushManager' in window)`,
  reporta "não suportado" (o card se adapta).

### Estado puro `lib/pwa/onboardingState.ts`

Função pura, 100% testável, que decide o que o card mostra:

```ts
type OnboardingInput = {
  permission: NotificationPermission // 'default' | 'granted' | 'denied'
  standalone: boolean                // app instalado / rodando standalone
  isIOS: boolean
  installable: boolean               // beforeinstallprompt capturado (Android/desktop)
  pushSupported: boolean
}
type OnboardingStep =
  | 'hidden'            // nada a fazer (já ativo, ou não suportado sem saída)
  | 'ios-install-first'// iOS não instalado → instruções de A2HS
  | 'install'          // Android/desktop instalável → botão instalar nativo
  | 'enable-push'      // pode pedir permissão agora → botão ativar
  | 'push-blocked'     // permission === 'denied' → orientar a reabrir nas config. do navegador

function resolveOnboardingStep(input: OnboardingInput): OnboardingStep
```

Regras:
- `!pushSupported && !installable` → `hidden`.
- `permission === 'granted'` e (standalone ou desktop) → `hidden`.
- `permission === 'denied'` → `push-blocked`.
- `isIOS && !standalone` → `ios-install-first`.
- `installable && !standalone` → `install`.
- caso contrário → `enable-push`.

### Componentes UI

- `components/pwa/InstallPromptProvider.tsx` — client provider que captura o evento
  `beforeinstallprompt` (guarda o `deferredPrompt`) e expõe `installable` + `promptInstall()`.
- `components/pwa/PushOnboardingCard.tsx` — card na `/home`:
  - Lê estado (permission, standalone via `matchMedia('(display-mode: standalone)')` +
    `navigator.standalone`, isIOS via UA, installable do provider).
  - Renderiza conforme `resolveOnboardingStep`.
  - `ios-install-first` → texto + ícone ilustrando Compartilhar → "Adicionar à Tela de Início".
  - `install` → botão que chama `promptInstall()`.
  - `enable-push` → botão que chama `subscribeToPush()`.
  - `push-blocked` → orientação para reabilitar nas configurações do navegador.
  - Botão "Agora não" grava dispensa em `localStorage` (`pwa-onboarding-dismissed`);
    o toggle no perfil é o ponto de reentrada permanente.
- Toggle no perfil — switch "Notificações": ligado = inscrito; desligar chama
  `unsubscribeFromPush()`. Reflete o estado real da permissão.

### Broadcast do admin

- `features/comunidade/actions.ts` → `sendNotification`: incluir `'push'` em
  `notifyChannels` quando `channels.includes('push')`.
- UI do broadcast: **reabilitar** o checkbox "push" (hoje desabilitado).

## Resiliência / erros

- Push é best-effort e **nunca** bloqueia o in-app (mesmo modelo de e-mail/WhatsApp).
- Sem VAPID → `sendPush` no-op. Inscrição morta (404/410) → apagada pelo dispatch.
- Falha por destinatário → `Sentry.captureException`, isolada.
- Erro ao inscrever no client → mensagem no card ("não foi possível ativar as
  notificações"), sem quebrar a home.

## Testes

**Unitários (Vitest):**
- `lib/pwa/onboardingState.test.ts` — matriz de `resolveOnboardingStep` cobrindo cada
  ramo (iOS não instalado, Android instalável, granted, denied, não suportado).
- `lib/notifications/push.test.ts` — `sendPush` com `web-push` mockado: sucesso → `ok`;
  404/410 → `expired`; sem VAPID → `skipped`; outro erro → lança.
- `lib/notifications/dispatch.test.ts` (ou extensão do existente) — canal push: itera
  inscrições, poda mortas, isola falha, não propaga.

**Manual em produção** (como validamos e-mail e Sentry): instalar em Android e iOS,
ativar permissão, disparar um broadcast com push marcado, confirmar chegada com o app
fechado; conferir no Sentry se falhas de envio aparecem.

## Passos manuais (usuário, na Vercel)

1. Gerar as chaves VAPID (assistente gera; a privada não é impressa).
2. Adicionar na Vercel (Production + Development): `NEXT_PUBLIC_VAPID_PUBLIC_KEY`,
   `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.
3. Aplicar a migration `push_subscriptions` no SQL Editor.

## Fora de escopo (YAGNI)

- **Cache offline / PWA completo** — o SW é só para push + instalabilidade.
- **Preferência de canal por evento** (opt-out granular) — o toggle é global (liga/desliga
  push do dispositivo).
- **Deep-links por evento** — todos os pushes abrem `/home` por ora.
- **Eventos push voltados ao admin** (ex.: "novo aluno", "pagamento recebido") — não há
  evento admin-facing hoje; não criar agora.
- **Ligar o next-pwa / cache** — frente futura, se offline virar objetivo.

## Arquivos

**Novos:**
- `supabase/migrations/<timestamp>_push_subscriptions.sql`
- `public/sw.js`
- `lib/notifications/push.ts`
- `lib/pwa/pushClient.ts`
- `lib/pwa/onboardingState.ts` (+ `.test.ts`)
- `features/notifications/pushActions.ts`
- `components/pwa/InstallPromptProvider.tsx`
- `components/pwa/PushOnboardingCard.tsx`
- toggle de notificações no perfil (componente client)

**Modificados:**
- `lib/notifications/dispatch.ts` — canal `push` + poda de inscrições mortas
- `features/comunidade/actions.ts` — `sendNotification` inclui push
- UI do broadcast — reabilita o checkbox push
- `app/(dashboard)/home/page.tsx` — monta `PushOnboardingCard`
- página de perfil — monta o toggle
- `package.json` — adiciona `web-push` (+ `@types/web-push`)
- `.env.example` — placeholders VAPID (linhas novas vazias)
