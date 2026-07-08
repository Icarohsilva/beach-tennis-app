# Botão de ajuda inline, feedback e melhorias no sininho — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remover a sobreposição do botão de ajuda, criar um canal de feedback (bug/elogio/ideia) lido no painel de plataforma, e permitir excluir/identificar notificações no sininho.

**Architecture:** O `HelpButton` ganha um modo `inline` e passa a viver no header (aluno) e no topo do painel (admin), em vez de flutuar. Um novo modal de feedback grava em `feedback` (+ bucket privado `feedback-images`) via server action; o dono da plataforma (`is_platform_admin`) lê em `/super-admin/feedback`. O `NotificationBell` ganha exclusão individual (hard delete) e rótulo de remetente derivado do tipo.

**Tech Stack:** Next.js 14 App Router, TypeScript, Tailwind, Supabase (Postgres + Storage + RLS), Vitest.

Spec: [docs/superpowers/specs/2026-07-08-help-button-feedback-notifications-design.md](../specs/2026-07-08-help-button-feedback-notifications-design.md)

---

## File Structure

Novos:
- `supabase/migrations/20260708000100_feedback.sql` — tabela `feedback` + bucket `feedback-images` + RLS
- `features/feedback/actions.ts` — `submitFeedback`, `setFeedbackStatus`
- `components/feedback/FeedbackModal.tsx` — modal client de envio
- `lib/utils/notificationSender.ts` + `.test.ts` — rótulo puro de remetente
- `app/(super-admin)/super-admin/feedback/page.tsx` — listagem para o dono da plataforma
- `app/(super-admin)/super-admin/feedback/FeedbackList.tsx` — client (filtro + status)

Alterados:
- `components/tour/HelpButton.tsx` — modo `inline` + item "Enviar feedback"
- `app/(dashboard)/layout.tsx` — help inline no header, ao lado do sininho; passa `orgName` ao sininho
- `app/(admin)/layout.tsx` — help inline no sidebar (desktop) e via slot no mobile nav
- `components/ui/AdminMobileNav.tsx` — aceita `helpSlot`
- `components/ui/NotificationBell.tsx` — excluir item, remetente, layout
- `features/notificacoes/actions.ts` — `deleteNotification`
- `app/(super-admin)/super-admin/page.tsx` — link "Feedback"

---

## Task 1: Migration — tabela `feedback` + bucket

**Files:**
- Create: `supabase/migrations/20260708000100_feedback.sql`

- [ ] **Step 1: Criar a migration**

```sql
-- supabase/migrations/20260708000100_feedback.sql

-- Canal de feedback do usuário (bug / elogio / ideia). Lido só pelo dono da
-- plataforma (profiles.is_platform_admin). organization_id é só contexto.
create table if not exists feedback (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references profiles(id) on delete cascade,
  organization_id uuid references organizations(id) on delete set null,
  category        text not null check (category in ('bug','elogio','ideia')),
  message         text not null,
  image_path      text,
  status          text not null default 'novo' check (status in ('novo','lido','resolvido')),
  created_at      timestamptz not null default now()
);

create index if not exists idx_feedback_created on feedback(created_at desc);

alter table feedback enable row level security;

-- Usuário insere a própria linha.
drop policy if exists "feedback_insert_own" on feedback;
create policy "feedback_insert_own" on feedback
  for insert to authenticated
  with check (user_id = auth.uid());

-- Só platform admin lê.
drop policy if exists "feedback_select_platform_admin" on feedback;
create policy "feedback_select_platform_admin" on feedback
  for select to authenticated
  using (
    exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.is_platform_admin = true
    )
  );

-- Só platform admin altera status.
drop policy if exists "feedback_update_platform_admin" on feedback;
create policy "feedback_update_platform_admin" on feedback
  for update to authenticated
  using (
    exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.is_platform_admin = true
    )
  );

-- Bucket privado para imagens de feedback. Path: {user_id}/{uuid}.{ext}
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'feedback-images',
  'feedback-images',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- Usuário só faz upload no próprio path ({user_id}/...).
drop policy if exists "feedback_img_upload_own" on storage.objects;
create policy "feedback_img_upload_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'feedback-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Leitura das imagens pelo painel é via service role (createAdminClient), sem policy extra.
```

- [ ] **Step 2: Aplicar a migration**

O usuário aplica migrations (o CLI local não tem auth). Peça para rodar:

Run: `supabase db push`
Expected: aplica `20260708000100_feedback.sql` sem erro.

> Se o agente não puder aplicar, marque o passo e prossiga — o código das próximas tasks não quebra o build sem a tabela, só falha em runtime até a migration rodar.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260708000100_feedback.sql
git commit -m "feat(feedback): migration da tabela feedback e bucket feedback-images"
```

---

## Task 2: Server actions de feedback

**Files:**
- Create: `features/feedback/actions.ts`

Segue o padrão de [features/branding/actions.ts:26-40](../../../features/branding/actions.ts) (FormData + File + admin client no storage) e resolve a org ativa via `getActiveOrgId`.

- [ ] **Step 1: Criar o arquivo de actions**

```typescript
'use server'
// features/feedback/actions.ts
import { randomUUID } from 'crypto'
import { createClient, createAdminClient, getActiveOrgId } from '@/lib/supabase/server'

const MAX_IMAGE_BYTES = 5 * 1024 * 1024 // 5MB
const IMG_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}
const CATEGORIES = ['bug', 'elogio', 'ideia'] as const
type Category = (typeof CATEGORIES)[number]

export async function submitFeedback(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Faça login para enviar feedback.' }

  const category = String(formData.get('category') ?? '') as Category
  if (!CATEGORIES.includes(category)) {
    return { ok: false, error: 'Categoria inválida.' }
  }

  const message = String(formData.get('message') ?? '').trim()
  if (message.length < 5) {
    return { ok: false, error: 'Descreva com pelo menos 5 caracteres.' }
  }

  const admin = createAdminClient()
  let imagePath: string | null = null

  const file = formData.get('image')
  if (file instanceof File && file.size > 0) {
    const ext = IMG_EXT[file.type]
    if (!ext) return { ok: false, error: 'Imagem deve ser JPG, PNG ou WEBP.' }
    if (file.size > MAX_IMAGE_BYTES) {
      return { ok: false, error: 'Imagem deve ter no máximo 5MB.' }
    }
    const path = `${user.id}/${randomUUID()}.${ext}`
    const { error: upErr } = await admin.storage
      .from('feedback-images')
      .upload(path, file, { contentType: file.type })
    if (upErr) return { ok: false, error: 'Erro ao enviar a imagem. Tente novamente.' }
    imagePath = path
  }

  const organizationId = await getActiveOrgId()

  const { error: insErr } = await admin.from('feedback').insert({
    user_id: user.id,
    organization_id: organizationId,
    category,
    message,
    image_path: imagePath,
  })
  if (insErr) return { ok: false, error: 'Erro ao salvar. Tente novamente.' }

  return { ok: true }
}

export async function setFeedbackStatus(
  id: string,
  status: 'novo' | 'lido' | 'resolvido',
): Promise<{ ok: boolean }> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false }

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('is_platform_admin')
    .eq('id', user.id)
    .single()
  if (profile?.is_platform_admin !== true) return { ok: false }

  const { error } = await admin.from('feedback').update({ status }).eq('id', id)
  return { ok: !error }
}
```

- [ ] **Step 2: Verificar o typecheck/build**

Run: `npm run build`
Expected: compila sem erro de tipos em `features/feedback/actions.ts`.

- [ ] **Step 3: Commit**

```bash
git add features/feedback/actions.ts
git commit -m "feat(feedback): server actions submitFeedback e setFeedbackStatus"
```

---

## Task 3: FeedbackModal

**Files:**
- Create: `components/feedback/FeedbackModal.tsx`

Segue o padrão visual de [components/tour/FaqModal.tsx](../../../components/tour/FaqModal.tsx).

- [ ] **Step 1: Criar o modal**

```tsx
'use client'
// components/feedback/FeedbackModal.tsx
import { useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { submitFeedback } from '@/features/feedback/actions'

type Category = 'bug' | 'elogio' | 'ideia'

const OPTIONS: { value: Category; label: string; emoji: string }[] = [
  { value: 'bug', label: 'Bug', emoji: '🐞' },
  { value: 'elogio', label: 'Elogio', emoji: '💛' },
  { value: 'ideia', label: 'Ideia', emoji: '💡' },
]

export function FeedbackModal({ onClose }: { onClose: () => void }) {
  const [category, setCategory] = useState<Category>('bug')
  const [message, setMessage] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (message.trim().length < 5) {
      setError('Descreva com pelo menos 5 caracteres.')
      return
    }
    setLoading(true)
    const fd = new FormData()
    fd.set('category', category)
    fd.set('message', message.trim())
    if (file) fd.set('image', file)
    const res = await submitFeedback(fd)
    setLoading(false)
    if (!res.ok) {
      setError(res.error ?? 'Não foi possível enviar. Tente novamente.')
      return
    }
    setDone(true)
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-lg max-h-[85vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-surface-card border border-surface-border p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-white">Enviar feedback</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1" aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>

        {done ? (
          <div className="py-6 text-center">
            <p className="text-emerald-400 text-sm font-semibold">Recebemos seu feedback. Obrigado!</p>
            <Button className="mt-4" onClick={onClose}>Fechar</Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="grid grid-cols-3 gap-2">
              {OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setCategory(opt.value)}
                  className={
                    'flex flex-col items-center gap-1 rounded-lg border px-2 py-3 text-xs font-semibold transition-colors ' +
                    (category === opt.value
                      ? 'border-brand-500 bg-brand-600/15 text-white'
                      : 'border-surface-border text-slate-400 hover:text-white')
                  }
                >
                  <span className="text-xl">{opt.emoji}</span>
                  {opt.label}
                </button>
              ))}
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-slate-300">Descrição</label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={4}
                placeholder="Conte o que aconteceu, o que gostou ou o que sugere..."
                className="w-full rounded-lg bg-surface border border-surface-border px-3 py-2 text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-slate-300">Imagem (opcional)</label>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="text-xs text-slate-400 file:mr-3 file:rounded-md file:border-0 file:bg-surface-border file:px-3 file:py-1.5 file:text-slate-200"
              />
              {file && <p className="text-[11px] text-slate-500 truncate">{file.name}</p>}
            </div>

            {error && <p className="text-sm text-red-400">{error}</p>}

            <Button type="submit" loading={loading} size="lg" className="w-full">
              Enviar
            </Button>
          </form>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add components/feedback/FeedbackModal.tsx
git commit -m "feat(feedback): modal de envio de bug/elogio/ideia"
```

---

## Task 4: HelpButton — modo inline + item de feedback

**Files:**
- Modify: `components/tour/HelpButton.tsx`

- [ ] **Step 1: Reescrever o componente**

```tsx
'use client'

import { useState } from 'react'
import { HelpCircle, PlayCircle, MessageCircleQuestion, MessageSquarePlus } from 'lucide-react'
import type { TourVariant } from '@/lib/tour/autostart'
import { FaqModal } from './FaqModal'
import { FeedbackModal } from '@/components/feedback/FeedbackModal'

export function HelpButton({
  variant,
  className,
  inline = false,
}: {
  variant: TourVariant
  className?: string
  inline?: boolean
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [faqOpen, setFaqOpen] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)

  function replay() {
    setMenuOpen(false)
    window.dispatchEvent(new CustomEvent('tour:replay'))
  }

  const wrapperClass = inline ? 'relative' : 'fixed z-50 ' + (className ?? 'bottom-24 right-4')
  const menuPosClass = inline ? 'top-full mt-2' : 'bottom-full mb-2'

  return (
    <>
      <div className={wrapperClass}>
        <button
          data-tour="tour-help-button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="Central de Ajuda"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-card border border-surface-border text-brand-500 shadow-lg hover:bg-surface-border transition-colors"
        >
          <HelpCircle className="h-5 w-5" />
        </button>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
            <div
              className={
                'absolute right-0 z-50 w-56 rounded-xl border border-surface-border bg-surface-card shadow-lg overflow-hidden ' +
                menuPosClass
              }
            >
              <button
                onClick={replay}
                className="flex w-full items-center gap-2 px-4 py-3 text-sm text-slate-200 hover:bg-surface-border transition-colors"
              >
                <PlayCircle className="h-4 w-4 text-brand-500" />
                Ver tutorial novamente
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false)
                  setFaqOpen(true)
                }}
                className="flex w-full items-center gap-2 px-4 py-3 text-sm text-slate-200 hover:bg-surface-border transition-colors border-t border-surface-border"
              >
                <MessageCircleQuestion className="h-4 w-4 text-brand-500" />
                Perguntas frequentes
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false)
                  setFeedbackOpen(true)
                }}
                className="flex w-full items-center gap-2 px-4 py-3 text-sm text-slate-200 hover:bg-surface-border transition-colors border-t border-surface-border"
              >
                <MessageSquarePlus className="h-4 w-4 text-brand-500" />
                Enviar feedback
              </button>
            </div>
          </>
        )}
      </div>
      {faqOpen && <FaqModal variant={variant} onClose={() => setFaqOpen(false)} />}
      {feedbackOpen && <FeedbackModal onClose={() => setFeedbackOpen(false)} />}
    </>
  )
}
```

Notas:
- O botão encolheu de `h-11 w-11` para `h-9 w-9` para caber no header (h-11).
- O menu agora abre relativo ao botão (`absolute`), acima quando flutuante (`bottom-full`) e abaixo quando inline (`top-full`), sempre alinhado à direita.

- [ ] **Step 2: Verificar build**

Run: `npm run build`
Expected: compila sem erro.

- [ ] **Step 3: Commit**

```bash
git add components/tour/HelpButton.tsx
git commit -m "feat(help): modo inline e item 'Enviar feedback' no menu de ajuda"
```

---

## Task 5: Help inline no header do aluno + orgName no sininho

**Files:**
- Modify: `app/(dashboard)/layout.tsx`

- [ ] **Step 1: Agrupar help + sininho no header e remover o flutuante**

Trocar o bloco do `NotificationBell` no header (linhas ~72-73) por um flex com o HelpButton:

```tsx
        <div className="flex items-center gap-1">
          <HelpButton variant="aluno" inline />
          <NotificationBell initialNotifications={notifications} orgName={org?.name ?? null} />
        </div>
        {unreadCount > 0 && <span className="sr-only">{unreadCount} notificações não lidas</span>}
```

- [ ] **Step 2: Remover o HelpButton flutuante do fim do layout**

Apagar a linha:

```tsx
      <HelpButton variant="aluno" className="bottom-24 right-4" />
```

(O `import { HelpButton }` permanece, agora usado no header.)

- [ ] **Step 3: Verificar build**

Run: `npm run build`
Expected: compila. `NotificationBell` aceita `orgName` (adicionado na Task 7 — se o build rodar antes da Task 7, adicione o prop lá primeiro). Ordem recomendada: fazer Task 7 antes desta, ou juntar o commit.

- [ ] **Step 4: Commit**

```bash
git add "app/(dashboard)/layout.tsx"
git commit -m "feat(help): botão de ajuda inline ao lado do sininho no dashboard"
```

---

## Task 6: Help inline no painel admin

**Files:**
- Modify: `components/ui/AdminMobileNav.tsx`
- Modify: `app/(admin)/layout.tsx`

- [ ] **Step 1: AdminMobileNav aceita um slot de ajuda**

Adicionar prop `helpSlot` e renderizar à esquerda do botão Menu no topbar mobile.

Alterar a assinatura e o topbar em [components/ui/AdminMobileNav.tsx](../../../components/ui/AdminMobileNav.tsx):

```tsx
export function AdminMobileNav({
  links,
  tourTargets,
  helpSlot,
}: {
  links: NavLink[]
  tourTargets?: Record<string, string>
  helpSlot?: React.ReactNode
}) {
```

E no topbar (o `<div className="fixed top-0 ... md:hidden">`), trocar o botão Menu por um flex com o slot:

```tsx
      <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 py-3 bg-surface-card border-b border-surface-border md:hidden">
        <span className="text-white font-semibold text-sm">Painel Admin</span>
        <div className="flex items-center gap-2">
          {helpSlot}
          <button onClick={() => setOpen(v => !v)} className="text-slate-400 hover:text-white p-1" aria-label="Menu">
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>
```

- [ ] **Step 2: Layout admin passa o help inline (desktop + mobile) e remove o flutuante**

Em [app/(admin)/layout.tsx](../../../app/(admin)/layout.tsx):

No header do sidebar desktop (o bloco gradiente, linhas ~106-112), adicionar o help alinhado à direita. Trocar o `<div className="bg-gradient-to-br ...">` por:

```tsx
        <div className="bg-gradient-to-br from-brand-600 to-brand-800 px-4 py-5 mb-2">
          <div className="flex items-start justify-between">
            <Logo variant="icon" size="sm" logoUrl={org?.logo_url ?? null} orgName={org?.name ?? undefined} />
            <HelpButton variant="admin" inline />
          </div>
          <span className="text-sm font-bold text-white mt-1 block truncate">
            {org?.name ?? 'Painel Admin'}
          </span>
          <span className="text-xs text-white/70 block">Painel Admin</span>
        </div>
```

Passar o slot para o mobile nav:

```tsx
      <AdminMobileNav
        links={navLinks}
        tourTargets={tourTargets}
        helpSlot={<HelpButton variant="admin" inline />}
      />
```

Remover a linha do flutuante no fim do layout:

```tsx
      <HelpButton variant="admin" className="bottom-4 right-4" />
```

(Manter o `import { HelpButton }`.)

- [ ] **Step 3: Verificar build**

Run: `npm run build`
Expected: compila sem erro.

- [ ] **Step 4: Commit**

```bash
git add "app/(admin)/layout.tsx" components/ui/AdminMobileNav.tsx
git commit -m "feat(help): botão de ajuda inline no painel admin (sidebar e topo mobile)"
```

---

## Task 7: NotificationBell — excluir, remetente e layout

**Files:**
- Create: `lib/utils/notificationSender.ts`
- Test: `lib/utils/notificationSender.test.ts`
- Modify: `features/notificacoes/actions.ts`
- Modify: `components/ui/NotificationBell.tsx`

- [ ] **Step 1: Escrever o teste do rótulo de remetente (falha)**

```typescript
// lib/utils/notificationSender.test.ts
import { describe, it, expect } from 'vitest'
import { notificationSender } from './notificationSender'

describe('notificationSender', () => {
  it('mostra o nome da academia para admin_message', () => {
    expect(notificationSender('admin_message', 'Arena Beach')).toBe('Arena Beach')
  })

  it('cai em "Academia" se admin_message sem nome', () => {
    expect(notificationSender('admin_message', null)).toBe('Academia')
    expect(notificationSender('admin_message', '   ')).toBe('Academia')
  })

  it('mostra "Sistema" para os demais tipos', () => {
    expect(notificationSender('waitlist_offer', 'Arena Beach')).toBe('Sistema')
    expect(notificationSender('no_credit', null)).toBe('Sistema')
    expect(notificationSender('new_event', 'X')).toBe('Sistema')
  })
})
```

- [ ] **Step 2: Rodar o teste (deve falhar)**

Run: `npm run test:run -- lib/utils/notificationSender.test.ts`
Expected: FAIL — módulo `./notificationSender` não existe.

- [ ] **Step 3: Implementar a função**

```typescript
// lib/utils/notificationSender.ts
export function notificationSender(type: string, orgName?: string | null): string {
  if (type === 'admin_message') return orgName?.trim() || 'Academia'
  return 'Sistema'
}
```

- [ ] **Step 4: Rodar o teste (deve passar)**

Run: `npm run test:run -- lib/utils/notificationSender.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 5: Adicionar a action de exclusão**

Em [features/notificacoes/actions.ts](../../../features/notificacoes/actions.ts), adicionar:

```typescript
export async function deleteNotification(id: string): Promise<void> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  await supabase
    .from('notifications')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)
}
```

- [ ] **Step 6: Reescrever o NotificationBell**

```tsx
'use client'
import { useState, useTransition } from 'react'
import { Bell, X } from 'lucide-react'
import { markAllNotificationsRead, deleteNotification } from '@/features/notificacoes/actions'
import { notificationSender } from '@/lib/utils/notificationSender'

interface Notification {
  id: string
  type: string
  title: string
  body: string
  read: boolean
  created_at: string
}

interface NotificationBellProps {
  initialNotifications: Notification[]
  orgName?: string | null
}

const typeIcon: Record<string, string> = {
  waitlist_offer: '🎾',
  no_credit: '⚠️',
  admin_message: '📣',
  new_event: '🏆',
}

export function NotificationBell({ initialNotifications, orgName }: NotificationBellProps) {
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState(initialNotifications)
  const [, start] = useTransition()

  const unread = notifications.filter((n) => !n.read).length

  function handleOpen() {
    setOpen((v) => !v)
    if (!open && unread > 0) {
      start(async () => {
        await markAllNotificationsRead()
        setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
      })
    }
  }

  function handleDelete(id: string) {
    setNotifications((prev) => prev.filter((n) => n.id !== id))
    start(async () => {
      await deleteNotification(id)
    })
  }

  return (
    <div className="relative">
      <button
        onClick={handleOpen}
        aria-label="Notificações"
        className="relative p-2 text-slate-400 hover:text-white transition-colors"
      >
        <Bell size={20} />
        {unread > 0 && (
          <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-10 z-50 w-[min(20rem,calc(100vw-1.5rem))] max-h-96 overflow-y-auto bg-surface-card border border-surface-border rounded-2xl shadow-xl">
            <div className="px-4 py-2.5 border-b border-surface-border">
              <p className="text-white text-sm font-semibold">Notificações</p>
            </div>
            {notifications.length === 0 ? (
              <p className="text-slate-400 text-sm text-center py-6">Nenhuma notificação.</p>
            ) : (
              <ul>
                {notifications.map((n) => (
                  <li
                    key={n.id}
                    className={`group relative px-3 py-2.5 border-b border-surface-border/50 last:border-0 ${
                      !n.read ? 'bg-brand-600/10' : ''
                    }`}
                  >
                    <div className="flex gap-2">
                      <span className="text-base shrink-0 leading-5">{typeIcon[n.type] ?? '🔔'}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-white text-xs font-semibold truncate">{n.title}</p>
                          <button
                            onClick={() => handleDelete(n.id)}
                            aria-label="Excluir notificação"
                            className="shrink-0 text-slate-500 hover:text-red-400 p-0.5"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <p className="text-slate-400 text-xs mt-0.5 leading-relaxed">{n.body}</p>
                        <p className="text-slate-600 text-[10px] mt-1">
                          {notificationSender(n.type, orgName)} ·{' '}
                          {new Date(n.created_at).toLocaleDateString('pt-BR', {
                            day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                          })}
                        </p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  )
}
```

Mudanças: prop `orgName`, botão `X` por item com delete otimista, rótulo de remetente, itens mais compactos e largura responsiva (`w-[min(20rem,calc(100vw-1.5rem))]`).

- [ ] **Step 7: Rodar testes e build**

Run: `npm run test:run -- lib/utils/notificationSender.test.ts`
Expected: PASS.

Run: `npm run build`
Expected: compila (o `orgName` já é passado pelo layout na Task 5).

- [ ] **Step 8: Commit**

```bash
git add lib/utils/notificationSender.ts lib/utils/notificationSender.test.ts features/notificacoes/actions.ts components/ui/NotificationBell.tsx
git commit -m "feat(notificacoes): excluir individual, remetente e layout no sininho"
```

---

## Task 8: Painel super-admin de feedback

**Files:**
- Create: `app/(super-admin)/super-admin/feedback/page.tsx`
- Create: `app/(super-admin)/super-admin/feedback/FeedbackList.tsx`
- Modify: `app/(super-admin)/super-admin/page.tsx`

- [ ] **Step 1: Página server que carrega os feedbacks**

```tsx
// app/(super-admin)/super-admin/feedback/page.tsx
import { createAdminClient } from '@/lib/supabase/server'
import { FeedbackList, type FeedbackRow } from './FeedbackList'

export default async function FeedbackPage() {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('feedback')
    .select('id, category, message, image_path, status, created_at, organization_id, user_id, profiles!feedback_user_id_fkey(full_name), organizations(name)')
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) return <p className="text-sm text-red-400">Erro ao carregar feedbacks.</p>

  const rows: FeedbackRow[] = await Promise.all(
    (data ?? []).map(async (f: any) => {
      let imageUrl: string | null = null
      if (f.image_path) {
        const { data: signed } = await admin.storage
          .from('feedback-images')
          .createSignedUrl(f.image_path, 60 * 60)
        imageUrl = signed?.signedUrl ?? null
      }
      return {
        id: f.id,
        category: f.category,
        message: f.message,
        status: f.status,
        createdAt: f.created_at,
        author: f.profiles?.full_name ?? '—',
        orgName: f.organizations?.name ?? '—',
        imageUrl,
      }
    }),
  )

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Feedback</h1>
        <p className="text-sm text-slate-400">{rows.length} recebidos</p>
      </div>
      <FeedbackList rows={rows} />
    </div>
  )
}
```

> Nota sobre o join: a FK `feedback.user_id → profiles(id)` gera o embed `profiles!feedback_user_id_fkey`. Se o nome do constraint diferir, usar `profiles(full_name)` simples — há só uma FK para `profiles`, então o PostgREST resolve sem ambiguidade. Verifique a coluna de nome real em `profiles` (`full_name`); se for outra (ex: `name`), ajuste o select e o `author`.

- [ ] **Step 2: Componente client com filtro e status**

```tsx
'use client'
// app/(super-admin)/super-admin/feedback/FeedbackList.tsx
import { useState, useTransition } from 'react'
import { Badge } from '@/components/ui/Badge'
import { setFeedbackStatus } from '@/features/feedback/actions'

export interface FeedbackRow {
  id: string
  category: 'bug' | 'elogio' | 'ideia'
  message: string
  status: 'novo' | 'lido' | 'resolvido'
  createdAt: string
  author: string
  orgName: string
  imageUrl: string | null
}

const CAT_LABEL: Record<FeedbackRow['category'], string> = {
  bug: '🐞 Bug',
  elogio: '💛 Elogio',
  ideia: '💡 Ideia',
}

const NEXT_STATUS: Record<FeedbackRow['status'], FeedbackRow['status']> = {
  novo: 'lido',
  lido: 'resolvido',
  resolvido: 'novo',
}

const STATUS_VARIANT: Record<FeedbackRow['status'], 'warning' | 'default' | 'success'> = {
  novo: 'warning',
  lido: 'default',
  resolvido: 'success',
}

export function FeedbackList({ rows }: { rows: FeedbackRow[] }) {
  const [items, setItems] = useState(rows)
  const [filter, setFilter] = useState<'todos' | FeedbackRow['category']>('todos')
  const [, start] = useTransition()

  const visible = filter === 'todos' ? items : items.filter((i) => i.category === filter)

  function cycleStatus(id: string) {
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, status: NEXT_STATUS[i.status] } : i)),
    )
    const target = items.find((i) => i.id === id)
    if (!target) return
    const next = NEXT_STATUS[target.status]
    start(async () => {
      await setFeedbackStatus(id, next)
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap">
        {(['todos', 'bug', 'elogio', 'ideia'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={
              'rounded-full px-3 py-1 text-xs font-semibold border transition-colors ' +
              (filter === f
                ? 'border-brand-500 bg-brand-600/15 text-white'
                : 'border-surface-border text-slate-400 hover:text-white')
            }
          >
            {f === 'todos' ? 'Todos' : CAT_LABEL[f]}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-slate-400">Nenhum feedback.</p>
      ) : (
        <ul className="space-y-3">
          {visible.map((f) => (
            <li key={f.id} className="rounded-xl border border-surface-border bg-surface-card p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-300">{CAT_LABEL[f.category]}</span>
                <button onClick={() => cycleStatus(f.id)} title="Alterar status">
                  <Badge variant={STATUS_VARIANT[f.status]}>{f.status}</Badge>
                </button>
              </div>
              <p className="text-sm text-white whitespace-pre-wrap">{f.message}</p>
              {f.imageUrl && (
                <a href={f.imageUrl} target="_blank" rel="noopener noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={f.imageUrl} alt="anexo" className="max-h-48 rounded-lg border border-surface-border" />
                </a>
              )}
              <p className="text-[11px] text-slate-500">
                {f.author} · {f.orgName} ·{' '}
                {new Date(f.createdAt).toLocaleDateString('pt-BR', {
                  day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
                })}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Link para feedback na home do super-admin**

Em [app/(super-admin)/super-admin/page.tsx](../../../app/(super-admin)/super-admin/page.tsx), adicionar um link acima da lista de academias:

```tsx
// app/(super-admin)/super-admin/page.tsx
import Link from 'next/link'
import { listOrganizations } from '@/features/super-admin/actions'
import { OrgList } from './OrgList'

export default async function SuperAdminHome() {
  const { rows, error } = await listOrganizations()
  if (error) return <p className="text-sm text-red-400">{error}</p>
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Academias</h1>
          <p className="text-sm text-slate-400">{rows?.length ?? 0} cadastradas</p>
        </div>
        <Link
          href="/super-admin/feedback"
          className="rounded-lg border border-surface-border px-3 py-1.5 text-sm text-slate-200 hover:bg-surface-border transition-colors"
        >
          Feedback
        </Link>
      </div>
      <OrgList rows={rows ?? []} />
    </div>
  )
}
```

- [ ] **Step 4: Confirmar a coluna de nome em `profiles`**

Run: `npm run build`
Expected: compila. Se o build/runtime reclamar do embed `profiles!feedback_user_id_fkey` ou da coluna `full_name`, ajuste conforme o schema real (procure a definição de `profiles` em `supabase/migrations/001_initial_schema.sql` e migrations de identidade).

- [ ] **Step 5: Commit**

```bash
git add "app/(super-admin)/super-admin/feedback/page.tsx" "app/(super-admin)/super-admin/feedback/FeedbackList.tsx" "app/(super-admin)/super-admin/page.tsx"
git commit -m "feat(super-admin): painel de leitura de feedback com filtro e status"
```

---

## Validação manual final

- [ ] Na comunidade (aluno), o "+" não é mais coberto por botão flutuante; a ajuda está no topo ao lado do sininho.
- [ ] Menu de ajuda abre para baixo, alinhado à direita, com os 3 itens (tutorial, FAQ, feedback).
- [ ] Enviar feedback de cada tipo (com e sem imagem) → aparece em `/super-admin/feedback`.
- [ ] Imagem anexada abre via signed URL.
- [ ] Alterar status cicla novo→lido→resolvido e persiste (refresh mantém).
- [ ] No sininho: excluir uma notificação some da lista e não volta após refresh; remetente aparece ("Sistema" ou nome da academia); layout ok com muitos itens (scroll).
- [ ] Admin: botão de ajuda inline no sidebar (desktop) e no topo (mobile), sem flutuante.

## Notas de dependência entre tasks

- Task 5 usa o prop `orgName` do `NotificationBell` (Task 7). Faça **Task 7 antes da Task 5**, ou una os dois commits, para o build passar.
- Task 1 (migration) precisa ser aplicada (`supabase db push`) para o runtime funcionar; o build não depende dela.
