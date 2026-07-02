# Product Tour Guiado + Central de Ajuda — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tour guiado passo-a-passo que roda no primeiro login de aluno e admin, mais uma "Central de Ajuda" (botão flutuante) para rever o tutorial e ver FAQs.

**Architecture:** Driver.js dispara o tour a partir de um `TourProvider` (client) montado nos layouts do aluno e do admin. O layout (Server Component) lê `profiles.tour_*_seen_at` e passa `autoStart`. Ao concluir/pular, uma Server Action grava o timestamp. Alvos são elementos reais marcados com `data-tour`. Um `HelpButton` flutuante permite replay e abre um `FaqModal`.

**Tech Stack:** Next.js 14 App Router · React · TypeScript · Tailwind · Supabase · Vitest · Driver.js.

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/20260702130000_profiles_tour_seen.sql` | Colunas `tour_aluno_seen_at`, `tour_admin_seen_at` em `profiles` |
| `types/index.ts` (modify) | Campos novos na interface `Profile` |
| `lib/tour/autostart.ts` | `shouldAutoStart(variant, pathname, seenAt)` — lógica pura |
| `lib/tour/autostart.test.ts` | Testes unit da lógica de auto-start |
| `lib/tour/steps.ts` | `getTourSteps(variant)` — passos do Driver.js por variante |
| `lib/tour/steps.test.ts` | Testes unit dos passos |
| `lib/tour/faqs.ts` | `getFaqs(variant)` — conteúdo das FAQs |
| `lib/tour/faqs.test.ts` | Testes unit das FAQs |
| `lib/tour/actions.ts` | Server Action `markTourSeen(variant)` |
| `components/tour/TourProvider.tsx` | Client. Inicializa Driver.js, auto-start, replay via evento |
| `components/tour/HelpButton.tsx` | Client. Botão flutuante + menu (replay / FAQs) |
| `components/tour/FaqModal.tsx` | Client. Modal accordion de FAQs |
| `app/(dashboard)/layout.tsx` (modify) | Lê flag, monta `TourProvider`/`HelpButton` (aluno) |
| `app/(admin)/layout.tsx` (modify) | Lê flag, monta `TourProvider`/`HelpButton` (admin) |
| `components/ui/BottomNav.tsx` (modify) | `data-tour` em Aulas, Perfil, Agendar |
| `app/(dashboard)/home/page.tsx` (modify) | `data-tour` no `StatHeader` (progresso) |

**Replay via CustomEvent:** `HelpButton` e `TourProvider` são irmãos no layout. Para o botão disparar o replay do provider sem lifting state, usam um `CustomEvent` no `window`: `window.dispatchEvent(new CustomEvent('tour:replay'))`. O `TourProvider` escuta esse evento. Simples e desacoplado.

---

## Task 1: Migration — colunas de tour em `profiles`

**Files:**
- Create: `supabase/migrations/20260702130000_profiles_tour_seen.sql`
- Modify: `types/index.ts:118-127`

- [ ] **Step 1: Criar a migration**

```sql
-- Flags de "tour guiado visto" por pessoa (profiles = identidade compartilhada).
-- Fonte de verdade cross-device: o tour não repete se o usuário troca de aparelho.
alter table public.profiles
  add column if not exists tour_aluno_seen_at timestamptz,
  add column if not exists tour_admin_seen_at timestamptz;
```

- [ ] **Step 2: Aplicar a migration**

Run: `supabase db push`
Expected: aplica sem erro; colunas criadas.

- [ ] **Step 3: Adicionar os campos ao tipo `Profile`**

Em `types/index.ts`, dentro de `interface Profile`, após `is_platform_admin: boolean`:

```typescript
  is_platform_admin: boolean
  tour_aluno_seen_at: string | null
  tour_admin_seen_at: string | null
  created_at: string
```

- [ ] **Step 4: Type-check**

Run: `npm run build` (ou `npx tsc --noEmit`)
Expected: sem erros de tipo.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260702130000_profiles_tour_seen.sql types/index.ts
git commit -m "feat(tour): colunas tour_*_seen_at em profiles"
```

---

## Task 2: Lógica pura de auto-start (`lib/tour/autostart.ts`)

Regra: aluno só auto-inicia na `/home` (onde existe o alvo do passo de progresso); admin auto-inicia em qualquer rota do painel; nunca inicia se já foi visto (`seenAt` não-nulo).

**Files:**
- Create: `lib/tour/autostart.ts`
- Test: `lib/tour/autostart.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```typescript
// lib/tour/autostart.test.ts
import { describe, it, expect } from 'vitest'
import { shouldAutoStart } from './autostart'

describe('shouldAutoStart', () => {
  it('aluno inicia na /home quando nunca viu', () => {
    expect(shouldAutoStart('aluno', '/home', null)).toBe(true)
  })

  it('aluno NÃO inicia fora da /home', () => {
    expect(shouldAutoStart('aluno', '/aulas', null)).toBe(false)
  })

  it('aluno NÃO inicia se já viu', () => {
    expect(shouldAutoStart('aluno', '/home', '2026-07-02T00:00:00Z')).toBe(false)
  })

  it('admin inicia em qualquer rota do painel', () => {
    expect(shouldAutoStart('admin', '/admin/financeiro', null)).toBe(true)
  })

  it('admin NÃO inicia se já viu', () => {
    expect(shouldAutoStart('admin', '/admin/dashboard', '2026-07-02T00:00:00Z')).toBe(false)
  })
})
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `npm run test:run -- lib/tour/autostart.test.ts`
Expected: FAIL — "Cannot find module './autostart'".

- [ ] **Step 3: Implementar**

```typescript
// lib/tour/autostart.ts
export type TourVariant = 'aluno' | 'admin'

export function shouldAutoStart(
  variant: TourVariant,
  pathname: string,
  seenAt: string | null,
): boolean {
  if (seenAt) return false
  if (variant === 'aluno') return pathname === '/home'
  return true // admin: alvos na sidebar existem em qualquer rota do painel
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `npm run test:run -- lib/tour/autostart.test.ts`
Expected: PASS (5 testes).

- [ ] **Step 5: Commit**

```bash
git add lib/tour/autostart.ts lib/tour/autostart.test.ts
git commit -m "feat(tour): lógica de auto-start (TDD)"
```

---

## Task 3: Passos do tour (`lib/tour/steps.ts`)

Retorna os passos no formato do Driver.js. Cada passo tem `element` (seletor `[data-tour="..."]`) e `popover` com `title`/`description`. O passo 1 do aluno é centrado (sem `element`).

**Files:**
- Create: `lib/tour/steps.ts`
- Test: `lib/tour/steps.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```typescript
// lib/tour/steps.test.ts
import { describe, it, expect } from 'vitest'
import { getTourSteps } from './steps'

describe('getTourSteps', () => {
  it('aluno tem 4 passos', () => {
    expect(getTourSteps('aluno')).toHaveLength(4)
  })

  it('admin tem 5 passos (inclui torneios)', () => {
    const steps = getTourSteps('admin')
    expect(steps).toHaveLength(5)
    const selectors = steps.map((s) => s.element)
    expect(selectors).toContain('[data-tour="tour-admin-torneios"]')
  })

  it('todo passo com element aponta para um seletor data-tour', () => {
    for (const s of getTourSteps('aluno')) {
      if (s.element) expect(s.element).toMatch(/^\[data-tour="tour-/)
    }
  })

  it('todo passo tem título e descrição', () => {
    for (const variant of ['aluno', 'admin'] as const) {
      for (const s of getTourSteps(variant)) {
        expect(s.popover.title.length).toBeGreaterThan(0)
        expect(s.popover.description.length).toBeGreaterThan(0)
      }
    }
  })
})
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `npm run test:run -- lib/tour/steps.test.ts`
Expected: FAIL — "Cannot find module './steps'".

- [ ] **Step 3: Implementar**

```typescript
// lib/tour/steps.ts
import type { TourVariant } from './autostart'

export interface TourStep {
  element?: string
  popover: { title: string; description: string }
}

const ALUNO_STEPS: TourStep[] = [
  {
    popover: {
      title: 'Bem-vindo(a)! 👋',
      description: 'Esse é o seu painel. Vou te mostrar rapidinho como tudo funciona.',
    },
  },
  {
    element: '[data-tour="tour-aluno-aulas"]',
    popover: {
      title: 'Suas aulas',
      description:
        'Aqui você vê as aulas disponíveis. Para reservar, use o botão laranja "+" (Agendar) no centro.',
    },
  },
  {
    element: '[data-tour="tour-aluno-progresso"]',
    popover: {
      title: 'Seu progresso',
      description: 'Acompanhe aqui seus créditos, aulas na semana e seu nível.',
    },
  },
  {
    element: '[data-tour="tour-aluno-perfil"]',
    popover: {
      title: 'Perfil e ajuda',
      description:
        'Seus dados ficam no Perfil. E sempre que precisar, o botão de ajuda (?) reabre este tutorial e mostra as perguntas frequentes.',
    },
  },
]

const ADMIN_STEPS: TourStep[] = [
  {
    element: '[data-tour="tour-admin-dashboard"]',
    popover: {
      title: 'Painel administrativo',
      description: 'A Dashboard traz a visão geral dos números da sua academia.',
    },
  },
  {
    element: '[data-tour="tour-admin-cadastro"]',
    popover: {
      title: 'Cadastros',
      description: 'Em Alunos e Grade de Aulas você cadastra novos alunos e monta as turmas.',
    },
  },
  {
    element: '[data-tour="tour-admin-torneios"]',
    popover: {
      title: 'Torneios',
      description: 'Crie e gerencie torneios da sua academia por aqui.',
    },
  },
  {
    element: '[data-tour="tour-admin-financeiro"]',
    popover: {
      title: 'Relatórios e faturamento',
      description: 'Acompanhe receitas, pagamentos e relatórios no Financeiro.',
    },
  },
  {
    element: '[data-tour="tour-admin-config"]',
    popover: {
      title: 'Configurações',
      description: 'Ajuste as configurações gerais do sistema sempre que precisar.',
    },
  },
]

export function getTourSteps(variant: TourVariant): TourStep[] {
  return variant === 'aluno' ? ALUNO_STEPS : ADMIN_STEPS
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `npm run test:run -- lib/tour/steps.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add lib/tour/steps.ts lib/tour/steps.test.ts
git commit -m "feat(tour): definição dos passos por variante (TDD)"
```

---

## Task 4: Conteúdo das FAQs (`lib/tour/faqs.ts`)

**Files:**
- Create: `lib/tour/faqs.ts`
- Test: `lib/tour/faqs.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```typescript
// lib/tour/faqs.test.ts
import { describe, it, expect } from 'vitest'
import { getFaqs } from './faqs'

describe('getFaqs', () => {
  it('aluno tem ao menos 4 FAQs', () => {
    expect(getFaqs('aluno').length).toBeGreaterThanOrEqual(4)
  })

  it('admin tem ao menos 4 FAQs', () => {
    expect(getFaqs('admin').length).toBeGreaterThanOrEqual(4)
  })

  it('toda FAQ tem pergunta e resposta preenchidas', () => {
    for (const variant of ['aluno', 'admin'] as const) {
      for (const f of getFaqs(variant)) {
        expect(f.q.length).toBeGreaterThan(0)
        expect(f.a.length).toBeGreaterThan(0)
      }
    }
  })
})
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `npm run test:run -- lib/tour/faqs.test.ts`
Expected: FAIL — "Cannot find module './faqs'".

- [ ] **Step 3: Implementar**

```typescript
// lib/tour/faqs.ts
import type { TourVariant } from './autostart'

export interface Faq {
  q: string
  a: string
}

const ALUNO_FAQS: Faq[] = [
  {
    q: 'Como agendar uma aula?',
    a: 'Toque no botão laranja "+" no centro da barra inferior, escolha o dia e a turma disponível e confirme a reserva.',
  },
  {
    q: 'Como cancelar e recuperar meu crédito?',
    a: 'Cancelamentos feitos até 5 horas antes da aula devolvem o crédito automaticamente. Após esse prazo, o crédito não é devolvido.',
  },
  {
    q: 'Como altero minha senha?',
    a: 'Vá em Perfil e use a opção de alterar senha. Se esqueceu a senha, use "Recuperar senha" na tela de login.',
  },
  {
    q: 'O que significam os níveis (iniciante, D, C, B, A)?',
    a: 'É a hierarquia de nível técnico, do iniciante ao A (mais avançado). Você só consegue reservar aulas do seu nível ou abaixo dele.',
  },
  {
    q: 'Como funciona o check-in via Wellhub/TotalPass?',
    a: 'Se você usa Wellhub ou TotalPass, o check-in é registrado automaticamente pelo parceiro — você não precisa fazer nada manual no app.',
  },
]

const ADMIN_FAQS: Faq[] = [
  {
    q: 'Como cadastrar um novo aluno?',
    a: 'Acesse Alunos no menu lateral e use o botão de cadastrar. Você também pode gerar um link de convite para o aluno se cadastrar sozinho.',
  },
  {
    q: 'Como criar uma turma na grade?',
    a: 'Vá em Grade de Aulas e use "Nova turma". Defina dia, horário, nível e capacidade — as sessões datadas são geradas a partir desse modelo.',
  },
  {
    q: 'Como criar um torneio?',
    a: 'Acesse Torneios no menu lateral e crie um novo torneio, definindo formato, datas e inscrições.',
  },
  {
    q: 'Onde vejo o faturamento?',
    a: 'Em Financeiro você acompanha receitas, pagamentos e relatórios da academia.',
  },
  {
    q: 'Como altero minha senha?',
    a: 'Use a opção de alterar senha no seu perfil. Para redefinir sem estar logado, use "Recuperar senha" na tela de login.',
  },
]

export function getFaqs(variant: TourVariant): Faq[] {
  return variant === 'aluno' ? ALUNO_FAQS : ADMIN_FAQS
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `npm run test:run -- lib/tour/faqs.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add lib/tour/faqs.ts lib/tour/faqs.test.ts
git commit -m "feat(tour): conteúdo das FAQs (rascunho, TDD)"
```

---

## Task 5: Server Action `markTourSeen` (`lib/tour/actions.ts`)

Grava o timestamp na coluna correspondente do usuário logado. Usa `createClient()` (RLS — o próprio usuário atualiza seu `profiles`).

**Files:**
- Create: `lib/tour/actions.ts`

- [ ] **Step 1: Implementar a Server Action**

```typescript
// lib/tour/actions.ts
'use server'

import { createClient } from '@/lib/supabase/server'
import type { TourVariant } from './autostart'

export async function markTourSeen(variant: TourVariant): Promise<void> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return

  const column = variant === 'aluno' ? 'tour_aluno_seen_at' : 'tour_admin_seen_at'
  await supabase
    .from('profiles')
    .update({ [column]: new Date().toISOString() })
    .eq('id', user.id)
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add lib/tour/actions.ts
git commit -m "feat(tour): server action markTourSeen"
```

---

## Task 6: Instalar Driver.js + `TourProvider`

`TourProvider` é client. No mount, se `autoStart`, dispara o tour. Escuta `window` para o evento `tour:replay` (disparado pelo HelpButton). Ao concluir ou destruir o tour em modo auto-start, chama `markTourSeen(variant)`.

**Files:**
- Create: `components/tour/TourProvider.tsx`

- [ ] **Step 1: Instalar a biblioteca**

Run: `npm install driver.js`
Expected: adiciona `driver.js` ao `package.json`.

- [ ] **Step 2: Implementar o TourProvider**

```typescript
// components/tour/TourProvider.tsx
'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { driver, type Driver } from 'driver.js'
import 'driver.js/dist/driver.css'
import { getTourSteps } from '@/lib/tour/steps'
import { shouldAutoStart, type TourVariant } from '@/lib/tour/autostart'
import { markTourSeen } from '@/lib/tour/actions'

export function TourProvider({
  variant,
  seenAt,
}: {
  variant: TourVariant
  seenAt: string | null
}) {
  const pathname = usePathname()
  const startedRef = useRef(false)

  function runTour(markOnFinish: boolean) {
    const steps = getTourSteps(variant).map((s) => ({
      element: s.element,
      popover: {
        title: s.popover.title,
        description: s.popover.description,
      },
    }))

    const d: Driver = driver({
      showProgress: true,
      nextBtnText: 'Próximo',
      prevBtnText: 'Voltar',
      doneBtnText: 'Concluir',
      steps,
      onDestroyed: () => {
        if (markOnFinish) void markTourSeen(variant)
      },
    })
    d.drive()
  }

  // Auto-start no primeiro login (uma vez por montagem).
  useEffect(() => {
    if (startedRef.current) return
    if (shouldAutoStart(variant, pathname, seenAt)) {
      startedRef.current = true
      // pequeno atraso para garantir que os alvos já montaram
      const t = setTimeout(() => runTour(true), 400)
      return () => clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, seenAt, variant])

  // Replay via evento do HelpButton (não marca como visto — já foi).
  useEffect(() => {
    const handler = () => runTour(false)
    window.addEventListener('tour:replay', handler)
    return () => window.removeEventListener('tour:replay', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant])

  return null
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json components/tour/TourProvider.tsx
git commit -m "feat(tour): TourProvider com Driver.js (auto-start + replay)"
```

---

## Task 7: `FaqModal` + `HelpButton`

`FaqModal` é um modal simples (accordion nativo com `<details>`). `HelpButton` é o botão flutuante com um pequeno menu: "Ver tutorial novamente" (dispara `tour:replay`) e "Perguntas frequentes" (abre o modal).

**Files:**
- Create: `components/tour/FaqModal.tsx`
- Create: `components/tour/HelpButton.tsx`

- [ ] **Step 1: Implementar o FaqModal**

```typescript
// components/tour/FaqModal.tsx
'use client'

import { X } from 'lucide-react'
import { getFaqs } from '@/lib/tour/faqs'
import type { TourVariant } from '@/lib/tour/autostart'

export function FaqModal({
  variant,
  onClose,
}: {
  variant: TourVariant
  onClose: () => void
}) {
  const faqs = getFaqs(variant)
  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-lg max-h-[80vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-surface-card border border-surface-border p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-white">Perguntas frequentes</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1" aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-2">
          {faqs.map((f, i) => (
            <details key={i} className="rounded-lg border border-surface-border bg-surface px-3 py-2">
              <summary className="cursor-pointer text-sm font-medium text-white">{f.q}</summary>
              <p className="mt-2 text-sm text-slate-400">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Implementar o HelpButton**

```typescript
// components/tour/HelpButton.tsx
'use client'

import { useState } from 'react'
import { HelpCircle, PlayCircle, MessageCircleQuestion } from 'lucide-react'
import type { TourVariant } from '@/lib/tour/autostart'
import { FaqModal } from './FaqModal'

export function HelpButton({
  variant,
  className,
}: {
  variant: TourVariant
  className?: string
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [faqOpen, setFaqOpen] = useState(false)

  function replay() {
    setMenuOpen(false)
    window.dispatchEvent(new CustomEvent('tour:replay'))
  }

  return (
    <>
      <div className={'fixed z-50 ' + (className ?? 'bottom-24 right-4')}>
        {menuOpen && (
          <div className="mb-2 w-56 rounded-xl border border-surface-border bg-surface-card shadow-lg overflow-hidden">
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
          </div>
        )}
        <button
          data-tour="tour-help-button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="Central de Ajuda"
          className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-card border border-surface-border text-brand-500 shadow-lg hover:bg-surface-border transition-colors"
        >
          <HelpCircle className="h-5 w-5" />
        </button>
      </div>
      {faqOpen && <FaqModal variant={variant} onClose={() => setFaqOpen(false)} />}
    </>
  )
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add components/tour/FaqModal.tsx components/tour/HelpButton.tsx
git commit -m "feat(tour): HelpButton flutuante + FaqModal"
```

---

## Task 8: Marcar alvos `data-tour` do aluno

**Files:**
- Modify: `components/ui/BottomNav.tsx`
- Modify: `app/(dashboard)/home/page.tsx:296-306`

- [ ] **Step 1: Adicionar `dataTour` aos itens do BottomNav**

Em `components/ui/BottomNav.tsx`, estender o config e passar ao `NavItem`/`Link`.

Config (linha 8-13):

```typescript
const navItems = [
  { href: '/home', icon: Home, label: 'Home' },
  { href: '/aulas', icon: Calendar, label: 'Aulas', dataTour: 'tour-aluno-aulas' },
  { href: '/comunidade', icon: Users, label: 'Comunidade' },
  { href: '/perfil', icon: User, label: 'Perfil', dataTour: 'tour-aluno-perfil' },
]
```

Assinatura e uso do `NavItem` (linha 41-48):

```typescript
function NavItem({ href, icon: Icon, label, active, dataTour }: { href: string; icon: typeof Home; label: string; active: boolean; dataTour?: string }) {
  return (
    <Link href={href} data-tour={dataTour} className="flex flex-col items-center gap-0.5 py-2 px-3">
      <Icon className={cn('h-5 w-5', active ? 'text-brand-500' : 'text-slate-500')} />
      <span className={cn('text-[10px] font-medium', active ? 'text-brand-500' : 'text-slate-500')}>{label}</span>
    </Link>
  )
}
```

Os dois `.map` que renderizam `NavItem` já espalham `{...item}`, então `dataTour` é passado automaticamente. O botão central Agendar (linha 24) recebe o atributo direto:

```typescript
        <Link href="/agendar" data-tour="tour-aluno-agendar" className="relative -top-5">
```

- [ ] **Step 2: Marcar o alvo de progresso na Home**

Em `app/(dashboard)/home/page.tsx`, envolver o `StatHeader` (linha 297-306) num wrapper com `data-tour`:

```tsx
      <div data-tour="tour-aluno-progresso">
        <StatHeader
          name={profile?.full_name?.split(' ')[0] ?? 'atleta'}
          stats={[
            ...(showCredits
              ? [{ label: 'Créditos', value: membership?.credits_balance ?? 0 }]
              : [{ label: 'Plano', value: membership?.payment_type === 'wellhub' ? 'Wellhub' : 'TotalPass' }]),
            { label: 'Aulas/semana', value: weeklyClassesCount ?? 0 },
            { label: 'Nível', value: (membership?.level ?? '—').toUpperCase() },
          ]}
        />
      </div>
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add components/ui/BottomNav.tsx app/(dashboard)/home/page.tsx
git commit -m "feat(tour): data-tour nos alvos do aluno"
```

---

## Task 9: Marcar alvos `data-tour` do admin

A sidebar renderiza os links por `.map` (linha 99-103 de `app/(admin)/layout.tsx`). Mapeamos `href → data-tour`. Passo 2 (cadastro) aponta para **Alunos**.

**Files:**
- Modify: `app/(admin)/layout.tsx:71-103`

- [ ] **Step 1: Adicionar mapa href→data-tour e aplicar no link da sidebar**

Após a definição de `allNav` (linha 71-81), adicionar:

```typescript
  const tourTargets: Record<string, string> = {
    '/admin/dashboard': 'tour-admin-dashboard',
    '/admin/alunos': 'tour-admin-cadastro',
    '/admin/torneios': 'tour-admin-torneios',
    '/admin/financeiro': 'tour-admin-financeiro',
    '/admin/configuracoes': 'tour-admin-config',
  }
```

No `.map` da sidebar (linha 99-103), adicionar o atributo:

```tsx
            {navLinks.map(link => (
              <Link key={link.href} href={link.href} data-tour={tourTargets[link.href]} className="px-3 py-2 rounded hover:bg-surface-border hover:text-white transition-colors">
                {link.label}
              </Link>
            ))}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add app/(admin)/layout.tsx
git commit -m "feat(tour): data-tour nos alvos do admin"
```

---

## Task 10: Montar TourProvider + HelpButton nos layouts

O layout (Server Component) lê a flag de `profiles` e passa `seenAt`. O `variant` é fixo por layout.

**Files:**
- Modify: `app/(dashboard)/layout.tsx`
- Modify: `app/(admin)/layout.tsx`

- [ ] **Step 1: Aluno — buscar flag e montar componentes**

Em `app/(dashboard)/layout.tsx`, após obter `user` (e antes do `return`), buscar a flag:

```typescript
  const { data: tourProfile } = await supabase
    .from('profiles')
    .select('tour_aluno_seen_at')
    .eq('id', user.id)
    .single()
```

Imports no topo:

```typescript
import { TourProvider } from '@/components/tour/TourProvider'
import { HelpButton } from '@/components/tour/HelpButton'
```

No JSX, dentro do `<div>` raiz (antes de `<BottomNav />`):

```tsx
      <BottomNav />
      <TourProvider variant="aluno" seenAt={tourProfile?.tour_aluno_seen_at ?? null} />
      <HelpButton variant="aluno" className="bottom-24 right-4" />
```

- [ ] **Step 2: Admin — buscar flag e montar componentes**

Em `app/(admin)/layout.tsx`, incluir a coluna na query de `org`? Não — a flag é do usuário. Buscar via `adminClient` junto ao contexto (já temos `ctx.userId`):

```typescript
  const { data: tourProfile } = await adminClient
    .from('profiles')
    .select('tour_admin_seen_at')
    .eq('id', ctx.userId)
    .single()
```

Imports no topo:

```typescript
import { TourProvider } from '@/components/tour/TourProvider'
import { HelpButton } from '@/components/tour/HelpButton'
```

No JSX, dentro do `<div>` raiz (após `<main>...</main>`, antes de fechar o div):

```tsx
      </main>
      <TourProvider variant="admin" seenAt={tourProfile?.tour_admin_seen_at ?? null} />
      <HelpButton variant="admin" className="bottom-4 right-4" />
    </div>
```

- [ ] **Step 3: Type-check + build**

Run: `npx tsc --noEmit && npm run build`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add app/(dashboard)/layout.tsx app/(admin)/layout.tsx
git commit -m "feat(tour): montar TourProvider e HelpButton nos layouts"
```

---

## Task 11: Validação manual (dev server)

- [ ] **Step 1: Subir o dev server**

Run: `npm run dev`

- [ ] **Step 2: Rodar toda a suíte de testes**

Run: `npm run test:run`
Expected: PASS (incl. autostart, steps, faqs).

- [ ] **Step 3: Validar tour do ALUNO**

Com um usuário aluno cujo `tour_aluno_seen_at` é NULL:
- Logar e cair na `/home` → tour inicia sozinho após ~400ms.
- Verificar os 4 passos: boas-vindas → Aulas → progresso (StatHeader) → Perfil/ajuda.
- Concluir → conferir no banco que `tour_aluno_seen_at` foi preenchido.
- Recarregar → tour NÃO reaparece.
- Clicar no botão de ajuda (?) → "Ver tutorial novamente" reinicia; "Perguntas frequentes" abre o modal com as FAQs do aluno.

- [ ] **Step 4: Validar tour do ADMIN**

Com um admin cujo `tour_admin_seen_at` é NULL:
- Entrar em `/admin/dashboard` → tour inicia sozinho.
- Verificar os 5 passos: Dashboard → Alunos(cadastro) → Torneios → Financeiro → Configurações.
- Concluir → `tour_admin_seen_at` preenchido; não reaparece.
- Botão de ajuda: replay + FAQs do admin.
- No mobile (largura estreita), a sidebar some; validar que o replay do admin funciona com o `AdminMobileNav` aberto (se algum alvo ficar oculto, Driver.js centraliza o passo — sem quebrar).

- [ ] **Step 5: Commit final (se houver ajustes)**

```bash
git add -A
git commit -m "test(tour): validação manual e ajustes finais"
```

---

## Notas de execução

- **Reset para testar de novo:** `update profiles set tour_aluno_seen_at = null, tour_admin_seen_at = null where id = '<user-id>';`
- **Mobile do admin:** os alvos da sidebar vivem no `AdminMobileNav` (dropdown fechado por padrão). O auto-start do admin ainda funciona porque, se o alvo estiver oculto, o Driver.js exibe o passo centrado. Melhoria opcional (fora do escopo): abrir o dropdown durante o tour no mobile.
- **StatHeader como alvo de progresso:** escolhido por estar sempre presente na Home (o `CheckinProgressCard` só renderiza para alunos Wellhub/TotalPass).
