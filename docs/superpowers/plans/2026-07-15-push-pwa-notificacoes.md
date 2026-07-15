# Push / PWA — Notificações push + permissão + instalar app — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar o canal de notificação **push** (web push) como 4º canal do dispatch central, mais um card de onboarding na home (instalar o app + ativar notificações) e um toggle no perfil, funcionando em Android e iOS.

**Architecture:** Service worker mínimo escrito à mão (`public/sw.js`, sem next-pwa) recebe os pushes; `web-push` envia do servidor autenticado por chaves VAPID; o dispatch `notifyUsers` ganha o canal `'push'` que busca `push_subscriptions` dos destinatários, envia best-effort e poda inscrições mortas. A UI decide o que mostrar por uma função pura testável (`resolveOnboardingStep`).

**Tech Stack:** Next.js 14 App Router, TypeScript, Supabase (RLS), `web-push`, Web Push API / Service Worker, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-15-push-pwa-notificacoes-design.md`

---

## Estrutura de arquivos

**Novos:**
- `lib/pwa/onboardingState.ts` (+ `.test.ts`) — função pura que decide o passo do card.
- `lib/pwa/pushEncoding.ts` (+ `.test.ts`) — `urlBase64ToUint8Array` (pura, testável isolada).
- `lib/pwa/pushClient.ts` — helpers de client (registrar SW, inscrever/desinscrever).
- `lib/notifications/push.ts` (+ `.test.ts`) — `sendPush` (web-push, fail-closed).
- `features/notifications/pushActions.ts` — server actions save/delete subscription.
- `supabase/migrations/20260715000100_push_subscriptions.sql` — tabela + RLS.
- `public/sw.js` — service worker mínimo.
- `components/pwa/PushOnboardingCard.tsx` — card na home.
- `features/perfil/NotificationToggle.tsx` — toggle no perfil.

**Modificados:**
- `lib/notifications/dispatch.ts` — canal `push` + poda (+ `.test.ts` novo).
- `features/comunidade/actions.ts` — `sendNotification` inclui `push`.
- `app/(admin)/admin/notificacoes/NotificacoesClient.tsx` — reabilita o botão push.
- `app/(dashboard)/home/page.tsx` — monta `PushOnboardingCard`.
- `app/(dashboard)/perfil/page.tsx` — monta `NotificationToggle`.
- `package.json` — `web-push` + `@types/web-push`.
- `.env.example` — placeholders VAPID.

**Nota de simplificação vs. spec:** o `InstallPromptProvider` da spec é dobrado dentro do `PushOnboardingCard` (o card escuta `beforeinstallprompt` diretamente). `/home` é o `start_url` do manifest, então o card é montado onde o evento naturalmente dispara — evita um provider extra no layout.

---

### Task 1: Dependência web-push + placeholders VAPID

**Files:**
- Modify: `package.json`
- Modify: `.env.example`

- [ ] **Step 1: Instalar web-push**

Run: `npm install web-push@^3.6.7 && npm install -D @types/web-push@^3.6.4`
Expected: `package.json` passa a listar `web-push` em dependencies e `@types/web-push` em devDependencies; `npm install` termina sem erro.

- [ ] **Step 2: Adicionar placeholders VAPID ao `.env.example`**

Acrescente ao final de `.env.example` (linhas novas, sem tocar nas chaves reais já existentes):

```
# Web Push (VAPID) — gerar com: npx web-push generate-vapid-keys
# A pública pode ir ao client; a privada é server-only e NUNCA vai ao repositório.
NEXT_PUBLIC_VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=
```

- [ ] **Step 3: Verificar build de tipos**

Run: `npx tsc --noEmit`
Expected: sem novos erros relacionados a `web-push` (erros pré-existentes em arquivos `*.test.ts` de `types/`, `lib/branding`, `lib/torneios/schedule` são conhecidos e não contam).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json .env.example
git commit -m "chore(push): adiciona web-push e placeholders VAPID"
```

---

### Task 2: Função pura `resolveOnboardingStep`

**Files:**
- Create: `lib/pwa/onboardingState.ts`
- Test: `lib/pwa/onboardingState.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Crie `lib/pwa/onboardingState.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { resolveOnboardingStep } from './onboardingState'

const base = {
  permission: 'default' as NotificationPermission,
  standalone: false,
  isIOS: false,
  installable: false,
  pushSupported: true,
}

describe('resolveOnboardingStep', () => {
  it('iOS não instalado → instalar primeiro', () => {
    expect(resolveOnboardingStep({ ...base, isIOS: true, pushSupported: false })).toBe('ios-install-first')
  })

  it('iOS instalado, permissão pendente → pedir permissão', () => {
    expect(resolveOnboardingStep({ ...base, isIOS: true, standalone: true })).toBe('enable-push')
  })

  it('iOS instalado, permissão concedida → escondido', () => {
    expect(resolveOnboardingStep({ ...base, isIOS: true, standalone: true, permission: 'granted' })).toBe('hidden')
  })

  it('Android instalável → oferecer instalação', () => {
    expect(resolveOnboardingStep({ ...base, installable: true })).toBe('install')
  })

  it('Android não instalável, permissão pendente → pedir permissão', () => {
    expect(resolveOnboardingStep({ ...base })).toBe('enable-push')
  })

  it('permissão negada → bloqueado', () => {
    expect(resolveOnboardingStep({ ...base, permission: 'denied' })).toBe('push-blocked')
  })

  it('desktop com permissão concedida e sem instalação → escondido', () => {
    expect(resolveOnboardingStep({ ...base, permission: 'granted' })).toBe('hidden')
  })

  it('nada suportado nem instalável → escondido', () => {
    expect(resolveOnboardingStep({ ...base, pushSupported: false })).toBe('hidden')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:run -- lib/pwa/onboardingState.test.ts`
Expected: FAIL — `Cannot find module './onboardingState'`.

- [ ] **Step 3: Implementar**

Crie `lib/pwa/onboardingState.ts`:

```ts
// lib/pwa/onboardingState.ts
// Decide, de forma pura e testável, o que o card de onboarding deve mostrar.
export type OnboardingInput = {
  permission: NotificationPermission // 'default' | 'granted' | 'denied'
  standalone: boolean                // app instalado / rodando em modo standalone
  isIOS: boolean
  installable: boolean               // beforeinstallprompt capturado (Android/desktop)
  pushSupported: boolean
}

export type OnboardingStep =
  | 'hidden'
  | 'ios-install-first'
  | 'install'
  | 'enable-push'
  | 'push-blocked'

export function resolveOnboardingStep(input: OnboardingInput): OnboardingStep {
  const { permission, standalone, isIOS, installable, pushSupported } = input

  // Nada a oferecer: sem push, sem instalação e não é iOS-por-instalar.
  if (!pushSupported && !installable && !(isIOS && !standalone)) return 'hidden'

  // Já concedeu e não há instalação pendente relevante → nada a fazer.
  if (permission === 'granted' && (standalone || (!isIOS && !installable))) return 'hidden'

  // Bloqueado no nível do navegador → orientar a reabrir nas configurações.
  if (permission === 'denied') return 'push-blocked'

  // iOS só recebe push depois de instalado na tela inicial.
  if (isIOS && !standalone) return 'ios-install-first'

  // Android/desktop instalável → oferecer o prompt nativo.
  if (installable && !standalone) return 'install'

  // Pode pedir a permissão agora.
  return 'enable-push'
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:run -- lib/pwa/onboardingState.test.ts`
Expected: PASS (8 testes).

- [ ] **Step 5: Commit**

```bash
git add lib/pwa/onboardingState.ts lib/pwa/onboardingState.test.ts
git commit -m "feat(push): resolveOnboardingStep (estado do card de onboarding)"
```

---

### Task 3: Codificação base64url (`urlBase64ToUint8Array`)

**Files:**
- Create: `lib/pwa/pushEncoding.ts`
- Test: `lib/pwa/pushEncoding.test.ts`

> Módulo puro separado do `pushClient.ts` para poder testar sem arrastar código server-only.

- [ ] **Step 1: Escrever o teste que falha**

Crie `lib/pwa/pushEncoding.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { urlBase64ToUint8Array } from './pushEncoding'

describe('urlBase64ToUint8Array', () => {
  it('decodifica base64url para os bytes corretos', () => {
    // "Hello" em base64 padrão é "SGVsbG8=" → base64url sem padding "SGVsbG8"
    const out = urlBase64ToUint8Array('SGVsbG8')
    expect(Array.from(out)).toEqual([72, 101, 108, 108, 111])
  })

  it('trata os caracteres url-safe - e _', () => {
    // bytes [255, 255] → base64 "//8=" → base64url "__8"
    const out = urlBase64ToUint8Array('__8')
    expect(Array.from(out)).toEqual([255, 255])
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:run -- lib/pwa/pushEncoding.test.ts`
Expected: FAIL — `Cannot find module './pushEncoding'`.

- [ ] **Step 3: Implementar**

Crie `lib/pwa/pushEncoding.ts`:

```ts
// lib/pwa/pushEncoding.ts
// Converte a chave pública VAPID (base64url) em Uint8Array, formato exigido por
// PushManager.subscribe({ applicationServerKey }). Função pura.
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const output = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i)
  return output
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:run -- lib/pwa/pushEncoding.test.ts`
Expected: PASS (2 testes).

- [ ] **Step 5: Commit**

```bash
git add lib/pwa/pushEncoding.ts lib/pwa/pushEncoding.test.ts
git commit -m "feat(push): urlBase64ToUint8Array para a chave VAPID"
```

---

### Task 4: Módulo server `sendPush`

**Files:**
- Create: `lib/notifications/push.ts`
- Test: `lib/notifications/push.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Crie `lib/notifications/push.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const setVapidDetails = vi.fn()
const sendNotification = vi.fn()

vi.mock('web-push', () => ({
  default: {
    setVapidDetails: (...args: unknown[]) => setVapidDetails(...args),
    sendNotification: (...args: unknown[]) => sendNotification(...args),
  },
}))

import { sendPush } from './push'

const subscription = { endpoint: 'https://push.example/abc', p256dh: 'p256', auth: 'authk' }

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = 'pub'
  process.env.VAPID_PRIVATE_KEY = 'priv'
  process.env.VAPID_SUBJECT = 'mailto:x@y.com'
})

describe('sendPush', () => {
  it('retorna skipped quando faltam chaves VAPID', async () => {
    delete process.env.VAPID_PRIVATE_KEY
    const r = await sendPush({ subscription, title: 't', body: 'b' })
    expect(r).toBe('skipped')
    expect(sendNotification).not.toHaveBeenCalled()
  })

  it('retorna ok no sucesso', async () => {
    sendNotification.mockResolvedValue(undefined)
    const r = await sendPush({ subscription, title: 't', body: 'b' })
    expect(r).toBe('ok')
    expect(sendNotification).toHaveBeenCalledTimes(1)
  })

  it('retorna expired quando o serviço responde 410', async () => {
    sendNotification.mockRejectedValue(Object.assign(new Error('gone'), { statusCode: 410 }))
    const r = await sendPush({ subscription, title: 't', body: 'b' })
    expect(r).toBe('expired')
  })

  it('retorna expired quando o serviço responde 404', async () => {
    sendNotification.mockRejectedValue(Object.assign(new Error('not found'), { statusCode: 404 }))
    const r = await sendPush({ subscription, title: 't', body: 'b' })
    expect(r).toBe('expired')
  })

  it('relança em outros erros', async () => {
    sendNotification.mockRejectedValue(Object.assign(new Error('boom'), { statusCode: 500 }))
    await expect(sendPush({ subscription, title: 't', body: 'b' })).rejects.toThrow('boom')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:run -- lib/notifications/push.test.ts`
Expected: FAIL — `Cannot find module './push'`.

- [ ] **Step 3: Implementar**

Crie `lib/notifications/push.ts`:

```ts
// lib/notifications/push.ts
// Envio de Web Push via web-push. I/O puro: recebe uma inscrição + mensagem.
// Fail-closed sem chaves VAPID (log + no-op). Erros 404/410 viram 'expired'
// para o dispatch podar a inscrição; outros erros relançam (o dispatch isola).
import webpush from 'web-push'

export interface PushSubscriptionData {
  endpoint: string
  p256dh: string
  auth: string
}

export interface SendPushParams {
  subscription: PushSubscriptionData
  title: string
  body: string
  url?: string
}

export type SendPushResult = 'ok' | 'expired' | 'skipped'

let configured = false

function ensureConfigured(): boolean {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT
  if (!publicKey || !privateKey || !subject) return false
  if (!configured) {
    webpush.setVapidDetails(subject, publicKey, privateKey)
    configured = true
  }
  return true
}

export async function sendPush({ subscription, title, body, url }: SendPushParams): Promise<SendPushResult> {
  if (!ensureConfigured()) {
    console.log('[push] chaves VAPID ausentes — envio ignorado', {
      endpoint: subscription.endpoint.slice(0, 40),
    })
    return 'skipped'
  }

  const payload = JSON.stringify({ title, body, url: url ?? '/home' })

  try {
    await webpush.sendNotification(
      { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
      payload,
    )
    return 'ok'
  } catch (err) {
    const statusCode = (err as { statusCode?: number }).statusCode
    if (statusCode === 404 || statusCode === 410) return 'expired'
    throw err
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:run -- lib/notifications/push.test.ts`
Expected: PASS (5 testes).

- [ ] **Step 5: Commit**

```bash
git add lib/notifications/push.ts lib/notifications/push.test.ts
git commit -m "feat(push): sendPush via web-push (fail-closed, poda em 404/410)"
```

---

### Task 5: Migration `push_subscriptions`

**Files:**
- Create: `supabase/migrations/20260715000100_push_subscriptions.sql`

- [ ] **Step 1: Criar a migration**

Crie `supabase/migrations/20260715000100_push_subscriptions.sql`:

```sql
-- supabase/migrations/20260715000100_push_subscriptions.sql

-- Inscrições Web Push (uma por dispositivo/navegador). O dispatch central
-- (createAdminClient / service_role) lê para enviar; cada usuário gerencia só
-- as próprias via RLS. organization_id dá escopo multi-tenant ao broadcast.
create table if not exists push_subscriptions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references profiles(id) on delete cascade,
  organization_id uuid references organizations(id) on delete set null,
  endpoint        text not null unique,
  p256dh          text not null,
  auth            text not null,
  user_agent      text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_push_subscriptions_user on push_subscriptions(user_id);
create index if not exists idx_push_subscriptions_org on push_subscriptions(organization_id);

alter table push_subscriptions enable row level security;

-- Usuário lê as próprias inscrições.
drop policy if exists "push_subscriptions_select_own" on push_subscriptions;
create policy "push_subscriptions_select_own" on push_subscriptions
  for select to authenticated
  using (user_id = auth.uid());

-- Usuário insere a própria inscrição.
drop policy if exists "push_subscriptions_insert_own" on push_subscriptions;
create policy "push_subscriptions_insert_own" on push_subscriptions
  for insert to authenticated
  with check (user_id = auth.uid());

-- Usuário apaga as próprias inscrições.
drop policy if exists "push_subscriptions_delete_own" on push_subscriptions;
create policy "push_subscriptions_delete_own" on push_subscriptions
  for delete to authenticated
  using (user_id = auth.uid());
```

- [ ] **Step 2: Verificar sintaxe localmente (opcional, sem DB)**

A migration é aplicada em produção pelo usuário no SQL Editor (o CLI `supabase db push` está dessincronizado — ver memória). Não há passo automatizado aqui. Confira visualmente: PK `gen_random_uuid()`, `endpoint` UNIQUE, 3 policies scoped por `auth.uid()`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260715000100_push_subscriptions.sql
git commit -m "feat(push): migration push_subscriptions (tabela + RLS por usuário)"
```

---

### Task 6: Canal `push` no dispatch central

**Files:**
- Modify: `lib/notifications/dispatch.ts`
- Test: `lib/notifications/dispatch.test.ts` (novo)

- [ ] **Step 1: Escrever o teste que falha**

Crie `lib/notifications/dispatch.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const sendPushMock = vi.fn()
vi.mock('./push', () => ({ sendPush: (...a: unknown[]) => sendPushMock(...a) }))
vi.mock('./email', () => ({ sendEmail: vi.fn() }))
vi.mock('./whatsapp', () => ({ sendWhatsApp: vi.fn() }))
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))

import { notifyUsers } from './dispatch'
import * as Sentry from '@sentry/nextjs'

// Mock mínimo do admin client: registra deletes e devolve as subs no select().in().
function makeClient(subs: Array<{ user_id: string; endpoint: string; p256dh: string; auth: string }>) {
  const deleted: string[] = []
  const client = {
    from() {
      return {
        insert: () => ({ error: null }),
        select: () => ({
          in: async () => ({ data: subs, error: null }),
        }),
        delete: () => ({
          eq: async (_col: string, val: string) => {
            deleted.push(val)
            return { error: null }
          },
        }),
      }
    },
    deleted,
  }
  return client
}

const sub = { user_id: 'u1', endpoint: 'https://push/1', p256dh: 'p', auth: 'a' }

beforeEach(() => vi.clearAllMocks())

describe('notifyUsers — canal push', () => {
  it('envia push para as inscrições dos destinatários', async () => {
    sendPushMock.mockResolvedValue('ok')
    const client = makeClient([sub])
    await notifyUsers(client as never, {
      orgId: 'org1',
      recipients: [{ userId: 'u1' }],
      type: 'admin_message',
      title: 't',
      body: 'b',
      channels: ['push'],
    })
    expect(sendPushMock).toHaveBeenCalledTimes(1)
    expect(client.deleted).toHaveLength(0)
  })

  it('poda a inscrição quando sendPush retorna expired', async () => {
    sendPushMock.mockResolvedValue('expired')
    const client = makeClient([sub])
    await notifyUsers(client as never, {
      orgId: 'org1',
      recipients: [{ userId: 'u1' }],
      type: 'admin_message',
      title: 't',
      body: 'b',
      channels: ['push'],
    })
    expect(client.deleted).toEqual(['https://push/1'])
  })

  it('isola falha de envio no Sentry sem propagar', async () => {
    sendPushMock.mockRejectedValue(new Error('boom'))
    const client = makeClient([sub])
    await expect(
      notifyUsers(client as never, {
        orgId: 'org1',
        recipients: [{ userId: 'u1' }],
        type: 'admin_message',
        title: 't',
        body: 'b',
        channels: ['push'],
      }),
    ).resolves.toBeUndefined()
    expect(Sentry.captureException).toHaveBeenCalledTimes(1)
  })

  it('não busca push quando o canal não está incluído', async () => {
    const client = makeClient([sub])
    await notifyUsers(client as never, {
      orgId: 'org1',
      recipients: [{ userId: 'u1' }],
      type: 'admin_message',
      title: 't',
      body: 'b',
      channels: ['inapp'],
    })
    expect(sendPushMock).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:run -- lib/notifications/dispatch.test.ts`
Expected: FAIL — `push` não é um canal aceito / o bloco de push ainda não existe (o teste de `expired` falha porque nada é deletado).

- [ ] **Step 3: Implementar as mudanças no dispatch**

Em `lib/notifications/dispatch.ts`:

3a. Adicione o import de `sendPush` logo após o import de `sendWhatsApp` (linha 9):

```ts
import { sendWhatsApp } from './whatsapp'
import { sendPush } from './push'
```

3b. Inclua `'push'` na union `NotificationChannel` (linha 20):

```ts
export type NotificationChannel = 'inapp' | 'email' | 'whatsapp' | 'push'
```

3c. Adicione o bloco de push ao final do corpo de `notifyUsers`, logo depois do bloco `if (channels.includes('whatsapp')) { ... }` e antes do fechamento da função:

```ts
  if (channels.includes('push')) {
    const userIds = recipients.map((r) => r.userId)
    const { data: subs } = await client
      .from('push_subscriptions')
      .select('user_id, endpoint, p256dh, auth')
      .in('user_id', userIds)

    for (const s of (subs ?? []) as {
      user_id: string
      endpoint: string
      p256dh: string
      auth: string
    }[]) {
      try {
        const result = await sendPush({
          subscription: { endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth },
          title,
          body,
        })
        if (result === 'expired') {
          await client.from('push_subscriptions').delete().eq('endpoint', s.endpoint)
        }
      } catch (err) {
        Sentry.captureException(err, {
          tags: { channel: 'push', notificationType: type },
          extra: { orgId, userId: s.user_id },
        })
      }
    }
  }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:run -- lib/notifications/dispatch.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add lib/notifications/dispatch.ts lib/notifications/dispatch.test.ts
git commit -m "feat(push): canal push no notifyUsers (best-effort + poda de mortas)"
```

---

### Task 7: Server actions de inscrição

**Files:**
- Create: `features/notifications/pushActions.ts`

> I/O puro (Supabase); sem teste unitário, igual a `email.ts`/`whatsapp.ts`. Validado no teste manual.

- [ ] **Step 1: Implementar as actions**

Crie `features/notifications/pushActions.ts`:

```ts
'use server'
// features/notifications/pushActions.ts
// Salva/remove a inscrição de push do usuário autenticado. Usa createClient
// (contexto do usuário) — a RLS garante que ninguém mexa em inscrição alheia.
import { createClient, getActiveOrgId } from '@/lib/supabase/server'

export interface BrowserPushSubscription {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

export async function savePushSubscription(
  sub: BrowserPushSubscription,
): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const orgId = await getActiveOrgId()

  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      user_id: user.id,
      organization_id: orgId,
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
    },
    { onConflict: 'endpoint' },
  )

  if (error) return { error: 'Não foi possível salvar a inscrição de notificações.' }
  return {}
}

export async function deletePushSubscription(endpoint: string): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint)
  if (error) return { error: 'Não foi possível remover a inscrição.' }
  return {}
}
```

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem novos erros (ignorar os `*.test.ts` pré-existentes conhecidos).

- [ ] **Step 3: Commit**

```bash
git add features/notifications/pushActions.ts
git commit -m "feat(push): server actions save/deletePushSubscription"
```

---

### Task 8: Service worker

**Files:**
- Create: `public/sw.js`

- [ ] **Step 1: Criar o service worker**

Crie `public/sw.js`:

```js
// public/sw.js — service worker mínimo: push + clique + instalabilidade.
// Sem cache offline (fora de escopo). O handler de fetch é no-op só para
// satisfazer o critério de instalabilidade do Chrome.
self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch (e) {
    data = {}
  }
  const title = data.title || 'ArenaHub'
  const options = {
    body: data.body || '',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-192x192.png',
    data: { url: data.url || '/home' },
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/home'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsList) => {
      for (const client of clientsList) {
        if ('focus' in client) {
          client.navigate(url)
          return client.focus()
        }
      }
      return self.clients.openWindow(url)
    }),
  )
})

// No-op: presença do handler de fetch habilita o beforeinstallprompt no Chrome.
self.addEventListener('fetch', () => {})
```

- [ ] **Step 2: Commit**

```bash
git add public/sw.js
git commit -m "feat(push): service worker mínimo (push + click + instalabilidade)"
```

---

### Task 9: Helpers de client (`pushClient.ts`)

**Files:**
- Create: `lib/pwa/pushClient.ts`

> Depende de `pushEncoding.ts` (Task 3) e das actions (Task 7). Sem teste unitário (APIs de browser); a lógica pura já está coberta.

- [ ] **Step 1: Implementar**

Crie `lib/pwa/pushClient.ts`:

```ts
// lib/pwa/pushClient.ts
// Helpers de client: registra o SW, inscreve/desinscreve no push e sincroniza
// com o servidor via server actions.
import { savePushSubscription, deletePushSubscription } from '@/features/notifications/pushActions'
import { urlBase64ToUint8Array } from './pushEncoding'

export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register('/sw.js')
}

export async function subscribeToPush(): Promise<{ error?: string }> {
  if (!isPushSupported()) {
    return { error: 'Notificações não são suportadas neste dispositivo.' }
  }
  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  if (!vapidKey) return { error: 'Notificações indisponíveis no momento.' }

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return { error: 'Permissão de notificação negada.' }

  const reg = await registerServiceWorker()
  const existing = await reg.pushManager.getSubscription()
  const sub =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey),
    }))

  const json = sub.toJSON()
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    return { error: 'Inscrição de notificações inválida.' }
  }

  return savePushSubscription({
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
  })
}

export async function unsubscribeFromPush(): Promise<{ error?: string }> {
  if (!isPushSupported()) return {}
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  if (!sub) return {}
  const endpoint = sub.endpoint
  await sub.unsubscribe()
  return deletePushSubscription(endpoint)
}
```

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem novos erros.

- [ ] **Step 3: Commit**

```bash
git add lib/pwa/pushClient.ts
git commit -m "feat(push): pushClient (registra SW, inscreve/desinscreve)"
```

---

### Task 10: Card de onboarding na home

**Files:**
- Create: `components/pwa/PushOnboardingCard.tsx`
- Modify: `app/(dashboard)/home/page.tsx`

- [ ] **Step 1: Implementar o card**

Crie `components/pwa/PushOnboardingCard.tsx`:

```tsx
'use client'
// components/pwa/PushOnboardingCard.tsx
// Card de onboarding na home: instalar o app e/ou ativar notificações, na ordem
// certa por plataforma. A decisão do que mostrar vem de resolveOnboardingStep.
import { useEffect, useState } from 'react'
import { Bell, Download, Share, X } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { resolveOnboardingStep, type OnboardingStep } from '@/lib/pwa/onboardingState'
import { isPushSupported, subscribeToPush } from '@/lib/pwa/pushClient'

const DISMISS_KEY = 'pwa-onboarding-dismissed'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function detectIsIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
}

function detectStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const mql = window.matchMedia('(display-mode: standalone)').matches
  const iosStandalone = (navigator as unknown as { standalone?: boolean }).standalone === true
  return mql || iosStandalone
}

export function PushOnboardingCard() {
  const [step, setStep] = useState<OnboardingStep>('hidden')
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  // Recalcula o passo a partir do estado atual do ambiente.
  function recompute(installable: boolean) {
    if (typeof window === 'undefined') return
    if (localStorage.getItem(DISMISS_KEY) === '1') {
      setStep('hidden')
      return
    }
    const permission = 'Notification' in window ? Notification.permission : 'denied'
    setStep(
      resolveOnboardingStep({
        permission,
        standalone: detectStandalone(),
        isIOS: detectIsIOS(),
        installable,
        pushSupported: isPushSupported(),
      }),
    )
  }

  useEffect(() => {
    recompute(false)
    const onBeforeInstall = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
      recompute(true)
    }
    const onInstalled = () => {
      setDeferredPrompt(null)
      recompute(false)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleInstall() {
    if (!deferredPrompt) return
    setBusy(true)
    await deferredPrompt.prompt()
    await deferredPrompt.userChoice
    setDeferredPrompt(null)
    setBusy(false)
    recompute(false)
  }

  async function handleEnablePush() {
    setBusy(true)
    setMsg(null)
    const res = await subscribeToPush()
    setBusy(false)
    if (res.error) {
      setMsg(res.error)
    } else {
      recompute(false)
    }
  }

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, '1')
    setStep('hidden')
  }

  if (step === 'hidden') return null

  return (
    <Card className="relative border-brand-600/40 bg-brand-600/5">
      <button
        onClick={dismiss}
        aria-label="Dispensar"
        className="absolute right-3 top-3 text-slate-500 hover:text-white transition-colors"
      >
        <X size={16} />
      </button>

      {step === 'ios-install-first' && (
        <div className="pr-6">
          <div className="flex items-center gap-2 mb-1">
            <Share size={18} className="text-brand-500" />
            <p className="text-sm font-semibold text-white">Instale o app para receber avisos</p>
          </div>
          <p className="text-xs text-slate-400">
            Toque em <strong>Compartilhar</strong> e depois em{' '}
            <strong>&ldquo;Adicionar à Tela de Início&rdquo;</strong>. Abra o app pela tela inicial
            e ative as notificações por aqui.
          </p>
        </div>
      )}

      {step === 'install' && (
        <div className="pr-6">
          <div className="flex items-center gap-2 mb-2">
            <Download size={18} className="text-brand-500" />
            <p className="text-sm font-semibold text-white">Instale o app no seu celular</p>
          </div>
          <p className="text-xs text-slate-400 mb-3">
            Adicione o ArenaHub à tela inicial para abrir com um toque e receber notificações.
          </p>
          <Button onClick={handleInstall} loading={busy} size="sm">
            Instalar app
          </Button>
        </div>
      )}

      {step === 'enable-push' && (
        <div className="pr-6">
          <div className="flex items-center gap-2 mb-2">
            <Bell size={18} className="text-brand-500" />
            <p className="text-sm font-semibold text-white">Ative as notificações</p>
          </div>
          <p className="text-xs text-slate-400 mb-3">
            Receba avisos de aula cancelada, vaga na fila, crédito baixo e mensagens da academia.
          </p>
          <Button onClick={handleEnablePush} loading={busy} size="sm">
            Ativar notificações
          </Button>
          {msg && <p className="text-xs text-red-400 mt-2">{msg}</p>}
        </div>
      )}

      {step === 'push-blocked' && (
        <div className="pr-6">
          <div className="flex items-center gap-2 mb-1">
            <Bell size={18} className="text-slate-400" />
            <p className="text-sm font-semibold text-white">Notificações bloqueadas</p>
          </div>
          <p className="text-xs text-slate-400">
            Você bloqueou as notificações no navegador. Reabilite nas configurações do site
            (cadeado ao lado do endereço) para voltar a receber avisos.
          </p>
        </div>
      )}
    </Card>
  )
}
```

- [ ] **Step 2: Montar o card na home**

Em `app/(dashboard)/home/page.tsx`:

2a. Adicione o import junto aos outros de componentes (após a linha 15, `import { CheckinProgressCard } ...`):

```ts
import { PushOnboardingCard } from '@/components/pwa/PushOnboardingCard'
```

2b. Renderize o card como primeiro filho do container, logo após a abertura
`<div className="p-4 space-y-6 pb-24">` (linha 322) e antes do bloco `{recRaw && (`:

```tsx
    <div className="p-4 space-y-6 pb-24">
      <PushOnboardingCard />

      {recRaw && (
```

- [ ] **Step 3: Verificar build**

Run: `npm run build`
Expected: compila sem erros; a rota `/home` continua listada.

- [ ] **Step 4: Commit**

```bash
git add components/pwa/PushOnboardingCard.tsx app/(dashboard)/home/page.tsx
git commit -m "feat(push): card de onboarding na home (instalar + ativar push)"
```

---

### Task 11: Toggle de notificações no perfil

**Files:**
- Create: `features/perfil/NotificationToggle.tsx`
- Modify: `app/(dashboard)/perfil/page.tsx`

- [ ] **Step 1: Implementar o toggle**

Crie `features/perfil/NotificationToggle.tsx`:

```tsx
'use client'
// features/perfil/NotificationToggle.tsx
// Liga/desliga as notificações push do dispositivo atual. Ponto de reentrada
// permanente (o card da home é dispensável).
import { useEffect, useState } from 'react'
import { Bell } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { isPushSupported, subscribeToPush, unsubscribeFromPush } from '@/lib/pwa/pushClient'

export function NotificationToggle() {
  const [supported, setSupported] = useState(true)
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    if (!isPushSupported()) {
      setSupported(false)
      return
    }
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setEnabled(!!sub))
      .catch(() => setEnabled(false))
  }, [])

  async function toggle() {
    setBusy(true)
    setMsg(null)
    const res = enabled ? await unsubscribeFromPush() : await subscribeToPush()
    setBusy(false)
    if (res.error) {
      setMsg(res.error)
    } else {
      setEnabled(!enabled)
    }
  }

  if (!supported) {
    return (
      <p className="text-xs text-slate-500">
        Este dispositivo não suporta notificações push.
      </p>
    )
  }

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 min-w-0">
        <Bell size={18} className="text-brand-500 shrink-0" />
        <div className="min-w-0">
          <p className="text-sm text-white">Notificações push</p>
          <p className="text-xs text-slate-500">
            {enabled ? 'Ativadas neste dispositivo.' : 'Receba avisos mesmo com o app fechado.'}
          </p>
          {msg && <p className="text-xs text-red-400 mt-1">{msg}</p>}
        </div>
      </div>
      <Button onClick={toggle} loading={busy} size="sm" variant={enabled ? 'secondary' : 'primary'}>
        {enabled ? 'Desativar' : 'Ativar'}
      </Button>
    </div>
  )
}
```

> Se `Button` não tiver a variante `'secondary'`, use `variant="ghost"` ou remova a prop `variant` — confira `components/ui/Button.tsx` antes de implementar e ajuste para uma variante existente.

- [ ] **Step 2: Montar no perfil**

Em `app/(dashboard)/perfil/page.tsx`:

2a. Adicione o import (após a linha 13, `import { SelfPartnerForm } ...`):

```ts
import { NotificationToggle } from '@/features/perfil/NotificationToggle'
```

2b. Adicione uma seção "Notificações" logo após o fechamento da seção
"Conta e segurança" (após a linha 192, `</section>`) e antes do bloco de Créditos:

```tsx
      {/* Notificações */}
      <section>
        <SectionHeader title="Notificações" />
        <div className="bg-surface-card border border-surface-border rounded-xl p-4">
          <NotificationToggle />
        </div>
      </section>
```

- [ ] **Step 3: Verificar build**

Run: `npm run build`
Expected: compila sem erros.

- [ ] **Step 4: Commit**

```bash
git add features/perfil/NotificationToggle.tsx app/(dashboard)/perfil/page.tsx
git commit -m "feat(push): toggle de notificações no perfil"
```

---

### Task 12: Reabilitar push no broadcast do admin

**Files:**
- Modify: `features/comunidade/actions.ts`
- Modify: `app/(admin)/admin/notificacoes/NotificacoesClient.tsx`

- [ ] **Step 1: Incluir push nos canais do broadcast**

Em `features/comunidade/actions.ts`, dentro de `sendNotification`, no trecho que monta `notifyChannels` (após `if (channels.includes('whatsapp')) notifyChannels.push('whatsapp')`), acrescente:

```ts
  if (channels.includes('email')) notifyChannels.push('email')
  if (channels.includes('whatsapp')) notifyChannels.push('whatsapp')
  if (channels.includes('push')) notifyChannels.push('push')
```

- [ ] **Step 2: Reabilitar o botão push na UI**

Em `app/(admin)/admin/notificacoes/NotificacoesClient.tsx`, no array de canais (linha ~173), troque a entrada de push:

```tsx
                  { value: 'push' as Channel, label: 'Push (PWA)', description: 'App / navegador', disabled: false },
                  { value: 'email' as Channel, label: 'E-mail', description: 'Via Resend', disabled: false },
                  { value: 'whatsapp' as Channel, label: 'WhatsApp', description: 'Via Z-API', disabled: false },
```

- [ ] **Step 3: Verificar build**

Run: `npm run build`
Expected: compila sem erros.

- [ ] **Step 4: Commit**

```bash
git add features/comunidade/actions.ts "app/(admin)/admin/notificacoes/NotificacoesClient.tsx"
git commit -m "feat(push): broadcast do admin passa a oferecer o canal push"
```

---

### Task 13: Verificação final + passos manuais

**Files:** nenhum (verificação).

- [ ] **Step 1: Suite completa**

Run: `npm run test:run`
Expected: todos os testes passam, incluindo os 4 novos arquivos
(`onboardingState`, `pushEncoding`, `push`, `dispatch`). As falhas conhecidas do
projeto aninhado `octogent/` (se aparecerem) não contam.

- [ ] **Step 2: Build + lint**

Run: `npm run build && npm run lint`
Expected: build OK; lint só com warnings (sem erros novos).

- [ ] **Step 3: Documentar os passos manuais do usuário (não executar)**

Estes passos são do usuário, feitos fora do código:

1. Gerar as chaves VAPID **localmente pelo próprio usuário** (para a privada nunca
   aparecer no chat do assistente): `npx web-push generate-vapid-keys`.
2. Na Vercel (Production **e** Development), adicionar:
   - `NEXT_PUBLIC_VAPID_PUBLIC_KEY` = a Public Key gerada
   - `VAPID_PRIVATE_KEY` = a Private Key gerada
   - `VAPID_SUBJECT` = `mailto:contato@arenahub.website`
3. Aplicar a migration `20260715000100_push_subscriptions.sql` no SQL Editor do Supabase.
4. Redeploy.

- [ ] **Step 4: Teste manual em produção (após deploy do usuário)**

Roteiro:
- Android/Chrome: abrir `/home` → o card oferece "Instalar app" e "Ativar
  notificações". Ativar → aceitar a permissão.
- iOS/Safari: abrir `/home` → o card mostra instruções de "Adicionar à Tela de
  Início"; abrir pelo ícone instalado → o card passa a oferecer "Ativar notificações".
- Admin → `/admin/notificacoes`: marcar o canal **Push**, enviar um broadcast.
- Confirmar a chegada da notificação com o app **fechado**.
- Conferir no Sentry se aparece alguma exceção de envio (não deveria, em caso feliz).

---

## Self-Review (executado pelo autor do plano)

**1. Cobertura da spec:**
- Tabela `push_subscriptions` + RLS → Task 5. ✅
- VAPID / web-push / fail-closed → Tasks 1, 4. ✅
- Service worker mínimo (push, notificationclick, fetch no-op) → Task 8. ✅
- Canal `push` no `notifyUsers` + poda de mortas → Task 6. ✅
- `sendPush` (`ok`/`expired`/`skipped`) → Task 4. ✅
- Server actions save/delete → Task 7. ✅
- `pushClient` (registrar SW, subscribe/unsubscribe) → Task 9. ✅
- `resolveOnboardingStep` puro + testes → Task 2. ✅
- Card de onboarding na home → Task 10. ✅
- Toggle no perfil → Task 11. ✅
- Broadcast reabilita push (action + UI) → Task 12. ✅
- Testes (onboardingState, push, dispatch, encoding) → Tasks 2, 3, 4, 6. ✅
- Passos manuais (VAPID na Vercel, migration) → Task 13. ✅

**2. Placeholders:** nenhum passo com "TBD/etc"; todo passo de código traz o código completo. ✅

**3. Consistência de tipos:**
- `SendPushResult = 'ok' | 'expired' | 'skipped'` usado igual em `push.ts`, no teste e no bloco do dispatch. ✅
- `PushSubscriptionData {endpoint,p256dh,auth}` consistente entre `push.ts` e o dispatch. ✅
- `BrowserPushSubscription {endpoint, keys:{p256dh,auth}}` consistente entre `pushActions.ts` e `pushClient.ts`. ✅
- `NotificationChannel` inclui `'push'` (dispatch) e `sendNotification` já aceitava `'push'` em `channels`. ✅
- `OnboardingStep` / `OnboardingInput` consistentes entre `onboardingState.ts`, teste e o card. ✅

**Nota de verificação para o implementador:** confirmar a variante do `Button` em
`components/ui/Button.tsx` antes da Task 11 (usar uma variante existente para o estado
"Desativar").
