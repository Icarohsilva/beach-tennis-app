# Popup de instalação do app + aviso de notificações — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar o card dispensável-para-sempre de onboarding do PWA por um popup de instalação que reaparece 1x/dia até a pessoa instalar, mais uma faixa permanente (não bloqueante) enquanto as notificações não forem permitidas.

**Architecture:** Toda a regra de decisão vive num módulo puro (`lib/pwa/promptState.ts`) que recebe um retrato do ambiente e devolve qual popup mostrar — isso torna a matriz plataforma × instalação × permissão testável sem simular Safari. Leitura do browser (`environment.ts`) e persistência da dispensa (`dismissStorage.ts`) ficam em módulos separados e finos. Os componentes só renderizam a decisão.

**Tech Stack:** Next.js 14 App Router · TypeScript · Tailwind · Vitest (jsdom) · Playwright + sharp (geração do GIF) · lucide-react

**Spec:** [docs/superpowers/specs/2026-07-27-popup-instalacao-pwa-design.md](../specs/2026-07-27-popup-instalacao-pwa-design.md)

---

## Nota de ambiente (leia antes de começar)

- **Rode os testes pelo tool PowerShell**, não pelo Bash: `npm run test:run`. Via Bash a suíte falha de forma intermitente neste ambiente com erro de `config` undefined.
- **Não rode `npm run dev` pelo Bash.** Use o tool `preview_start` do Browser pane.
- **`npx tsc --noEmit` já falha nesta branch, antes de qualquer mudança**: 9 erros
  pré-existentes em `lib/branding/palette.test.ts`, `lib/branding/theme.test.ts`,
  `lib/torneios/schedule/americano.test.ts` e `types/index.test.ts`. Todos em
  arquivos de teste, nenhum em código de app. Onde este plano diz "Esperado:
  nenhum erro", leia **"nenhum erro novo além desses 9"**.
- O repositório está na branch `main`. Crie uma branch antes do primeiro commit:
  `git checkout -b feat/popup-instalacao-pwa`

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `lib/pwa/promptState.ts` | **Puro.** `resolvePrompt(input) → PromptDecision`. Toda a regra de negócio. |
| `lib/pwa/promptState.test.ts` | Matriz completa de decisão. |
| `lib/pwa/environment.ts` | Lê o browser: iOS, Android, mobile, standalone, in-app browser, push. |
| `lib/pwa/environment.test.ts` | Só as funções que recebem user agent como argumento. |
| `lib/pwa/dismissStorage.ts` | Lê/grava o timestamp de dispensa; tolera localStorage hostil. |
| `lib/pwa/dismissStorage.test.ts` | Valor corrompido, timestamp futuro, localStorage que lança. |
| `components/pwa/IosInstallAnimation.tsx` | Animação do passo a passo. Reusada em 3 lugares. |
| `components/pwa/InstallSheet.tsx` | O bottom sheet, 3 variantes. |
| `components/pwa/PushNagBanner.tsx` | A faixa de notificações, 2 estados. |
| `components/pwa/InstallGate.tsx` | Orquestrador: monta ambiente, decide, renderiza. |
| `app/(public)/instalar/page.tsx` | Página pública compartilhável. |
| `scripts/gerar-video-instalacao.mjs` | Playwright + sharp → `docs/faq/images/instalar-ios.gif`. |

**Deletados:** `components/pwa/PushOnboardingCard.tsx`, `lib/pwa/onboardingState.ts`, `lib/pwa/onboardingState.test.ts`.

---

### Task 1: Módulo de decisão (`promptState`)

**Files:**
- Create: `lib/pwa/promptState.ts`
- Test: `lib/pwa/promptState.test.ts`

- [ ] **Step 1: Escreva o teste que falha**

Crie `lib/pwa/promptState.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { resolvePrompt, DISMISS_WINDOW_MS, type PromptInput } from './promptState'

const NOW = 1_800_000_000_000

// Celular Android genérico, nada instalado, permissão ainda não pedida.
const base: PromptInput = {
  isMobile: true,
  isIOS: false,
  isInAppBrowser: false,
  standalone: false,
  installable: false,
  pushSupported: true,
  permission: 'default',
  dismissedAt: null,
  now: NOW,
}

describe('resolvePrompt', () => {
  it('desktop nunca vê nada', () => {
    expect(resolvePrompt({ ...base, isMobile: false })).toBe('none')
    expect(resolvePrompt({ ...base, isMobile: false, installable: true })).toBe('none')
    expect(resolvePrompt({ ...base, isMobile: false, permission: 'denied' })).toBe('none')
  })

  it('instalado + permissão concedida → nada', () => {
    expect(resolvePrompt({ ...base, standalone: true, permission: 'granted' })).toBe('none')
  })

  it('instalado + permissão pendente → pede push', () => {
    expect(resolvePrompt({ ...base, standalone: true })).toBe('push-ask')
  })

  it('instalado + permissão negada → explica como desbloquear', () => {
    expect(resolvePrompt({ ...base, standalone: true, permission: 'denied' })).toBe('push-blocked')
  })

  it('iOS não instalado → sheet de instalação', () => {
    expect(resolvePrompt({ ...base, isIOS: true, pushSupported: false })).toBe('install-ios')
  })

  it('iOS dentro de in-app browser → manda abrir no Safari', () => {
    expect(resolvePrompt({ ...base, isIOS: true, isInAppBrowser: true })).toBe('install-ios-inapp')
  })

  it('iOS não instalado nunca pede push, mesmo com permissão negada', () => {
    // No iOS push só existe depois de instalar: pedir antes confunde.
    expect(resolvePrompt({ ...base, isIOS: true, permission: 'denied' })).toBe('install-ios')
  })

  it('Android instalável → sheet com botão nativo', () => {
    expect(resolvePrompt({ ...base, installable: true })).toBe('install-android')
  })

  it('Android sem beforeinstallprompt cai para push', () => {
    expect(resolvePrompt({ ...base, installable: false })).toBe('push-ask')
  })

  it('sem suporte a push e sem instalação possível → nada', () => {
    expect(resolvePrompt({ ...base, pushSupported: false })).toBe('none')
  })

  it('dispensado há menos de 24h esconde o sheet', () => {
    const recente = NOW - (DISMISS_WINDOW_MS - 1000)
    expect(resolvePrompt({ ...base, isIOS: true, dismissedAt: recente })).toBe('none')
    expect(resolvePrompt({ ...base, installable: true, dismissedAt: recente })).toBe('none')
  })

  it('dispensado há mais de 24h mostra o sheet de novo', () => {
    const antigo = NOW - (DISMISS_WINDOW_MS + 1000)
    expect(resolvePrompt({ ...base, isIOS: true, dismissedAt: antigo })).toBe('install-ios')
    expect(resolvePrompt({ ...base, installable: true, dismissedAt: antigo })).toBe('install-android')
  })

  it('dispensa não silencia o aviso de push', () => {
    // A faixa não é dispensável: só some quando a permissão for concedida.
    expect(resolvePrompt({ ...base, standalone: true, dismissedAt: NOW })).toBe('push-ask')
  })

  it('dispensa não silencia o "abra no Safari"', () => {
    // Não é um convite, é um beco sem saída: precisa aparecer sempre.
    expect(
      resolvePrompt({ ...base, isIOS: true, isInAppBrowser: true, dismissedAt: NOW }),
    ).toBe('install-ios-inapp')
  })
})
```

- [ ] **Step 2: Rode o teste e confirme que falha**

Tool PowerShell: `npm run test:run -- lib/pwa/promptState.test.ts`
Esperado: FAIL — `Failed to resolve import "./promptState"`.

- [ ] **Step 3: Implemente**

Crie `lib/pwa/promptState.ts`:

```ts
// lib/pwa/promptState.ts
// Decide, de forma pura e testável, qual convite mostrar: instalar o app ou
// permitir notificações. Não toca em browser nenhum — recebe um retrato do
// ambiente e devolve a decisão.

export type PromptInput = {
  isMobile: boolean
  isIOS: boolean
  isInAppBrowser: boolean // Instagram, Facebook, etc.
  standalone: boolean // já instalado / rodando como app
  installable: boolean // beforeinstallprompt capturado
  pushSupported: boolean
  permission: NotificationPermission
  dismissedAt: number | null // epoch ms da última dispensa do sheet
  now: number
}

export type PromptDecision =
  | 'none'
  | 'install-ios' // sheet com o passo a passo animado
  | 'install-ios-inapp' // "abra no Safari primeiro"
  | 'install-android' // sheet com o prompt nativo
  | 'push-ask' // faixa: ativar notificações
  | 'push-blocked' // faixa: como desbloquear

export const DISMISS_WINDOW_MS = 24 * 60 * 60 * 1000

function dispensadoAgora(dismissedAt: number | null, now: number): boolean {
  if (dismissedAt === null) return false
  return now - dismissedAt < DISMISS_WINDOW_MS
}

// O convite de push só faz sentido se o dispositivo suporta e a pessoa ainda
// não decidiu (ou decidiu não).
function decidePush(input: PromptInput): PromptDecision {
  if (!input.pushSupported) return 'none'
  if (input.permission === 'granted') return 'none'
  if (input.permission === 'denied') return 'push-blocked'
  return 'push-ask'
}

export function resolvePrompt(input: PromptInput): PromptDecision {
  // 1. Desktop nunca vê nada: ninguém instala PWA no PC e o dono da academia
  //    trabalha no painel pelo computador.
  if (!input.isMobile) return 'none'

  // 2. Já instalado: só resta a conversa sobre notificações.
  if (input.standalone) return decidePush(input)

  // 3. iOS sem instalar. Push no iOS exige instalação, então nem mencionamos.
  if (input.isIOS) {
    // In-app browser não tem "Adicionar à Tela de Início" no menu — sem isso o
    // passo a passo mentiria. Não é dispensável: é um beco sem saída.
    if (input.isInAppBrowser) return 'install-ios-inapp'
    if (dispensadoAgora(input.dismissedAt, input.now)) return 'none'
    return 'install-ios'
  }

  // 4. Android/Chrome com o evento nativo em mãos.
  if (input.installable) {
    if (dispensadoAgora(input.dismissedAt, input.now)) return 'none'
    return 'install-android'
  }

  // 5. Sobrou: Android que não pode instalar agora (já instalou antes, browser
  //    sem suporte). Segue para a conversa de notificações.
  return decidePush(input)
}
```

- [ ] **Step 4: Rode o teste e confirme que passa**

Tool PowerShell: `npm run test:run -- lib/pwa/promptState.test.ts`
Esperado: PASS, 13 testes.

- [ ] **Step 5: Commit**

```bash
git add lib/pwa/promptState.ts lib/pwa/promptState.test.ts && git commit -m "feat(pwa): modulo puro de decisao do popup de instalacao"
```

---

### Task 2: Persistência da dispensa (`dismissStorage`)

**Files:**
- Create: `lib/pwa/dismissStorage.ts`
- Test: `lib/pwa/dismissStorage.test.ts`

- [ ] **Step 1: Escreva o teste que falha**

Crie `lib/pwa/dismissStorage.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readDismissedAt, writeDismissedAt, DISMISS_KEY } from './dismissStorage'

describe('dismissStorage', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sem nada gravado devolve null', () => {
    expect(readDismissedAt()).toBeNull()
  })

  it('grava e lê o timestamp', () => {
    writeDismissedAt(1_700_000_000_000)
    expect(readDismissedAt(1_700_000_050_000)).toBe(1_700_000_000_000)
  })

  it('writeDismissedAt sem argumento usa a hora atual', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_234_567_890)
    writeDismissedAt()
    expect(readDismissedAt(1_234_567_899)).toBe(1_234_567_890)
  })

  it('valor não numérico é tratado como nunca dispensado', () => {
    localStorage.setItem(DISMISS_KEY, 'ontem')
    expect(readDismissedAt()).toBeNull()
  })

  it('valor vazio é tratado como nunca dispensado', () => {
    localStorage.setItem(DISMISS_KEY, '')
    expect(readDismissedAt()).toBeNull()
  })

  it('timestamp no futuro é descartado', () => {
    // Relógio do aparelho errado esconderia o popup por tempo indeterminado.
    localStorage.setItem(DISMISS_KEY, String(2_000_000_000_000))
    expect(readDismissedAt(1_700_000_000_000)).toBeNull()
  })

  it('localStorage que lança ao ler não quebra a página', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    expect(readDismissedAt()).toBeNull()
  })

  it('localStorage que lança ao gravar não quebra a página', () => {
    // Safari em navegação privada lança QuotaExceededError ao escrever.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(() => writeDismissedAt(1_700_000_000_000)).not.toThrow()
  })
})
```

- [ ] **Step 2: Rode o teste e confirme que falha**

Tool PowerShell: `npm run test:run -- lib/pwa/dismissStorage.test.ts`
Esperado: FAIL — `Failed to resolve import "./dismissStorage"`.

- [ ] **Step 3: Implemente**

Crie `lib/pwa/dismissStorage.ts`:

```ts
// lib/pwa/dismissStorage.ts
// Guarda quando a pessoa dispensou o popup de instalação. A janela de 24h é
// aplicada em promptState — aqui só há IO e validação.

export const DISMISS_KEY = 'arenahub-install-dismissed-at'

// Toda leitura/escrita é protegida: Safari em navegação privada lança exceção
// ao escrever, e um localStorage indisponível nunca pode derrubar a página.
export function readDismissedAt(now: number = Date.now()): number | null {
  let raw: string | null
  try {
    raw = localStorage.getItem(DISMISS_KEY)
  } catch {
    return null
  }
  if (!raw) return null

  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return null
  // Relógio adiantado no aparelho esconderia o popup indefinidamente.
  if (parsed > now) return null
  return parsed
}

export function writeDismissedAt(at: number = Date.now()): void {
  try {
    localStorage.setItem(DISMISS_KEY, String(at))
  } catch {
    // Sem persistência, o popup volta na próxima navegação. Aceitável.
  }
}
```

- [ ] **Step 4: Rode o teste e confirme que passa**

Tool PowerShell: `npm run test:run -- lib/pwa/dismissStorage.test.ts`
Esperado: PASS, 8 testes.

- [ ] **Step 5: Commit**

```bash
git add lib/pwa/dismissStorage.ts lib/pwa/dismissStorage.test.ts && git commit -m "feat(pwa): persistencia da dispensa do popup com janela de 24h"
```

---

### Task 3: Leitura do ambiente (`environment`)

**Files:**
- Create: `lib/pwa/environment.ts`
- Test: `lib/pwa/environment.test.ts`

- [ ] **Step 1: Escreva o teste que falha**

Só as funções que recebem o user agent como argumento são testadas — o resto é
leitura direta de `window`, verificada no preview.

Crie `lib/pwa/environment.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { matchesIOS, matchesAndroid, matchesInAppBrowser } from './environment'

const UA_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const UA_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'
const UA_DESKTOP =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const UA_INSTAGRAM = `${UA_IPHONE} Instagram 300.0.0.0.0`
const UA_FACEBOOK = `${UA_IPHONE} [FBAN/FBIOS;FBAV/450.0.0.0]`

describe('matchesIOS', () => {
  it('reconhece iPhone', () => {
    expect(matchesIOS(UA_IPHONE)).toBe(true)
  })
  it('não confunde Android com iOS', () => {
    expect(matchesIOS(UA_ANDROID)).toBe(false)
  })
  it('não confunde desktop com iOS', () => {
    expect(matchesIOS(UA_DESKTOP)).toBe(false)
  })
})

describe('matchesAndroid', () => {
  it('reconhece Android', () => {
    expect(matchesAndroid(UA_ANDROID)).toBe(true)
  })
  it('não confunde iPhone com Android', () => {
    expect(matchesAndroid(UA_IPHONE)).toBe(false)
  })
})

describe('matchesInAppBrowser', () => {
  it('reconhece o browser do Instagram', () => {
    expect(matchesInAppBrowser(UA_INSTAGRAM)).toBe(true)
  })
  it('reconhece o browser do Facebook', () => {
    expect(matchesInAppBrowser(UA_FACEBOOK)).toBe(true)
  })
  it('Safari puro não é in-app browser', () => {
    expect(matchesInAppBrowser(UA_IPHONE)).toBe(false)
  })
  it('Chrome no Android não é in-app browser', () => {
    expect(matchesInAppBrowser(UA_ANDROID)).toBe(false)
  })
})
```

- [ ] **Step 2: Rode o teste e confirme que falha**

Tool PowerShell: `npm run test:run -- lib/pwa/environment.test.ts`
Esperado: FAIL — `Failed to resolve import "./environment"`.

- [ ] **Step 3: Implemente**

Crie `lib/pwa/environment.ts`:

```ts
// lib/pwa/environment.ts
// Retrato do ambiente do browser para alimentar resolvePrompt. As funções que
// recebem user agent são exportadas separadamente porque são testáveis; o resto
// só existe no client.
import { isPushSupported } from './pushClient'

export function matchesIOS(ua: string): boolean {
  return /iPhone|iPad|iPod/i.test(ua)
}

export function matchesAndroid(ua: string): boolean {
  return /Android/i.test(ua)
}

// Detecção por user agent é frágil por natureza, então erra para o lado seguro:
// na dúvida devolve false e a pessoa vê o passo a passo normal do Safari.
export function matchesInAppBrowser(ua: string): boolean {
  return /FBAN|FBAV|FBIOS|Instagram|Line\/|Twitter|LinkedInApp|MicroMessenger|TikTok/i.test(ua)
}

export type PwaEnvironment = {
  isMobile: boolean
  isIOS: boolean
  isInAppBrowser: boolean
  standalone: boolean
  pushSupported: boolean
}

export function readEnvironment(): PwaEnvironment {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return {
      isMobile: false,
      isIOS: false,
      isInAppBrowser: false,
      standalone: false,
      pushSupported: false,
    }
  }

  const ua = navigator.userAgent
  // iPadOS 13+ se declara como Mac; o toque é o que o denuncia.
  const iPadMascarado =
    navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
  const isIOS = matchesIOS(ua) || iPadMascarado
  const isAndroid = matchesAndroid(ua)

  // "Celular" = sistema móvel E tela estreita. Exclui desktop por completo e
  // tablets grandes em paisagem, onde o popup só atrapalharia.
  const isMobile =
    (isIOS || isAndroid) && window.matchMedia('(max-width: 900px)').matches

  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true

  return {
    isMobile,
    isIOS,
    isInAppBrowser: matchesInAppBrowser(ua),
    standalone,
    pushSupported: isPushSupported(),
  }
}
```

- [ ] **Step 4: Rode o teste e confirme que passa**

Tool PowerShell: `npm run test:run -- lib/pwa/environment.test.ts`
Esperado: PASS, 9 testes.

- [ ] **Step 5: Commit**

```bash
git add lib/pwa/environment.ts lib/pwa/environment.test.ts && git commit -m "feat(pwa): leitura do ambiente para o popup de instalacao"
```

---

### Task 4: A animação do passo a passo do iPhone

**Files:**
- Create: `components/pwa/IosInstallAnimation.tsx`

Sem teste unitário: é um componente puramente visual, verificado no preview
(Task 12). O que importa aqui é o contrato — `scene` opcional para renderização
determinística, e o atributo `data-install-stage` que o script de captura usa
para recortar o frame.

- [ ] **Step 1: Crie o componente**

Crie `components/pwa/IosInstallAnimation.tsx`:

```tsx
'use client'
// components/pwa/IosInstallAnimation.tsx
// Passo a passo animado de "Adicionar à Tela de Início" no iPhone — o iOS não
// expõe nenhuma API de instalação, então o passo a passo é a única via.
// Sem biblioteca de animação: as cenas são estado do React com transições CSS.
// Usado em três lugares sem alteração: o sheet de instalação, a página
// /instalar e a captura de frames do GIF (via a prop `scene`).
import { useEffect, useState } from 'react'
import { Share, ChevronLeft, ChevronRight, BookOpen, Copy, Star, SquarePlus } from 'lucide-react'

export const SCENE_LEGENDAS = [
  'Toque no botão Compartilhar, na barra de baixo',
  'O menu vai subir na tela',
  'Role a lista até achar a opção',
  'Toque em "Adicionar à Tela de Início"',
  'Confirme em "Adicionar", lá em cima',
  'Pronto! O ArenaHub está na sua tela 🎉',
] as const

export const SCENE_COUNT = SCENE_LEGENDAS.length
export const SCENE_MS = 2200

// Passos em texto, para quem não quer esperar o loop, para prefers-reduced-motion
// e para leitores de tela.
export const PASSOS_TEXTO = [
  'Abra o ArenaHub no Safari (não funciona pelo Instagram nem pelo Chrome).',
  'Toque no botão Compartilhar — o quadradinho com a seta pra cima, na barra de baixo.',
  'Role o menu e toque em "Adicionar à Tela de Início".',
  'Toque em "Adicionar" no canto superior direito. O ícone aparece na sua tela.',
] as const

function Dedo({ className }: { className: string }) {
  return (
    <span
      aria-hidden
      className={`absolute h-9 w-9 rounded-full border-2 border-white/70 bg-white/25 shadow-lg transition-all duration-500 ${className}`}
    />
  )
}

export function IosInstallAnimation({ scene: forcada }: { scene?: number }) {
  const [auto, setAuto] = useState(0)
  const estatica = typeof forcada === 'number'
  const scene = estatica ? Math.min(Math.max(forcada, 0), SCENE_COUNT - 1) : auto

  useEffect(() => {
    if (estatica) return
    // Quem pediu menos movimento fica na cena 1 e lê os passos em texto.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const id = setInterval(() => setAuto((s) => (s + 1) % SCENE_COUNT), SCENE_MS)
    return () => clearInterval(id)
  }, [estatica])

  const sheetAberto = scene >= 1 && scene <= 4
  const listaRolada = scene >= 2
  const confirmando = scene === 4
  const instalado = scene === 5

  return (
    <div className="flex flex-col items-center gap-3">
      {/* Moldura do iPhone. data-install-stage é o alvo do script de captura. */}
      <div
        data-install-stage
        className="relative h-[400px] w-[200px] shrink-0 overflow-hidden rounded-[30px] border-4 border-slate-700 bg-slate-950 shadow-2xl"
      >
        {/* Notch */}
        <div className="absolute left-1/2 top-0 z-30 h-4 w-20 -translate-x-1/2 rounded-b-xl bg-slate-700" />

        {/* --- Tela de início (cena final) --- */}
        <div
          className={`absolute inset-0 z-20 bg-gradient-to-b from-sky-900 to-slate-900 p-3 pt-8 transition-opacity duration-500 ${
            instalado ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
        >
          <div className="grid grid-cols-4 gap-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="aspect-square rounded-xl bg-white/10" />
            ))}
            <div
              className={`flex aspect-square items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-[9px] font-bold text-white ring-2 ring-white/70 ${
                instalado ? 'animate-bounce' : ''
              }`}
            >
              AH
            </div>
          </div>
          <p className="mt-2 text-center text-[8px] text-white/70">ArenaHub</p>
        </div>

        {/* --- Safari --- */}
        <div className="absolute inset-0 z-10 flex flex-col bg-slate-900 pt-6">
          <div className="mx-3 rounded-md bg-slate-800 px-2 py-1 text-center text-[8px] text-slate-400">
            arenahub.website
          </div>
          <div className="flex-1 space-y-2 p-3">
            <div className="rounded-lg bg-gradient-to-br from-brand-600 to-brand-800 p-2">
              <div className="h-1.5 w-12 rounded bg-white/70" />
              <div className="mt-1 h-1 w-16 rounded bg-white/40" />
            </div>
            <div className="h-10 rounded-lg bg-slate-800" />
            <div className="h-10 rounded-lg bg-slate-800" />
          </div>
          {/* Barra inferior do Safari */}
          <div className="relative flex items-center justify-around border-t border-slate-800 px-3 py-2 text-slate-500">
            <ChevronLeft size={14} />
            <ChevronRight size={14} />
            <span
              className={`relative rounded p-1 transition-all ${
                scene === 0 ? 'bg-brand-500/30 text-brand-300 ring-2 ring-brand-400' : ''
              }`}
            >
              <Share size={14} />
              {scene === 0 && (
                <span className="absolute -inset-1 animate-ping rounded-full border-2 border-brand-400" />
              )}
            </span>
            <BookOpen size={14} />
            <span className="h-3 w-3 rounded-sm border border-current" />
          </div>
        </div>

        {/* --- Folha de compartilhamento --- */}
        <div
          className={`absolute inset-x-0 bottom-0 z-20 rounded-t-2xl bg-slate-800 p-3 shadow-2xl transition-transform duration-500 ${
            sheetAberto ? 'translate-y-0' : 'translate-y-full'
          }`}
        >
          <div className="mx-auto mb-2 h-1 w-8 rounded-full bg-slate-600" />
          <div className="mb-2 flex items-center gap-2">
            <div className="h-6 w-6 rounded bg-gradient-to-br from-brand-500 to-brand-700" />
            <div>
              <p className="text-[8px] font-semibold text-white">ArenaHub</p>
              <p className="text-[7px] text-slate-400">arenahub.website</p>
            </div>
          </div>
          {/* A lista "rola": um translate negativo revela a opção que interessa. */}
          <div className="h-[104px] overflow-hidden">
            <div
              className={`space-y-1 transition-transform duration-500 ${
                listaRolada ? '-translate-y-[52px]' : 'translate-y-0'
              }`}
            >
              <Linha icone={<Copy size={11} />} texto="Copiar" />
              <Linha icone={<BookOpen size={11} />} texto="Adicionar à Lista de Leitura" />
              <Linha icone={<Star size={11} />} texto="Adicionar aos Favoritos" />
              <Linha
                icone={<SquarePlus size={11} />}
                texto="Adicionar à Tela de Início"
                destaque={scene >= 3}
              />
              <Linha icone={<Share size={11} />} texto="Marcação" />
            </div>
          </div>
        </div>

        {/* --- Confirmação "Adicionar" --- */}
        <div
          className={`absolute inset-0 z-[25] flex flex-col bg-slate-900 pt-6 transition-opacity duration-300 ${
            confirmando ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
        >
          <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
            <span className="text-[8px] text-slate-400">Cancelar</span>
            <span className="text-[8px] font-semibold text-white">Tela de Início</span>
            <span className="rounded bg-brand-500/30 px-1.5 py-0.5 text-[8px] font-bold text-brand-200 ring-2 ring-brand-400">
              Adicionar
            </span>
          </div>
          <div className="flex items-center gap-2 p-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 text-[8px] font-bold text-white">
              AH
            </div>
            <span className="text-[9px] text-white">ArenaHub</span>
          </div>
        </div>

        {/* --- Dedo --- */}
        {scene === 0 && <Dedo className="bottom-2 left-[86px] z-30" />}
        {scene === 3 && <Dedo className="bottom-[46px] left-[30px] z-30" />}
        {scene === 4 && <Dedo className="right-2 top-6 z-30" />}
      </div>

      <p className="min-h-[32px] max-w-[240px] text-center text-xs text-slate-300">
        <span className="font-bold text-brand-400">{Math.min(scene + 1, SCENE_COUNT)}.</span>{' '}
        {SCENE_LEGENDAS[scene]}
      </p>
    </div>
  )
}

function Linha({
  icone,
  texto,
  destaque,
}: {
  icone: React.ReactNode
  texto: string
  destaque?: boolean
}) {
  return (
    <div
      className={`flex h-12 items-center justify-between rounded-lg px-2 text-[8px] transition-all ${
        destaque
          ? 'bg-brand-500/20 text-white ring-2 ring-brand-400'
          : 'bg-slate-700/50 text-slate-300'
      }`}
    >
      <span>{texto}</span>
      <span className="text-slate-400">{icone}</span>
    </div>
  )
}
```

- [ ] **Step 2: Verifique que compila**

Tool PowerShell: `npx tsc --noEmit`
Esperado: nenhum erro. Se `SquarePlus` não existir na versão instalada do
lucide-react, rode `node -e "console.log(Object.keys(require('lucide-react')).filter(k=>/Plus/.test(k)).join('\n'))"` e troque pelo nome correto (`PlusSquare` nas versões anteriores).

- [ ] **Step 3: Commit**

```bash
git add components/pwa/IosInstallAnimation.tsx && git commit -m "feat(pwa): animacao do passo a passo de instalacao no iPhone"
```

---

### Task 5: O bottom sheet de instalação

**Files:**
- Create: `components/pwa/InstallSheet.tsx`

- [ ] **Step 1: Crie o componente**

Segue o padrão visual do `components/tour/FaqModal.tsx` (sheet subindo de baixo,
backdrop clicável). O z-index precisa ficar acima do `BottomNav` (`z-50`) e
abaixo do `FaqModal` (`z-[60]`) — daí `z-[55]`.

Crie `components/pwa/InstallSheet.tsx`:

```tsx
'use client'
// components/pwa/InstallSheet.tsx
// O convite para instalar o app. Três variantes, decididas por resolvePrompt:
// Android (prompt nativo), iOS (passo a passo) e iOS dentro de in-app browser
// (onde instalar é impossível — só resta mandar abrir no Safari).
import { useState } from 'react'
import Link from 'next/link'
import { X, Share, Compass, Check } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { IosInstallAnimation, PASSOS_TEXTO } from './IosInstallAnimation'

export type InstallSheetDecision = 'install-ios' | 'install-ios-inapp' | 'install-android'

export function InstallSheet({
  decision,
  onDismiss,
  onInstall,
}: {
  decision: InstallSheetDecision
  onDismiss: () => void
  onInstall: () => Promise<void>
}) {
  const [mostrandoPassos, setMostrandoPassos] = useState(false)
  const [instalando, setInstalando] = useState(false)
  const [linkCopiado, setLinkCopiado] = useState(false)

  async function instalar() {
    setInstalando(true)
    await onInstall()
    setInstalando(false)
  }

  async function copiarLink() {
    try {
      await navigator.clipboard.writeText(window.location.origin)
      setLinkCopiado(true)
    } catch {
      // Clipboard barrado (contexto não seguro, permissão negada): o endereço
      // já está visível na barra do navegador, então não há o que fazer.
    }
  }

  return (
    <div
      className="fixed inset-0 z-[55] flex items-end justify-center bg-black/60 sm:items-center sm:p-4"
      onClick={onDismiss}
      role="dialog"
      aria-modal="true"
      aria-label="Instalar o aplicativo"
    >
      <div
        className="max-h-[88vh] w-full overflow-y-auto rounded-t-2xl border border-surface-border bg-surface-card p-5 sm:max-w-md sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onDismiss}
          aria-label="Fechar"
          className="float-right p-1 text-slate-400 transition-colors hover:text-white"
        >
          <X className="h-5 w-5" />
        </button>

        {decision === 'install-android' && (
          <>
            <h2 className="mb-1 pr-8 text-base font-bold text-white">Instalar o ArenaHub?</h2>
            <p className="mb-4 text-sm text-slate-400">
              Um toque e ele vira app de verdade no seu celular — abre mais rápido e te avisa das
              suas aulas.
            </p>
            <div className="flex gap-2">
              <Button onClick={instalar} loading={instalando} className="flex-1">
                Instalar
              </Button>
              <Button onClick={onDismiss} variant="ghost">
                Agora não
              </Button>
            </div>
          </>
        )}

        {decision === 'install-ios' && (
          <>
            <div className="mb-1 flex items-center gap-2 pr-8">
              <Share size={18} className="shrink-0 text-brand-500" />
              <h2 className="text-base font-bold text-white">
                Bota o ArenaHub na sua tela de início 🏐
              </h2>
            </div>
            <p className="mb-4 text-sm text-slate-400">
              10 segundos e suas aulas ficam a um toque.
            </p>

            {mostrandoPassos ? (
              <>
                <IosInstallAnimation />
                <ol className="mt-4 space-y-2 text-xs text-slate-400">
                  {PASSOS_TEXTO.map((passo, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="font-bold text-brand-400">{i + 1}.</span>
                      <span>{passo}</span>
                    </li>
                  ))}
                </ol>
                <div className="mt-4 flex items-center justify-between gap-2">
                  <Link
                    href="/ajuda/aluno#instale-o-app-no-seu-celular"
                    className="text-xs text-brand-400 underline underline-offset-2 hover:text-brand-300"
                  >
                    Ver na ajuda
                  </Link>
                  <Button onClick={onDismiss} variant="ghost" size="sm">
                    Fechar
                  </Button>
                </div>
              </>
            ) : (
              <div className="flex gap-2">
                <Button onClick={() => setMostrandoPassos(true)} className="flex-1">
                  Ver como faz
                </Button>
                <Button onClick={onDismiss} variant="ghost">
                  Agora não
                </Button>
              </div>
            )}
          </>
        )}

        {decision === 'install-ios-inapp' && (
          <>
            <div className="mb-1 flex items-center gap-2 pr-8">
              <Compass size={18} className="shrink-0 text-brand-500" />
              <h2 className="text-base font-bold text-white">Quase lá! Abre no Safari 🧭</h2>
            </div>
            <p className="mb-4 text-sm text-slate-400">
              Por aqui dentro o iPhone não deixa instalar. Toque nos três pontinhos no canto da
              tela e escolha <strong className="text-slate-200">&ldquo;Abrir no Safari&rdquo;</strong>.
            </p>
            <div className="flex gap-2">
              <Button onClick={copiarLink} variant="secondary" className="flex-1">
                {linkCopiado ? (
                  <>
                    <Check size={14} className="mr-1" /> Link copiado
                  </>
                ) : (
                  'Copiar link'
                )}
              </Button>
              <Button onClick={onDismiss} variant="ghost">
                Agora não
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verifique que compila**

Tool PowerShell: `npx tsc --noEmit`
Esperado: nenhum erro.

- [ ] **Step 3: Commit**

```bash
git add components/pwa/InstallSheet.tsx && git commit -m "feat(pwa): bottom sheet de instalacao com variantes iOS e Android"
```

---

### Task 6: A faixa de notificações

**Files:**
- Create: `components/pwa/PushNagBanner.tsx`

- [ ] **Step 1: Crie o componente**

A faixa **não tem botão de fechar** por decisão de produto: ela some sozinha
quando a permissão é concedida. É uma linha fina, em fluxo normal, e não cobre
conteúdo.

Crie `components/pwa/PushNagBanner.tsx`:

```tsx
'use client'
// components/pwa/PushNagBanner.tsx
// Faixa que insiste na permissão de notificação. Por decisão de produto não tem
// botão de fechar: some sozinha quando a permissão é concedida. Tom leve, sem
// cara de erro — quem se irrita com o aviso não instala o app.
import { useState } from 'react'
import Link from 'next/link'
import { Bell, BellOff } from 'lucide-react'
import { subscribeToPush } from '@/lib/pwa/pushClient'

export function PushNagBanner({
  state,
  onGranted,
}: {
  state: 'push-ask' | 'push-blocked'
  onGranted: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function ativar() {
    setBusy(true)
    setErro(null)
    const res = await subscribeToPush()
    setBusy(false)
    // Sucesso ou recusa, o ambiente mudou: recalcula (a faixa some se virou
    // 'granted', vira 'push-blocked' se a pessoa clicou em Bloquear).
    if (res.error) setErro(res.error)
    onGranted()
  }

  if (state === 'push-blocked') {
    return (
      <div className="mx-4 mb-3 flex items-center gap-2 rounded-lg border border-slate-600/40 bg-slate-500/10 px-3 py-2 text-xs text-slate-300">
        <BellOff className="h-4 w-4 shrink-0 text-slate-400" />
        <span className="min-w-0 flex-1">
          As notificações estão bloqueadas no navegador. Toque no cadeado 🔒 ao lado do endereço
          pra liberar.
        </span>
        <Link
          href="/ajuda/aluno#instale-o-app-no-seu-celular"
          className="shrink-0 font-semibold text-slate-200 underline underline-offset-2"
        >
          Como faço
        </Link>
      </div>
    )
  }

  return (
    <div className="mx-4 mb-3 flex items-center gap-2 rounded-lg border border-brand-600/30 bg-brand-600/10 px-3 py-2 text-xs text-brand-100">
      <Bell className="h-4 w-4 shrink-0 text-brand-400" />
      <span className="min-w-0 flex-1">
        {erro ?? 'Tá faltando combinar o principal: aula cancelada, vaga na fila, lembrete de treino.'}
      </span>
      <button
        onClick={ativar}
        disabled={busy}
        className="shrink-0 rounded-md bg-gradient-to-r from-brand-600 to-brand-700 px-2.5 py-1 font-semibold text-white transition-opacity disabled:opacity-50"
      >
        {busy ? '...' : 'Ativar'}
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Verifique que compila**

Tool PowerShell: `npx tsc --noEmit`
Esperado: nenhum erro.

- [ ] **Step 3: Commit**

```bash
git add components/pwa/PushNagBanner.tsx && git commit -m "feat(pwa): faixa persistente de ativacao de notificacoes"
```

---

### Task 7: O orquestrador e a captura do `beforeinstallprompt`

**Files:**
- Create: `components/pwa/InstallGate.tsx`
- Modify: `app/layout.tsx`

Este é o ponto de falha mais provável da feature: `beforeinstallprompt` dispara
antes de o React hidratar, e se ninguém chamar `preventDefault()` o navegador
consome o evento e mostra o próprio banner. O script inline resolve isso.

- [ ] **Step 1: Crie o orquestrador**

Crie `components/pwa/InstallGate.tsx`:

```tsx
'use client'
// components/pwa/InstallGate.tsx
// Junta ambiente + permissão + dispensa, chama resolvePrompt e renderiza o que
// ele decidir. Montado nos layouts de aluno e admin; se auto-suprime no desktop.
import { useCallback, useEffect, useState } from 'react'
import { readEnvironment } from '@/lib/pwa/environment'
import { resolvePrompt, type PromptDecision } from '@/lib/pwa/promptState'
import { readDismissedAt, writeDismissedAt } from '@/lib/pwa/dismissStorage'
import { InstallSheet } from './InstallSheet'
import { PushNagBanner } from './PushNagBanner'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

declare global {
  interface Window {
    __arenahubInstallEvent?: BeforeInstallPromptEvent
  }
}

export function InstallGate() {
  const [decision, setDecision] = useState<PromptDecision>('none')

  const recompute = useCallback(() => {
    if (typeof window === 'undefined') return
    const env = readEnvironment()
    setDecision(
      resolvePrompt({
        ...env,
        installable: Boolean(window.__arenahubInstallEvent),
        permission: 'Notification' in window ? Notification.permission : 'denied',
        dismissedAt: readDismissedAt(),
        now: Date.now(),
      }),
    )
  }, [])

  useEffect(() => {
    // Roda depois da hidratação: o evento pode já ter sido capturado pelo
    // script inline do layout raiz antes de o React existir.
    recompute()

    const onInstalled = () => {
      window.__arenahubInstallEvent = undefined
      recompute()
    }
    // Emitido pelo script inline quando o evento chega depois da hidratação.
    window.addEventListener('arenahub:installable', recompute)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('arenahub:installable', recompute)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [recompute])

  function dispensar() {
    writeDismissedAt()
    recompute()
  }

  async function instalar() {
    const evt = window.__arenahubInstallEvent
    if (!evt) return
    await evt.prompt()
    await evt.userChoice
    // O evento só pode ser usado uma vez, aceito ou recusado.
    window.__arenahubInstallEvent = undefined
    recompute()
  }

  if (decision === 'none') return null
  if (decision === 'push-ask' || decision === 'push-blocked') {
    return <PushNagBanner state={decision} onGranted={recompute} />
  }
  return <InstallSheet decision={decision} onDismiss={dispensar} onInstall={instalar} />
}
```

- [ ] **Step 2: Adicione o script inline no layout raiz**

Em `app/layout.tsx`, dentro de `<body>`, **como primeiro filho**, antes de
`{children}`:

```tsx
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className={`${inter.className} ${inter.variable} ${sora.variable}`}>
        {/* beforeinstallprompt dispara antes de o React hidratar e, sem
            preventDefault, o navegador consome o evento. Este script roda na
            análise do HTML e guarda o evento para o InstallGate usar depois. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__arenahubInstallEvent=e;window.dispatchEvent(new Event('arenahub:installable'))});",
          }}
        />
        {children}
        <CookieBanner />
      </body>
    </html>
  )
}
```

- [ ] **Step 3: Verifique que compila**

Tool PowerShell: `npx tsc --noEmit`
Esperado: nenhum erro.

- [ ] **Step 4: Commit**

```bash
git add components/pwa/InstallGate.tsx app/layout.tsx && git commit -m "feat(pwa): orquestrador do popup e captura precoce do beforeinstallprompt"
```

---

### Task 8: Montar nos layouts e remover a lógica antiga

**Files:**
- Modify: `app/(dashboard)/layout.tsx`
- Modify: `app/(admin)/layout.tsx:140`
- Modify: `app/(dashboard)/home/page.tsx:21,298`
- Delete: `components/pwa/PushOnboardingCard.tsx`
- Delete: `lib/pwa/onboardingState.ts`
- Delete: `lib/pwa/onboardingState.test.ts`

O `InstallGate` entra como primeiro filho de `<main>` nos dois layouts. Em fluxo
normal, não `fixed`: a faixa fica logo abaixo do header sem cobrir conteúdo, e o
sheet é `fixed` por conta própria, então a posição no DOM não importa.

- [ ] **Step 1: Monte na área do aluno**

Em `app/(dashboard)/layout.tsx`, adicione o import:

```tsx
import { InstallGate } from '@/components/pwa/InstallGate'
```

e coloque o componente como primeiro filho de `<main>`:

```tsx
      <main className="pt-11 pb-24">
        <InstallGate />
        {children}
```

- [ ] **Step 2: Monte no painel da academia**

Em `app/(admin)/layout.tsx`, adicione o import:

```tsx
import { InstallGate } from '@/components/pwa/InstallGate'
```

e, na linha 140, coloque o componente como primeiro filho de `<main>`:

```tsx
      <main className="flex-1 p-6 mt-14 md:mt-0">
        <InstallGate />
```

- [ ] **Step 3: Remova o card antigo da home**

Em `app/(dashboard)/home/page.tsx`, apague a linha 21:

```tsx
import { PushOnboardingCard } from '@/components/pwa/PushOnboardingCard'
```

e a linha 298:

```tsx
      <PushOnboardingCard />
```

- [ ] **Step 4: Apague os arquivos obsoletos**

```bash
git rm components/pwa/PushOnboardingCard.tsx lib/pwa/onboardingState.ts lib/pwa/onboardingState.test.ts
```

- [ ] **Step 5: Confirme que nada mais referencia o que foi apagado**

Use a ferramenta Grep com o padrão `PushOnboardingCard|onboardingState|pwa-onboarding-dismissed`,
ignorando `docs/superpowers/`.
Esperado: nenhum resultado em código. Se algum aparecer, remova antes de seguir.

- [ ] **Step 6: Rode a suíte inteira**

Tool PowerShell: `npm run test:run`
Esperado: PASS. A contagem cai 8 testes (os de `onboardingState`) e sobe 30
(as três novas suítes).

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(pwa): monta InstallGate nos layouts e remove o card de onboarding"
```

---

### Task 9: Página pública `/instalar`

**Files:**
- Create: `app/(public)/instalar/page.tsx`

`app/(public)/layout.tsx` é um layout mínimo sem guards de auth, sem BottomNav e
sem sidebar — a página cai nele sem adaptação. A query `?cena=N` congela a
animação num quadro, que é como o script de captura gera os frames do GIF.

- [ ] **Step 1: Crie a página**

Crie `app/(public)/instalar/page.tsx`:

```tsx
// app/(public)/instalar/page.tsx
// Página pública com o passo a passo de instalação. Serve para dois usos: link
// compartilhável nos grupos das academias e fonte dos frames do GIF (?cena=N
// congela a animação num quadro específico).
import type { Metadata } from 'next'
import { IosInstallAnimation, PASSOS_TEXTO } from '@/components/pwa/IosInstallAnimation'
import { Logo } from '@/components/ui/Logo'

export const metadata: Metadata = {
  title: 'Como instalar o ArenaHub no seu celular',
  description:
    'Passo a passo para colocar o ArenaHub na tela de início do seu iPhone ou Android.',
}

export default function InstalarPage({
  searchParams,
}: {
  searchParams: { cena?: string }
}) {
  const cenaCrua = Number(searchParams.cena)
  const cena = Number.isInteger(cenaCrua) ? cenaCrua : undefined

  return (
    <main className="min-h-screen bg-surface px-4 py-8 text-white">
      <div className="mx-auto flex max-w-md flex-col items-center">
        <Logo variant="icon" size="sm" />
        <h1 className="mt-4 text-center text-xl font-bold">
          Bota o ArenaHub na sua tela de início 🏐
        </h1>
        <p className="mb-6 mt-2 text-center text-sm text-slate-400">
          Leva 10 segundos e suas aulas ficam a um toque.
        </p>

        <section className="w-full rounded-2xl border border-surface-border bg-surface-card p-5">
          <h2 className="mb-4 text-center text-sm font-semibold text-brand-400">
            No iPhone (Safari)
          </h2>
          <IosInstallAnimation scene={cena} />
          <ol className="mt-5 space-y-3 text-sm text-slate-400">
            {PASSOS_TEXTO.map((passo, i) => (
              <li key={i} className="flex gap-2">
                <span className="font-bold text-brand-400">{i + 1}.</span>
                <span>{passo}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-4 w-full rounded-2xl border border-surface-border bg-surface-card p-5">
          <h2 className="mb-3 text-sm font-semibold text-brand-400">No Android (Chrome)</h2>
          <p className="text-sm text-slate-400">
            Mais fácil ainda: abra o ArenaHub e toque em{' '}
            <strong className="text-slate-200">Instalar</strong> quando o aviso aparecer. Se ele
            não aparecer, toque nos três pontinhos no canto do Chrome e escolha{' '}
            <strong className="text-slate-200">
              &ldquo;Instalar aplicativo&rdquo;
            </strong>{' '}
            ou <strong className="text-slate-200">&ldquo;Adicionar à tela inicial&rdquo;</strong>.
          </p>
        </section>

        <section className="mt-4 w-full rounded-2xl border border-surface-border bg-surface-card p-5">
          <h2 className="mb-3 text-sm font-semibold text-brand-400">
            E as notificações?
          </h2>
          <p className="text-sm text-slate-400">
            Depois de instalar, abra o app pela tela de início e toque em{' '}
            <strong className="text-slate-200">Ativar</strong> no aviso que aparece no topo. É por
            ali que chegam aula cancelada, vaga liberada na fila e lembrete de treino.
          </p>
        </section>
      </div>
    </main>
  )
}
```

- [ ] **Step 2: Verifique no browser**

Use `preview_start` com `{name: "dev"}` (crie a entrada em `.claude/launch.json`
se ela não existir: `runtimeExecutable: "npm"`, `runtimeArgs: ["run","dev"]`,
`port: 3000`). Navegue para `http://localhost:3000/instalar`.

Confira com `read_page` e um screenshot: a animação avança sozinha entre as 6
cenas, a legenda muda junto e os 4 passos em texto aparecem abaixo. Depois
navegue para `/instalar?cena=3` e confirme que a animação **congela** com
"Adicionar à Tela de Início" destacado.

- [ ] **Step 3: Commit**

```bash
git add "app/(public)/instalar/page.tsx" && git commit -m "feat(pwa): pagina publica /instalar com passo a passo compartilhavel"
```

---

### Task 10: Script que gera o GIF

**Files:**
- Create: `scripts/gerar-video-instalacao.mjs`
- Create: `docs/faq/images/instalar-ios.gif` (gerado)
- Modify: `package.json`

A receita do `sharp` abaixo foi **verificada** neste projeto. O caminho
alternativo (buffer raw empilhado com `pageHeight`) falha com
`vips_image_get: field "n-pages" not found` — use `join`.

- [ ] **Step 1: Crie o script**

Crie `scripts/gerar-video-instalacao.mjs`:

```js
// scripts/gerar-video-instalacao.mjs
// -----------------------------------------------------------------------------
// Gera docs/faq/images/instalar-ios.gif a partir da página /instalar: navega
// uma vez por cena com ?cena=N, recorta a moldura do iPhone e monta um GIF
// animado. Não depende de ffmpeg — sharp faz a montagem via `join`.
//
// Uso:
//   1. Suba o app:  npm run dev        (localhost:3000)
//   2. Rode:        npm run gerar:video-instalacao
//
// Variáveis de ambiente:
//   INSTALL_BASE_URL -> base do app (default http://localhost:3000)
// -----------------------------------------------------------------------------
import { chromium } from '@playwright/test'
import sharp from 'sharp'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BASE_URL = process.env.INSTALL_BASE_URL ?? 'http://localhost:3000'
const DESTINO = join(__dirname, '..', 'docs', 'faq', 'images', 'instalar-ios.gif')

// Precisa bater com SCENE_COUNT/SCENE_MS de components/pwa/IosInstallAnimation.tsx.
const CENAS = 6
const DELAY_MS = 2200

const browser = await chromium.launch()
const page = await browser.newPage({
  viewport: { width: 420, height: 760 },
  deviceScaleFactor: 2,
})

const frames = []
for (let cena = 0; cena < CENAS; cena++) {
  await page.goto(`${BASE_URL}/instalar?cena=${cena}`, { waitUntil: 'networkidle' })
  const moldura = page.locator('[data-install-stage]')
  await moldura.waitFor({ state: 'visible' })
  // As transições CSS duram 500ms; espere assentar antes de fotografar.
  await page.waitForTimeout(800)
  frames.push(await moldura.screenshot({ type: 'png' }))
  console.log(`  cena ${cena + 1}/${CENAS} capturada`)
}

await browser.close()

await sharp(frames, { join: { across: 1, animated: true } })
  .gif({ loop: 0, delay: frames.map(() => DELAY_MS) })
  .toFile(DESTINO)

console.log(`\nGIF gerado: ${DESTINO} (${frames.length} quadros, ${DELAY_MS}ms cada)`)
```

- [ ] **Step 2: Adicione o script ao package.json**

Em `package.json`, dentro de `"scripts"`, depois de `"test:run"`:

```json
    "test:run": "vitest run",
    "gerar:video-instalacao": "node scripts/gerar-video-instalacao.mjs"
```

- [ ] **Step 3: Rode e verifique o GIF**

Com o dev server rodando (via `preview_start`), tool PowerShell:

```
npm run gerar:video-instalacao
```

Esperado: 6 linhas "cena N/6 capturada" e a linha final com o caminho do GIF.

Confirme que o arquivo é um GIF animado de 6 páginas, tool PowerShell:

```
node -e "require('sharp')('docs/faq/images/instalar-ios.gif',{pages:-1}).metadata().then(m=>console.log(m.format,m.pages,m.width,m.pageHeight))"
```

Esperado: `gif 6 <largura> <altura>` — o importante é `pages` ser 6.

Abra o GIF com `SendUserFile` (`display: "render"`) para o usuário conferir o
resultado antes de seguir.

- [ ] **Step 4: Commit**

```bash
git add scripts/gerar-video-instalacao.mjs package.json docs/faq/images/instalar-ios.gif && git commit -m "feat(pwa): script que gera o GIF do passo a passo de instalacao"
```

---

### Task 11: FAQ e capturas de tela

**Files:**
- Modify: `docs/faq/aluno.md`
- Modify: `docs/faq/academia.md`
- Modify: `docs/faq/capture.mjs`

Os manuais são servidos dentro do app em `/ajuda/[manual]`, e o sheet linka para
a âncora `#instale-o-app-no-seu-celular` (gerada por `rehype-slug` a partir do
título). O texto da âncora e o do título precisam bater.

- [ ] **Step 1: Adicione a seção no manual do aluno**

Em `docs/faq/aluno.md`, insira **antes** da linha `## 1. Como entrar na academia`
(linha 31) e adicione a entrada correspondente no Índice (a lista que começa na
linha 15):

```markdown
## Instale o app no seu celular

O ArenaHub funciona melhor instalado: abre direto da tela de início, sem digitar
endereço, e é a única forma de receber os avisos de aula cancelada, vaga liberada
na fila e lembrete de treino.

### No iPhone

O iPhone não tem botão de instalar — o caminho é pelo Safari:

![Passo a passo de instalação no iPhone](images/instalar-ios.gif)

1. Abra o ArenaHub no **Safari**. Pelo Instagram, pelo Facebook ou pelo Chrome
   não funciona — o menu deles não tem a opção.
2. Toque no botão **Compartilhar** (o quadradinho com a seta pra cima, na barra
   de baixo).
3. Role o menu e toque em **"Adicionar à Tela de Início"**.
4. Toque em **"Adicionar"** no canto superior direito.

### No Android

Bem mais rápido: abra o ArenaHub e toque em **Instalar** no aviso que aparece.
Se o aviso não aparecer, toque nos três pontinhos do Chrome e escolha
**"Instalar aplicativo"**.

### Depois de instalar: ative as notificações

Abra o app pela tela de início e toque em **Ativar** na faixa laranja do topo. O
celular vai perguntar se você permite notificações — responda **Permitir**.

Se você tocou em "Bloquear" sem querer, dá pra reverter: toque no cadeado 🔒 ao
lado do endereço no navegador e libere as notificações do site.
```

- [ ] **Step 2: Adicione a seção no manual da academia**

Em `docs/faq/academia.md`, adicione uma seção equivalente no topo (antes da
primeira seção numerada) e registre no Índice:

```markdown
## Instale o app no seu celular

O painel da academia também funciona instalado, e é assim que você recebe os
avisos no celular: aluno entrando na fila de espera, cancelamento em cima da
hora, pagamento confirmado.

### No iPhone

![Passo a passo de instalação no iPhone](images/instalar-ios.gif)

1. Abra o ArenaHub no **Safari** (não pelo Instagram nem pelo Chrome).
2. Toque no botão **Compartilhar**, na barra de baixo.
3. Role o menu e toque em **"Adicionar à Tela de Início"**.
4. Toque em **"Adicionar"** no canto superior direito.

### No Android

Abra o ArenaHub e toque em **Instalar** no aviso que aparece. Se ele não
aparecer, use os três pontinhos do Chrome → **"Instalar aplicativo"**.

### Ative as notificações

Depois de instalar, abra o app pela tela de início e toque em **Ativar** na faixa
do topo. Sem essa permissão o celular não te avisa de nada.

Você pode mandar este link direto para seus alunos: **arenahub.website/instalar**
— é a mesma explicação, numa página só.
```

- [ ] **Step 3: Capture as telas novas**

O contexto do aluno em `docs/faq/capture.mjs` se chama `stuCtx` e a página é
`stu`. O popup só aparece com user agent móvel e tela estreita, e um contexto do
Playwright não muda de viewport depois de criado — então é preciso um contexto
novo, reaproveitando a sessão já autenticada via `storageState`.

Insira este bloco **depois** da linha `await capture(stu, '/perfil', 'aluno-perfil')`
e **antes** de `await stuCtx.close()`:

```js
// --- Popup de instalação (só aparece em celular) ---------------------------
// Um contexto não muda de viewport/UA depois de criado, então clonamos a sessão
// do aluno num contexto "iPhone". shot() usa fullPage, que distorce overlays
// fixos — aqui o screenshot é direto, sem fullPage.
await safe('instalar-sheet-ios', async () => {
  const mobileCtx = await browser.newContext({
    viewport: { width: 390, height: 780 },
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    storageState: await stuCtx.storageState(),
  })
  const mob = await mobileCtx.newPage()
  await mob.goto(`${BASE_URL}/home`)
  await mob.getByRole('button', { name: 'Ver como faz' }).waitFor({ timeout: 15000 })
  await mob.screenshot({ path: join(IMAGES_DIR, 'instalar-sheet-ios.png') })
  console.log('  📸 instalar-sheet-ios.png')

  // Com os passos abertos: a animação e a lista numerada.
  await mob.getByRole('button', { name: 'Ver como faz' }).click()
  await mob.waitForTimeout(1000)
  await mob.screenshot({ path: join(IMAGES_DIR, 'instalar-passos-ios.png') })
  console.log('  📸 instalar-passos-ios.png')

  await mobileCtx.close()
})
```

Note que `capture-manifest.json` **não** precisa de edição manual: ele é
reescrito pelo próprio `capture.mjs` no final da execução, a partir do array
`results` que `safe()` alimenta.

- [ ] **Step 4: Confira o link do sheet**

O `InstallSheet` e o `PushNagBanner` apontam para
`/ajuda/aluno#instale-o-app-no-seu-celular`. Com o dev server rodando, navegue
até essa URL no preview e confirme que a página pula para a seção nova. Se a
âncora não bater, ajuste o `href` para o slug real (inspecione o `id` do `<h2>`
com `read_page`).

- [ ] **Step 5: Commit**

```bash
git add docs/faq/ && git commit -m "docs(faq): secao de instalacao do app nos manuais de aluno e academia"
```

---

### Task 12: Verificação de ponta a ponta

**Files:** nenhum (só verificação)

- [ ] **Step 1: Suíte completa, lint e build**

Tool PowerShell, um de cada vez:

```
npm run test:run
```
Esperado: PASS, sem testes pulados.

```
npm run lint
```
Esperado: sem erros. Avisos pré-existentes em outros arquivos são aceitáveis;
avisos nos arquivos novos, não.

```
npm run build
```
Esperado: build completo, com `/instalar` listado como rota estática.

- [ ] **Step 2: Verifique o comportamento no preview**

Com `preview_start` e `resize_window` (preset `mobile`), confirme cada caso.
Como o InstallGate lê o user agent real do browser de preview, force os cenários
pelo `javascript_tool` quando necessário.

1. **Desktop:** `resize_window` preset `desktop`, navegue para `/home`.
   Esperado: nenhum popup, nenhuma faixa. Confirme com `read_page`.
2. **Celular sem instalar:** preset `mobile`. Esperado: o sheet aparece.
   Clique em "Ver como faz" e confirme a animação e os 4 passos.
3. **Dispensa:** clique em "Agora não". Esperado: o sheet some. Recarregue a
   página — o sheet **não** volta. Confirme no console:
   `localStorage.getItem('arenahub-install-dismissed-at')` devolve um número.
4. **Volta depois de 24h:** com `javascript_tool`, rode
   `localStorage.setItem('arenahub-install-dismissed-at', String(Date.now() - 25*60*60*1000))`
   e recarregue. Esperado: o sheet volta.
5. **Faixa de push:** com `javascript_tool`, force o estado instalado
   sobrescrevendo `matchMedia` antes do reload, ou teste no aparelho real.
   Esperado: faixa laranja de uma linha abaixo do header, com botão "Ativar" e
   **sem** botão de fechar.
6. **Console limpo:** `read_console_messages` com `onlyErrors: true` em cada
   passo acima. Esperado: nenhum erro.

- [ ] **Step 3: Screenshot para o usuário**

Tire um screenshot do sheet no iPhone com os passos abertos e mande com
`SendUserFile`, junto com o GIF gerado na Task 10.

- [ ] **Step 4: Commit final, se algo mudou**

```bash
git status
```
Se houver ajustes pendentes da verificação, commite-os. Senão, siga.

---

## Nota sobre o aparelho real

O preview do browser não é iPhone de verdade: `beforeinstallprompt`,
`navigator.standalone` e o prompt de permissão do iOS só se comportam como
devem no aparelho. Antes de considerar a feature entregue, abra o app num iPhone
e num Android reais e confirme o fluxo completo — instalar, abrir pela tela de
início, ver a faixa, permitir, ver a faixa sumir.
