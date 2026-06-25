# Personalização visual por academia (white-label co-branded) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cada academia aplica logo e cor próprias (accent) nas três superfícies (app do aluno, painel admin, página pública `/arenas/[slug]`), mantendo um selo discreto "Powered by ArenaHub".

**Architecture:** A cor da academia substitui o laranja apenas como *accent* — os tokens `brand-*` do Tailwind passam de hex estáticos para **variáveis CSS com triplas RGB** (preservando os modificadores de opacidade). Cada layout injeta `style={accentVars(org.brand_color)}` num wrapper. Cor vem de uma **allowlist curada de 8 cores** (validada no servidor); logo é **upload para o Supabase Storage** (bucket `org-logos`, escrita restrita ao dono). Telas sem academia ativa continuam laranja + logo ArenaHub via defaults no `:root`.

**Tech Stack:** Next.js 14 App Router · TypeScript · Tailwind CSS (CSS vars) · Supabase Storage · Vitest · Server Actions.

**Branch:** `develop` (padrão do projeto: editar no develop → `npm run build` → commit de arquivos específicos → push develop).

---

## File Structure

| Unidade | Responsabilidade | Depende de |
|---|---|---|
| `lib/branding/palette.ts` | Allowlist de 8 cores + `isAllowedBrandColor()` + `DEFAULT_BRAND_COLOR` | — (puro) |
| `lib/branding/palette.test.ts` | Testes da allowlist | palette |
| `lib/branding/theme.ts` | `accentVars(hex)` → objeto de CSS vars (mapa cor→escala, triplas RGB) | palette |
| `lib/branding/theme.test.ts` | Testes de `accentVars` | theme |
| `tailwind.config.ts` | escala `brand` via `rgb(var(--brand-N) / <alpha-value>)` | — |
| `app/globals.css` | defaults laranja no `:root` (triplas RGB) | — |
| `components/ui/Logo.tsx` | logo da academia com fallback ArenaHub (novas props `logoUrl`/`orgName`) | — |
| `components/ui/PoweredBy.tsx` | selo co-branding | — |
| `supabase/migrations/20260625000200_org_logos_bucket.sql` | bucket `org-logos` + policies | organizations |
| `features/branding/actions.ts` (`updateBranding`) | configurar logo/cor (owner-only, upload service role) | palette, Storage |
| `app/(admin)/admin/configuracoes/BrandingForm.tsx` | upload + 8 swatches + preview ao vivo | palette, theme, actions |
| layouts (admin/dashboard/arena) | injetar `accentVars` + logo override + selo | theme, Logo, PoweredBy |

---

## Task 1: Allowlist de cores (`lib/branding/palette.ts`)

**Files:**
- Create: `lib/branding/palette.ts`
- Test: `lib/branding/palette.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/branding/palette.test.ts
import { describe, it, expect } from 'vitest'
import { ALLOWED_BRAND_COLORS, DEFAULT_BRAND_COLOR, isAllowedBrandColor } from './palette'

describe('palette', () => {
  it('tem 8 cores e o laranja como default', () => {
    expect(ALLOWED_BRAND_COLORS).toHaveLength(8)
    expect(DEFAULT_BRAND_COLOR).toBe('#f97316')
    expect(ALLOWED_BRAND_COLORS[0]).toBe('#f97316')
  })

  it('aceita cores da allowlist (case-insensitive)', () => {
    expect(isAllowedBrandColor('#7c3aed')).toBe(true)
    expect(isAllowedBrandColor('#7C3AED')).toBe(true)
    expect(isAllowedBrandColor('#f97316')).toBe(true)
  })

  it('rejeita cor arbitrária, vazia ou nula', () => {
    expect(isAllowedBrandColor('#123456')).toBe(false)
    expect(isAllowedBrandColor('')).toBe(false)
    expect(isAllowedBrandColor('red')).toBe(false)
    // @ts-expect-error teste de runtime com tipo errado
    expect(isAllowedBrandColor(null)).toBe(false)
    // @ts-expect-error teste de runtime com tipo errado
    expect(isAllowedBrandColor(undefined)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- lib/branding/palette.test.ts`
Expected: FAIL — `Cannot find module './palette'`

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/branding/palette.ts
// Allowlist curada de cores de marca por academia. Cada hex é o tom "500" (cor
// principal de botões/links). Validada no servidor — nunca um valor arbitrário.
// Todas têm contraste garantido no tema escuro e com texto branco.

export const ALLOWED_BRAND_COLORS = [
  '#f97316', // laranja (default ArenaHub)
  '#7c3aed', // violeta
  '#2563eb', // azul
  '#059669', // esmeralda
  '#dc2626', // vermelho
  '#db2777', // rosa
  '#0891b2', // ciano
  '#ca8a04', // âmbar
] as const

export type BrandColor = (typeof ALLOWED_BRAND_COLORS)[number]

export const DEFAULT_BRAND_COLOR: BrandColor = '#f97316'

const ALLOWED_SET = new Set<string>(ALLOWED_BRAND_COLORS)

export function isAllowedBrandColor(color: unknown): color is BrandColor {
  return typeof color === 'string' && ALLOWED_SET.has(color.toLowerCase())
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- lib/branding/palette.test.ts`
Expected: PASS (3 passing)

- [ ] **Step 5: Commit**

```bash
git add lib/branding/palette.ts lib/branding/palette.test.ts
git commit -m "feat(branding): allowlist curada de cores de marca"
```

---

## Task 2: Gerador de CSS vars (`lib/branding/theme.ts`)

**Files:**
- Create: `lib/branding/theme.ts`
- Test: `lib/branding/theme.test.ts`

A escala de cada cor é **pré-computada** (mapa cor→escala) usando famílias Tailwind, com a cor escolhida ancorada no tom 500. `accentVars(hex)` converte cada tom hex para tripla RGB (`"r g b"`) e devolve `{ '--brand-50': ..., ..., '--brand-900': ... }`. Cor inválida cai no laranja default.

- [ ] **Step 1: Write the failing test**

```ts
// lib/branding/theme.test.ts
import { describe, it, expect } from 'vitest'
import { accentVars } from './theme'

describe('accentVars', () => {
  it('cor conhecida (violeta) → escala esperada com 500 = a cor escolhida', () => {
    const vars = accentVars('#7c3aed')
    expect(vars['--brand-500']).toBe('124 58 237') // #7c3aed
    // 10 tons presentes
    expect(Object.keys(vars)).toHaveLength(10)
    expect(vars['--brand-50']).toBeDefined()
    expect(vars['--brand-900']).toBeDefined()
  })

  it('laranja default → triplas laranja (idêntico ao :root)', () => {
    const vars = accentVars('#f97316')
    expect(vars['--brand-500']).toBe('249 115 22')  // #f97316
    expect(vars['--brand-600']).toBe('234 88 12')   // #ea580c
    expect(vars['--brand-50']).toBe('255 247 237')  // #fff7ed
  })

  it('cor inválida → cai no laranja default', () => {
    expect(accentVars('#000000')['--brand-500']).toBe('249 115 22')
    expect(accentVars('')['--brand-500']).toBe('249 115 22')
    // @ts-expect-error runtime
    expect(accentVars(null)['--brand-500']).toBe('249 115 22')
  })

  it('case-insensitive', () => {
    expect(accentVars('#7C3AED')['--brand-500']).toBe('124 58 237')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- lib/branding/theme.test.ts`
Expected: FAIL — `Cannot find module './theme'`

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/branding/theme.ts
// Converte a cor de marca da academia em CSS custom properties (triplas RGB) que
// alimentam os tokens brand-* do Tailwind (ver tailwind.config.ts + globals.css).
// Escalas pré-computadas (mapa cor→escala) — mais previsível que derivação algorítmica.
// Cada escala usa uma família Tailwind ancorando a cor escolhida no tom 500.
import { DEFAULT_BRAND_COLOR, isAllowedBrandColor } from './palette'

type Scale = readonly [string, string, string, string, string, string, string, string, string, string]
//             50      100     200     300     400     500     600     700     800     900

// chave = hex do tom 500 (a cor da allowlist). Índice 5 sempre === a chave.
const SCALES: Record<string, Scale> = {
  '#f97316': ['#fff7ed', '#ffedd5', '#fed7aa', '#fdba74', '#fb923c', '#f97316', '#ea580c', '#c2410c', '#9a3412', '#7c2d12'],
  '#7c3aed': ['#ede9fe', '#ddd6fe', '#c4b5fd', '#a78bfa', '#8b5cf6', '#7c3aed', '#6d28d9', '#5b21b6', '#4c1d95', '#2e1065'],
  '#2563eb': ['#dbeafe', '#bfdbfe', '#93c5fd', '#60a5fa', '#3b82f6', '#2563eb', '#1d4ed8', '#1e40af', '#1e3a8a', '#172554'],
  '#059669': ['#d1fae5', '#a7f3d0', '#6ee7b7', '#34d399', '#10b981', '#059669', '#047857', '#065f46', '#064e3b', '#022c22'],
  '#dc2626': ['#fee2e2', '#fecaca', '#fca5a5', '#f87171', '#ef4444', '#dc2626', '#b91c1c', '#991b1b', '#7f1d1d', '#450a0a'],
  '#db2777': ['#fce7f3', '#fbcfe8', '#f9a8d4', '#f472b6', '#ec4899', '#db2777', '#be185d', '#9d174d', '#831843', '#500724'],
  '#0891b2': ['#cffafe', '#a5f3fc', '#67e8f9', '#22d3ee', '#06b6d4', '#0891b2', '#0e7490', '#155e75', '#164e63', '#083344'],
  '#ca8a04': ['#fef9c3', '#fef08a', '#fde047', '#facc15', '#eab308', '#ca8a04', '#a16207', '#854d0e', '#713f12', '#422006'],
}

const STOPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900] as const

// "#7c3aed" → "124 58 237"
function hexToTriplet(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `${r} ${g} ${b}`
}

export function accentVars(color: unknown): Record<string, string> {
  const key = isAllowedBrandColor(color) ? (color as string).toLowerCase() : DEFAULT_BRAND_COLOR
  const scale = SCALES[key] ?? SCALES[DEFAULT_BRAND_COLOR]
  const vars: Record<string, string> = {}
  STOPS.forEach((stop, i) => {
    vars[`--brand-${stop}`] = hexToTriplet(scale[i])
  })
  return vars
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- lib/branding/theme.test.ts`
Expected: PASS (4 passing)

- [ ] **Step 5: Commit**

```bash
git add lib/branding/theme.ts lib/branding/theme.test.ts
git commit -m "feat(branding): accentVars gera CSS vars da cor da academia"
```

---

## Task 3: Tokens `brand-*` via CSS vars (Tailwind + globals)

**Files:**
- Modify: `tailwind.config.ts:14-25`
- Modify: `app/globals.css:1-7`

Converte os tokens `brand` para variáveis CSS. Os defaults laranja no `:root` garantem que telas sem academia ativa (auth, landing, fallback) continuem laranja — e que a Hudson fique idêntica a hoje.

- [ ] **Step 1: Editar `tailwind.config.ts` — escala brand via CSS vars**

Substituir o bloco `brand: { ... }` (linhas 14-25) por:

```ts
        brand: {
          50:  'rgb(var(--brand-50) / <alpha-value>)',
          100: 'rgb(var(--brand-100) / <alpha-value>)',
          200: 'rgb(var(--brand-200) / <alpha-value>)',
          300: 'rgb(var(--brand-300) / <alpha-value>)',
          400: 'rgb(var(--brand-400) / <alpha-value>)',
          500: 'rgb(var(--brand-500) / <alpha-value>)',
          600: 'rgb(var(--brand-600) / <alpha-value>)',
          700: 'rgb(var(--brand-700) / <alpha-value>)',
          800: 'rgb(var(--brand-800) / <alpha-value>)',
          900: 'rgb(var(--brand-900) / <alpha-value>)',
        },
```

(O bloco `surface` permanece igual, com hex estáticos.)

- [ ] **Step 2: Editar `app/globals.css` — defaults laranja no `:root`**

Substituir o início do arquivo (linhas 1-7) por:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  /* Defaults da marca ArenaHub (laranja). Academias sobrescrevem via accentVars()
     injetado no wrapper de cada layout. Triplas RGB para casar com
     rgb(var(--brand-N) / <alpha-value>) no tailwind.config.ts. */
  --brand-50: 255 247 237;
  --brand-100: 255 237 213;
  --brand-200: 254 215 170;
  --brand-300: 253 186 116;
  --brand-400: 251 146 60;
  --brand-500: 249 115 22;
  --brand-600: 234 88 12;
  --brand-700: 194 65 12;
  --brand-800: 154 52 18;
  --brand-900: 124 45 18;
}

html {
  background-color: #0c1220;
}
```

(O bloco `* { box-sizing: border-box; }` permanece logo abaixo.)

- [ ] **Step 3: Verificar build**

Run: `npm run build`
Expected: build sem erros. As classes `bg-brand-500`, `bg-brand-500/15`, `text-brand-500`, `from-brand-600 to-brand-800` etc. continuam compilando (agora resolvendo para a CSS var). Visualmente idêntico ao laranja atual (defaults do `:root`).

- [ ] **Step 4: Commit**

```bash
git add tailwind.config.ts app/globals.css
git commit -m "refactor(branding): tokens brand-* via CSS vars com defaults laranja no :root"
```

---

## Task 4: Migration do bucket `org-logos`

**Files:**
- Create: `supabase/migrations/20260625000200_org_logos_bucket.sql`

Bucket público para leitura; escrita (insert/update/delete) restrita ao dono da org, com `organization_id` no primeiro segmento do path do objeto. A action `updateBranding` faz upload via service role (bypassa policy); a policy owner-only é **defesa em profundidade** contra acesso direto do cliente.

> **Nota de aplicação:** migrations são aplicadas **manualmente pelo usuário** (SQL Editor / `supabase db push`). Não aplicar nesta task — apenas criar o arquivo.

- [ ] **Step 1: Criar o arquivo de migration**

```sql
-- Bucket de Storage para logos das academias (white-label co-branded).
-- Leitura pública (logos aparecem no app do aluno, admin e página pública).
-- Escrita restrita ao DONO da academia; organization_id é o 1º segmento do path
-- (ex.: org-logos/{organization_id}/logo.png). Idempotente.

-- Cria o bucket público (id = name = 'org-logos').
insert into storage.buckets (id, name, public)
values ('org-logos', 'org-logos', true)
on conflict (id) do update set public = true;

-- Leitura pública (qualquer um lê os objetos do bucket).
drop policy if exists "org-logos public read" on storage.objects;
create policy "org-logos public read"
  on storage.objects for select
  using (bucket_id = 'org-logos');

-- INSERT restrito ao dono da org cujo id é o 1º segmento do path.
drop policy if exists "org-logos owner insert" on storage.objects;
create policy "org-logos owner insert"
  on storage.objects for insert
  with check (
    bucket_id = 'org-logos'
    and exists (
      select 1 from organizations o
      where o.id::text = (storage.foldername(name))[1]
        and o.owner_id = auth.uid()
    )
  );

-- UPDATE restrito ao dono.
drop policy if exists "org-logos owner update" on storage.objects;
create policy "org-logos owner update"
  on storage.objects for update
  using (
    bucket_id = 'org-logos'
    and exists (
      select 1 from organizations o
      where o.id::text = (storage.foldername(name))[1]
        and o.owner_id = auth.uid()
    )
  );

-- DELETE restrito ao dono.
drop policy if exists "org-logos owner delete" on storage.objects;
create policy "org-logos owner delete"
  on storage.objects for delete
  using (
    bucket_id = 'org-logos'
    and exists (
      select 1 from organizations o
      where o.id::text = (storage.foldername(name))[1]
        and o.owner_id = auth.uid()
    )
  );
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260625000200_org_logos_bucket.sql
git commit -m "feat(branding): migration bucket org-logos (leitura pública, escrita owner-only)"
```

---

## Task 5: Logo com override por academia (`components/ui/Logo.tsx`)

**Files:**
- Modify: `components/ui/Logo.tsx`

Adiciona props opcionais `logoUrl` e `orgName`. Se `logoUrl` existe, renderiza a logo da academia (alt = nome da org); senão, mantém o fallback ArenaHub atual (símbolo + wordmark). A wordmark "ArenaHub" só aparece no fallback.

- [ ] **Step 1: Reescrever `components/ui/Logo.tsx`**

```tsx
import Image from 'next/image'

interface Props {
  size?: 'sm' | 'md' | 'lg'
  variant?: 'full' | 'icon'
  /** Logo da academia (Supabase Storage). Quando presente, sobrescreve o logo ArenaHub. */
  logoUrl?: string | null
  /** Nome da academia — usado como alt da logo. */
  orgName?: string
}

const textSizes = {
  sm: 'text-base',
  md: 'text-xl',
  lg: 'text-2xl',
}

// Tamanho do símbolo (px) por escala — casa com a altura da wordmark.
const symbolPx = {
  sm: 22,
  md: 30,
  lg: 40,
}

const SYMBOL = '/brand/arenahub-symbol-transparent.png'

export function Logo({ size = 'md', variant = 'full', logoUrl, orgName }: Props) {
  const px = symbolPx[size]

  // Override por academia: renderiza a logo enviada, sem a wordmark ArenaHub.
  if (logoUrl) {
    return (
      <Image
        src={logoUrl}
        alt={orgName ?? 'Logo'}
        width={px}
        height={px}
        priority
        unoptimized
        className="object-contain"
      />
    )
  }

  if (variant === 'icon') {
    return (
      <Image src={SYMBOL} alt="ArenaHub" width={px} height={px} priority className="object-contain" />
    )
  }

  return (
    <span className={`inline-flex items-center gap-2 font-extrabold tracking-tight ${textSizes[size]}`}>
      <Image src={SYMBOL} alt="" aria-hidden width={px} height={px} priority className="object-contain" />
      <span aria-label="ArenaHub">
        <span className="text-white">Arena</span>
        <span className="text-brand-500">Hub</span>
      </span>
    </span>
  )
}
```

> `unoptimized` evita configurar `remotePatterns` do `next/image` para o domínio do Supabase Storage (logos são poucas e pequenas).

- [ ] **Step 2: Verificar build**

Run: `npm run build`
Expected: sem erros. Call sites existentes (`<Logo variant="icon" size="sm" />`) seguem funcionando (props novas são opcionais).

- [ ] **Step 3: Commit**

```bash
git add components/ui/Logo.tsx
git commit -m "feat(branding): Logo aceita override logoUrl/orgName com fallback ArenaHub"
```

---

## Task 6: Selo "Powered by ArenaHub" (`components/ui/PoweredBy.tsx`)

**Files:**
- Create: `components/ui/PoweredBy.tsx`

Texto pequeno "Powered by **ArenaHub**" + símbolo, link para `https://arenahub.website`, estilo discreto (cinza). Sempre renderizado, independente do branding da academia (não usa `brand-*`).

- [ ] **Step 1: Criar `components/ui/PoweredBy.tsx`**

```tsx
import Image from 'next/image'

const SYMBOL = '/brand/arenahub-symbol-transparent.png'

/** Selo co-branding. Sempre visível nos rodapés (app aluno, admin, página pública). */
export function PoweredBy({ className = '' }: { className?: string }) {
  return (
    <a
      href="https://arenahub.website"
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-400 transition-colors ${className}`}
    >
      <span>Powered by</span>
      <Image src={SYMBOL} alt="" aria-hidden width={14} height={14} className="object-contain opacity-70" />
      <span className="font-semibold text-slate-400">ArenaHub</span>
    </a>
  )
}
```

- [ ] **Step 2: Verificar build**

Run: `npm run build`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add components/ui/PoweredBy.tsx
git commit -m "feat(branding): componente PoweredBy (selo co-branding)"
```

---

## Task 7: Server action `updateBranding` (`features/branding/actions.ts`)

**Files:**
- Create: `features/branding/actions.ts`

Recebe `FormData` (cor + arquivo opcional). `requireOwner()`; valida cor na allowlist; se veio arquivo, valida tipo/tamanho e faz upload no bucket `org-logos` no path `{organization_id}/logo.<ext>` via `createAdminClient()` (service role); grava `logo_url`/`brand_color` em `organizations`; revalida as rotas afetadas.

- [ ] **Step 1: Criar `features/branding/actions.ts`**

```ts
'use server'
// features/branding/actions.ts
import { createAdminClient, requireOwner } from '@/lib/supabase/server'
import { isAllowedBrandColor } from '@/lib/branding/palette'

const MAX_LOGO_BYTES = 512 * 1024 // 512KB
const ALLOWED_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/svg+xml': 'svg',
}

export async function updateBranding(formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireOwner()
  const orgId = ctx.organizationId

  const brandColor = String(formData.get('brand_color') ?? '')
  if (!isAllowedBrandColor(brandColor)) {
    return { error: 'Cor inválida. Escolha uma das cores disponíveis.' }
  }

  const admin = createAdminClient()
  const update: { brand_color: string; logo_url?: string } = {
    brand_color: brandColor.toLowerCase(),
  }

  const file = formData.get('logo')
  if (file instanceof File && file.size > 0) {
    const ext = ALLOWED_TYPES[file.type]
    if (!ext) return { error: 'Logo deve ser PNG ou SVG.' }
    if (file.size > MAX_LOGO_BYTES) return { error: 'Logo deve ter no máximo 512KB.' }

    const path = `${orgId}/logo.${ext}`
    const { error: uploadErr } = await admin.storage
      .from('org-logos')
      .upload(path, file, { upsert: true, contentType: file.type })
    if (uploadErr) return { error: 'Erro ao enviar a logo. Tente novamente.' }

    const { data: pub } = admin.storage.from('org-logos').getPublicUrl(path)
    // cache-busting para refletir troca de logo (mesmo path, upsert)
    update.logo_url = `${pub.publicUrl}?v=${Date.now()}`
  }

  const { error: updateErr } = await admin
    .from('organizations')
    .update(update)
    .eq('id', orgId)
  if (updateErr) return { error: 'Erro ao salvar a personalização.' }

  const { revalidatePath } = await import('next/cache')
  revalidatePath('/admin/configuracoes')
  revalidatePath('/admin', 'layout')
  revalidatePath('/home')
  return {}
}
```

- [ ] **Step 2: Verificar build**

Run: `npm run build`
Expected: sem erros de tipo.

- [ ] **Step 3: Commit**

```bash
git add features/branding/actions.ts
git commit -m "feat(branding): action updateBranding (valida cor, upload logo, owner-only)"
```

---

## Task 8: Formulário de personalização (`BrandingForm.tsx`) + wire na página de Configurações

**Files:**
- Create: `app/(admin)/admin/configuracoes/BrandingForm.tsx`
- Modify: `app/(admin)/admin/configuracoes/page.tsx`

Formulário client: upload de logo (mostra logo atual), 8 swatches (selecionado destacado), preview ao vivo que aplica `accentVars(corSelecionada)` + logo antes de salvar. Espelha o padrão de `VitrineForm.tsx` (useState/useTransition, Card/Button, mensagens de erro/sucesso).

- [ ] **Step 1: Criar `app/(admin)/admin/configuracoes/BrandingForm.tsx`**

```tsx
'use client'
// app/(admin)/admin/configuracoes/BrandingForm.tsx
import { useState, useTransition } from 'react'
import Image from 'next/image'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { ALLOWED_BRAND_COLORS, DEFAULT_BRAND_COLOR } from '@/lib/branding/palette'
import { accentVars } from '@/lib/branding/theme'
import { updateBranding } from '@/features/branding/actions'

interface BrandingFormProps {
  brandColor: string | null
  logoUrl: string | null
  orgName: string
}

export function BrandingForm({ brandColor, logoUrl, orgName }: BrandingFormProps) {
  const [color, setColor] = useState(brandColor ?? DEFAULT_BRAND_COLOR)
  const [logoPreview, setLogoPreview] = useState<string | null>(logoUrl)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) setLogoPreview(URL.createObjectURL(file))
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    const formData = new FormData(e.currentTarget)
    formData.set('brand_color', color)
    startTransition(async () => {
      const result = await updateBranding(formData)
      if (result.error) setError(result.error)
      else setSuccess('Personalização salva com sucesso.')
    })
  }

  return (
    <Card>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
            {error}
          </p>
        )}
        {success && (
          <p className="text-sm text-green-400 bg-green-500/10 border border-green-500/30 rounded-lg px-3 py-2">
            {success}
          </p>
        )}

        {/* Logo */}
        <div className="space-y-2">
          <label className="text-sm text-slate-300 font-medium">Logo da academia</label>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-lg bg-surface-border flex items-center justify-center overflow-hidden">
              {logoPreview ? (
                <Image src={logoPreview} alt="Prévia da logo" width={40} height={40} unoptimized className="object-contain" />
              ) : (
                <span className="text-xs text-slate-500">—</span>
              )}
            </div>
            <input
              type="file"
              name="logo"
              accept="image/png,image/svg+xml"
              onChange={handleFile}
              className="text-sm text-slate-400 file:mr-3 file:rounded-lg file:border-0 file:bg-surface-border file:px-3 file:py-1.5 file:text-sm file:text-white"
            />
          </div>
          <p className="text-xs text-slate-500">PNG ou SVG, até 512KB.</p>
        </div>

        {/* Seletor de cor */}
        <div className="space-y-2">
          <label className="text-sm text-slate-300 font-medium">Cor da academia</label>
          <div className="flex flex-wrap gap-2">
            {ALLOWED_BRAND_COLORS.map((c) => {
              const active = c.toLowerCase() === color.toLowerCase()
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  aria-label={`Cor ${c}`}
                  aria-pressed={active}
                  className="w-8 h-8 rounded-lg transition-transform"
                  style={{
                    background: c,
                    outline: active ? '2px solid #fff' : 'none',
                    outlineOffset: '2px',
                  }}
                />
              )
            })}
          </div>
        </div>

        {/* Preview ao vivo */}
        <div className="space-y-2">
          <label className="text-sm text-slate-300 font-medium">Prévia</label>
          <div style={accentVars(color)} className="rounded-lg overflow-hidden border border-surface-border">
            <div className="bg-gradient-to-br from-brand-600 to-brand-800 px-4 py-3 flex items-center gap-2">
              <div className="w-6 h-6 rounded bg-white/20 overflow-hidden flex items-center justify-center">
                {logoPreview && (
                  <Image src={logoPreview} alt="" aria-hidden width={20} height={20} unoptimized className="object-contain" />
                )}
              </div>
              <strong className="text-white text-sm truncate">{orgName}</strong>
            </div>
            <div className="bg-surface-card p-3">
              <button type="button" className="w-full bg-brand-500 text-white rounded-lg py-2 text-sm font-bold">
                Agendar aula
              </button>
              <span className="block mt-2 text-xs text-brand-500 font-semibold">● confirmada</span>
            </div>
          </div>
        </div>

        <Button type="submit" variant="primary" loading={pending}>
          Salvar personalização
        </Button>
      </form>
    </Card>
  )
}
```

- [ ] **Step 2: Wire na página `app/(admin)/admin/configuracoes/page.tsx`**

Adicionar o import no topo (após o import de `VitrineForm`):

```tsx
import { BrandingForm } from './BrandingForm'
```

Ampliar o `.select(...)` da org (linha ~28) para incluir os campos de branding + nome:

```tsx
  const { data: orgRow } = await adminClient
    .from('organizations')
    .select('name, brand_color, logo_url, is_listed, cep, state, city, neighborhood, address_line, address_number, no_number, sports, whatsapp')
    .eq('id', orgId)
    .single()
```

Ampliar o tipo `org` (linhas ~33-44) para incluir os 3 campos novos:

```tsx
  const org = (orgRow ?? {}) as {
    name?: string | null
    brand_color?: string | null
    logo_url?: string | null
    is_listed?: boolean
    cep?: string | null
    state?: string | null
    city?: string | null
    neighborhood?: string | null
    address_line?: string | null
    address_number?: string | null
    no_number?: boolean
    sports?: string[] | null
    whatsapp?: string | null
  }
```

No JSX, inserir a seção Personalização **antes** da seção "Vitrine pública" (ou seja, entre `<SystemSettingsForm .../>` na linha ~65 e o `<div>` do título "Vitrine pública"):

```tsx
      <div>
        <h2 className="text-lg font-bold text-white">Personalização</h2>
        <p className="text-slate-400 text-sm mt-1">
          Logo e cor da sua academia nas telas do app, painel e página pública.
        </p>
      </div>
      <BrandingForm
        brandColor={org.brand_color ?? null}
        logoUrl={org.logo_url ?? null}
        orgName={org.name ?? 'Sua Academia'}
      />
```

- [ ] **Step 3: Verificar build**

Run: `npm run build`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add "app/(admin)/admin/configuracoes/BrandingForm.tsx" "app/(admin)/admin/configuracoes/page.tsx"
git commit -m "feat(branding): aba Personalização (BrandingForm com preview ao vivo)"
```

---

## Task 9: Injetar accent + logo + selo nos 3 layouts/superfícies

**Files:**
- Modify: `app/(admin)/layout.tsx`
- Modify: `app/(dashboard)/layout.tsx`
- Modify: `app/arenas/[slug]/page.tsx`

Cada superfície lê `brand_color`/`logo_url` da academia ativa/resolvida, envolve o conteúdo num wrapper com `style={accentVars(brand_color)}`, passa `logoUrl`/`orgName` ao `Logo`, e renderiza o `PoweredBy` no rodapé.

### 9a — Admin (`app/(admin)/layout.tsx`)

- [ ] **Step 1: Imports + ampliar select da org**

Adicionar imports (junto aos demais no topo):

```tsx
import { accentVars } from '@/lib/branding/theme'
import { PoweredBy } from '@/components/ui/PoweredBy'
```

Ampliar o select da org (linha ~34-38) para incluir branding:

```tsx
  const { data: org } = await adminClient
    .from('organizations')
    .select('owner_id, name, onboarding_completed, brand_color, logo_url')
    .eq('id', ctx.organizationId)
    .single()
```

- [ ] **Step 2: Envolver o layout com o wrapper de accent, logo override e selo**

Trocar o elemento raiz `<div className="min-h-screen bg-surface text-white flex flex-col md:flex-row">` para aplicar `style`:

```tsx
    <div
      style={accentVars(org?.brand_color)}
      className="min-h-screen bg-surface text-white flex flex-col md:flex-row"
    >
```

Passar a logo da academia para o `<Logo>` da sidebar (linha ~80):

```tsx
          <Logo variant="icon" size="sm" logoUrl={org?.logo_url ?? null} orgName={org?.name ?? undefined} />
```

Adicionar o selo no rodapé da sidebar, logo após o `<LogoutButton>` (dentro do `div.px-4.pb-4`):

```tsx
          <PoweredBy className="mt-3" />
```

- [ ] **Step 3: Verificar build**

Run: `npm run build`
Expected: sem erros.

### 9b — Dashboard do aluno (`app/(dashboard)/layout.tsx`)

- [ ] **Step 4: Imports**

Adicionar (junto aos demais):

```tsx
import { Logo } from '@/components/ui/Logo'
import { accentVars } from '@/lib/branding/theme'
import { PoweredBy } from '@/components/ui/PoweredBy'
```

(`getCurrentOrg()` já é chamado e retorna o `Organization` completo, incluindo `brand_color` e `logo_url`.)

- [ ] **Step 5: Wrapper de accent + logo na top bar + selo no rodapé**

Trocar o elemento raiz `<div className="min-h-screen bg-surface text-white">` por:

```tsx
    <div style={accentVars(org?.brand_color)} className="min-h-screen bg-surface text-white">
```

Na top bar, quando há só 1 academia (ramo `else`, linha ~51-53), mostrar a logo da academia ao lado do nome:

```tsx
        ) : (
          <span className="inline-flex items-center gap-2 max-w-[60%]">
            <Logo variant="icon" size="sm" logoUrl={org?.logo_url ?? null} orgName={org?.name ?? undefined} />
            <span className="text-sm font-semibold text-white truncate">{org?.name ?? ''}</span>
          </span>
        )}
```

Adicionar o selo dentro do `<main>`, ao final do conteúdo, antes do `<BottomNav />`:

```tsx
      <main className="pt-11 pb-24">
        {children}
        <div className="mt-8 mb-4 flex justify-center">
          <PoweredBy />
        </div>
      </main>
      <BottomNav />
```

- [ ] **Step 6: Verificar build**

Run: `npm run build`
Expected: sem erros.

### 9c — Página pública (`app/arenas/[slug]/page.tsx`)

- [ ] **Step 7: Imports + ampliar ArenaRow + select**

Adicionar imports:

```tsx
import { Logo } from '@/components/ui/Logo'
import { accentVars } from '@/lib/branding/theme'
import { PoweredBy } from '@/components/ui/PoweredBy'
```

Adicionar `brand_color` e `logo_url` à interface `ArenaRow`:

```tsx
  whatsapp: string | null
  brand_color: string | null
  logo_url: string | null
```

Ampliar o `.select(...)` (linha ~37):

```tsx
    .select('id, name, slug, status, is_listed, city, state, neighborhood, address_line, address_number, no_number, sports, whatsapp, brand_color, logo_url')
```

- [ ] **Step 8: Wrapper de accent + logo no cabeçalho + selo no rodapé**

Trocar o elemento raiz `<div className="min-h-screen bg-surface text-white">` por:

```tsx
    <div style={accentVars(org.brand_color)} className="min-h-screen bg-surface text-white">
```

No cabeçalho (`<div className="mb-6">`, linha ~52), mostrar a logo acima do `<h1>` quando houver:

```tsx
        <div className="mb-6">
          {org.logo_url && (
            <div className="mb-3">
              <Logo variant="icon" size="lg" logoUrl={org.logo_url} orgName={org.name} />
            </div>
          )}
          <h1 className="text-2xl font-bold text-white">{org.name}</h1>
```

Adicionar o selo ao final do container interno, depois do `<Card>` de fora (antes de fechar `<div className="max-w-lg mx-auto px-4 py-10">`):

```tsx
        <div className="mt-8 flex justify-center">
          <PoweredBy />
        </div>
```

- [ ] **Step 9: Verificar build**

Run: `npm run build`
Expected: sem erros.

- [ ] **Step 10: Commit**

```bash
git add "app/(admin)/layout.tsx" "app/(dashboard)/layout.tsx" "app/arenas/[slug]/page.tsx"
git commit -m "feat(branding): injeta accent + logo + selo nas 3 superfícies"
```

---

## Task 10: Verificação final (build, testes, smoke)

**Files:** nenhum (verificação)

- [ ] **Step 1: Rodar todos os testes**

Run: `npm run test:run`
Expected: tudo passa, incluindo `lib/branding/palette.test.ts` e `lib/branding/theme.test.ts`.

- [ ] **Step 2: Build de produção**

Run: `npm run build`
Expected: sem erros de tipo nem de compilação.

- [ ] **Step 3: Grep de sanidade — nenhum brand hex hardcoded reintroduzido**

Run: `npm run lint`
Expected: sem novos erros.

- [ ] **Step 4: Roteiro de smoke manual (após o usuário aplicar a migration do bucket)**

Documentar para o usuário (não automatizável aqui):
1. Aplicar a migration `20260625000200_org_logos_bucket.sql` no SQL Editor / `supabase db push`.
2. Numa **academia de teste**, abrir Configurações → Personalização: enviar uma logo PNG e escolher uma cor (ex.: violeta). Conferir preview ao vivo. Salvar.
3. Confirmar que **app do aluno**, **painel admin** e **`/arenas/[slug]`** dessa academia mudaram (botões/links/gradiente na cor escolhida; logo aparece).
4. Confirmar que a **Academia Hudson Barros** (org #1, sem branding definido) continua **idêntica** (laranja + logo ArenaHub).
5. Confirmar o selo **"Powered by ArenaHub"** visível nas três superfícies.

- [ ] **Step 5: Deploy (padrão do projeto)**

```bash
git push origin develop
git checkout main && git merge --ff-only develop && git push origin main && git checkout develop
```

(Push para `main` dispara o deploy de produção na Vercel. Lembrar o usuário de aplicar a migration do bucket no Supabase.)

---

## Self-Review

- **Cobertura da spec:**
  - §1 Modelo de dados → Tasks 1 (allowlist), 4 (bucket). `logo_url`/`brand_color` já existem nos tipos/colunas. ✓
  - §2 Aplicação da cor (CSS vars) → Tasks 2, 3, 9. ✓
  - §3 Logo → Tasks 5, 9. ✓
  - §4 Selo PoweredBy → Tasks 6, 9. ✓
  - §5 Configuração (aba Personalização) → Tasks 7, 8. ✓
  - Erros e bordas (cor fora da allowlist, arquivo inválido, sem brand_color/logo_url, Hudson idêntica) → cobertos em Tasks 1/2/7 (validação + fallback default) e Task 10 (smoke Hudson). ✓
- **Placeholder scan:** sem TBD/TODO; todo passo de código mostra o código completo. ✓
- **Consistência de tipos:** `accentVars(color: unknown)` aceita `string | null | undefined` (usado como `org?.brand_color`); `isAllowedBrandColor(color: unknown)`; `Logo` props `logoUrl?: string | null`, `orgName?: string`; `updateBranding(formData: FormData)`. Nomes batem entre tasks. ✓
- **Escopo:** uma única feature coesa (branding por academia). Painel super-admin fica fora (spec separado). ✓
