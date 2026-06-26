# Check-in Wellhub (webhook) + criar aluno com senha temporária — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Receber check-ins reais da Wellhub por webhook (casando o aluno pelo `wellhub_id`, gravando check-in/presença ou parqueando como pendente) e permitir que o staff da academia crie alunos com senha temporária, forçando a troca no 1º login.

**Architecture:** Toda a parte específica da Wellhub (formato do payload, assinatura) fica isolada num parser trocável (`lib/checkin/wellhub.ts`). O núcleo que grava check-in (`lib/checkin/ingest.ts`) é compartilhado entre o webhook e o botão manual do admin — quando a doc autenticada da Wellhub chegar, só o parser muda. Config da integração e fila de órfãos ficam em tabelas novas por academia (`org_integrations`, `pending_checkins`). A troca forçada de senha usa a flag `user_metadata.must_change_password` no Auth, com gate nos layouts.

**Tech Stack:** Next.js 14 App Router · TypeScript · Supabase (Auth + Postgres + RLS) · Vitest · Vercel · `crypto` (Node) para HMAC e senha aleatória.

**Branch:** `develop`. Migrations são aplicadas manualmente pelo usuário no SQL Editor (nunca aplicar localmente). Comentários e commits em pt-BR. Nunca logar/commitar `webhook_secret` nem service-role key.

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/20260626000000_checkin_integrations.sql` | (novo) tabelas `org_integrations` + `pending_checkins` + RLS |
| `lib/checkin/wellhub.ts` | (novo) parser isolado: `parseWellhubEvent` + `verifyWellhubSignature` |
| `lib/checkin/wellhub.test.ts` | (novo) testes puros do parser/assinatura |
| `lib/auth/tempPassword.ts` | (novo) gerador de senha temporária |
| `lib/auth/tempPassword.test.ts` | (novo) testes do gerador |
| `lib/checkin/ingest.ts` | (novo) núcleo compartilhado: `ingestPartnerCheckin`, `recordResolvedCheckin`, `findLinkedSession` |
| `lib/checkin/ingest.test.ts` | (novo) testes do núcleo com client falso |
| `features/checkin/actions.ts` | (modificar) `recordCheckin` passa a chamar o núcleo; novas actions `connectIntegration`/`disconnectIntegration`/`resolvePendingCheckin` |
| `app/api/webhooks/wellhub/route.ts` | (novo) endpoint do webhook |
| `app/(admin)/admin/integracoes/page.tsx` + `IntegracoesClient.tsx` | (novo) tela de integrações + fila de pendentes |
| `lib/org/permissions.ts` + `.test.ts` | (modificar) nova área `integracoes` |
| `app/(admin)/layout.tsx` | (modificar) item de nav Integrações + gate `must_change_password` |
| `app/(dashboard)/layout.tsx` | (modificar) gate `must_change_password` |
| `features/organizations/actions.ts` | (modificar) nova action `createStudent` |
| `app/(admin)/admin/alunos/page.tsx` + `CriarAlunoButton.tsx` | (modificar/novo) botão e form Criar aluno |
| `app/(auth)/definir-senha/page.tsx` | (novo) tela de troca forçada (usuário logado) |
| `features/auth/actions.ts` | (novo) action `clearMustChangePassword` |
| `app/(dashboard)/home/page.tsx` + `components/ui/CheckinProgressCard.tsx` | (modificar/novo) card de progresso do aluno |
| `types/index.ts` | (modificar) `OrgIntegration`, `PendingCheckin` |

---

## Task 1: Migration — `org_integrations` + `pending_checkins` + tipos

**Files:**
- Create: `supabase/migrations/20260626000000_checkin_integrations.sql`
- Modify: `types/index.ts` (adicionar `OrgIntegration`, `PendingCheckin`)

Migration não tem teste automatizado (SQL aplicado manualmente). Verificação é por `npm run build` (tipos) + revisão do SQL.

- [ ] **Step 1: Escrever a migration**

Create `supabase/migrations/20260626000000_checkin_integrations.sql`:

```sql
-- Integração de check-in por parceiro (Wellhub/TotalPass), por academia.
-- org_integrations: config (gym_id + webhook_secret) que roteia o webhook → academia.
-- pending_checkins: fila de check-ins órfãos (ID não casou) para o admin resolver.

-- 1. Config da integração por academia.
create table if not exists org_integrations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  partner         checkin_partner not null,
  gym_id          text not null,
  webhook_secret  text not null,
  status          text not null default 'connected',
  connected_at    timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

-- Um gym_id mapeia exatamente uma academia (roteamento do webhook).
create unique index if not exists org_integrations_partner_gym_idx
  on org_integrations (partner, gym_id);
-- Uma config por parceiro por academia.
create unique index if not exists org_integrations_org_partner_idx
  on org_integrations (organization_id, partner);

-- 2. Fila de check-ins órfãos.
create table if not exists pending_checkins (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  partner           checkin_partner not null,
  partner_member_id text not null,
  checkin_date      date not null,
  external_ref      text,
  payload           jsonb not null,
  resolved          boolean not null default false,
  created_at        timestamptz not null default now()
);

create index if not exists pending_checkins_org_resolved_idx
  on pending_checkins (organization_id, resolved);
-- Dedupe de eventos reenviados pela Wellhub.
create unique index if not exists pending_checkins_partner_ref_idx
  on pending_checkins (partner, external_ref) where external_ref is not null;

-- 3. RLS — escrita só via service role (webhook/admin actions). Leitura: admin da academia.
alter table org_integrations enable row level security;
alter table pending_checkins enable row level security;

create policy "org_integrations_admin_org" on org_integrations
  for select using (is_org_admin(organization_id));
create policy "pending_checkins_admin_org" on pending_checkins
  for select using (is_org_admin(organization_id));
```

- [ ] **Step 2: Adicionar os tipos**

In `types/index.ts`, após a definição de `CheckinPartner` (linha ~12), adicione:

```ts
export interface OrgIntegration {
  id: string
  organization_id: string
  partner: CheckinPartner
  gym_id: string
  webhook_secret: string
  status: 'connected' | 'disconnected'
  connected_at: string
  created_at: string
}

export interface PendingCheckin {
  id: string
  organization_id: string
  partner: CheckinPartner
  partner_member_id: string
  checkin_date: string
  external_ref: string | null
  payload: unknown
  resolved: boolean
  created_at: string
}
```

- [ ] **Step 3: Verificar o build de tipos**

Run: `npm run build`
Expected: build sem erros de tipo.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260626000000_checkin_integrations.sql types/index.ts
git commit -m "feat(checkin): migration org_integrations + pending_checkins e tipos"
```

---

## Task 2: Parser Wellhub isolado (TDD, puro)

**Files:**
- Create: `lib/checkin/wellhub.ts`
- Test: `lib/checkin/wellhub.test.ts`

O payload de exemplo é uma **assunção documentada** no topo do arquivo; quando a doc autenticada da Wellhub chegar, só estas funções mudam.

- [ ] **Step 1: Escrever os testes (falhando)**

Create `lib/checkin/wellhub.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import crypto from 'crypto'
import { parseWellhubEvent, verifyWellhubSignature } from './wellhub'

const SAMPLE = JSON.stringify({
  id: 'evt_abc123',
  event: 'checkin.created',
  data: {
    gym: { id: 'gym_789' },
    member: { id: 'GP123456' },
    checkin: { at: '2026-06-25T13:45:00Z' },
  },
})

describe('parseWellhubEvent', () => {
  it('normaliza o payload de exemplo para o formato canônico', () => {
    expect(parseWellhubEvent(SAMPLE)).toEqual({
      gymId: 'gym_789',
      partnerMemberId: 'GP123456',
      checkinDate: '2026-06-25',
      externalRef: 'evt_abc123',
    })
  })

  it('lança erro em JSON malformado', () => {
    expect(() => parseWellhubEvent('{ not json')).toThrow()
  })

  it('lança erro quando faltam campos obrigatórios', () => {
    expect(() => parseWellhubEvent(JSON.stringify({ data: {} }))).toThrow()
  })
})

describe('verifyWellhubSignature', () => {
  const secret = 's3cr3t'
  const signature = crypto.createHmac('sha256', secret).update(SAMPLE).digest('hex')

  it('aceita assinatura válida', () => {
    expect(verifyWellhubSignature(SAMPLE, signature, secret)).toBe(true)
  })

  it('rejeita assinatura inválida', () => {
    expect(verifyWellhubSignature(SAMPLE, 'deadbeef', secret)).toBe(false)
  })

  it('rejeita assinatura vazia', () => {
    expect(verifyWellhubSignature(SAMPLE, '', secret)).toBe(false)
  })
})
```

- [ ] **Step 2: Rodar os testes — devem falhar**

Run: `npm run test:run -- lib/checkin/wellhub.test.ts`
Expected: FAIL ("Cannot find module './wellhub'").

- [ ] **Step 3: Implementar o parser**

Create `lib/checkin/wellhub.ts`:

```ts
// lib/checkin/wellhub.ts
// Peça ISOLADA da integração Wellhub: formato do payload + verificação de assinatura.
//
// ASSUNÇÃO (até a doc autenticada do Access Control API ser confirmada com as
// credenciais do Hudson): o evento de check-in chega como JSON no formato abaixo,
// e a assinatura é o HMAC-SHA256 (hex) do corpo cru com o webhook_secret da academia.
//   {
//     "id": "evt_abc123",                         // referência única do evento
//     "event": "checkin.created",
//     "data": {
//       "gym":     { "id": "gym_789" },           // unidade → roteia p/ academia
//       "member":  { "id": "GP123456" },          // ID Wellhub do aluno
//       "checkin": { "at": "2026-06-25T13:45:00Z" }
//     }
//   }
// Quando a doc real chegar, SÓ este arquivo muda — o núcleo de ingestão não.
import crypto from 'crypto'

export interface CanonicalCheckinEvent {
  gymId: string
  partnerMemberId: string
  checkinDate: string // yyyy-MM-dd
  externalRef: string | null
}

interface RawWellhubEvent {
  id?: string
  data?: {
    gym?: { id?: string }
    member?: { id?: string }
    checkin?: { at?: string }
  }
}

// Normaliza o payload cru da Wellhub. Lança erro se malformado/incompleto.
export function parseWellhubEvent(rawBody: string): CanonicalCheckinEvent {
  const raw = JSON.parse(rawBody) as RawWellhubEvent
  const gymId = raw.data?.gym?.id
  const partnerMemberId = raw.data?.member?.id
  const at = raw.data?.checkin?.at
  if (!gymId || !partnerMemberId || !at) {
    throw new Error('Wellhub event malformado: campos obrigatórios ausentes')
  }
  return {
    gymId,
    partnerMemberId,
    checkinDate: at.slice(0, 10),
    externalRef: raw.id ?? null,
  }
}

// Verifica a assinatura do corpo cru com o segredo da academia, em tempo constante.
export function verifyWellhubSignature(
  rawBody: string,
  signature: string,
  secret: string,
): boolean {
  if (!signature) return false
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
  const expectedBuf = Buffer.from(expected, 'hex')
  const sigBuf = Buffer.from(signature, 'hex')
  if (expectedBuf.length !== sigBuf.length) return false
  return crypto.timingSafeEqual(expectedBuf, sigBuf)
}
```

- [ ] **Step 4: Rodar os testes — devem passar**

Run: `npm run test:run -- lib/checkin/wellhub.test.ts`
Expected: PASS (6 testes).

- [ ] **Step 5: Commit**

```bash
git add lib/checkin/wellhub.ts lib/checkin/wellhub.test.ts
git commit -m "feat(checkin): parser Wellhub isolado + verificação de assinatura (TDD)"
```

---

## Task 3: Gerador de senha temporária (TDD, puro)

**Files:**
- Create: `lib/auth/tempPassword.ts`
- Test: `lib/auth/tempPassword.test.ts`

- [ ] **Step 1: Escrever os testes (falhando)**

Create `lib/auth/tempPassword.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { generateTempPassword } from './tempPassword'

const ALLOWED = /^[ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789]+$/
const AMBIGUOUS = /[Il1O0]/

describe('generateTempPassword', () => {
  it('usa o tamanho padrão de 10', () => {
    expect(generateTempPassword()).toHaveLength(10)
  })

  it('respeita o tamanho informado', () => {
    expect(generateTempPassword(16)).toHaveLength(16)
  })

  it('usa só caracteres do charset permitido (sem ambíguos)', () => {
    for (let i = 0; i < 50; i++) {
      const pwd = generateTempPassword()
      expect(pwd).toMatch(ALLOWED)
      expect(pwd).not.toMatch(AMBIGUOUS)
    }
  })
})
```

- [ ] **Step 2: Rodar os testes — devem falhar**

Run: `npm run test:run -- lib/auth/tempPassword.test.ts`
Expected: FAIL ("Cannot find module './tempPassword'").

- [ ] **Step 3: Implementar o gerador**

Create `lib/auth/tempPassword.ts`:

```ts
// lib/auth/tempPassword.ts
// Senha temporária aleatória para alunos criados pelo admin. Charset sem caracteres
// ambíguos (I, l, 1, O, 0) para facilitar repassar verbalmente/por escrito.
import { randomInt } from 'crypto'

const CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'

export function generateTempPassword(length = 10): string {
  let out = ''
  for (let i = 0; i < length; i++) {
    out += CHARSET[randomInt(CHARSET.length)]
  }
  return out
}
```

- [ ] **Step 4: Rodar os testes — devem passar**

Run: `npm run test:run -- lib/auth/tempPassword.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add lib/auth/tempPassword.ts lib/auth/tempPassword.test.ts
git commit -m "feat(auth): gerador de senha temporária sem caracteres ambíguos (TDD)"
```

---

## Task 4: Núcleo de ingestão compartilhado (TDD) + refactor `recordCheckin`

**Files:**
- Create: `lib/checkin/ingest.ts`
- Test: `lib/checkin/ingest.test.ts`
- Modify: `features/checkin/actions.ts` (`recordCheckin` passa a usar o núcleo; remove `findLinkedSession` daqui)

O núcleo NÃO é um arquivo `'use server'` (assim aceita um client injetável e fica testável). `recordCheckin` (manual, com `requireAdmin`) e o webhook viram dois chamadores do mesmo núcleo.

- [ ] **Step 1: Escrever os testes (falhando)**

Create `lib/checkin/ingest.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { ingestPartnerCheckin } from './ingest'

// Client falso: suporta o subconjunto de chamadas que o núcleo faz.
// - maybeSingle(): memberships (lookup do aluno), checkins (idempotência)
// - await builder: enrollments (findLinkedSession curto-circuita com [])
// - insert(): checkins, pending_checkins
function makeFakeClient(opts: {
  membership?: { user_id: string; monthly_checkin_target: number } | null
  existingCheckin?: { id: string } | null
}) {
  const inserts: Record<string, unknown[]> = {}
  const client = {
    from(table: string) {
      const builder: Record<string, unknown> = {}
      const chain = () => builder
      builder.select = chain
      builder.eq = chain
      builder.in = chain
      builder.limit = chain
      builder.maybeSingle = () => {
        if (table === 'memberships') return Promise.resolve({ data: opts.membership ?? null })
        if (table === 'checkins') return Promise.resolve({ data: opts.existingCheckin ?? null })
        return Promise.resolve({ data: null })
      }
      // findLinkedSession faz `await client.from('enrollments').select().eq().eq()`:
      // o builder precisa ser "thenable" e resolver com lista vazia.
      builder.then = (resolve: (v: { data: unknown[] }) => void) => resolve({ data: [] })
      builder.insert = (row: unknown) => {
        inserts[table] = [...(inserts[table] ?? []), row]
        return Promise.resolve({ error: null })
      }
      return builder
    },
  }
  return { client: client as never, inserts }
}

describe('ingestPartnerCheckin', () => {
  const base = {
    orgId: 'org-1',
    partner: 'wellhub' as const,
    partnerMemberId: 'GP123456',
    date: '2026-06-25',
    externalRef: 'evt_abc123',
    payload: { raw: true },
  }

  it('casa o aluno por wellhub_id e grava o check-in', async () => {
    const { client, inserts } = makeFakeClient({
      membership: { user_id: 'student-1', monthly_checkin_target: 12 },
      existingCheckin: null,
    })
    const res = await ingestPartnerCheckin(base, client)
    expect(res).toEqual({ recorded: true, pending: false, linkedSessionId: null })
    expect(inserts.checkins).toHaveLength(1)
    expect(inserts.checkins[0]).toMatchObject({
      organization_id: 'org-1',
      student_id: 'student-1',
      partner: 'wellhub',
      checkin_date: '2026-06-25',
      external_ref: 'evt_abc123',
      validation: 'wellhub',
    })
    expect(inserts.pending_checkins).toBeUndefined()
  })

  it('parqueia como pendente quando o ID não casa', async () => {
    const { client, inserts } = makeFakeClient({ membership: null })
    const res = await ingestPartnerCheckin(base, client)
    expect(res).toEqual({ recorded: false, pending: true })
    expect(inserts.pending_checkins).toHaveLength(1)
    expect(inserts.pending_checkins[0]).toMatchObject({
      organization_id: 'org-1',
      partner: 'wellhub',
      partner_member_id: 'GP123456',
      checkin_date: '2026-06-25',
      external_ref: 'evt_abc123',
      resolved: false,
    })
    expect(inserts.checkins).toBeUndefined()
  })

  it('é idempotente: não duplica quando já existe check-in com o mesmo external_ref', async () => {
    const { client, inserts } = makeFakeClient({
      membership: { user_id: 'student-1', monthly_checkin_target: 12 },
      existingCheckin: { id: 'chk-1' },
    })
    const res = await ingestPartnerCheckin(base, client)
    expect(res).toEqual({ recorded: true, pending: false, linkedSessionId: null })
    expect(inserts.checkins).toBeUndefined()
  })
})
```

- [ ] **Step 2: Rodar os testes — devem falhar**

Run: `npm run test:run -- lib/checkin/ingest.test.ts`
Expected: FAIL ("Cannot find module './ingest'").

- [ ] **Step 3: Implementar o núcleo**

Create `lib/checkin/ingest.ts`:

```ts
// lib/checkin/ingest.ts
// Núcleo de ingestão de check-in, COMPARTILHADO entre o botão manual do admin
// (features/checkin/actions.ts → recordCheckin) e o webhook do parceiro
// (app/api/webhooks/wellhub/route.ts). Não é 'use server': aceita um client
// injetável (testável) e não exige sessão de admin (o webhook não tem uma).
import { createAdminClient } from '@/lib/supabase/server'
import type { CheckinPartner } from '@/types'

type AdminClient = ReturnType<typeof createAdminClient>

/** Sessão agendada na data, de turma com matrícula ativa e reserva confirmada. */
export async function findLinkedSession(
  client: AdminClient,
  studentId: string,
  orgId: string,
  date: string,
): Promise<string | null> {
  const { data: enrolls } = await client
    .from('enrollments')
    .select('class_id')
    .eq('student_id', studentId)
    .eq('organization_id', orgId)
    .eq('is_active', true)
  const classIds = (enrolls ?? []).map((e: { class_id: string }) => e.class_id)
  if (classIds.length === 0) return null

  const { data: sessions } = await client
    .from('class_sessions')
    .select('id')
    .eq('organization_id', orgId)
    .eq('session_date', date)
    .eq('status', 'scheduled')
    .in('class_id', classIds)
  const sessionIds = (sessions ?? []).map((s: { id: string }) => s.id)
  if (sessionIds.length === 0) return null

  const { data: booking } = await client
    .from('session_bookings')
    .select('session_id')
    .eq('student_id', studentId)
    .eq('status', 'confirmed')
    .in('session_id', sessionIds)
    .limit(1)
    .maybeSingle()

  return (booking?.session_id as string | undefined) ?? null
}

export interface RecordResolvedInput {
  orgId: string
  studentId: string
  partner: CheckinPartner
  date: string
  externalRef: string | null
  validation: 'manual' | CheckinPartner
  createdBy?: string | null
}

// Grava um check-in JÁ resolvido (aluno conhecido). Idempotente por external_ref.
// Se a data cai em aula fixa com reserva confirmada, marca presença também.
export async function recordResolvedCheckin(
  client: AdminClient,
  input: RecordResolvedInput,
): Promise<{ recorded: boolean; linkedSessionId: string | null }> {
  if (input.externalRef) {
    const { data: existing } = await client
      .from('checkins')
      .select('id')
      .eq('organization_id', input.orgId)
      .eq('partner', input.partner)
      .eq('external_ref', input.externalRef)
      .maybeSingle()
    if (existing) return { recorded: true, linkedSessionId: null }
  }

  const linkedSessionId = await findLinkedSession(client, input.studentId, input.orgId, input.date)

  await client.from('checkins').insert({
    organization_id: input.orgId,
    student_id: input.studentId,
    partner: input.partner,
    checkin_date: input.date,
    session_id: linkedSessionId,
    external_ref: input.externalRef,
    validation: input.validation,
    created_by: input.createdBy ?? null,
  })

  if (linkedSessionId) {
    await client.from('attendance').upsert(
      {
        organization_id: input.orgId,
        student_id: input.studentId,
        session_id: linkedSessionId,
        status: 'present',
        source: input.partner,
        checked_in_at: new Date().toISOString(),
      },
      { onConflict: 'student_id,session_id' },
    )
  }

  return { recorded: true, linkedSessionId }
}

export interface IngestPartnerCheckinInput {
  orgId: string
  partner: CheckinPartner
  partnerMemberId: string
  date: string
  externalRef: string | null
  payload: unknown
  createdBy?: string | null
}

export interface IngestResult {
  recorded: boolean
  pending: boolean
  linkedSessionId?: string | null
}

// Ponto de entrada do webhook: casa o aluno pelo ID do parceiro; sem match → pendente.
export async function ingestPartnerCheckin(
  input: IngestPartnerCheckinInput,
  client: AdminClient = createAdminClient(),
): Promise<IngestResult> {
  const idColumn = input.partner === 'wellhub' ? 'wellhub_id' : 'totalpass_id'

  const { data: membership } = await client
    .from('memberships')
    .select('user_id, monthly_checkin_target')
    .eq('organization_id', input.orgId)
    .eq(idColumn, input.partnerMemberId)
    .maybeSingle()

  if (!membership) {
    await client.from('pending_checkins').insert({
      organization_id: input.orgId,
      partner: input.partner,
      partner_member_id: input.partnerMemberId,
      checkin_date: input.date,
      external_ref: input.externalRef,
      payload: input.payload,
      resolved: false,
    })
    return { recorded: false, pending: true }
  }

  const { recorded, linkedSessionId } = await recordResolvedCheckin(client, {
    orgId: input.orgId,
    studentId: membership.user_id as string,
    partner: input.partner,
    date: input.date,
    externalRef: input.externalRef,
    validation: input.partner,
    createdBy: input.createdBy ?? null,
  })

  return { recorded, pending: false, linkedSessionId }
}
```

- [ ] **Step 4: Rodar os testes — devem passar**

Run: `npm run test:run -- lib/checkin/ingest.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 5: Refatorar `recordCheckin` para usar o núcleo**

In `features/checkin/actions.ts`:

Substitua o import `getMonthWindow`/`findLinkedSession` local. No topo, adicione:
```ts
import { recordResolvedCheckin } from '@/lib/checkin/ingest'
```

Remova a função local `findLinkedSession` inteira (linhas ~178-214 — agora vive em `lib/checkin/ingest.ts`).

Substitua o corpo de `recordCheckin` a partir da idempotência/insert (após a validação, da linha `// Idempotência por external_ref` até o `return { ... }` final) por:

```ts
  // Idempotência + inserção + presença ficam no núcleo compartilhado (lib/checkin/ingest).
  const { linkedSessionId } = await recordResolvedCheckin(adminClient, {
    orgId,
    studentId,
    partner,
    date,
    externalRef: result.externalRef ?? null,
    validation: result.validation,
    createdBy: opts?.createdBy ?? null,
  })

  revalidatePath(`/admin/alunos/${studentId}`)
  return {
    progress: await monthlyProgress(adminClient, studentId, orgId, profile.monthly_checkin_target),
    linkedSessionId,
  }
}
```

> Nota: `recordCheckin` continua exigindo `requireAdmin`, validando o parceiro do aluno e calculando `monthlyProgress`. Só a parte de gravar (idempotência + insert + attendance) passou ao núcleo. O comportamento do botão manual fica idêntico (`validation: 'manual'`).

- [ ] **Step 6: Rodar a suíte de checkin e o build**

Run: `npm run test:run -- lib/checkin/ && npm run build`
Expected: PASS + build sem erros.

- [ ] **Step 7: Commit**

```bash
git add lib/checkin/ingest.ts lib/checkin/ingest.test.ts features/checkin/actions.ts
git commit -m "refactor(checkin): núcleo de ingestão compartilhado entre manual e webhook (TDD)"
```

---

## Task 5: Endpoint do webhook Wellhub

**Files:**
- Create: `app/api/webhooks/wellhub/route.ts`

Sem teste automatizado (parser e núcleo já cobertos por testes). Verificação por `npm run build` + smoke manual com `curl`.

- [ ] **Step 1: Implementar a rota**

Create `app/api/webhooks/wellhub/route.ts`:

```ts
// app/api/webhooks/wellhub/route.ts
// Webhook de check-in da Wellhub. runtime nodejs: precisa do corpo CRU para a
// assinatura. Roteia gym_id → academia via org_integrations e delega ao núcleo
// de ingestão. Sempre 200 para evento genuíno (mesmo órfão) para a Wellhub não
// reenviar. Segue o padrão do webhook do Mercado Pago.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { parseWellhubEvent, verifyWellhubSignature } from '@/lib/checkin/wellhub'
import { ingestPartnerCheckin } from '@/lib/checkin/ingest'

export const runtime = 'nodejs'

// Header de assinatura assumido (ajustar quando a doc real chegar — junto do parser).
const SIGNATURE_HEADER = 'x-wellhub-signature'

export async function POST(req: NextRequest) {
  const rawBody = await req.text()

  // 1. Parse do payload cru. Malformado → 400.
  let event
  try {
    event = parseWellhubEvent(rawBody)
  } catch {
    return NextResponse.json({ error: 'Malformed payload' }, { status: 400 })
  }

  const admin = createAdminClient()

  // 2. Roteia gym_id → academia. Gym desconhecido → 200 (nada a fazer).
  const { data: integration } = await admin
    .from('org_integrations')
    .select('organization_id, webhook_secret')
    .eq('partner', 'wellhub')
    .eq('gym_id', event.gymId)
    .eq('status', 'connected')
    .maybeSingle()

  if (!integration) {
    console.warn('[webhook/wellhub] gym desconhecido:', event.gymId)
    return NextResponse.json({ received: true })
  }

  // 3. Verifica a assinatura. Inválida → 401.
  const signature = req.headers.get(SIGNATURE_HEADER) ?? ''
  if (!verifyWellhubSignature(rawBody, signature, integration.webhook_secret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  // 4. Ingestão (casa aluno ou parqueia como pendente).
  await ingestPartnerCheckin(
    {
      orgId: integration.organization_id,
      partner: 'wellhub',
      partnerMemberId: event.partnerMemberId,
      date: event.checkinDate,
      externalRef: event.externalRef,
      payload: JSON.parse(rawBody),
    },
    admin,
  )

  // 5. Sempre 200 para evento genuíno.
  return NextResponse.json({ received: true })
}
```

- [ ] **Step 2: Verificar o build**

Run: `npm run build`
Expected: build sem erros; a rota aparece como `ƒ /api/webhooks/wellhub`.

- [ ] **Step 3: Commit**

```bash
git add app/api/webhooks/wellhub/route.ts
git commit -m "feat(checkin): endpoint do webhook Wellhub (parse + rota + ingestão)"
```

---

## Task 6: Actions de integração + tela Integrações + nav

**Files:**
- Modify: `lib/org/permissions.ts` + `lib/org/permissions.test.ts` (nova área `integracoes`)
- Modify: `features/checkin/actions.ts` (`connectIntegration`, `disconnectIntegration`, `resolvePendingCheckin`)
- Create: `app/(admin)/admin/integracoes/page.tsx`
- Create: `app/(admin)/admin/integracoes/IntegracoesClient.tsx`
- Modify: `app/(admin)/layout.tsx` (item de nav)

- [ ] **Step 1: Adicionar a área `integracoes` (TDD)**

In `lib/org/permissions.test.ts`, adicione um caso garantindo que `integracoes` é acessível a qualquer staff (não é owner-only):

```ts
it('integracoes é acessível ao professor (não é owner-only)', () => {
  expect(canAccessArea('integracoes', false)).toBe(true)
})
```

Run: `npm run test:run -- lib/org/permissions.test.ts`
Expected: FAIL (type error: `'integracoes'` não é `AdminArea`).

In `lib/org/permissions.ts`, adicione `'integracoes'` ao type `AdminArea`:

```ts
export type AdminArea =
  | 'dashboard' | 'aulas' | 'alunos' | 'notificacoes' | 'torneios'
  | 'financeiro' | 'configuracoes' | 'equipe' | 'integracoes'
```

(NÃO adicionar a `OWNER_ONLY` — staff/professor pode gerenciar integrações.)

Run: `npm run test:run -- lib/org/permissions.test.ts`
Expected: PASS.

- [ ] **Step 2: Implementar as actions de integração**

In `features/checkin/actions.ts`, adicione ao final do arquivo:

```ts
import type { CheckinPartner } from '@/types' // (já importado no topo — não duplicar)

/** Conecta/atualiza a integração do parceiro na academia ativa. Admin-only. */
export async function connectIntegration(
  partner: CheckinPartner,
  input: { gymId: string; webhookSecret: string },
): Promise<{ error?: string }> {
  const { ok, orgId } = await requireAdmin()
  if (!ok) return { error: 'Sem permissão de administrador.' }

  const gymId = input.gymId.trim()
  const webhookSecret = input.webhookSecret.trim()
  if (!gymId || !webhookSecret) return { error: 'Informe o gym_id e o webhook secret.' }

  const adminClient = createAdminClient()
  const { error } = await adminClient
    .from('org_integrations')
    .upsert(
      {
        organization_id: orgId,
        partner,
        gym_id: gymId,
        webhook_secret: webhookSecret,
        status: 'connected',
        connected_at: new Date().toISOString(),
      },
      { onConflict: 'organization_id,partner' },
    )
  if (error) return { error: 'Não foi possível salvar a integração.' }

  revalidatePath('/admin/integracoes')
  return {}
}

/** Marca a integração como desconectada (mantém o registro). Admin-only. */
export async function disconnectIntegration(
  partner: CheckinPartner,
): Promise<{ error?: string }> {
  const { ok, orgId } = await requireAdmin()
  if (!ok) return { error: 'Sem permissão de administrador.' }

  const adminClient = createAdminClient()
  const { error } = await adminClient
    .from('org_integrations')
    .update({ status: 'disconnected' })
    .eq('organization_id', orgId)
    .eq('partner', partner)
  if (error) return { error: 'Não foi possível desconectar.' }

  revalidatePath('/admin/integracoes')
  return {}
}

/** Vincula um check-in pendente a um aluno: grava o check-in real e marca resolvido. */
export async function resolvePendingCheckin(
  pendingId: string,
  studentId: string,
): Promise<{ error?: string }> {
  const { ok, orgId } = await requireAdmin()
  if (!ok) return { error: 'Sem permissão de administrador.' }

  const adminClient = createAdminClient()
  const { data: pending } = await adminClient
    .from('pending_checkins')
    .select('id, partner, checkin_date, external_ref, resolved')
    .eq('id', pendingId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!pending || pending.resolved) return { error: 'Pendência não encontrada.' }

  // Garante que o aluno pertence à academia ativa.
  const { data: membership } = await adminClient
    .from('memberships')
    .select('user_id')
    .eq('user_id', studentId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!membership) return { error: 'Aluno não encontrado nesta academia.' }

  await recordResolvedCheckin(adminClient, {
    orgId,
    studentId,
    partner: pending.partner as CheckinPartner,
    date: pending.checkin_date as string,
    externalRef: (pending.external_ref as string | null) ?? null,
    validation: pending.partner as CheckinPartner,
  })

  await adminClient.from('pending_checkins').update({ resolved: true }).eq('id', pendingId)

  revalidatePath('/admin/integracoes')
  return {}
}
```

> No topo de `features/checkin/actions.ts`, garanta os imports: `recordResolvedCheckin` (de `@/lib/checkin/ingest`, já adicionado na Task 4) e `CheckinPartner` (já importado via `import type { CheckinPartner } from '@/types'`). Não duplicar imports.

- [ ] **Step 3: Implementar a página Integrações (server)**

Create `app/(admin)/admin/integracoes/page.tsx`:

```tsx
// app/(admin)/admin/integracoes/page.tsx
import { createAdminClient, getCurrentOrgId } from '@/lib/supabase/server'
import { IntegracoesClient } from './IntegracoesClient'
import type { OrgIntegration, PendingCheckin } from '@/types'

export const dynamic = 'force-dynamic'

export default async function IntegracoesPage() {
  const adminClient = createAdminClient()
  const orgId = await getCurrentOrgId()

  const [{ data: integrationsRaw }, { data: pendingRaw }, { data: studentsRaw }] = await Promise.all([
    adminClient.from('org_integrations').select('*').eq('organization_id', orgId),
    adminClient
      .from('pending_checkins')
      .select('*')
      .eq('organization_id', orgId)
      .eq('resolved', false)
      .order('created_at', { ascending: false }),
    adminClient
      .from('memberships')
      .select('user_id, profiles:profiles!memberships_user_id_fkey!inner(full_name)')
      .eq('organization_id', orgId)
      .eq('role', 'student'),
  ])

  const integrations = (integrationsRaw ?? []) as OrgIntegration[]
  const pending = (pendingRaw ?? []) as PendingCheckin[]
  const students = ((studentsRaw ?? []) as unknown as {
    user_id: string
    profiles: { full_name: string } | { full_name: string }[] | null
  }[])
    .map((m) => {
      const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles
      return { id: m.user_id, full_name: p?.full_name ?? '' }
    })
    .sort((a, b) => a.full_name.localeCompare(b.full_name, 'pt-BR'))

  const wellhub = integrations.find((i) => i.partner === 'wellhub') ?? null
  const webhookUrl = `${process.env.NEXT_PUBLIC_SITE_URL ?? ''}/api/webhooks/wellhub`

  return (
    <IntegracoesClient
      wellhub={wellhub}
      pending={pending}
      students={students}
      webhookUrl={webhookUrl}
    />
  )
}
```

> Verifique o nome da env de URL pública usada no projeto (na Task 6, Step 6). Se for diferente de `NEXT_PUBLIC_SITE_URL`, ajuste a linha `webhookUrl`.

- [ ] **Step 4: Implementar o client da página**

Create `app/(admin)/admin/integracoes/IntegracoesClient.tsx`:

```tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { EmptyState } from '@/components/ui/EmptyState'
import { Plug } from 'lucide-react'
import {
  connectIntegration,
  disconnectIntegration,
  resolvePendingCheckin,
} from '@/features/checkin/actions'
import type { OrgIntegration, PendingCheckin } from '@/types'

interface Props {
  wellhub: OrgIntegration | null
  pending: PendingCheckin[]
  students: { id: string; full_name: string }[]
  webhookUrl: string
}

export function IntegracoesClient({ wellhub, pending, students, webhookUrl }: Props) {
  const router = useRouter()
  const [gymId, setGymId] = useState(wellhub?.gym_id ?? '')
  const [secret, setSecret] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const connected = wellhub?.status === 'connected'

  async function handleSave() {
    setError('')
    setSaving(true)
    const res = await connectIntegration('wellhub', { gymId, webhookSecret: secret })
    setSaving(false)
    if (res.error) {
      setError(res.error)
      return
    }
    setSecret('')
    router.refresh()
  }

  async function handleDisconnect() {
    setSaving(true)
    await disconnectIntegration('wellhub')
    setSaving(false)
    router.refresh()
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Integrações</h1>

      <Card>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">Wellhub</h2>
          <Badge variant={connected ? 'success' : 'default'}>
            {connected ? 'Conectado' : 'Desconectado'}
          </Badge>
        </div>

        <p className="text-sm text-slate-400 mb-4">
          Informe à Wellhub esta URL de webhook para receber os check-ins:
        </p>
        <code className="block text-xs bg-surface border border-surface-border rounded-lg px-3 py-2 text-brand-400 mb-4 break-all">
          {webhookUrl}
        </code>

        <div className="space-y-3">
          <Input label="Gym ID (Wellhub)" value={gymId} onChange={(e) => setGymId(e.target.value)} />
          <Input
            label="Webhook secret"
            type="password"
            placeholder={wellhub ? '••••••• (preencha para alterar)' : ''}
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
          />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex gap-2">
            <Button onClick={handleSave} loading={saving} disabled={!gymId || !secret}>
              {wellhub ? 'Salvar' : 'Conectar'}
            </Button>
            {connected && (
              <Button variant="ghost" onClick={handleDisconnect} loading={saving}>
                Desconectar
              </Button>
            )}
          </div>
        </div>
      </Card>

      <Card>
        <h2 className="text-lg font-semibold text-white mb-4">Check-ins pendentes</h2>
        {pending.length === 0 ? (
          <EmptyState icon={Plug} title="Nenhum check-in pendente." description="Check-ins cujo ID não casou com um aluno aparecem aqui." />
        ) : (
          <div className="space-y-3">
            {pending.map((p) => (
              <PendingRow key={p.id} pending={p} students={students} onResolved={() => router.refresh()} />
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

function PendingRow({
  pending,
  students,
  onResolved,
}: {
  pending: PendingCheckin
  students: { id: string; full_name: string }[]
  onResolved: () => void
}) {
  const [studentId, setStudentId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function handleLink() {
    if (!studentId) return
    setError('')
    setBusy(true)
    const res = await resolvePendingCheckin(pending.id, studentId)
    setBusy(false)
    if (res.error) {
      setError(res.error)
      return
    }
    onResolved()
  }

  return (
    <div className="border border-surface-border rounded-lg p-3 space-y-2">
      <div className="text-sm text-white">
        ID <span className="text-brand-400">{pending.partner_member_id}</span> ·{' '}
        <span className="text-slate-400">{pending.checkin_date}</span>
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        <select
          value={studentId}
          onChange={(e) => setStudentId(e.target.value)}
          className="flex-1 min-w-48 bg-surface-card border border-surface-border rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-500"
        >
          <option value="">Selecione um aluno…</option>
          {students.map((s) => (
            <option key={s.id} value={s.id}>
              {s.full_name}
            </option>
          ))}
        </select>
        <Button onClick={handleLink} loading={busy} disabled={!studentId} size="sm">
          Vincular
        </Button>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  )
}
```

> Antes de implementar, confirme rapidamente as props reais de `Badge` (variantes disponíveis: `success`/`default`?), `Button` (`variant`, `size`, `loading`) e `EmptyState` lendo `components/ui/`. Ajuste nomes de variantes se divergirem — o restante da lógica não muda.

- [ ] **Step 5: Adicionar o item de nav no layout admin**

In `app/(admin)/layout.tsx`, no array `allNav`, adicione (após `torneios`):

```ts
    { href: '/admin/integracoes', label: 'Integrações', area: 'integracoes' },
```

- [ ] **Step 6: Confirmar a env de URL pública e o build**

Run: `npm run build`
Expected: build sem erros; rota `/admin/integracoes` listada.

Grep para confirmar o nome da env de URL pública usada no projeto:
Run: `npm run test:run -- lib/org/permissions.test.ts`
Expected: PASS.

> Se o projeto já tem uma env de URL pública (ex.: a usada no link de convite — checar `lib/org/identifiers.ts` ou onde o invite URL é montado), use a mesma em `webhookUrl` no Step 3.

- [ ] **Step 7: Commit**

```bash
git add lib/org/permissions.ts lib/org/permissions.test.ts features/checkin/actions.ts app/(admin)/admin/integracoes/ app/(admin)/layout.tsx
git commit -m "feat(checkin): tela de Integrações Wellhub + fila de pendentes + actions"
```

---

## Task 7: `createStudent` + form Criar aluno

**Files:**
- Modify: `features/organizations/actions.ts` (`createStudent`)
- Create: `app/(admin)/admin/alunos/CriarAlunoButton.tsx`
- Modify: `app/(admin)/admin/alunos/page.tsx` (renderizar o botão)

- [ ] **Step 1: Implementar `createStudent`**

In `features/organizations/actions.ts`, adicione no topo o import do gerador e do `setStudentType`:

```ts
import { generateTempPassword } from '@/lib/auth/tempPassword'
import { setStudentType } from '@/features/checkin/actions'
```

Adicione a interface e a action (junto de `createProfessor`):

```ts
export interface CreateStudentInput {
  fullName: string
  email: string
  partner?: { type: 'wellhub' | 'totalpass'; partnerId: string; monthlyTarget: number }
}

// Cria um aluno na academia ativa com senha temporária gerada pelo sistema, forçando
// a troca no 1º login (must_change_password). Admin-only (qualquer staff role='admin').
export async function createStudent(
  input: CreateStudentInput,
): Promise<{ error?: string; password?: string }> {
  const ctx = await getStaffContext()
  if (!ctx) return { error: 'Não autenticado.' }

  const admin = createAdminClient()
  // Autorização: a membership da academia ativa precisa ser admin (staff).
  const { data: caller } = await admin
    .from('memberships')
    .select('role')
    .eq('user_id', ctx.userId)
    .eq('organization_id', ctx.organizationId)
    .single()
  if (caller?.role !== 'admin') return { error: 'Apenas o staff pode criar alunos.' }

  const email = input.email.trim()
  const fullName = input.fullName.trim()
  if (!fullName) return { error: 'Informe o nome do aluno.' }
  if (!email) return { error: 'Informe o e-mail do aluno.' }

  const { data: org } = await admin
    .from('organizations')
    .select('invite_code')
    .eq('id', ctx.organizationId)
    .single()
  if (!org) return { error: 'Academia não encontrada.' }

  const password = generateTempPassword()

  const { data: created, error: userErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: fullName,
      org_invite_code: org.invite_code,
      must_change_password: true,
    },
  })
  if (userErr || !created?.user) {
    const msg = userErr?.message?.toLowerCase().includes('already')
      ? 'Já existe uma conta com esse e-mail.'
      : 'Não foi possível criar o aluno.'
    return { error: msg }
  }

  // Opcional: vincular tipo parceiro (grava wellhub_id/totalpass_id + meta na membership).
  if (input.partner) {
    await setStudentType(created.user.id, {
      type: input.partner.type,
      partnerId: input.partner.partnerId,
      monthlyTarget: input.partner.monthlyTarget,
    })
  }

  revalidatePath('/admin/alunos')
  return { password }
}
```

> O trigger `handle_new_user` cria perfil + membership `student` na academia a partir de `org_invite_code` (padrão existente). O aluno permanece com `role='student'` (não promover). A senha é retornada uma única vez e nunca persistida.

- [ ] **Step 2: Verificar o build**

Run: `npm run build`
Expected: build sem erros. (Atenção a ciclos de import: `features/organizations/actions.ts` ↔ `features/checkin/actions.ts`. Ambos são `'use server'`; se o build acusar ciclo, mova `setStudentType` para ser chamado por id sem reimportar — ou inline a escrita do `wellhub_id`/meta na membership. Resolver conforme o erro reportado.)

- [ ] **Step 3: Implementar o botão/form Criar aluno (client)**

Create `app/(admin)/admin/alunos/CriarAlunoButton.tsx`:

```tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card } from '@/components/ui/Card'
import { createStudent } from '@/features/organizations/actions'

export function CriarAlunoButton() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [password, setPassword] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const res = await createStudent({ fullName, email })
    setLoading(false)
    if (res.error) {
      setError(res.error)
      return
    }
    setPassword(res.password ?? '')
    router.refresh()
  }

  function reset() {
    setOpen(false)
    setFullName('')
    setEmail('')
    setError('')
    setPassword(null)
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} size="sm">
        Criar aluno
      </Button>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <Card className="w-full max-w-md">
        {password !== null ? (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-white">Aluno criado!</h2>
            <p className="text-sm text-slate-400">
              Copie e repasse ao aluno. No 1º login, o sistema pedirá para trocar a senha.
            </p>
            <div className="bg-surface border border-surface-border rounded-lg px-3 py-2">
              <p className="text-xs text-slate-500">Senha temporária</p>
              <p className="text-lg font-mono text-brand-400 break-all">{password}</p>
            </div>
            <Button onClick={reset} className="w-full">
              Fechar
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <h2 className="text-lg font-semibold text-white">Criar aluno</h2>
            <Input label="Nome completo" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
            <Input label="E-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            {error && <p className="text-sm text-red-400">{error}</p>}
            <div className="flex gap-2">
              <Button type="submit" loading={loading} className="flex-1">
                Criar
              </Button>
              <Button type="button" variant="ghost" onClick={reset}>
                Cancelar
              </Button>
            </div>
          </form>
        )}
      </Card>
    </div>
  )
}
```

> Confirme as variantes de `Button` (`variant="ghost"`, `size="sm"`) em `components/ui/Button.tsx` e ajuste se necessário.

- [ ] **Step 4: Renderizar o botão na página de Alunos**

In `app/(admin)/admin/alunos/page.tsx`:

Adicione o import:
```tsx
import { CriarAlunoButton } from './CriarAlunoButton'
```

No header (o `div` com `<h1>Alunos</h1>`), troque o bloco para incluir o botão:
```tsx
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Alunos</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-400">{students.length} alunos</span>
          <CriarAlunoButton />
        </div>
      </div>
```

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: build sem erros.

- [ ] **Step 6: Commit**

```bash
git add features/organizations/actions.ts app/(admin)/admin/alunos/CriarAlunoButton.tsx app/(admin)/admin/alunos/page.tsx
git commit -m "feat(alunos): criar aluno com senha temporária (staff) + form"
```

---

## Task 8: Tela `/definir-senha` + gate `must_change_password`

**Files:**
- Create: `features/auth/actions.ts` (`clearMustChangePassword`)
- Create: `app/(auth)/definir-senha/page.tsx`
- Modify: `app/(admin)/layout.tsx` (gate)
- Modify: `app/(dashboard)/layout.tsx` (gate)

- [ ] **Step 1: Action que limpa a flag**

Create `features/auth/actions.ts`:

```ts
'use server'
// features/auth/actions.ts
import { createClient, createAdminClient } from '@/lib/supabase/server'

// Limpa a flag must_change_password no Auth após o usuário definir a nova senha.
export async function clearMustChangePassword(): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const admin = createAdminClient()
  const { error } = await admin.auth.admin.updateUserById(user.id, {
    user_metadata: { ...user.user_metadata, must_change_password: false },
  })
  if (error) return { error: 'Não foi possível concluir.' }
  return {}
}
```

- [ ] **Step 2: Tela definir-senha (usuário logado)**

Create `app/(auth)/definir-senha/page.tsx`:

```tsx
// app/(auth)/definir-senha/page.tsx
// Troca FORÇADA de senha no 1º login (aluno criado pelo admin com senha temporária).
// Distinta da /nova-senha (fluxo de link de recuperação PKCE). Aqui o usuário JÁ está
// logado: define a nova senha via updateUser e limpa must_change_password.
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { clearMustChangePassword } from '@/features/auth/actions'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card } from '@/components/ui/Card'

export default function DefinirSenhaPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (password.length < 6) {
      setError('A senha deve ter pelo menos 6 caracteres.')
      return
    }
    if (password !== confirm) {
      setError('As senhas não coincidem.')
      return
    }
    setLoading(true)
    const supabase = createClient()
    const { error: updErr } = await supabase.auth.updateUser({ password })
    if (updErr) {
      setError('Não foi possível alterar a senha. Tente novamente.')
      setLoading(false)
      return
    }
    const res = await clearMustChangePassword()
    setLoading(false)
    if (res.error) {
      setError(res.error)
      return
    }
    router.replace('/home')
  }

  return (
    <Card>
      <div className="h-1.5 -mx-4 -mt-4 mb-6 rounded-t-xl bg-gradient-to-r from-brand-500 to-brand-700" />
      <h2 className="text-lg font-semibold text-white mb-2">Defina sua senha</h2>
      <p className="text-sm text-slate-400 mb-6">
        Você entrou com uma senha temporária. Escolha uma senha nova para continuar.
      </p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input label="Nova senha" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <Input label="Confirmar nova senha" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <Button type="submit" loading={loading} size="lg" className="w-full">
          Salvar e continuar
        </Button>
      </form>
    </Card>
  )
}
```

- [ ] **Step 3: Gate no layout do aluno**

In `app/(dashboard)/layout.tsx`, logo após `if (!user) redirect('/login')`:

```ts
  if (user.user_metadata?.must_change_password === true) redirect('/definir-senha')
```

- [ ] **Step 4: Gate no layout admin**

In `app/(admin)/layout.tsx`, logo após `if (!user) redirect('/login')`:

```ts
  if (user.user_metadata?.must_change_password === true) redirect('/definir-senha')
```

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: build sem erros; rota `/definir-senha` listada.

- [ ] **Step 6: Commit**

```bash
git add features/auth/actions.ts app/(auth)/definir-senha/page.tsx app/(dashboard)/layout.tsx app/(admin)/layout.tsx
git commit -m "feat(auth): troca forçada de senha no 1º login (/definir-senha + gate)"
```

---

## Task 9: Card de progresso do aluno na home

**Files:**
- Create: `components/ui/CheckinProgressCard.tsx`
- Modify: `app/(dashboard)/home/page.tsx`

- [ ] **Step 1: Componente do card (read-only)**

Create `components/ui/CheckinProgressCard.tsx`:

```tsx
// components/ui/CheckinProgressCard.tsx
import { Card } from '@/components/ui/Card'
import type { CheckinProgress } from '@/lib/checkin/progress'

export function CheckinProgressCard({
  partner,
  progress,
}: {
  partner: 'wellhub' | 'totalpass'
  progress: CheckinProgress
}) {
  const label = partner === 'wellhub' ? 'Wellhub' : 'TotalPass'
  const pct = progress.target > 0 ? Math.min((progress.done / progress.target) * 100, 100) : 0

  return (
    <Card>
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-semibold text-white">Check-ins do mês · {label}</p>
        <span className="text-sm text-slate-400">
          {progress.done}
          {progress.target > 0 ? ` / ${progress.target}` : ''}
        </span>
      </div>
      {progress.target > 0 && (
        <div className="h-2 w-full rounded-full bg-surface-border overflow-hidden">
          <div className="h-full bg-brand-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
      )}
      {progress.target > 0 && progress.remaining > 0 && (
        <p className="text-xs text-slate-400 mt-2">Faltam {progress.remaining} para a meta.</p>
      )}
      {progress.target > 0 && progress.remaining === 0 && (
        <p className="text-xs text-green-400 mt-2">Meta do mês alcançada!</p>
      )}
    </Card>
  )
}
```

- [ ] **Step 2: Calcular e renderizar o progresso na home**

In `app/(dashboard)/home/page.tsx`:

Adicione os imports:
```ts
import { computeProgress } from '@/lib/checkin/progress'
import { getMonthWindow } from '@/lib/utils/monthWindow'
import { CheckinProgressCard } from '@/components/ui/CheckinProgressCard'
```

Após a linha `const showCredits = ...` (~linha 83), adicione o cálculo do progresso (só para parceiros):
```ts
  const isPartner = membership?.payment_type === 'wellhub' || membership?.payment_type === 'totalpass'
  let checkinProgress: ReturnType<typeof computeProgress> | null = null
  if (isPartner && membership) {
    const { from, to } = getMonthWindow(new Date())
    const { count } = await adminClient
      .from('checkins')
      .select('id', { count: 'exact', head: true })
      .eq('student_id', user.id)
      .eq('organization_id', orgId)
      .gte('checkin_date', from)
      .lte('checkin_date', to)
    checkinProgress = computeProgress(membership.monthly_checkin_target, count ?? 0)
  }
```

No JSX, logo após `<StatHeader ... />` (antes de "Aulas de hoje"):
```tsx
      {isPartner && checkinProgress && (
        <CheckinProgressCard
          partner={membership!.payment_type as 'wellhub' | 'totalpass'}
          progress={checkinProgress}
        />
      )}
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: build sem erros.

- [ ] **Step 4: Commit**

```bash
git add components/ui/CheckinProgressCard.tsx app/(dashboard)/home/page.tsx
git commit -m "feat(checkin): card de progresso mensal do aluno parceiro na home"
```

---

## Task 10: Verificação final

**Files:** nenhum (verificação).

- [ ] **Step 1: Suíte completa de testes**

Run: `npm run test:run`
Expected: todos os testes passam (incluindo os novos: `wellhub`, `tempPassword`, `ingest`, `permissions`).

- [ ] **Step 2: Build de produção**

Run: `npm run build`
Expected: build sem erros de tipo; rotas novas presentes: `/api/webhooks/wellhub`, `/admin/integracoes`, `/definir-senha`.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: sem erros (warnings pré-existentes toleráveis).

- [ ] **Step 4: Smoke manual do webhook (local, dev server)**

Suba `npm run dev`. Como ainda não há `org_integrations` no banco local (migration aplicada só pelo usuário em produção), o teste de gym desconhecido valida o caminho 200:
```bash
curl -i -X POST http://localhost:3000/api/webhooks/wellhub \
  -H "Content-Type: application/json" \
  -d '{"id":"evt_test","event":"checkin.created","data":{"gym":{"id":"gym_inexistente"},"member":{"id":"GP1"},"checkin":{"at":"2026-06-25T13:00:00Z"}}}'
```
Expected: `HTTP/1.1 200` com `{"received":true}` (gym desconhecido). Payload malformado → 400:
```bash
curl -i -X POST http://localhost:3000/api/webhooks/wellhub -H "Content-Type: application/json" -d '{bad'
```
Expected: `HTTP/1.1 400`.

- [ ] **Step 5: Push e merge para produção**

```bash
git push origin develop
git checkout main && git merge --ff-only develop && git push origin main && git checkout develop
```

- [ ] **Step 6: Lembrete de migration + credenciais (NÃO automatizar)**

Avisar o usuário:
1. Aplicar `supabase/migrations/20260626000000_checkin_integrations.sql` no SQL Editor de produção.
2. Confirmar/definir a env de URL pública usada em `webhookUrl` (Vercel) se ainda não existir.
3. Após o Hudson confirmar com a Wellhub (`gym_id`, `webhook_secret`/esquema de assinatura, doc do Access Control API): ajustar **apenas** `lib/checkin/wellhub.ts` (parser + `SIGNATURE_HEADER` no route) ao formato real, e cadastrar a integração em `/admin/integracoes`.

---

## Self-Review (checagem do plano contra o spec)

- **Cobertura do spec:** ✅ migrations `org_integrations`/`pending_checkins` (T1); parser isolado (T2); senha temporária (T3); núcleo compartilhado + refactor (T4); webhook (T5); tela Integrações + pendentes + actions (T6); criar aluno (T7); definir-senha + gate (T8); card de progresso (T9); verificação (T10). `checkins.validation='wellhub'` coberto pelo núcleo (sem mudança de schema). Flag `must_change_password` no Auth (T7/T8).
- **Placeholders:** nenhum TODO/“implementar depois”; todo passo tem código completo. Onde há incerteza de ambiente (nome da env de URL pública; variantes de `Button`/`Badge`/`EmptyState`; header de assinatura), o plano manda **confirmar e ajustar**, com fallback explícito — não deixa o trabalho em aberto.
- **Consistência de tipos:** `CanonicalCheckinEvent`, `IngestPartnerCheckinInput`/`IngestResult`, `RecordResolvedInput`, `OrgIntegration`, `PendingCheckin`, `CreateStudentInput` usados de forma consistente entre tarefas. `ingestPartnerCheckin(input, client?)` e `recordResolvedCheckin(client, input)` com as mesmas assinaturas em T4/T5/T6.
- **Risco conhecido:** possível ciclo de import entre os dois `'use server'` (`organizations/actions` ↔ `checkin/actions`) na T7 — endereçado no Step 2 com plano de contorno. Fake client da T4 cobre só os caminhos exercitados (enrollments vazio → `linkedSessionId: null`); o caminho com presença é coberto pelo `recordCheckin` manual (inalterado) + build.
