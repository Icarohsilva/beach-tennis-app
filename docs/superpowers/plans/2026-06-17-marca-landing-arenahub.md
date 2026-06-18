# Marca + Landing (ArenaHub) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebrand the app from "BT App / Academia Hudson Barros" to the SaaS platform **ArenaHub**, ship a real marketing landing page at `app/page.tsx`, and make the post-login UI show each academy's own name.

**Architecture:** Two brand layers. Pre-login surfaces (landing, auth pages, `Logo`, metadata) show the **platform brand (ArenaHub)**. Post-login surfaces show the **academy's dynamic name** from `organizations.name` (already fetched via `getCurrentOrg()` / the admin layout's org query). The landing is a static Server Component using `next/image` for locally-hosted Unsplash photos and a CSS Module for marketing-only styling (gradients, hero overlay, floating-icon keyframes). Fonts Sora (display) + Inter (body) load via `next/font/google` as CSS variables.

**Tech Stack:** Next.js 14 App Router · TypeScript · Tailwind · CSS Modules · next/font · next/image · Vitest (existing suite must stay green).

**Note on testing:** This is a UI/branding deliverable with no unit-testable business logic (per the spec). The verification gates are therefore `npm run build` (type + font + image correctness), `npm run test:run` (existing suite stays green), and **grep cleanliness** (no leftover "Hudson"/"BT App"/"Beach Tennis" in `app/`, `components/`, `public/`). Each task ends with a build/grep check and a commit instead of a TDD red-green loop.

**Visual source of truth:** `.superpowers/brainstorm/1241-1781726644/content/landing-hifi.html` (approved hi-fi mockup). The landing task below already transcribes it into JSX + CSS Module — you do not need to open the mockup, but it is the reference if anything is ambiguous.

**Design tokens (from CLAUDE.md):** `bg-surface #0c1220`, `bg-surface-card #151e31`, `border-surface-border #26334d`, `text-brand-500 #f97316`, brand gradient `from-brand-600 to-brand-800`.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `app/layout.tsx` | Modify | Platform metadata (title/description/appleWebApp/OpenGraph) + load Sora & Inter as CSS variables |
| `public/manifest.json` | Modify | PWA name/short_name → ArenaHub |
| `components/ui/Logo.tsx` | Rewrite | ArenaHub wordmark (text/SVG, no `<Image>`); fixes the `src="public/icon.svg"` bug |
| `app/(auth)/layout.tsx` | Modify | Replace "Academia Hudson Barros" with platform subtitle |
| `public/landing/hero.jpg` | Create | Downloaded Unsplash hero photo (commercial-licensed, self-hosted) |
| `public/landing/aluno.jpg` | Create | Downloaded Unsplash student-section photo |
| `app/landing.module.css` | Create | Marketing-only CSS (hero overlay, feature grid, pricing, floating-icon keyframes) |
| `app/page.tsx` | Rewrite | The ArenaHub landing (Server Component, static) |
| `app/(admin)/layout.tsx` | Modify | Show academy name in the sidebar header (from `organizations.name`) |
| `app/(dashboard)/layout.tsx` | Modify | Show academy name in the student top bar |
| `app/(admin)/admin/equipe/page.tsx` | Modify | Drop the hardcoded vercel-app invite-URL fallback in favor of env-only |

---

### Task 1: Rebrand metadata + load Sora/Inter fonts

**Files:**
- Modify: `app/layout.tsx`

- [ ] **Step 1: Rewrite `app/layout.tsx`**

Replace the entire file with:

```tsx
// app/layout.tsx
import type { Metadata, Viewport } from 'next'
import { Inter, Sora } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })
const sora = Sora({ subsets: ['latin'], weight: ['400', '600', '700', '800'], variable: '--font-sora' })

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://arenahub.pro'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: 'ArenaHub — Gestão para arenas e academias de esporte',
  description:
    'Aulas, turmas, créditos, check-in e pagamentos para arenas de beach tennis, padel, futevôlei e mais. 1º mês grátis.',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'ArenaHub',
  },
  openGraph: {
    title: 'ArenaHub — Gestão para arenas e academias de esporte',
    description:
      'Aulas, turmas, créditos, check-in e pagamentos para arenas de beach tennis, padel, futevôlei e mais. 1º mês grátis.',
    url: SITE_URL,
    siteName: 'ArenaHub',
    images: ['/og.png'],
    locale: 'pt_BR',
    type: 'website',
  },
}

export const viewport: Viewport = {
  themeColor: '#ea580c',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className={`${inter.className} ${inter.variable} ${sora.variable}`}>{children}</body>
    </html>
  )
}
```

Notes: `inter.className` keeps Inter as the global base font (unchanged app-wide); `inter.variable` and `sora.variable` expose `--font-inter` / `--font-sora` so the landing CSS Module can switch headings to Sora. `metadataBase` silences the Next warning about resolving the OG image URL. The OG image `/og.png` is optional (see spec pré-requisitos) — Next tolerates a missing OG image at build time.

- [ ] **Step 2: Verify the build compiles**

Run: `npm run build`
Expected: build succeeds; no errors about `next/font` or metadata. (A console note that `/og.png` is missing is acceptable — it is an optional asset.)

- [ ] **Step 3: Commit**

```bash
git add app/layout.tsx
git commit -m "feat(brand): ArenaHub metadata + Sora/Inter fonts in root layout"
```

---

### Task 2: Rebrand the PWA manifest

**Files:**
- Modify: `public/manifest.json`

- [ ] **Step 1: Read the current manifest**

Run: `Read public/manifest.json` to see all existing keys (icons, theme_color, etc.) so you only change the two name fields.

- [ ] **Step 2: Edit name + short_name**

Change `"name": "Beach Tennis App"` → `"name": "ArenaHub"` and `"short_name": "BT App"` → `"short_name": "ArenaHub"`. Leave every other key (icons, start_url, display, background_color, theme_color) untouched.

- [ ] **Step 3: Verify the JSON is valid**

Run: `node -e "JSON.parse(require('fs').readFileSync('public/manifest.json','utf8')); console.log('manifest ok')"`
Expected: prints `manifest ok` (no JSON parse error).

- [ ] **Step 4: Commit**

```bash
git add public/manifest.json
git commit -m "feat(brand): rename PWA manifest to ArenaHub"
```

---

### Task 3: Turn `Logo` into the ArenaHub wordmark

**Files:**
- Rewrite: `components/ui/Logo.tsx`

This removes the broken `<Image src="public/icon.svg">` (invalid path — `public/` is not a URL prefix in Next) and replaces both variants with a text/emoji wordmark. The wordmark scales with the existing `size` prop and keeps the same `Props` shape so every current caller (`app/(auth)/layout.tsx`, `app/(admin)/layout.tsx`) keeps working.

- [ ] **Step 1: Rewrite `components/ui/Logo.tsx`**

Replace the entire file with:

```tsx
interface Props {
  size?: 'sm' | 'md' | 'lg'
  variant?: 'full' | 'icon'
}

const textSizes = {
  sm: 'text-base',
  md: 'text-xl',
  lg: 'text-2xl',
}

const iconSizes = {
  sm: 'text-xl',
  md: 'text-2xl',
  lg: 'text-3xl',
}

export function Logo({ size = 'md', variant = 'full' }: Props) {
  if (variant === 'icon') {
    return (
      <span className={iconSizes[size]} role="img" aria-label="ArenaHub">
        🏟️
      </span>
    )
  }

  return (
    <span className={`font-extrabold tracking-tight ${textSizes[size]}`} aria-label="ArenaHub">
      <span aria-hidden="true">🏟️ </span>
      <span className="text-white">Arena</span>
      <span className="text-brand-500">Hub</span>
    </span>
  )
}
```

Notes: no `next/font` family is forced here — it inherits whatever surrounds it (Inter app-wide; Sora on the landing where the nav `.logo` class sets Sora). The wordmark is intentionally swappable for a designed SVG later without touching callers.

- [ ] **Step 2: Verify build + no remaining `next/image` import in this file**

Run: `npm run build`
Expected: succeeds. The previous unused `Image` import is gone, so no lint/type complaint.

- [ ] **Step 3: Commit**

```bash
git add components/ui/Logo.tsx
git commit -m "feat(brand): ArenaHub wordmark Logo, remove broken icon.svg path"
```

---

### Task 4: De-Hudson the auth layout

**Files:**
- Modify: `app/(auth)/layout.tsx`

- [ ] **Step 1: Replace the hardcoded academy name with a platform subtitle**

In `app/(auth)/layout.tsx`, change this line:

```tsx
          <p className="text-slate-400 text-sm">Academia Hudson Barros</p>
```

to:

```tsx
          <p className="text-slate-400 text-sm">Gestão para arenas e academias</p>
```

Leave the `<Logo variant="full" size="md" />` above it as-is (platform brand pre-login is correct).

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add "app/(auth)/layout.tsx"
git commit -m "feat(brand): platform subtitle on auth pages (no academy name pre-login)"
```

---

### Task 5: Download the landing images locally

**Files:**
- Create: `public/landing/hero.jpg`
- Create: `public/landing/aluno.jpg`

The Unsplash license permits commercial use; we self-host (no hotlink in production). These exact photo IDs were validated (HTTP 200) during brainstorming.

- [ ] **Step 1: Create the directory**

Run: `mkdir public\landing` (PowerShell: `New-Item -ItemType Directory -Force public/landing`)
Expected: directory exists. (If it already exists, that's fine.)

- [ ] **Step 2: Download the hero and student photos as JPG**

Run (cmd/bash `curl`, available on Windows 10+):

```bash
curl -L "https://images.unsplash.com/photo-1638873194946-ae8c1aced4c4?w=1600&q=75&fm=jpg" -o public/landing/hero.jpg
curl -L "https://images.unsplash.com/photo-1519046947096-f43d6481532b?w=900&q=72&fm=jpg" -o public/landing/aluno.jpg
```

- [ ] **Step 3: Verify both files downloaded as real images (not an error page)**

Run: `node -e "const fs=require('fs');for(const f of ['public/landing/hero.jpg','public/landing/aluno.jpg']){const b=fs.readFileSync(f);if(b.length<10000)throw new Error(f+' too small: '+b.length);if(!(b[0]===0xFF&&b[1]===0xD8))throw new Error(f+' not a JPEG');console.log(f,b.length,'bytes OK')}"`
Expected: prints both files with byte counts (each well over 10 KB) and `OK`. The check asserts the JPEG magic bytes `FF D8`, so an HTML error page would fail here.

- [ ] **Step 4: Commit**

```bash
git add public/landing/hero.jpg public/landing/aluno.jpg
git commit -m "feat(landing): self-host hero and student Unsplash photos"
```

---

### Task 6: Landing CSS Module

**Files:**
- Create: `app/landing.module.css`

This is the marketing-only styling transcribed from the approved mockup, adapted to a CSS Module (class names are locally scoped; the `bob` keyframes are scoped with them). Headings use `var(--font-sora)` (set up in Task 1).

- [ ] **Step 1: Create `app/landing.module.css`**

```css
.page {
  --bg: #0a0f1c;
  --card: #151e31;
  --border: #26334d;
  --brand: #f97316;
  --brand2: #fb923c;
  --ink: #e8eef9;
  --mut: #8aa0c2;
  background: var(--bg);
  color: var(--ink);
  font-family: var(--font-inter), system-ui, sans-serif;
  line-height: 1.5;
  overflow-x: hidden;
  scroll-behavior: smooth;
}
.page h1,
.page h2,
.page h3,
.logo {
  font-family: var(--font-sora), sans-serif;
}
.wrap {
  max-width: 1080px;
  margin: 0 auto;
  padding: 0 22px;
}

/* NAV */
.nav {
  position: sticky;
  top: 0;
  z-index: 30;
  backdrop-filter: blur(10px);
  background: rgba(10, 15, 28, 0.72);
  border-bottom: 1px solid rgba(38, 51, 77, 0.6);
}
.navInner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 62px;
}
.logo {
  font-weight: 800;
  font-size: 20px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.dot {
  color: var(--brand);
}
.navlinks {
  display: flex;
  gap: 26px;
  font-size: 14px;
  color: var(--mut);
}
.navlinks a:hover {
  color: var(--ink);
}
.navcta {
  display: flex;
  gap: 12px;
  align-items: center;
}
.btn {
  border-radius: 10px;
  font-weight: 600;
  font-size: 14px;
  padding: 10px 18px;
  cursor: pointer;
  border: 0;
  transition: 0.18s;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.btnPrimary {
  background: linear-gradient(135deg, var(--brand), #ea580c);
  color: #0a0f1c;
}
.btnPrimary:hover {
  transform: translateY(-2px);
  box-shadow: 0 10px 28px rgba(249, 115, 22, 0.4);
}
.btnGhost {
  background: transparent;
  color: var(--ink);
  border: 1px solid var(--border);
}
.btnGhost:hover {
  border-color: var(--brand);
  color: var(--brand2);
}
.btnLg {
  padding: 15px 26px;
  font-size: 16px;
  border-radius: 12px;
}
@media (max-width: 720px) {
  .navlinks {
    display: none;
  }
}

/* HERO */
.hero {
  position: relative;
  min-height: 88vh;
  display: flex;
  align-items: center;
  overflow: hidden;
}
.heroImg {
  object-fit: cover;
  filter: saturate(1.05);
  z-index: 0;
}
.heroOverlay {
  position: absolute;
  inset: 0;
  z-index: 1;
  background: linear-gradient(
    105deg,
    rgba(10, 15, 28, 0.96) 0%,
    rgba(10, 15, 28, 0.82) 42%,
    rgba(10, 15, 28, 0.45) 100%
  );
}
.heroInner {
  position: relative;
  z-index: 3;
  padding: 60px 22px;
}
.eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--brand2);
  font-weight: 600;
  background: rgba(249, 115, 22, 0.1);
  border: 1px solid rgba(249, 115, 22, 0.3);
  padding: 6px 14px;
  border-radius: 999px;
}
.heroTitle {
  font-size: 54px;
  font-weight: 800;
  line-height: 1.04;
  margin: 22px 0 16px;
  letter-spacing: -0.02em;
  max-width: 14ch;
}
.hl {
  background: linear-gradient(120deg, var(--brand), var(--brand2));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.heroSub {
  font-size: 18px;
  color: var(--mut);
  max-width: 48ch;
  margin-bottom: 30px;
}
.cluster {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  align-items: center;
}
.freebie {
  font-size: 13px;
  color: var(--mut);
  margin-top: 18px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.freebie b {
  color: var(--ink);
}
@media (max-width: 720px) {
  .heroTitle {
    font-size: 38px;
  }
  .heroSub {
    font-size: 16px;
  }
}

/* floating sport icons */
.floaters {
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
}
.floaters span {
  position: absolute;
  font-size: 40px;
  opacity: 0.16;
  filter: grayscale(0.2);
}
.f1 {
  top: 18%;
  right: 8%;
  animation: bob 3.4s ease-in-out infinite;
}
.f2 {
  top: 54%;
  right: 20%;
  font-size: 30px;
  animation: bob 2.6s ease-in-out infinite 0.4s;
}
.f3 {
  top: 32%;
  right: 34%;
  font-size: 26px;
  animation: bob 3s ease-in-out infinite 0.9s;
}
.f4 {
  bottom: 14%;
  right: 12%;
  font-size: 34px;
  animation: bob 3.8s ease-in-out infinite 0.2s;
}
@keyframes bob {
  0%,
  100% {
    transform: translateY(0) rotate(-6deg);
  }
  50% {
    transform: translateY(-22px) rotate(6deg);
  }
}

/* sports chips */
.sports {
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  background: #0c1322;
}
.sportsInner {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: center;
  padding: 18px 22px;
}
.chip {
  font-size: 13.5px;
  color: var(--mut);
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 8px 16px;
  display: flex;
  gap: 7px;
  align-items: center;
}

/* sections */
.blk {
  padding: 86px 0;
}
.altBg {
  background: #0c1322;
}
.khead {
  text-align: center;
  max-width: 42ch;
  margin: 0 auto 50px;
}
.label {
  color: var(--brand2);
  font-weight: 600;
  font-size: 13px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.khead h2 {
  font-size: 38px;
  font-weight: 800;
  letter-spacing: -0.02em;
  margin: 12px 0;
}
.khead p {
  color: var(--mut);
  font-size: 17px;
}

.grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 18px;
}
@media (max-width: 860px) {
  .grid {
    grid-template-columns: 1fr 1fr;
  }
}
@media (max-width: 560px) {
  .grid {
    grid-template-columns: 1fr;
  }
}
.feat {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 26px;
  transition: 0.2s;
}
.feat:hover {
  transform: translateY(-4px);
  border-color: rgba(249, 115, 22, 0.5);
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.35);
}
.featIc {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  background: linear-gradient(135deg, rgba(249, 115, 22, 0.22), rgba(249, 115, 22, 0.06));
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  margin-bottom: 16px;
}
.feat h3 {
  font-size: 18px;
  margin-bottom: 7px;
}
.feat p {
  color: var(--mut);
  font-size: 14.5px;
}

/* student split */
.split {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 46px;
  align-items: center;
}
@media (max-width: 820px) {
  .split {
    grid-template-columns: 1fr;
  }
}
.shot {
  border-radius: 20px;
  overflow: hidden;
  border: 1px solid var(--border);
  position: relative;
  min-height: 330px;
}
.shotImg {
  object-fit: cover;
}
.shotOverlay {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, transparent, rgba(10, 15, 28, 0.4));
}
.split h2 {
  font-size: 34px;
  font-weight: 800;
  letter-spacing: -0.02em;
  margin-bottom: 14px;
}
.split p {
  color: var(--mut);
  font-size: 16px;
  margin-bottom: 14px;
}
.pin {
  display: flex;
  gap: 10px;
  align-items: center;
  color: var(--ink);
  font-size: 15px;
  margin: 10px 0;
}
.pinB {
  color: var(--brand);
}

/* pricing teaser */
.price {
  background: linear-gradient(135deg, #15233f, #0c1322);
  border: 1px solid var(--border);
  border-radius: 24px;
  padding: 54px;
  text-align: center;
  position: relative;
  overflow: hidden;
}
.price h2 {
  font-size: 34px;
  font-weight: 800;
  margin-bottom: 10px;
}
.priceBig {
  font-size: 52px;
  font-weight: 800;
  color: var(--brand2);
  margin: 8px 0;
}
.priceBig small {
  font-size: 18px;
  color: var(--mut);
  font-weight: 500;
}
.price p {
  color: var(--mut);
  margin-bottom: 24px;
}

.footer {
  border-top: 1px solid var(--border);
  padding: 34px 0;
  color: var(--mut);
  font-size: 13.5px;
}
.footerInner {
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
}
```

- [ ] **Step 2: Commit (the module is consumed by Task 7; commit it on its own so the diff is reviewable)**

```bash
git add app/landing.module.css
git commit -m "feat(landing): marketing CSS module (hero, grid, pricing, floating icons)"
```

---

### Task 7: Rewrite the landing page

**Files:**
- Rewrite: `app/page.tsx`

Static Server Component (no `'use client'`, no data fetching). Uses `next/link` for the real CTAs, `next/image` for the two self-hosted photos, and the CSS Module from Task 6. Smooth-scroll anchors (`#rec`, `#alunos`, `#preco`) are handled by `scroll-behavior` in the module.

- [ ] **Step 1: Replace the entire `app/page.tsx`**

```tsx
// app/page.tsx
import Link from 'next/link'
import Image from 'next/image'
import s from './landing.module.css'

export default function LandingPage() {
  return (
    <div className={s.page}>
      {/* NAV */}
      <nav className={s.nav}>
        <div className={`${s.wrap} ${s.navInner}`}>
          <div className={s.logo}>
            🏟️ Arena<span className={s.dot}>Hub</span>
          </div>
          <div className={s.navlinks}>
            <a href="#rec">Recursos</a>
            <a href="#alunos">Para alunos</a>
            <a href="#preco">Preço</a>
          </div>
          <div className={s.navcta}>
            <Link className={`${s.btn} ${s.btnGhost}`} href="/login">
              Entrar
            </Link>
            <Link className={`${s.btn} ${s.btnPrimary}`} href="/criar-academia">
              Criar conta grátis
            </Link>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <header className={s.hero}>
        <Image
          className={s.heroImg}
          src="/landing/hero.jpg"
          alt="Quadra de beach tennis ao entardecer"
          fill
          priority
          sizes="100vw"
        />
        <div className={s.heroOverlay} />
        <div className={s.floaters}>
          <span className={s.f1}>🎾</span>
          <span className={s.f2}>🏐</span>
          <span className={s.f3}>🏆</span>
          <span className={s.f4}>🥎</span>
        </div>
        <div className={`${s.wrap} ${s.heroInner}`}>
          <span className={s.eyebrow}>⚡ Plataforma para arenas e academias</span>
          <h1 className={s.heroTitle}>
            Sua arena <span className={s.hl}>cheia</span>. Sua gestão no{' '}
            <span className={s.hl}>automático</span>.
          </h1>
          <p className={s.heroSub}>
            Aulas, turmas por nível, créditos, check-in e pagamentos — tudo num app só. Feito
            para beach tennis, padel, futevôlei e vôlei de praia.
          </p>
          <div className={s.cluster}>
            <Link className={`${s.btn} ${s.btnPrimary} ${s.btnLg}`} href="/criar-academia">
              Criar conta grátis →
            </Link>
            <a className={`${s.btn} ${s.btnGhost} ${s.btnLg}`} href="#rec">
              ▶ Ver como funciona
            </a>
          </div>
          <div className={s.freebie}>
            ✅ <b>1º mês grátis</b> · sem cartão · configura em minutos
          </div>
        </div>
      </header>

      {/* SPORTS CHIPS */}
      <div className={s.sports}>
        <div className={`${s.wrap} ${s.sportsInner}`}>
          <span className={s.chip}>🎾 Beach Tennis</span>
          <span className={s.chip}>🟢 Padel</span>
          <span className={s.chip}>⚽ Futevôlei</span>
          <span className={s.chip}>🏐 Vôlei de Praia</span>
          <span className={s.chip}>🎾 Tênis</span>
          <span className={s.chip}>➕ e mais</span>
        </div>
      </div>

      {/* FEATURES */}
      <section className={s.blk} id="rec">
        <div className={s.wrap}>
          <div className={s.khead}>
            <div className={s.label}>Tudo num lugar só</div>
            <h2>O que o ArenaHub faz pela sua arena</h2>
            <p>Para de gerenciar aula no caderno e no grupo do WhatsApp.</p>
          </div>
          <div className={s.grid}>
            <div className={s.feat}>
              <div className={s.featIc}>📅</div>
              <h3>Grade &amp; agendamento</h3>
              <p>
                Turmas recorrentes por nível e horário. Aluno agenda, repõe e entra na fila de
                espera sozinho.
              </p>
            </div>
            <div className={s.feat}>
              <div className={s.featIc}>💳</div>
              <h3>Créditos &amp; reposição</h3>
              <p>Cancelou com 5h de antecedência? Crédito automático. Sem dor de cabeça com remarcação.</p>
            </div>
            <div className={s.feat}>
              <div className={s.featIc}>✅</div>
              <h3>Check-in integrado</h3>
              <p>Wellhub e TotalPass entram direto. Presença registrada sem fila na recepção.</p>
            </div>
            <div className={s.feat}>
              <div className={s.featIc}>📊</div>
              <h3>Financeiro</h3>
              <p>Mensalidades, pagamentos avulsos e inadimplência num painel claro. Você sabe quanto entra.</p>
            </div>
            <div className={s.feat}>
              <div className={s.featIc}>🏆</div>
              <h3>Torneios</h3>
              <p>Monte chaves, divulgue e inscreva alunos. Engaja a comunidade e movimenta a quadra.</p>
            </div>
            <div className={s.feat}>
              <div className={s.featIc}>💬</div>
              <h3>Comunidade</h3>
              <p>Feed da arena: avisos, fotos e ranking. Seus alunos viram torcida.</p>
            </div>
          </div>
        </div>
      </section>

      {/* STUDENT SPLIT */}
      <section className={`${s.blk} ${s.altBg}`} id="alunos">
        <div className={s.wrap}>
          <div className={s.split}>
            <div className={s.shot}>
              <Image
                className={s.shotImg}
                src="/landing/aluno.jpg"
                alt="Jogadora em quadra de areia"
                fill
                sizes="(max-width: 820px) 100vw, 50vw"
              />
              <div className={s.shotOverlay} />
            </div>
            <div>
              <div className={s.label}>Para quem joga</div>
              <h2>Achou um tempo pra jogar? Ache a arena.</h2>
              <p>
                Descubra arenas e academias perto de você, veja horários e{' '}
                <b>agende uma aula experimental gratuita</b> em segundos.
              </p>
              <div className={s.pin}>
                <span className={s.pinB}>📍</span> Busca por região e tipo de esporte
              </div>
              <div className={s.pin}>
                <span className={s.pinB}>🎾</span> Aula experimental sem compromisso
              </div>
              <div className={s.pin}>
                <span className={s.pinB}>⭐</span> Vê níveis, horários e a vibe da arena
              </div>
              <Link
                className={`${s.btn} ${s.btnPrimary} ${s.btnLg}`}
                href="/experimental"
                style={{ marginTop: 18 }}
              >
                Encontrar uma arena
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section className={s.blk} id="preco">
        <div className={s.wrap}>
          <div className={s.price}>
            <h2>Comece de graça</h2>
            <div className={s.priceBig}>
              R$ 49,90<small> /mês</small>
            </div>
            <p>1º mês por nossa conta. Depois, preço único — sem taxa por aluno, sem surpresa.</p>
            <Link className={`${s.btn} ${s.btnPrimary} ${s.btnLg}`} href="/criar-academia">
              Criar conta grátis →
            </Link>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className={s.footer}>
        <div className={`${s.wrap} ${s.footerInner}`}>
          <div className={s.logo} style={{ fontSize: 16 }}>
            🏟️ Arena<span className={s.dot}>Hub</span>
          </div>
          <div>© 2026 ArenaHub · arenahub.pro</div>
        </div>
      </footer>
    </div>
  )
}
```

- [ ] **Step 2: Verify the build compiles and the page is static**

Run: `npm run build`
Expected: succeeds; in the route summary `/` is marked static (`○`) or prerendered. No errors about `next/image` (local `/landing/*.jpg` need no `remotePatterns` config).

- [ ] **Step 3: Manual visual smoke (dev server)**

Run: `npm run dev`, open `http://localhost:3000`. Confirm: hero photo with dark overlay + animated floating icons; sports chips; 6 feature cards with hover lift; student split with the second photo; pricing R$ 39,90; footer. Click each CTA — "Criar conta grátis" → `/criar-academia`, "Entrar" → `/login`, "Encontrar uma arena" → `/experimental`, and nav anchors scroll smoothly. Resize to mobile width: nav links hide, hero text shrinks, grid collapses to one column. (Preço atual: R$ 49,90/mês.)

- [ ] **Step 4: Commit**

```bash
git add app/page.tsx
git commit -m "feat(landing): ArenaHub marketing landing page"
```

---

### Task 8: Show the academy name in the admin sidebar

**Files:**
- Modify: `app/(admin)/layout.tsx`

The layout already fetches the org for the owner check. Extend that select to include `name` and render it as the sidebar heading (replacing the static "Painel Admin" line with the academy's own name + "Painel Admin" as the subtitle). The platform `Logo` stays as a small mark above it.

- [ ] **Step 1: Add `name` to the org select**

In `app/(admin)/layout.tsx`, change:

```tsx
  const { data: org } = profileOrg?.organization_id
    ? await adminClient
        .from('organizations')
        .select('owner_id')
        .eq('id', profileOrg.organization_id)
        .single()
    : { data: null }
```

to:

```tsx
  const { data: org } = profileOrg?.organization_id
    ? await adminClient
        .from('organizations')
        .select('owner_id, name')
        .eq('id', profileOrg.organization_id)
        .single()
    : { data: null }
```

- [ ] **Step 2: Render the academy name in the sidebar header**

Change the sidebar brand block:

```tsx
        <div className="bg-gradient-to-br from-brand-600 to-brand-800 px-4 py-5 mb-2">
          <Logo variant="full" size="sm" />
          <span className="text-xs text-white/70 mt-1 block">Painel Admin</span>
        </div>
```

to:

```tsx
        <div className="bg-gradient-to-br from-brand-600 to-brand-800 px-4 py-5 mb-2">
          <Logo variant="icon" size="sm" />
          <span className="text-sm font-bold text-white mt-1 block truncate">
            {org?.name ?? 'Painel Admin'}
          </span>
          <span className="text-xs text-white/70 block">Painel Admin</span>
        </div>
```

Note: `org` is typed from the Supabase response; `org?.name` is `string | undefined`, so the `?? 'Painel Admin'` fallback covers the (unlikely) missing-org case. If TypeScript complains the `org` shape doesn't include `name` because the false-branch literal `{ data: null }` narrows the type, add `as { owner_id: string; name: string } | null` to the `org` destructure or annotate the false branch as `{ data: null as { owner_id: string; name: string } | null }`. Verify in Step 3.

- [ ] **Step 3: Verify build + role-gate untouched**

Run: `npm run build`
Expected: succeeds with no type error on `org.name`. The `isOwner` logic (`org?.owner_id === user.id`) still works since `owner_id` is still selected.

- [ ] **Step 4: Commit**

```bash
git add "app/(admin)/layout.tsx"
git commit -m "feat(brand): show academy name in admin sidebar header"
```

---

### Task 9: Show the academy name in the student top bar

**Files:**
- Modify: `app/(dashboard)/layout.tsx`

The student top bar currently holds only the notification bell. Add the logged-in academy's name on the left, fetched via the existing `getCurrentOrg()` helper.

- [ ] **Step 1: Import the helper and fetch the org**

In `app/(dashboard)/layout.tsx`, change the import line:

```tsx
import { createClient } from '@/lib/supabase/server'
```

to:

```tsx
import { createClient, getCurrentOrg } from '@/lib/supabase/server'
```

Then, after the `if (!user) redirect('/login')` line, add:

```tsx
  const org = await getCurrentOrg()
```

- [ ] **Step 2: Render the name in the header bar**

Change the header:

```tsx
      <header className="fixed top-0 left-0 right-0 z-40 h-11 flex items-center justify-end px-3 bg-surface border-b border-surface-border/40">
        <NotificationBell initialNotifications={notifications} />
        {unreadCount > 0 && <span className="sr-only">{unreadCount} notificações não lidas</span>}
      </header>
```

to:

```tsx
      <header className="fixed top-0 left-0 right-0 z-40 h-11 flex items-center justify-between px-3 bg-surface border-b border-surface-border/40">
        <span className="text-sm font-semibold text-white truncate max-w-[60%]">
          {org?.name ?? ''}
        </span>
        <NotificationBell initialNotifications={notifications} />
        {unreadCount > 0 && <span className="sr-only">{unreadCount} notificações não lidas</span>}
      </header>
```

(`justify-end` → `justify-between` so the name sits left and the bell stays right.)

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: succeeds. `getCurrentOrg()` returns `Organization | null`, so `org?.name` is safe.

- [ ] **Step 4: Commit**

```bash
git add "app/(dashboard)/layout.tsx"
git commit -m "feat(brand): show academy name in student top bar"
```

---

### Task 10: Env-only invite URL (domain hygiene)

**Files:**
- Modify: `app/(admin)/admin/equipe/page.tsx`

The invite-link base currently falls back to the old hardcoded vercel URL. Per the spec, the production URL must come from `NEXT_PUBLIC_SITE_URL`. We keep a fallback (the env var is set in Vercel as a user action, separate from this code change) but point it at the new domain so no leftover `beach-tennis-app-pi.vercel.app` string remains in the app code.

- [ ] **Step 1: Replace the fallback URL**

In `app/(admin)/admin/equipe/page.tsx`, change:

```tsx
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://beach-tennis-app-pi.vercel.app'
```

to:

```tsx
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://arenahub.pro'
```

- [ ] **Step 2: Confirm no app code still references the old vercel URL**

Run: `Grep` for `beach-tennis-app-pi` in `app/`, `components/`, `lib/`, `features/`.
Expected: zero matches in code (the only remaining hits are in `docs/` HTML guides and old plan/spec markdown — those are documentation, out of scope here).

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add "app/(admin)/admin/equipe/page.tsx"
git commit -m "chore(domain): invite URL fallback uses arenahub.pro, not old vercel host"
```

---

### Task 11: Final verification — build, tests, and brand-leak grep

**Files:** none (verification only)

- [ ] **Step 1: Full production build**

Run: `npm run build`
Expected: succeeds with no errors. `/` is static.

- [ ] **Step 2: Existing test suite stays green**

Run: `npm run test:run`
Expected: all existing tests pass (this deliverable added no unit logic; nothing should regress).

- [ ] **Step 3: Brand-leak grep across user-facing code**

Run `Grep` (case-insensitive) for `Hudson`, `BT App`, and `Beach Tennis` restricted to `app/`, `components/`, and `public/`.
Expected: **zero** matches. If any appear, fix that file and re-run. (Hits under `docs/`, `supabase/`, `lib/`, `features/`, or the parked Plano 3 spec are out of scope for this task — the spec scopes the leak check to `app/`, `components/`, `public/`.)

- [ ] **Step 4: Manual responsive pass**

Run `npm run dev` and view the landing on desktop and a mobile viewport. Confirm hero/animations/grid/student-split/pricing render and all CTAs route correctly (`/criar-academia`, `/login`, `/experimental`). Confirm a logged-in admin sees their academy name in the sidebar and a logged-in student sees it in the top bar.

- [ ] **Step 5: No commit needed** (verification only). If Step 3 or 4 required a fix, commit that fix with a descriptive message.

---

## Out of scope (other plans — do NOT implement here)

- **Aula experimental por região** (the actual region search behind "Encontrar uma arena") — its own subsystem; the CTA points to the existing `/experimental` for now.
- **Per-academy logo/colors** and super-admin panel → Plano 4.
- **Cobrança SaaS** (`platform_subscriptions`, MercadoPago Preapproval) → Plano 3 (parked spec).
- Professionally designed logo — the wordmark v1 covers launch.

## User actions / external dependencies (not code)

- Buy `arenahub.pro`, add it to the Vercel project, configure DNS.
- Set `NEXT_PUBLIC_SITE_URL=https://arenahub.pro` in Vercel and `.env.local`.
- (Optional) add `public/og.png` for richer link sharing.
