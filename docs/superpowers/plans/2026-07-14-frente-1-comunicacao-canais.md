# Frente 1 — Comunicação (canais externos de notificação) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer e-mail (Resend) e WhatsApp (Z-API) realmente saírem — no broadcast manual do admin e em 4 gatilhos transacionais (vaga de espera, aula cancelada, crédito baixo, assinatura em atraso) — mantendo o in-app como canal garantido.

**Architecture:** Módulos de I/O puro (`email.ts`, `whatsapp.ts`) que só recebem destino+conteúdo prontos; um helper central `notifyUsers` (dispatch.ts) que faz fan-out multi-canal (in-app falha alto; e-mail/WhatsApp best-effort isolados em try/catch → Sentry); uma view `public.user_emails` (service-role only) para resolver e-mails em lote. Cada gatilho coleta destinatários e delega ao helper.

**Tech Stack:** Next.js 14 App Router · TypeScript · Supabase (service role) · Resend SDK · Z-API (fetch) · Sentry · Vitest.

**Spec:** [docs/superpowers/specs/2026-07-14-frente-1-comunicacao-canais-design.md](../specs/2026-07-14-frente-1-comunicacao-canais-design.md)

---

## File Structure

Novos:
- `lib/notifications/whatsapp.ts` (+ `.test.ts`) — I/O Z-API, `normalizePhone` + `sendWhatsApp`.
- `lib/notifications/email.ts` (+ `.test.ts`) — I/O Resend, `sendEmail` fail-closed.
- `lib/notifications/dispatch.ts` (+ `.test.ts`) — `notifyUsers` (fan-out multi-canal).
- `lib/notifications/lowCredit.ts` (+ `.test.ts`) — regra pura `shouldNotifyLowCredit`.
- `features/aulas/creditNotifications.ts` (+ `.test.ts`) — `checkLowCreditThreshold` (nunca lança).
- `supabase/migrations/20260714000100_user_emails_view.sql` — view `public.user_emails`.

Alterados:
- `package.json` — dependência `resend`.
- `.env.example` — `NOTIFICATIONS_FROM_EMAIL`, `ZAPI_INSTANCE_ID`, `ZAPI_CLIENT_TOKEN`.
- `features/aulas/actions.ts` — `bookSession` chama `checkLowCreditThreshold`.
- `features/aulas/creditReconciliation.ts` — passo de débito chama `checkLowCreditThreshold`.
- `features/comunidade/actions.ts` — `sendNotification` usa `notifyUsers`; remove 3 stubs.
- `app/(admin)/admin/notificacoes/NotificacoesClient.tsx` — desabilita push + filtro PWA.
- `features/aulas/waitlistActions.ts` — `offerWaitlistSpot` via `notifyUsers`.
- `features/aulas/adminActions.ts` — `deleteClass` notifica afetados.
- `app/api/webhooks/mercadopago/studentHandlers.ts` — notificação em `past_due`.

---

## Task 1: Dependência `resend` + novas variáveis de ambiente

**Files:**
- Modify: `package.json` (via `npm install`)
- Modify: `.env.example`

- [ ] **Step 1: Instalar o pacote resend**

Run: `npm install resend`
Expected: `package.json` ganha `"resend": "^<versão>"` em `dependencies`; `package-lock.json` atualizado; sem erros.

- [ ] **Step 2: Adicionar placeholders no `.env.example`**

Edite `.env.example`. Localize a linha `ZAPI_TOKEN=` e substitua esse trecho para incluir as novas vars logo após o bloco de secrets existentes:

Trocar:
```
RESEND_API_KEY='re_82h3uKqY_Aq1FEU1a2XaAbGo3rDfuJbna'
ZAPI_TOKEN=
```
Por:
```
RESEND_API_KEY='re_82h3uKqY_Aq1FEU1a2XaAbGo3rDfuJbna'
# Remetente verificado no Resend (ex.: 'Academia <no-reply@seudominio.com>')
NOTIFICATIONS_FROM_EMAIL=
ZAPI_TOKEN=
# Z-API exige 3 credenciais: Instance ID (URL) + Token (URL) + Client-Token (header)
ZAPI_INSTANCE_ID=
ZAPI_CLIENT_TOKEN=
```

> IMPORTANTE: não altere/remova/rotacione nenhum valor real já presente (`SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, etc.). Apenas ADICIONE as 3 linhas novas + comentários.

- [ ] **Step 3: Verificar build de tipos**

Run: `npm run build`
Expected: build passa (o pacote `resend` resolve). Se falhar por outro motivo, pare e investigue antes de seguir.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json .env.example
git commit -m "feat(notifications): adiciona dependencia resend e novas env vars de canais"
```

---

## Task 2: `lib/notifications/whatsapp.ts` + teste

**Files:**
- Create: `lib/notifications/whatsapp.ts`
- Test: `lib/notifications/whatsapp.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Create `lib/notifications/whatsapp.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { sendWhatsApp, normalizePhone } from './whatsapp'

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response
}

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  process.env.ZAPI_INSTANCE_ID = 'inst-test'
  process.env.ZAPI_TOKEN = 'token-test'
  process.env.ZAPI_CLIENT_TOKEN = 'client-token-test'
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('normalizePhone', () => {
  it('remove nao-digitos e adiciona DDI 55 se ausente', () => {
    expect(normalizePhone('(11) 98888-7777')).toBe('5511988887777')
  })
  it('nao duplica DDI 55 se ja presente', () => {
    expect(normalizePhone('5511988887777')).toBe('5511988887777')
  })
})

describe('sendWhatsApp', () => {
  it('fail-closed sem ZAPI_INSTANCE_ID', async () => {
    delete process.env.ZAPI_INSTANCE_ID
    await sendWhatsApp({ phone: '11988887777', message: 'oi' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('fail-closed sem ZAPI_TOKEN', async () => {
    delete process.env.ZAPI_TOKEN
    await sendWhatsApp({ phone: '11988887777', message: 'oi' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('fail-closed sem ZAPI_CLIENT_TOKEN', async () => {
    delete process.env.ZAPI_CLIENT_TOKEN
    await sendWhatsApp({ phone: '11988887777', message: 'oi' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('monta URL, header Client-Token e telefone normalizado', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ zaapId: 'z1' }))
    await sendWhatsApp({ phone: '(11) 98888-7777', message: '*Titulo*\n\nCorpo' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.z-api.io/instances/inst-test/token/token-test/send-text')
    expect((init as RequestInit).headers).toMatchObject({ 'Client-Token': 'client-token-test' })
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.phone).toBe('5511988887777')
    expect(body.message).toBe('*Titulo*\n\nCorpo')
  })
  it('resposta nao-ok lanca', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'invalid' }, 400))
    await expect(sendWhatsApp({ phone: '11988887777', message: 'oi' })).rejects.toThrow(/400/)
  })
})
```

- [ ] **Step 2: Rodar o teste (deve falhar)**

Run: `npm run test:run -- lib/notifications/whatsapp.test.ts`
Expected: FAIL com "Failed to resolve import './whatsapp'" ou "sendWhatsApp is not a function".

- [ ] **Step 3: Implementar `lib/notifications/whatsapp.ts`**

Create `lib/notifications/whatsapp.ts`:
```ts
// lib/notifications/whatsapp.ts
// Envio de WhatsApp via Z-API. I/O puro: recebe telefone + mensagem prontos.
// Fail-closed sem credenciais (log + no-op). Erro HTTP vira Error — quem decide
// o try/catch é o dispatch central.
const ZAPI_BASE = 'https://api.z-api.io'

export interface SendWhatsAppParams {
  phone: string
  message: string
}

/** Remove nao-digitos e garante DDI 55 (mesma regra de buildWhatsAppUrl). */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  return digits.startsWith('55') ? digits : `55${digits}`
}

export async function sendWhatsApp({ phone, message }: SendWhatsAppParams): Promise<void> {
  const instanceId = process.env.ZAPI_INSTANCE_ID
  const token = process.env.ZAPI_TOKEN
  const clientToken = process.env.ZAPI_CLIENT_TOKEN

  if (!instanceId || !token || !clientToken) {
    console.log('[whatsapp] credenciais Z-API ausentes — envio ignorado', { phone })
    return
  }

  const url = `${ZAPI_BASE}/instances/${instanceId}/token/${token}/send-text`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Client-Token': clientToken,
    },
    body: JSON.stringify({ phone: normalizePhone(phone), message }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`[whatsapp] Z-API ${res.status}: ${body.slice(0, 300)}`)
  }
}
```

- [ ] **Step 4: Rodar o teste (deve passar)**

Run: `npm run test:run -- lib/notifications/whatsapp.test.ts`
Expected: PASS (todos os casos).

- [ ] **Step 5: Commit**

```bash
git add lib/notifications/whatsapp.ts lib/notifications/whatsapp.test.ts
git commit -m "feat(notifications): cliente Z-API sendWhatsApp com normalizacao de telefone"
```

---

## Task 3: `lib/notifications/email.ts` + teste

**Files:**
- Create: `lib/notifications/email.ts`
- Test: `lib/notifications/email.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Create `lib/notifications/email.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const sendMock = vi.hoisted(() => vi.fn())

vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: { send: sendMock },
  })),
}))

import { sendEmail } from './email'

describe('sendEmail', () => {
  beforeEach(() => {
    sendMock.mockReset()
    process.env.RESEND_API_KEY = 're_test_key'
    process.env.NOTIFICATIONS_FROM_EMAIL = 'Academia <no-reply@teste.com>'
  })

  it('fail-closed sem RESEND_API_KEY', async () => {
    delete process.env.RESEND_API_KEY
    await sendEmail({ to: 'aluno@x.com', subject: 'Oi', html: '<p>Oi</p>' })
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('fail-closed sem NOTIFICATIONS_FROM_EMAIL', async () => {
    delete process.env.NOTIFICATIONS_FROM_EMAIL
    await sendEmail({ to: 'aluno@x.com', subject: 'Oi', html: '<p>Oi</p>' })
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('envia com from configurado', async () => {
    sendMock.mockResolvedValueOnce({ data: { id: 'email-1' }, error: null })
    await sendEmail({ to: 'aluno@x.com', subject: 'Titulo', html: '<p>Corpo</p>' })
    expect(sendMock).toHaveBeenCalledWith({
      from: 'Academia <no-reply@teste.com>',
      to: 'aluno@x.com',
      subject: 'Titulo',
      html: '<p>Corpo</p>',
    })
  })

  it('erro do Resend vira excecao', async () => {
    sendMock.mockResolvedValueOnce({ data: null, error: { message: 'dominio nao verificado' } })
    await expect(
      sendEmail({ to: 'aluno@x.com', subject: 'Titulo', html: '<p>Corpo</p>' }),
    ).rejects.toThrow(/dominio nao verificado/)
  })
})
```

- [ ] **Step 2: Rodar o teste (deve falhar)**

Run: `npm run test:run -- lib/notifications/email.test.ts`
Expected: FAIL com "Failed to resolve import './email'".

- [ ] **Step 3: Implementar `lib/notifications/email.ts`**

Create `lib/notifications/email.ts`:
```ts
// lib/notifications/email.ts
// Envio de e-mail via Resend. I/O puro: recebe to/subject/html prontos.
// Fail-closed sem RESEND_API_KEY ou NOTIFICATIONS_FROM_EMAIL (log + no-op).
// Erro do Resend vira Error — quem decide o try/catch é o dispatch central.
import { Resend } from 'resend'

export interface SendEmailParams {
  to: string
  subject: string
  html: string
}

export async function sendEmail({ to, subject, html }: SendEmailParams): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.NOTIFICATIONS_FROM_EMAIL

  if (!apiKey || !from) {
    console.log('[email] RESEND_API_KEY ou NOTIFICATIONS_FROM_EMAIL ausente — envio ignorado', { to })
    return
  }

  const resend = new Resend(apiKey)
  const { error } = await resend.emails.send({ from, to, subject, html })
  if (error) {
    throw new Error(`[email] Resend retornou erro: ${error.message}`)
  }
}
```

- [ ] **Step 4: Rodar o teste (deve passar)**

Run: `npm run test:run -- lib/notifications/email.test.ts`
Expected: PASS (todos os casos).

- [ ] **Step 5: Commit**

```bash
git add lib/notifications/email.ts lib/notifications/email.test.ts
git commit -m "feat(notifications): cliente Resend sendEmail fail-closed"
```

---

## Task 4: Migration da view `public.user_emails`

**Files:**
- Create: `supabase/migrations/20260714000100_user_emails_view.sql`

- [ ] **Step 1: Criar o arquivo de migration**

Create `supabase/migrations/20260714000100_user_emails_view.sql`:
```sql
-- supabase/migrations/20260714000100_user_emails_view.sql

-- View somente-leitura para o dispatch de notificacoes (Frente 1) resolver
-- e-mail de alunos em lote. profiles/memberships nao tem coluna de e-mail —
-- ele vive em auth.users. Só o service role recebe grant (nunca anon nem
-- authenticated), entao nao vaza e-mail via API publica/RLS.
create or replace view public.user_emails as
  select id, email from auth.users;

revoke all on public.user_emails from anon, authenticated;
grant select on public.user_emails to service_role;
```

- [ ] **Step 2: Aplicar a migration**

O usuário aplica via `supabase db push` (o CLI local não tem auth — ver memória `reference-supabase-cli-auth`). Peça ao usuário para rodar `supabase db push` e confirmar que a view foi criada.

Verificação manual (o usuário roda no SQL editor do Supabase):
```sql
select id, email from public.user_emails limit 1;
```
Expected: retorna uma linha (id + email) sem erro de permissão para o service role.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260714000100_user_emails_view.sql
git commit -m "feat(notifications): view user_emails (service-role) para resolver e-mails em lote"
```

---

## Task 5: `lib/notifications/dispatch.ts` (`notifyUsers`) + teste

**Files:**
- Create: `lib/notifications/dispatch.ts`
- Test: `lib/notifications/dispatch.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Create `lib/notifications/dispatch.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./email', () => ({ sendEmail: vi.fn() }))
vi.mock('./whatsapp', () => ({ sendWhatsApp: vi.fn() }))
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))

import { notifyUsers } from './dispatch'
import { sendEmail } from './email'
import { sendWhatsApp } from './whatsapp'
import * as Sentry from '@sentry/nextjs'

function makeFakeClient(opts: { insertError?: { message: string } } = {}) {
  const inserted: Record<string, unknown[]> = {}
  const client = {
    from(table: string) {
      return {
        insert: (rows: unknown[]) => {
          inserted[table] = rows as unknown[]
          return Promise.resolve({ error: opts.insertError ?? null })
        },
      }
    },
  }
  return { client: client as never, inserted }
}

describe('notifyUsers', () => {
  beforeEach(() => {
    vi.mocked(sendEmail).mockReset()
    vi.mocked(sendWhatsApp).mockReset()
    vi.mocked(Sentry.captureException).mockReset()
  })

  it('sem destinatarios nao faz nada', async () => {
    const { client } = makeFakeClient()
    await notifyUsers(client, {
      orgId: 'org-1', recipients: [], type: 'admin_message', title: 'T', body: 'B',
      channels: ['inapp', 'email', 'whatsapp'],
    })
    expect(sendEmail).not.toHaveBeenCalled()
    expect(sendWhatsApp).not.toHaveBeenCalled()
  })

  it('insere em notifications quando channels inclui inapp', async () => {
    const { client, inserted } = makeFakeClient()
    await notifyUsers(client, {
      orgId: 'org-1', recipients: [{ userId: 'u1' }], type: 'waitlist_offer',
      title: 'Vaga disponivel!', body: 'Corpo', channels: ['inapp'],
    })
    expect(inserted.notifications).toEqual([
      { organization_id: 'org-1', user_id: 'u1', type: 'waitlist_offer', title: 'Vaga disponivel!', body: 'Corpo', read: false },
    ])
  })

  it('insert falhando lanca (in-app e o canal garantido)', async () => {
    const { client } = makeFakeClient({ insertError: { message: 'db down' } })
    await expect(
      notifyUsers(client, {
        orgId: 'org-1', recipients: [{ userId: 'u1' }], type: 'admin_message',
        title: 'T', body: 'B', channels: ['inapp'],
      }),
    ).rejects.toThrow(/db down/)
  })

  it('chama sendEmail so para destinatarios com email', async () => {
    const { client } = makeFakeClient()
    vi.mocked(sendEmail).mockResolvedValue(undefined)
    await notifyUsers(client, {
      orgId: 'org-1',
      recipients: [{ userId: 'u1', email: 'a@x.com' }, { userId: 'u2' }],
      type: 'low_credits', title: 'T', body: 'B', channels: ['email'],
    })
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(sendEmail).toHaveBeenCalledWith({ to: 'a@x.com', subject: 'T', html: expect.stringContaining('B') })
  })

  it('chama sendWhatsApp so para destinatarios com phone', async () => {
    const { client } = makeFakeClient()
    vi.mocked(sendWhatsApp).mockResolvedValue(undefined)
    await notifyUsers(client, {
      orgId: 'org-1',
      recipients: [{ userId: 'u1', phone: '11988887777' }, { userId: 'u2' }],
      type: 'class_cancelled', title: 'T', body: 'B', channels: ['whatsapp'],
    })
    expect(sendWhatsApp).toHaveBeenCalledTimes(1)
    expect(sendWhatsApp).toHaveBeenCalledWith({ phone: '11988887777', message: '*T*\n\nB' })
  })

  it('falha em um email nao impede os demais nem o whatsapp e reporta ao Sentry', async () => {
    const { client } = makeFakeClient()
    vi.mocked(sendEmail).mockRejectedValueOnce(new Error('smtp fail')).mockResolvedValueOnce(undefined)
    vi.mocked(sendWhatsApp).mockResolvedValue(undefined)
    await notifyUsers(client, {
      orgId: 'org-1',
      recipients: [
        { userId: 'u1', email: 'a@x.com', phone: '11988887777' },
        { userId: 'u2', email: 'b@x.com' },
      ],
      type: 'payment_past_due', title: 'T', body: 'B', channels: ['email', 'whatsapp'],
    })
    expect(sendEmail).toHaveBeenCalledTimes(2)
    expect(sendWhatsApp).toHaveBeenCalledTimes(1)
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: { channel: 'email', notificationType: 'payment_past_due' } }),
    )
  })
})
```

- [ ] **Step 2: Rodar o teste (deve falhar)**

Run: `npm run test:run -- lib/notifications/dispatch.test.ts`
Expected: FAIL com "Failed to resolve import './dispatch'".

- [ ] **Step 3: Implementar `lib/notifications/dispatch.ts`**

Create `lib/notifications/dispatch.ts`:
```ts
// lib/notifications/dispatch.ts
// Helper central de disparo multi-canal. In-app é o canal garantido (nosso
// banco — falha aqui é erro real e PROPAGA). E-mail/WhatsApp são best-effort:
// cada envio roda isolado em try/catch e reporta ao Sentry, nunca derruba a
// acao de origem (broadcast ou gatilho transacional).
import * as Sentry from '@sentry/nextjs'
import type { createAdminClient } from '@/lib/supabase/server'
import { sendEmail } from './email'
import { sendWhatsApp } from './whatsapp'

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * Valores convencionais: 'admin_message' | 'waitlist_offer' | 'class_cancelled'
 * | 'low_credits' | 'payment_past_due'. Aceita string livre porque o broadcast
 * do admin ja usa tipos proprios ('announcement', etc.) como notifications.type.
 */
export type NotificationType = string

export type NotificationChannel = 'inapp' | 'email' | 'whatsapp'

export interface NotifyRecipient {
  userId: string
  email?: string | null
  phone?: string | null
}

export interface NotifyUsersParams {
  orgId: string
  recipients: NotifyRecipient[]
  type: NotificationType
  title: string
  body: string
  channels: NotificationChannel[]
}

function buildEmailHtml(title: string, body: string): string {
  return `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color: #f97316;">${title}</h2>
      <p style="color: #1f2937; white-space: pre-line;">${body}</p>
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
      <p style="color: #9ca3af; font-size: 12px;">Esta é uma mensagem automática da sua academia.</p>
    </div>
  `.trim()
}

function buildWhatsAppText(title: string, body: string): string {
  return `*${title}*\n\n${body}`
}

/**
 * Dispara uma notificacao para varios destinatarios nos canais pedidos.
 * In-app falha alto (erro do nosso banco). E-mail/WhatsApp nunca lançam — cada
 * falha é reportada ao Sentry com tags { channel, notificationType }.
 */
export async function notifyUsers(
  client: AdminClient,
  { orgId, recipients, type, title, body, channels }: NotifyUsersParams,
): Promise<void> {
  if (recipients.length === 0) return

  if (channels.includes('inapp')) {
    const rows = recipients.map((r) => ({
      organization_id: orgId,
      user_id: r.userId,
      type,
      title,
      body,
      read: false,
    }))
    const { error } = await client.from('notifications').insert(rows)
    if (error) {
      throw new Error(`[notifyUsers] insert em notifications falhou: ${error.message}`)
    }
  }

  if (channels.includes('email')) {
    const html = buildEmailHtml(title, body)
    for (const r of recipients) {
      if (!r.email) continue
      try {
        await sendEmail({ to: r.email, subject: title, html })
      } catch (err) {
        Sentry.captureException(err, {
          tags: { channel: 'email', notificationType: type },
          extra: { orgId, userId: r.userId },
        })
      }
    }
  }

  if (channels.includes('whatsapp')) {
    const message = buildWhatsAppText(title, body)
    for (const r of recipients) {
      if (!r.phone) continue
      try {
        await sendWhatsApp({ phone: r.phone, message })
      } catch (err) {
        Sentry.captureException(err, {
          tags: { channel: 'whatsapp', notificationType: type },
          extra: { orgId, userId: r.userId },
        })
      }
    }
  }
}
```

- [ ] **Step 4: Rodar o teste (deve passar)**

Run: `npm run test:run -- lib/notifications/dispatch.test.ts`
Expected: PASS (todos os casos).

- [ ] **Step 5: Commit**

```bash
git add lib/notifications/dispatch.ts lib/notifications/dispatch.test.ts
git commit -m "feat(notifications): helper central notifyUsers com fan-out multi-canal"
```

---

## Task 6: `lib/notifications/lowCredit.ts` (regra pura) + teste

**Files:**
- Create: `lib/notifications/lowCredit.ts`
- Test: `lib/notifications/lowCredit.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Create `lib/notifications/lowCredit.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { shouldNotifyLowCredit } from './lowCredit'

describe('shouldNotifyLowCredit', () => {
  it('dispara quando cruza de >1 para 1', () => {
    expect(shouldNotifyLowCredit(2, 1)).toBe(true)
    expect(shouldNotifyLowCredit(5, 1)).toBe(true)
  })
  it('nao dispara se ja estava em 1', () => {
    expect(shouldNotifyLowCredit(1, 1)).toBe(false)
  })
  it('nao dispara se caiu a 0', () => {
    expect(shouldNotifyLowCredit(1, 0)).toBe(false)
    expect(shouldNotifyLowCredit(2, 0)).toBe(false)
  })
  it('nao dispara em saldo alto sem cruzar 1', () => {
    expect(shouldNotifyLowCredit(5, 3)).toBe(false)
  })
  it('nao dispara em concessao (saldo sobe)', () => {
    expect(shouldNotifyLowCredit(0, 1)).toBe(false)
    expect(shouldNotifyLowCredit(1, 2)).toBe(false)
  })
})
```

- [ ] **Step 2: Rodar o teste (deve falhar)**

Run: `npm run test:run -- lib/notifications/lowCredit.test.ts`
Expected: FAIL com "Failed to resolve import './lowCredit'".

- [ ] **Step 3: Implementar `lib/notifications/lowCredit.ts`**

Create `lib/notifications/lowCredit.ts`:
```ts
// lib/notifications/lowCredit.ts
/**
 * Decide se o cruzamento de saldo deve disparar o aviso de "credito baixo".
 * Dispara SÓ quando o saldo passou de >1 para exatamente 1 neste debito. Se já
 * estava em 1 ou 0 (ou o saldo subiu), não repete.
 */
export function shouldNotifyLowCredit(oldBalance: number, newBalance: number): boolean {
  return oldBalance > 1 && newBalance === 1
}
```

- [ ] **Step 4: Rodar o teste (deve passar)**

Run: `npm run test:run -- lib/notifications/lowCredit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/notifications/lowCredit.ts lib/notifications/lowCredit.test.ts
git commit -m "feat(notifications): regra pura shouldNotifyLowCredit (cruzamento de saldo)"
```

---

## Task 7: `features/aulas/creditNotifications.ts` (`checkLowCreditThreshold`) + teste

**Files:**
- Create: `features/aulas/creditNotifications.ts`
- Test: `features/aulas/creditNotifications.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Create `features/aulas/creditNotifications.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/notifications/dispatch', () => ({ notifyUsers: vi.fn() }))
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))

import { checkLowCreditThreshold } from './creditNotifications'
import { notifyUsers } from '@/lib/notifications/dispatch'

function makeFakeClient(opts: {
  creditsBalance: number
  phone?: string | null
  email?: string | null
}) {
  const client = {
    from(table: string) {
      const builder: Record<string, unknown> = {}
      const chain = () => builder
      builder.select = chain
      builder.eq = chain
      builder.single = () => {
        if (table === 'memberships') return Promise.resolve({ data: { credits_balance: opts.creditsBalance } })
        if (table === 'profiles') return Promise.resolve({ data: { phone: opts.phone ?? null } })
        return Promise.resolve({ data: null })
      }
      builder.maybeSingle = () => {
        if (table === 'user_emails') return Promise.resolve({ data: opts.email ? { email: opts.email } : null })
        return Promise.resolve({ data: null })
      }
      return builder
    },
  }
  return client as never
}

describe('checkLowCreditThreshold', () => {
  beforeEach(() => {
    vi.mocked(notifyUsers).mockReset()
  })

  it('dispara quando o debito cruzou de >1 para 1', async () => {
    const client = makeFakeClient({ creditsBalance: 1, phone: '11988887777', email: 'a@x.com' })
    await checkLowCreditThreshold(client, 'student-1', 'org-1', -1)
    expect(notifyUsers).toHaveBeenCalledTimes(1)
    expect(notifyUsers).toHaveBeenCalledWith(client, expect.objectContaining({
      orgId: 'org-1',
      type: 'low_credits',
      recipients: [{ userId: 'student-1', email: 'a@x.com', phone: '11988887777' }],
      channels: ['inapp', 'email', 'whatsapp'],
    }))
  })

  it('nao dispara quando o saldo permanece alto apos o debito', async () => {
    const client = makeFakeClient({ creditsBalance: 4 })
    await checkLowCreditThreshold(client, 'student-1', 'org-1', -1)
    expect(notifyUsers).not.toHaveBeenCalled()
  })

  it('nao dispara se caiu a 0', async () => {
    const client = makeFakeClient({ creditsBalance: 0 })
    await checkLowCreditThreshold(client, 'student-1', 'org-1', -1)
    expect(notifyUsers).not.toHaveBeenCalled()
  })

  it('nunca lanca mesmo se notifyUsers falhar', async () => {
    vi.mocked(notifyUsers).mockRejectedValueOnce(new Error('boom'))
    const client = makeFakeClient({ creditsBalance: 1 })
    await expect(checkLowCreditThreshold(client, 'student-1', 'org-1', -1)).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Rodar o teste (deve falhar)**

Run: `npm run test:run -- features/aulas/creditNotifications.test.ts`
Expected: FAIL com "Failed to resolve import './creditNotifications'".

- [ ] **Step 3: Implementar `features/aulas/creditNotifications.ts`**

Create `features/aulas/creditNotifications.ts`:
```ts
// features/aulas/creditNotifications.ts
// Aviso de "credito baixo": chamado depois de qualquer debito via adjust_credits.
// NUNCA lança — uma falha aqui nao pode reverter o debito nem quebrar o fluxo
// que chamou (bookSession, reconcileEnrollmentCredits).
import * as Sentry from '@sentry/nextjs'
import type { createAdminClient } from '@/lib/supabase/server'
import { notifyUsers } from '@/lib/notifications/dispatch'
import { shouldNotifyLowCredit } from '@/lib/notifications/lowCredit'

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * Verifica se o debito que acabou de rodar cruzou o saldo de >1 para 1 e, se
 * sim, dispara o aviso de credito baixo. `delta` é o valor (negativo) que o
 * caller já aplicou na chamada de adjust_credits (ex.: -1). O saldo NOVO é lido
 * de memberships.credits_balance (atualizado pela RPC); o saldo ANTERIOR é
 * newBalance - delta.
 */
export async function checkLowCreditThreshold(
  client: AdminClient,
  studentId: string,
  orgId: string,
  delta: number,
): Promise<void> {
  try {
    const { data: membership } = await client
      .from('memberships')
      .select('credits_balance')
      .eq('user_id', studentId)
      .eq('organization_id', orgId)
      .single()
    if (!membership) return

    const newBalance = (membership as { credits_balance: number }).credits_balance
    const oldBalance = newBalance - delta
    if (!shouldNotifyLowCredit(oldBalance, newBalance)) return

    const { data: profile } = await client
      .from('profiles')
      .select('phone')
      .eq('id', studentId)
      .single()

    const { data: emailRow } = await client
      .from('user_emails')
      .select('email')
      .eq('id', studentId)
      .maybeSingle()

    await notifyUsers(client, {
      orgId,
      recipients: [{
        userId: studentId,
        email: (emailRow as { email: string } | null)?.email ?? null,
        phone: (profile as { phone: string | null } | null)?.phone ?? null,
      }],
      type: 'low_credits',
      title: 'Seu credito esta acabando',
      body: 'Voce tem apenas 1 credito restante. Renove seu plano para continuar agendando aulas.',
      channels: ['inapp', 'email', 'whatsapp'],
    })
  } catch (err) {
    console.error('[checkLowCreditThreshold] falhou', {
      studentId, orgId, error: err instanceof Error ? err.message : String(err),
    })
    Sentry.captureException(err, {
      tags: { channel: 'dispatch', notificationType: 'low_credits' },
      extra: { studentId, orgId },
    })
  }
}
```

- [ ] **Step 4: Rodar o teste (deve passar)**

Run: `npm run test:run -- features/aulas/creditNotifications.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add features/aulas/creditNotifications.ts features/aulas/creditNotifications.test.ts
git commit -m "feat(notifications): checkLowCreditThreshold apos debito de credito"
```

---

## Task 8: Ligar `checkLowCreditThreshold` nos 2 pontos de débito

**Files:**
- Modify: `features/aulas/actions.ts` (import + `bookSession` após débito, ~linha 232)
- Modify: `features/aulas/creditReconciliation.ts` (import + passo de débito, ~linha 151)

> Os outros pontos que chamam `adjust_credits` estão FORA de escopo por prova: concessões/refunds têm `delta >= 0` (impossível cruzar >1→1); `cancelSubscription`/`adminCancelStudentPlan` zeram o saldo (`newBalance` sempre 0, nunca 1); `addCreditsManually` pode ser negativo mas é ajuste administrativo pontual, não consumo de aula. Só os 2 débitos de aula (-1) abaixo entram.

- [ ] **Step 1: Adicionar o import em `features/aulas/actions.ts`**

Localize (linha ~8):
```ts
import { offerWaitlistSpot } from './waitlistActions'
```
Adicione logo abaixo:
```ts
import { checkLowCreditThreshold } from './creditNotifications'
```

- [ ] **Step 2: Chamar após o débito em `bookSession`**

Localize o fim do bloco de débito (após o `if (creditErr) { ... }`), atualmente:
```ts
      return creditErr.message.includes('INSUFFICIENT_CREDITS')
        ? { error: 'Créditos insuficientes.' }
        : { error: 'Erro ao criar agendamento. Tente novamente.' }
    }
  }

  revalidatePath('/home')
```
Substitua por:
```ts
      return creditErr.message.includes('INSUFFICIENT_CREDITS')
        ? { error: 'Créditos insuficientes.' }
        : { error: 'Erro ao criar agendamento. Tente novamente.' }
    }

    // Aviso de credito baixo (best-effort; a funcao nunca lança).
    await checkLowCreditThreshold(adminClient, user.id, orgId, -1)
  }

  revalidatePath('/home')
```

- [ ] **Step 3: Adicionar o import em `features/aulas/creditReconciliation.ts`**

Localize (linha ~5):
```ts
import { isSubscriptionCurrent } from '@/lib/billing/periodicity'
```
Adicione logo abaixo:
```ts
import { checkLowCreditThreshold } from './creditNotifications'
```

- [ ] **Step 4: Chamar após o débito em `reconcileEnrollmentCredits`**

Localize o fim do passo de débito, atualmente:
```ts
    if (debitErr) {
      console.error('[reconcileEnrollmentCredits] debito falhou', {
        studentId, sessionId: op.sessionId, error: debitErr.message,
      })
      continue
    }
    result.debited++
  }

  return result
}
```
Substitua por:
```ts
    if (debitErr) {
      console.error('[reconcileEnrollmentCredits] debito falhou', {
        studentId, sessionId: op.sessionId, error: debitErr.message,
      })
      continue
    }
    result.debited++

    // Aviso de credito baixo (best-effort; a funcao nunca lança).
    await checkLowCreditThreshold(adminClient, studentId, cls.organization_id, -1)
  }

  return result
}
```

- [ ] **Step 5: Verificar tipos e testes existentes**

Run: `npm run test:run -- features/aulas/creditNotifications.test.ts`
Expected: PASS (regressão do módulo).

Run: `npm run build`
Expected: build passa (imports resolvem, sem erro de tipo).

- [ ] **Step 6: Commit**

```bash
git add features/aulas/actions.ts features/aulas/creditReconciliation.ts
git commit -m "feat(notifications): dispara aviso de credito baixo apos debito de aula"
```

---

## Task 9: Rewire do broadcast do admin (`sendNotification` + UI)

**Files:**
- Modify: `features/comunidade/actions.ts` (`sendNotification`; remove 3 stubs)
- Modify: `app/(admin)/admin/notificacoes/NotificacoesClient.tsx` (desabilita push + filtro PWA; default channels)

- [ ] **Step 1: Adicionar import em `features/comunidade/actions.ts`**

Localize (linha ~5):
```ts
import { createClient, createAdminClient, getActiveOrgId } from '@/lib/supabase/server'
import type { StudentLevel, PaymentType } from '@/types'
```
Adicione logo abaixo:
```ts
import { notifyUsers, type NotificationChannel } from '@/lib/notifications/dispatch'
```

- [ ] **Step 2: Substituir o corpo de `sendNotification` + remover os 3 stubs**

Substitua TODO o trecho das linhas 187–372 (do comentário `// sendNotification` até o fim do arquivo, incluindo os 3 helpers `_sendEmailNotifications`, `_sendWhatsAppNotifications`, `_sendPushNotifications`) por:
```ts
// ---------------------------------------------------------------------------
// sendNotification
// ---------------------------------------------------------------------------

/**
 * Envia uma notificacao para um conjunto filtrado de alunos via notifyUsers.
 * - In-app sempre (canal garantido); e-mail/WhatsApp best-effort quando o canal
 *   estiver marcado na UI.
 * - O contador de "enviados" reflete os destinatarios in-app (como antes).
 *
 * Filtros: 'all' | 'by_level' | 'by_plan'. ('pwa_only' fica indisponivel — push
 * chega na proxima etapa; a tabela push_subscriptions nem existe.)
 */
export async function sendNotification(params: {
  title: string
  body: string
  type: string
  filterMode: 'all' | 'by_level' | 'by_plan' | 'pwa_only'
  filterValue?: string
  channels: Array<'push' | 'email' | 'whatsapp'>
}): Promise<{ error?: string; sentCount?: number }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const adminClient = createAdminClient()

  // Academia ATIVA + verificação de admin via membership desta academia.
  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  const { data: callerMembership } = await adminClient
    .from('memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .single()

  if (callerMembership?.role !== 'admin') return { error: 'Sem permissão.' }

  const { title, body, type, filterMode, filterValue, channels } = params

  if (!title.trim() || !body.trim()) {
    return { error: 'Título e mensagem são obrigatórios.' }
  }

  if (filterMode === 'pwa_only') {
    return { error: 'Filtro indisponível (push chega na próxima etapa).' }
  }

  // Destinatários: memberships de alunos da academia ativa. Os campos por-academia
  // (level, payment_type, contract_active) vivem na membership.
  let memQuery = adminClient
    .from('memberships')
    .select('user_id, level, payment_type')
    .eq('organization_id', orgId)
    .eq('role', 'student')
    .eq('contract_active', true)

  if (filterMode === 'by_level' && filterValue) {
    memQuery = memQuery.eq('level', filterValue as StudentLevel)
  } else if (filterMode === 'by_plan' && filterValue) {
    memQuery = memQuery.eq('payment_type', filterValue as PaymentType)
  }

  const { data: members, error: membersErr } = await memQuery
  if (membersErr) return { error: 'Erro ao buscar destinatários.' }
  const memberIds = (members ?? []).map((m: { user_id: string }) => m.user_id)

  if (memberIds.length === 0) return { sentCount: 0 }

  // Identidade (telefone) dos destinatários vem de profiles.
  const { data: recipients, error: recipientsErr } = await adminClient
    .from('profiles')
    .select('id, phone')
    .in('id', memberIds)
  if (recipientsErr) return { error: 'Erro ao buscar destinatários.' }
  if (!recipients || recipients.length === 0) return { sentCount: 0 }

  // E-mails via view somente-leitura (profiles não tem e-mail — ele vive em auth.users).
  const { data: emailRows } = await adminClient
    .from('user_emails')
    .select('id, email')
    .in('id', memberIds)
  const emailById = new Map(
    ((emailRows ?? []) as { id: string; email: string }[]).map((r) => [r.id, r.email]),
  )

  // In-app sempre; e-mail/WhatsApp conforme marcado na UI. (Push é ignorado —
  // sem dispatcher real; a UI o mantém desabilitado.)
  const notifyChannels: NotificationChannel[] = ['inapp']
  if (channels.includes('email')) notifyChannels.push('email')
  if (channels.includes('whatsapp')) notifyChannels.push('whatsapp')

  try {
    await notifyUsers(adminClient, {
      orgId,
      recipients: (recipients as { id: string; phone: string | null }[]).map((r) => ({
        userId: r.id,
        email: emailById.get(r.id) ?? null,
        phone: r.phone,
      })),
      type,
      title,
      body,
      channels: notifyChannels,
    })
  } catch {
    // Falha do in-app (nosso banco) é o único caso que chega aqui — notifyUsers
    // isola e-mail/WhatsApp internamente.
    return { error: 'Erro ao salvar notificações.' }
  }

  return { sentCount: recipients.length }
}
```

- [ ] **Step 3: Ajustar a UI — default de canais em `NotificacoesClient.tsx`**

Localize (linha ~44):
```ts
  const [channels, setChannels] = useState<Channel[]>(['push'])
```
Substitua por:
```ts
  const [channels, setChannels] = useState<Channel[]>(['email', 'whatsapp'])
```

Localize (linha ~93, dentro do reset de sucesso):
```ts
        setChannels(['push'])
```
Substitua por:
```ts
        setChannels(['email', 'whatsapp'])
```

- [ ] **Step 4: Ajustar a UI — bloco de Canais (desabilitar Push)**

Substitua o bloco de Canais (linhas ~167–192) por:
```tsx
          {/* Channels */}
          <div>
            <label className="text-sm font-medium text-slate-300 block mb-2">Canais</label>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  { value: 'push' as Channel, label: 'Push (PWA)', description: 'Em breve', disabled: true },
                  { value: 'email' as Channel, label: 'E-mail', description: 'Via Resend', disabled: false },
                  { value: 'whatsapp' as Channel, label: 'WhatsApp', description: 'Via Z-API', disabled: false },
                ] as const
              ).map((c) => (
                <button
                  key={c.value}
                  onClick={() => { if (!c.disabled) toggleChannel(c.value) }}
                  disabled={c.disabled}
                  className={`flex flex-col items-start px-3 py-2 rounded-lg text-sm transition-colors border ${
                    c.disabled
                      ? 'bg-surface border-surface-border text-slate-600 opacity-50 cursor-not-allowed'
                      : channels.includes(c.value)
                      ? 'bg-brand-600/20 border-brand-600 text-brand-400'
                      : 'bg-surface border-surface-border text-slate-400 hover:border-brand-600/50 hover:text-white'
                  }`}
                >
                  <span className="font-medium">{c.label}</span>
                  <span className="text-xs opacity-70">{c.description}</span>
                </button>
              ))}
            </div>
          </div>
```

- [ ] **Step 5: Ajustar a UI — bloco de Destinatários (desabilitar PWA)**

Substitua o bloco de radios de filterMode (linhas ~198–226, o `.map` até o fechamento) por:
```tsx
              {(
                [
                  { value: 'all' as FilterMode, label: 'Todos os alunos ativos', disabled: false },
                  { value: 'by_level' as FilterMode, label: 'Por nível', disabled: false },
                  { value: 'by_plan' as FilterMode, label: 'Por tipo de plano', disabled: false },
                  { value: 'pwa_only' as FilterMode, label: 'Somente alunos com PWA instalado — em breve', disabled: true },
                ] as const
              ).map((f) => (
                <label
                  key={f.value}
                  className={`flex items-center gap-3 group ${f.disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  <input
                    type="radio"
                    name="filterMode"
                    value={f.value}
                    checked={filterMode === f.value}
                    disabled={f.disabled}
                    onChange={() => {
                      if (f.disabled) return
                      setFilterMode(f.value)
                      setFilterValue('')
                    }}
                    className="accent-brand-600"
                  />
                  <span className="text-sm text-slate-300 group-hover:text-white transition-colors">
                    {f.label}
                  </span>
                </label>
              ))}
```

- [ ] **Step 6: Verificar build**

Run: `npm run build`
Expected: build passa. Sem referências restantes a `push_subscriptions`, `_sendEmailNotifications`, `_sendWhatsAppNotifications`, `_sendPushNotifications`, `WHATSAPP_GATEWAY`.

- [ ] **Step 7: Commit**

```bash
git add features/comunidade/actions.ts "app/(admin)/admin/notificacoes/NotificacoesClient.tsx"
git commit -m "feat(notifications): broadcast do admin usa notifyUsers; desabilita push/PWA na UI"
```

---

## Task 10: Gatilho `waitlist_offer` (`offerWaitlistSpot`)

**Files:**
- Modify: `features/aulas/waitlistActions.ts` (imports + `offerWaitlistSpot`, linhas ~1–57)

- [ ] **Step 1: Adicionar imports**

Localize (linhas ~4–6):
```ts
import { revalidatePath } from 'next/cache'
import { createClient, createAdminClient, getActiveOrgId, getActiveMembership } from '@/lib/supabase/server'
import type { WaitlistStatus, StudentLevel, ClassType } from '@/types'
```
Adicione logo abaixo:
```ts
import * as Sentry from '@sentry/nextjs'
import { notifyUsers } from '@/lib/notifications/dispatch'
```

- [ ] **Step 2: Substituir o insert manual por `notifyUsers`**

Substitua o trecho final de `offerWaitlistSpot` (linhas ~45–57), atualmente:
```ts
  const deadline = new Date(Date.now() + 60 * 60 * 1000)
  const deadlineStr = deadline.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

  // Insert in-app notification
  await adminClient.from('notifications').insert({
    organization_id: session?.organization_id,
    user_id: next.student_id,
    type: 'waitlist_offer',
    title: 'Vaga disponível!',
    body: `Uma vaga abriu em ${className} (${session?.session_date}). Confirme sua presença até ${deadlineStr}.`,
    read: false,
  })
}
```
Por:
```ts
  const deadline = new Date(Date.now() + 60 * 60 * 1000)
  const deadlineStr = deadline.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

  const title = 'Vaga disponível!'
  const body = `Uma vaga abriu em ${className} (${session?.session_date}). Confirme sua presença até ${deadlineStr}.`

  // Best-effort: uma falha de notificacao nao pode derrubar o avanço da fila
  // (offerWaitlistSpot é chamado fire-and-forget por leaveWaitlist/acceptWaitlistSpot).
  try {
    const { data: profile } = await adminClient
      .from('profiles')
      .select('phone')
      .eq('id', next.student_id)
      .single()
    const { data: emailRow } = await adminClient
      .from('user_emails')
      .select('email')
      .eq('id', next.student_id)
      .maybeSingle()

    await notifyUsers(adminClient, {
      orgId: session?.organization_id as string,
      recipients: [{
        userId: next.student_id,
        email: (emailRow as { email: string } | null)?.email ?? null,
        phone: (profile as { phone: string | null } | null)?.phone ?? null,
      }],
      type: 'waitlist_offer',
      title,
      body,
      channels: ['inapp', 'email', 'whatsapp'],
    })
  } catch (err) {
    console.error('[offerWaitlistSpot] notifyUsers falhou', {
      sessionId, studentId: next.student_id,
      error: err instanceof Error ? err.message : String(err),
    })
    Sentry.captureException(err, {
      tags: { channel: 'dispatch', notificationType: 'waitlist_offer' },
      extra: { sessionId, studentId: next.student_id },
    })
  }
}
```

- [ ] **Step 3: Verificar build**

Run: `npm run build`
Expected: build passa.

- [ ] **Step 4: Commit**

```bash
git add features/aulas/waitlistActions.ts
git commit -m "feat(notifications): waitlist_offer via notifyUsers (in-app + email + whatsapp)"
```

---

## Task 11: Gatilho `class_cancelled` (`deleteClass`)

**Files:**
- Modify: `features/aulas/adminActions.ts` (imports + `deleteClass`, linhas ~314–377)

- [ ] **Step 1: Adicionar imports**

Localize (linhas ~4–11, topo do arquivo):
```ts
import { revalidatePath } from 'next/cache'
import { createClient, createAdminClient, getActiveOrgId } from '@/lib/supabase/server'
import { format, endOfMonth } from 'date-fns'
import { buildSessionRows } from './sessionUtils'
import type { StudentLevel } from '@/types'
import { reconcileEnrollmentCredits } from './creditReconciliation'
import { requiresCredit } from '@/lib/utils/reconciliationOps'
```
Adicione logo abaixo:
```ts
import * as Sentry from '@sentry/nextjs'
import { notifyUsers } from '@/lib/notifications/dispatch'
```

- [ ] **Step 2: Reescrever `deleteClass`**

Substitua a função inteira `deleteClass` (linhas ~318–377) por:
```ts
export async function deleteClass(classId: string): Promise<{ error?: string }> {
  const { orgId, error: authErr } = await requireAdmin()
  if (authErr) return { error: authErr }

  const adminClient = createAdminClient()
  const now = new Date().toISOString()
  const today = format(new Date(), 'yyyy-MM-dd')

  // Garante que a turma pertence à academia ativa antes de mutar. Pega o nome
  // para a mensagem da notificação.
  const { data: ownClass } = await adminClient
    .from('classes')
    .select('id, name')
    .eq('id', classId)
    .eq('organization_id', orgId)
    .single()
  if (!ownClass) return { error: 'Turma não encontrada.' }

  // Coleta destinatários afetados ANTES de cancelar — as mutações abaixo mudam
  // os filtros (status='confirmed', is_active=true) que identificam os afetados.
  const { data: futureSessions } = await adminClient
    .from('class_sessions')
    .select('id')
    .eq('class_id', classId)
    .gte('session_date', today)
  const sessionIds = (futureSessions ?? []).map((s: { id: string }) => s.id)

  const affectedIds = new Set<string>()
  if (sessionIds.length > 0) {
    const { data: bookingsRaw } = await adminClient
      .from('session_bookings')
      .select('student_id')
      .in('session_id', sessionIds)
      .eq('status', 'confirmed')
    for (const b of (bookingsRaw ?? []) as { student_id: string }[]) affectedIds.add(b.student_id)
  }
  const { data: enrollmentsRaw } = await adminClient
    .from('enrollments')
    .select('student_id')
    .eq('class_id', classId)
    .eq('is_active', true)
  for (const e of (enrollmentsRaw ?? []) as { student_id: string }[]) affectedIds.add(e.student_id)

  // Cancel all future sessions
  await adminClient
    .from('class_sessions')
    .update({ status: 'cancelled' })
    .eq('class_id', classId)
    .gte('session_date', today)
    .neq('status', 'cancelled')

  // Cancel bookings on those future sessions
  if (sessionIds.length > 0) {
    await adminClient
      .from('session_bookings')
      .update({ status: 'cancelled', cancelled_at: now })
      .in('session_id', sessionIds)
      .eq('status', 'confirmed')
  }

  // Cancel all active enrollments
  await adminClient
    .from('enrollments')
    .update({ is_active: false, cancelled_at: now })
    .eq('class_id', classId)
    .eq('is_active', true)

  // Soft-delete the class
  const { error } = await adminClient
    .from('classes')
    .update({ is_active: false })
    .eq('id', classId)

  if (error) return { error: 'Erro ao excluir turma.' }

  // Best-effort: notificar afetados NUNCA reverte o cancelamento.
  if (affectedIds.size > 0) {
    try {
      const ids = Array.from(affectedIds)
      const { data: emailRows } = await adminClient
        .from('user_emails')
        .select('id, email')
        .in('id', ids)
      const { data: profileRows } = await adminClient
        .from('profiles')
        .select('id, phone')
        .in('id', ids)
      const emailById = new Map(((emailRows ?? []) as { id: string; email: string }[]).map((r) => [r.id, r.email]))
      const phoneById = new Map(((profileRows ?? []) as { id: string; phone: string | null }[]).map((r) => [r.id, r.phone]))

      await notifyUsers(adminClient, {
        orgId,
        recipients: ids.map((id) => ({
          userId: id,
          email: emailById.get(id) ?? null,
          phone: phoneById.get(id) ?? null,
        })),
        type: 'class_cancelled',
        title: 'Aula cancelada',
        body: `A turma "${(ownClass as { name: string }).name}" foi cancelada.`,
        channels: ['inapp', 'email', 'whatsapp'],
      })
    } catch (err) {
      console.error('[deleteClass] notifyUsers falhou', {
        classId, error: err instanceof Error ? err.message : String(err),
      })
      Sentry.captureException(err, {
        tags: { channel: 'dispatch', notificationType: 'class_cancelled' },
        extra: { classId, orgId },
      })
    }
  }

  revalidatePath('/admin/grade')
  revalidatePath('/admin/alunos')
  return {}
}
```

- [ ] **Step 3: Verificar build**

Run: `npm run build`
Expected: build passa.

- [ ] **Step 4: Commit**

```bash
git add features/aulas/adminActions.ts
git commit -m "feat(notifications): deleteClass avisa alunos afetados (class_cancelled)"
```

---

## Task 12: Gatilho `payment_past_due` (`handleStudentPreapprovalEvent`)

**Files:**
- Modify: `app/api/webhooks/mercadopago/studentHandlers.ts` (import + ramo `past_due`, linhas ~103–105)

- [ ] **Step 1: Adicionar import**

Localize (linhas ~5–15, topo do arquivo; `Sentry` já está importado):
```ts
import { addPeriod } from '@/lib/billing/periodicity'
```
Adicione logo abaixo:
```ts
import { notifyUsers } from '@/lib/notifications/dispatch'
```

- [ ] **Step 2: Adicionar a notificação no ramo `past_due`**

Localize (linhas ~103–105):
```ts
  } else if (mapped === 'past_due' || mapped === 'cancelled') {
    await admin.from('student_subscriptions').update({ status: mapped }).eq('id', sub.id)
  }
```
Substitua por:
```ts
  } else if (mapped === 'past_due' || mapped === 'cancelled') {
    await admin.from('student_subscriptions').update({ status: mapped }).eq('id', sub.id)

    // Só avisa em past_due (cobrança falhou / suspenso). Best-effort: uma falha
    // de notificação NUNCA quebra o webhook (o MP reentregaria o evento).
    if (mapped === 'past_due') {
      try {
        const { data: profile } = await admin
          .from('profiles')
          .select('phone')
          .eq('id', sub.student_id)
          .single()
        const { data: emailRow } = await admin
          .from('user_emails')
          .select('email')
          .eq('id', sub.student_id)
          .maybeSingle()

        await notifyUsers(admin, {
          orgId: sub.organization_id,
          recipients: [{
            userId: sub.student_id,
            email: (emailRow as { email: string } | null)?.email ?? null,
            phone: (profile as { phone: string | null } | null)?.phone ?? null,
          }],
          type: 'payment_past_due',
          title: 'Pagamento não aprovado',
          body: 'A cobrança da sua assinatura não foi aprovada. Regularize o pagamento para reativar seu acesso.',
          channels: ['inapp', 'email', 'whatsapp'],
        })
      } catch (err) {
        console.error('[webhook/mp] notifyUsers (payment_past_due) falhou', {
          sub: sub.id, error: err instanceof Error ? err.message : String(err),
        })
        Sentry.captureException(err, {
          tags: { channel: 'dispatch', notificationType: 'payment_past_due' },
          extra: { subscriptionId: sub.id, orgId: sub.organization_id },
        })
      }
    }
  }
```

- [ ] **Step 3: Verificar build**

Run: `npm run build`
Expected: build passa.

- [ ] **Step 4: Commit**

```bash
git add app/api/webhooks/mercadopago/studentHandlers.ts
git commit -m "feat(notifications): avisa aluno quando assinatura entra em past_due"
```

---

## Task 13: Verificação final

**Files:** nenhum (só verificação)

- [ ] **Step 1: Rodar toda a suíte de testes**

Run: `npm run test:run`
Expected: PASS em toda a suíte (incluindo os 5 novos arquivos: whatsapp, email, dispatch, lowCredit, creditNotifications). Zero testes quebrados.

- [ ] **Step 2: Build de produção**

Run: `npm run build`
Expected: build completa sem erro de tipo nem import não resolvido.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: sem novos erros de lint nos arquivos tocados.

- [ ] **Step 4: Grep de resíduos**

Run: `git grep -n "push_subscriptions\|WHATSAPP_GATEWAY\|_sendEmailNotifications\|_sendWhatsAppNotifications\|_sendPushNotifications"`
Expected: sem resultados em `features/` nem `app/` (referências à fachada antiga removidas). (Pode haver menções só em docs/specs — aceitável.)

- [ ] **Step 5: Checklist manual (o usuário executa, dependem de Supabase/rede)**

Confirme com o usuário:
1. Migration `user_emails` aplicada (`supabase db push` rodado).
2. Env vars preenchidas no ambiente real: `NOTIFICATIONS_FROM_EMAIL`, `ZAPI_INSTANCE_ID`, `ZAPI_TOKEN`, `ZAPI_CLIENT_TOKEN`, `RESEND_API_KEY` (já existe).
3. Broadcast de teste em `/admin/notificacoes` com E-mail+WhatsApp marcados → chega in-app + e-mail + WhatsApp (fail-closed silencioso se credencial ausente, sem quebrar a tela).
4. Push e "Somente alunos com PWA" aparecem desabilitados com rótulo "em breve".

- [ ] **Step 6: Commit final (se houver ajustes de lint/verificação)**

```bash
git add -A
git commit -m "chore(notifications): verificacao final da Frente 1"
```

---

## Self-Review (feita ao escrever este plano)

- **Cobertura da spec:** e-mail (Task 3) · WhatsApp (Task 2) · dispatch central `notifyUsers` (Task 5) · view `user_emails` (Task 4) · broadcast + UI (Task 9) · waitlist_offer (Task 10) · class_cancelled (Task 11) · low_credits (Tasks 6–8) · payment_past_due (Task 12) · env vars + dep (Task 1) · testes (cada task) · resiliência Sentry/try-catch (dispatch + cada gatilho). Todos os itens da spec têm task.
- **Consistência de tipos:** `notifyUsers(client, params)` com `NotifyUsersParams { orgId, recipients: {userId,email?,phone?}[], type: string, title, body, channels: NotificationChannel[] }` — usado identicamente em Tasks 7, 9, 10, 11, 12. `NotificationChannel = 'inapp'|'email'|'whatsapp'`. `checkLowCreditThreshold(client, studentId, orgId, delta)` — assinatura idêntica nos 2 call sites (Task 8), sempre `delta = -1`.
- **Sem placeholders:** todo passo de código tem o código completo; todo passo de verificação tem comando + saída esperada.
