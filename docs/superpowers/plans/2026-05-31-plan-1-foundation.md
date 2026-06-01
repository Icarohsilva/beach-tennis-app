# Beach Tennis App — Plano 1: Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffoldar o projeto Next.js 14 com App Router, TypeScript, Tailwind, Supabase, PWA e autenticação completa — base funcional para todos os outros planos.

**Architecture:** Feature-based App Router. Supabase para auth + banco. next-pwa para PWA. Middleware de proteção de rotas por role. Deploy na Vercel.

**Tech Stack:** Next.js 14, TypeScript, Tailwind CSS, Supabase, next-pwa, date-fns, lucide-react, Vitest

**Spec:** `docs/superpowers/specs/2026-05-31-beach-tennis-app-design.md`

---

## Mapa de Arquivos

```
c:\beach-tennis-app\
├── app/
│   ├── (auth)/
│   │   ├── layout.tsx
│   │   ├── login/page.tsx
│   │   ├── cadastro/page.tsx
│   │   └── recuperar-senha/page.tsx
│   ├── (dashboard)/
│   │   └── layout.tsx          ← bottom nav + proteção
│   ├── (admin)/
│   │   └── layout.tsx          ← sidebar + proteção admin
│   ├── experimental/page.tsx   ← público (sem login)
│   ├── layout.tsx
│   ├── page.tsx                ← landing page
│   └── globals.css
├── components/
│   └── ui/
│       ├── Button.tsx
│       ├── Card.tsx
│       ├── Badge.tsx
│       ├── Input.tsx
│       └── BottomNav.tsx
├── lib/
│   └── supabase/
│       ├── client.ts
│       ├── server.ts
│       └── middleware.ts
├── types/
│   └── index.ts
├── supabase/
│   └── migrations/
│       └── 001_initial_schema.sql
├── middleware.ts
├── next.config.js
├── tailwind.config.ts
└── public/
    ├── manifest.json
    └── icons/
        ├── icon-192x192.png    ← placeholder laranja
        └── icon-512x512.png
```

---

## Task 1: Inicializar Projeto Next.js

**Files:**
- Create: `package.json`, `next.config.js`, `tailwind.config.ts`, `tsconfig.json`

- [ ] **1.1 Criar projeto**

```bash
cd c:\
npx create-next-app@14 beach-tennis-app --typescript --tailwind --eslint --app --no-src-dir --import-alias "@/*"
cd beach-tennis-app
```

- [ ] **1.2 Instalar dependências**

```bash
npm install @supabase/supabase-js @supabase/auth-helpers-nextjs next-pwa date-fns lucide-react
npm install -D vitest @vitejs/plugin-react @testing-library/react @testing-library/jest-dom jsdom
```

- [ ] **1.3 Configurar next.config.js**

```js
// next.config.js
const withPWA = require('next-pwa')({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development',
  register: true,
  skipWaiting: true,
})

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.supabase.co' },
    ],
  },
}

module.exports = withPWA(nextConfig)
```

- [ ] **1.4 Configurar vitest.config.ts**

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
})
```

- [ ] **1.5 Criar vitest.setup.ts**

```ts
// vitest.setup.ts
import '@testing-library/jest-dom'
```

- [ ] **1.6 Adicionar scripts ao package.json**

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "test": "vitest",
  "test:run": "vitest run"
}
```

- [ ] **1.7 Criar .env.local**

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

- [ ] **1.8 Criar .env.example**

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
MERCADOPAGO_ACCESS_TOKEN=
RESEND_API_KEY=
ZAPI_TOKEN=
```

- [ ] **1.9 Verificar que Next.js inicia**

```bash
npm run dev
```
Esperado: servidor em http://localhost:3000

- [ ] **1.10 Commit**

```bash
git add -A
git commit -m "feat: initialize Next.js 14 project with TypeScript, Tailwind, PWA"
```

---

## Task 2: TypeScript Types

**Files:**
- Create: `types/index.ts`

- [ ] **2.1 Escrever tipos globais**

```ts
// types/index.ts

export type UserRole = 'student' | 'admin'
export type StudentLevel = 'A' | 'B' | 'C' | 'D' | 'iniciante'
export type PaymentType = 'subscriber' | 'per_class' | 'wellhub' | 'totalpass'
export type ClassType = 'kids' | 'adult'
export type BookingStatus = 'confirmed' | 'cancelled'
export type BookingType = 'extra' | 'makeup'
export type AttendanceStatus = 'present' | 'absent' | 'late'
export type AttendanceSource = 'manual' | 'wellhub' | 'totalpass'
export type SessionStatus = 'scheduled' | 'completed' | 'cancelled'
export type SubscriptionStatus = 'active' | 'paused' | 'cancelled'
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded'
export type PaymentTransactionType = 'subscription' | 'per_class' | 'trial'
export type CreditTransactionType = 'renewed' | 'used' | 'refunded' | 'expired'
export type TournamentFormat = 'super8'
export type TournamentModality = 'dupla_fixa' | 'dupla_revezando'
export type TournamentStatus = 'draft' | 'open' | 'in_progress' | 'finished'
export type TrialStatus = 'pending' | 'attended' | 'no_show' | 'cancelled'

export interface Profile {
  id: string
  full_name: string
  avatar_url: string | null
  phone: string | null
  city: string | null
  role: UserRole
  level: StudentLevel
  payment_type: PaymentType
  is_dependent: boolean
  parent_id: string | null
  contract_active: boolean
  credits_balance: number // cached; source of truth = credit_transactions
  wellhub_id: string | null
  totalpass_id: string | null
  created_at: string
}

export interface Class {
  id: string
  name: string
  description: string | null
  level: StudentLevel
  type: ClassType
  day_of_week: number // 0=Sunday, 6=Saturday
  start_time: string // HH:MM
  end_time: string
  max_students: number
  is_active: boolean
}

export interface ClassSession {
  id: string
  class_id: string
  session_date: string // YYYY-MM-DD
  status: SessionStatus
  notes: string | null
}

export interface Enrollment {
  id: string
  student_id: string
  class_id: string
  enrolled_at: string
  cancelled_at: string | null
  is_active: boolean
}

export interface SessionBooking {
  id: string
  student_id: string
  session_id: string
  type: BookingType
  status: BookingStatus
  from_enrollment: boolean
  credit_used: boolean
  booked_at: string
  cancelled_at: string | null
}

export interface Attendance {
  id: string
  student_id: string
  session_id: string
  status: AttendanceStatus
  source: AttendanceSource
  checked_in_at: string
}

export interface CreditTransaction {
  id: string
  student_id: string
  type: CreditTransactionType
  amount: number
  reason: string
  session_id: string | null
  subscription_id: string | null
  expires_at: string | null // null = expires at month end; date = makeup credit (30 days)
  created_at: string
}

export interface TrialBooking {
  id: string
  name: string
  email: string
  phone: string
  session_id: string
  status: TrialStatus
  must_pay_next: boolean
  created_at: string
}

export interface SubscriptionPlan {
  id: string
  name: string
  description: string | null
  classes_per_week: number
  credits_per_month: number
  price_monthly: number
  price_quarterly: number
  price_annual: number
  is_active: boolean
}

export interface StudentSubscription {
  id: string
  student_id: string
  payer_id: string
  plan_id: string
  status: SubscriptionStatus
  starts_at: string
  ends_at: string | null
  next_billing_at: string
  discount_pct: number
  gateway_subscription_id: string | null
}

export interface Payment {
  id: string
  student_id: string
  subscription_id: string | null
  session_id: string | null
  amount: number
  currency: string
  status: PaymentStatus
  type: PaymentTransactionType
  gateway_payment_id: string | null
  gateway: string
  paid_at: string | null
  created_at: string
}

export interface Tournament {
  id: string
  name: string
  date: string
  format: TournamentFormat
  modality: TournamentModality
  level: StudentLevel
  status: TournamentStatus
  created_by: string
}

export interface Post {
  id: string
  author_id: string
  content: string
  image_urls: string[]
  likes_count: number
  session_id: string | null
  tournament_id: string | null
  created_at: string
}

export interface Notification {
  id: string
  user_id: string
  type: string
  title: string
  body: string
  read: boolean
  created_at: string
}

// Joined types for UI
export interface ClassWithSession extends Class {
  sessions: ClassSession[]
  enrolled_count: number
}

export interface SessionWithClass extends ClassSession {
  class: Class
  bookings_count: number
}
```

- [ ] **2.2 Commit**

```bash
git add types/index.ts
git commit -m "feat: add global TypeScript types"
```

---

## Task 3: Utilitários de Negócio + Testes

**Files:**
- Create: `lib/utils/levelAccess.ts`, `lib/utils/creditRules.ts`, `lib/utils/dateHelpers.ts`
- Test: `lib/utils/levelAccess.test.ts`, `lib/utils/creditRules.test.ts`

- [ ] **3.1 Escrever teste de levelAccess**

```ts
// lib/utils/levelAccess.test.ts
import { describe, it, expect } from 'vitest'
import { canStudentAttendLevel, LEVEL_HIERARCHY } from './levelAccess'

describe('canStudentAttendLevel', () => {
  it('allows student to attend their own level', () => {
    expect(canStudentAttendLevel('C', 'C')).toBe(true)
  })

  it('allows student to attend a lower level', () => {
    expect(canStudentAttendLevel('C', 'D')).toBe(true)
    expect(canStudentAttendLevel('A', 'iniciante')).toBe(true)
  })

  it('blocks student from attending a higher level', () => {
    expect(canStudentAttendLevel('D', 'C')).toBe(false)
    expect(canStudentAttendLevel('iniciante', 'A')).toBe(false)
  })

  it('A can attend any level', () => {
    expect(canStudentAttendLevel('A', 'B')).toBe(true)
    expect(canStudentAttendLevel('A', 'iniciante')).toBe(true)
  })

  it('iniciante can only attend iniciante', () => {
    expect(canStudentAttendLevel('iniciante', 'iniciante')).toBe(true)
    expect(canStudentAttendLevel('iniciante', 'D')).toBe(false)
  })
})
```

- [ ] **3.2 Rodar teste — deve falhar**

```bash
npm run test:run -- lib/utils/levelAccess.test.ts
```
Esperado: FAIL "Cannot find module './levelAccess'"

- [ ] **3.3 Implementar levelAccess.ts**

```ts
// lib/utils/levelAccess.ts
import type { StudentLevel } from '@/types'

// Higher index = more advanced. A=4 (most advanced), iniciante=0 (most basic)
export const LEVEL_HIERARCHY: Record<StudentLevel, number> = {
  iniciante: 0,
  D: 1,
  C: 2,
  B: 3,
  A: 4,
}

/** Student can attend a class if their level >= class level (numerically) */
export function canStudentAttendLevel(
  studentLevel: StudentLevel,
  classLevel: StudentLevel,
): boolean {
  return LEVEL_HIERARCHY[studentLevel] >= LEVEL_HIERARCHY[classLevel]
}
```

- [ ] **3.4 Rodar teste — deve passar**

```bash
npm run test:run -- lib/utils/levelAccess.test.ts
```
Esperado: PASS (5 tests)

- [ ] **3.5 Escrever teste de creditRules**

```ts
// lib/utils/creditRules.test.ts
import { describe, it, expect } from 'vitest'
import { canCancelWithRefund, getMakeupCreditExpiry, CANCELLATION_WINDOW_HOURS } from './creditRules'

describe('canCancelWithRefund', () => {
  it('allows cancellation 6 hours before', () => {
    const sessionDate = new Date()
    sessionDate.setHours(sessionDate.getHours() + 6)
    expect(canCancelWithRefund(sessionDate.toISOString(), new Date().toISOString())).toBe(true)
  })

  it('blocks cancellation 4 hours before', () => {
    const sessionDate = new Date()
    sessionDate.setHours(sessionDate.getHours() + 4)
    expect(canCancelWithRefund(sessionDate.toISOString(), new Date().toISOString())).toBe(false)
  })

  it('blocks cancellation exactly at window limit', () => {
    const sessionDate = new Date()
    sessionDate.setHours(sessionDate.getHours() + CANCELLATION_WINDOW_HOURS)
    // at exactly 5h: not strictly greater, so no refund
    expect(canCancelWithRefund(sessionDate.toISOString(), new Date().toISOString())).toBe(false)
  })
})

describe('getMakeupCreditExpiry', () => {
  it('returns a date 30 days from now by default', () => {
    const now = new Date('2026-06-01T10:00:00Z')
    const expiry = getMakeupCreditExpiry(now, 30)
    expect(expiry.toISOString().startsWith('2026-07-01')).toBe(true)
  })

  it('respects custom expiry days', () => {
    const now = new Date('2026-06-01T10:00:00Z')
    const expiry = getMakeupCreditExpiry(now, 15)
    expect(expiry.toISOString().startsWith('2026-06-16')).toBe(true)
  })
})
```

- [ ] **3.6 Rodar teste — deve falhar**

```bash
npm run test:run -- lib/utils/creditRules.test.ts
```
Esperado: FAIL "Cannot find module"

- [ ] **3.7 Implementar creditRules.ts**

```ts
// lib/utils/creditRules.ts

export const CANCELLATION_WINDOW_HOURS = 5

/**
 * Returns true if cancellation is more than CANCELLATION_WINDOW_HOURS before session.
 * Only then does the student receive a makeup credit.
 */
export function canCancelWithRefund(
  sessionStartIso: string,
  nowIso: string,
  windowHours = CANCELLATION_WINDOW_HOURS,
): boolean {
  const sessionStart = new Date(sessionStartIso)
  const now = new Date(nowIso)
  const diffHours = (sessionStart.getTime() - now.getTime()) / (1000 * 60 * 60)
  return diffHours > windowHours
}

/**
 * Returns the expiry date for a makeup credit.
 * Default: 30 days. Configurable via system_settings.credit_expiry_days.
 */
export function getMakeupCreditExpiry(from: Date, expiryDays: number): Date {
  const expiry = new Date(from)
  expiry.setDate(expiry.getDate() + expiryDays)
  return expiry
}

/** Returns true if a makeup credit has expired */
export function isCreditExpired(expiresAt: string | null, now = new Date()): boolean {
  if (!expiresAt) return false // monthly credits: handled by month-end cron
  return new Date(expiresAt) < now
}
```

- [ ] **3.8 Rodar testes — devem passar**

```bash
npm run test:run -- lib/utils/creditRules.test.ts
```
Esperado: PASS (4 tests)

- [ ] **3.9 Implementar dateHelpers.ts**

```ts
// lib/utils/dateHelpers.ts
import { format, addMonths, startOfMonth, endOfMonth, eachDayOfInterval, getDay } from 'date-fns'
import { ptBR } from 'date-fns/locale'

/** Returns all dates in a month that match a given day_of_week (0=Sun, 6=Sat) */
export function getDatesForDayOfWeekInMonth(
  year: number,
  month: number, // 0-indexed
  dayOfWeek: number,
): Date[] {
  const start = startOfMonth(new Date(year, month))
  const end = endOfMonth(new Date(year, month))
  return eachDayOfInterval({ start, end }).filter((d) => getDay(d) === dayOfWeek)
}

export function formatDate(date: string | Date, fmt = 'dd/MM/yyyy'): string {
  return format(new Date(date), fmt, { locale: ptBR })
}

export function formatTime(time: string): string {
  // time = "HH:MM:SS" or "HH:MM"
  return time.slice(0, 5)
}

export function getFirstDayOfNextMonth(): Date {
  return startOfMonth(addMonths(new Date(), 1))
}
```

- [ ] **3.10 Commit**

```bash
git add lib/utils/
git commit -m "feat: add business logic utilities (levelAccess, creditRules, dateHelpers) with tests"
```

---

## Task 4: Supabase — Cliente e Helpers

**Files:**
- Create: `lib/supabase/client.ts`, `lib/supabase/server.ts`

- [ ] **4.1 Criar cliente browser**

```ts
// lib/supabase/client.ts
import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}
```

> Nota: instalar `@supabase/ssr` em vez de `@supabase/auth-helpers-nextjs` (deprecated):
> ```bash
> npm install @supabase/ssr
> npm uninstall @supabase/auth-helpers-nextjs
> ```

- [ ] **4.2 Criar cliente server**

```ts
// lib/supabase/server.ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export function createClient() {
  const cookieStore = cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {}
        },
      },
    },
  )
}

export function createAdminClient() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { cookies: { getAll: () => [], setAll: () => {} } },
  )
}
```

- [ ] **4.3 Commit**

```bash
git add lib/supabase/
git commit -m "feat: add Supabase client helpers (browser + server)"
```

---

## Task 5: Middleware de Proteção de Rotas

**Files:**
- Create: `middleware.ts`

- [ ] **5.1 Criar middleware**

```ts
// middleware.ts
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  const { data: { user } } = await supabase.auth.getUser()
  const { pathname } = request.nextUrl

  // Public routes
  if (
    pathname.startsWith('/login') ||
    pathname.startsWith('/cadastro') ||
    pathname.startsWith('/recuperar-senha') ||
    pathname.startsWith('/experimental') ||
    pathname === '/'
  ) {
    return supabaseResponse
  }

  // Must be authenticated for dashboard
  if (!user) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // Admin routes require admin role
  if (pathname.startsWith('/admin')) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profile?.role !== 'admin') {
      return NextResponse.redirect(new URL('/home', request.url))
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
```

- [ ] **5.2 Commit**

```bash
git add middleware.ts
git commit -m "feat: add route protection middleware with role-based access"
```

---

## Task 6: Migração SQL — Schema Inicial

**Files:**
- Create: `supabase/migrations/001_initial_schema.sql`

- [ ] **6.1 Criar migration SQL**

```sql
-- supabase/migrations/001_initial_schema.sql

-- Enable extensions
create extension if not exists "uuid-ossp";

-- Enums
create type user_role as enum ('student', 'admin');
create type student_level as enum ('A', 'B', 'C', 'D', 'iniciante');
create type payment_type as enum ('subscriber', 'per_class', 'wellhub', 'totalpass');
create type class_type as enum ('kids', 'adult');
create type session_status as enum ('scheduled', 'completed', 'cancelled');
create type booking_status as enum ('confirmed', 'cancelled');
create type booking_type as enum ('extra', 'makeup');
create type attendance_status as enum ('present', 'absent', 'late');
create type attendance_source as enum ('manual', 'wellhub', 'totalpass');
create type credit_transaction_type as enum ('renewed', 'used', 'refunded', 'expired');
create type trial_status as enum ('pending', 'attended', 'no_show', 'cancelled');
create type subscription_status as enum ('active', 'paused', 'cancelled');
create type payment_status as enum ('pending', 'paid', 'failed', 'refunded');
create type payment_transaction_type as enum ('subscription', 'per_class', 'trial');
create type tournament_format as enum ('super8');
create type tournament_modality as enum ('dupla_fixa', 'dupla_revezando');
create type tournament_status as enum ('draft', 'open', 'in_progress', 'finished');

-- Profiles (extends auth.users)
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  avatar_url text,
  phone text,
  city text,
  role user_role not null default 'student',
  level student_level not null default 'iniciante',
  payment_type payment_type not null default 'per_class',
  is_dependent boolean not null default false,
  parent_id uuid references profiles(id) on delete set null,
  contract_active boolean not null default true,
  credits_balance int not null default 0,
  wellhub_id text,
  totalpass_id text,
  created_at timestamptz not null default now()
);

-- Classes (recurring schedule)
create table classes (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  description text,
  level student_level not null,
  type class_type not null default 'adult',
  day_of_week int not null check (day_of_week between 0 and 6),
  start_time time not null,
  end_time time not null,
  max_students int not null default 8,
  is_active boolean not null default true
);

-- Class Sessions (specific date instances)
create table class_sessions (
  id uuid primary key default uuid_generate_v4(),
  class_id uuid not null references classes(id) on delete cascade,
  session_date date not null,
  status session_status not null default 'scheduled',
  notes text,
  unique(class_id, session_date)
);

-- Enrollments (fixed schedule)
create table enrollments (
  id uuid primary key default uuid_generate_v4(),
  student_id uuid not null references profiles(id) on delete cascade,
  class_id uuid not null references classes(id) on delete cascade,
  enrolled_at timestamptz not null default now(),
  cancelled_at timestamptz,
  is_active boolean not null default true,
  unique(student_id, class_id)
);

-- Session Bookings (all bookings: auto-enrolled, extra, makeup)
create table session_bookings (
  id uuid primary key default uuid_generate_v4(),
  student_id uuid not null references profiles(id) on delete cascade,
  session_id uuid not null references class_sessions(id) on delete cascade,
  type booking_type not null default 'extra',
  status booking_status not null default 'confirmed',
  from_enrollment boolean not null default false,
  credit_used boolean not null default false,
  booked_at timestamptz not null default now(),
  cancelled_at timestamptz,
  unique(student_id, session_id)
);

-- Attendance
create table attendance (
  id uuid primary key default uuid_generate_v4(),
  student_id uuid not null references profiles(id) on delete cascade,
  session_id uuid not null references class_sessions(id) on delete cascade,
  status attendance_status not null default 'present',
  source attendance_source not null default 'manual',
  checked_in_at timestamptz not null default now(),
  unique(student_id, session_id)
);

-- Credit Transactions
create table credit_transactions (
  id uuid primary key default uuid_generate_v4(),
  student_id uuid not null references profiles(id) on delete cascade,
  type credit_transaction_type not null,
  amount int not null,
  reason text not null,
  session_id uuid references class_sessions(id) on delete set null,
  subscription_id uuid,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

-- Trial Bookings (public, no auth required)
create table trial_bookings (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  email text not null,
  phone text not null,
  session_id uuid not null references class_sessions(id) on delete cascade,
  status trial_status not null default 'pending',
  must_pay_next boolean not null default false,
  created_at timestamptz not null default now()
);

-- Subscription Plans
create table subscription_plans (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  description text,
  classes_per_week int not null,
  credits_per_month int not null,
  price_monthly numeric(10,2) not null default 0,
  price_quarterly numeric(10,2) not null default 0,
  price_annual numeric(10,2) not null default 0,
  is_active boolean not null default true
);

-- Student Subscriptions
create table student_subscriptions (
  id uuid primary key default uuid_generate_v4(),
  student_id uuid not null references profiles(id) on delete cascade,
  payer_id uuid not null references profiles(id),
  plan_id uuid not null references subscription_plans(id),
  status subscription_status not null default 'active',
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  next_billing_at timestamptz not null,
  discount_pct numeric(5,2) not null default 0,
  gateway_subscription_id text
);

-- Add FK from credit_transactions to student_subscriptions
alter table credit_transactions
  add constraint credit_transactions_subscription_id_fkey
  foreign key (subscription_id) references student_subscriptions(id) on delete set null;

-- Payments
create table payments (
  id uuid primary key default uuid_generate_v4(),
  student_id uuid not null references profiles(id) on delete cascade,
  subscription_id uuid references student_subscriptions(id) on delete set null,
  session_id uuid references class_sessions(id) on delete set null,
  amount numeric(10,2) not null,
  currency text not null default 'BRL',
  status payment_status not null default 'pending',
  type payment_transaction_type not null,
  gateway_payment_id text,
  gateway text not null default 'mercadopago',
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

-- System Settings
create table system_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id)
);

-- Default settings
insert into system_settings (key, value) values
  ('credit_expiry_days', '30'),
  ('cancellation_window_hours', '5'),
  ('saturday_end_time', '11:00'),
  ('max_daily_bookings', '2');

-- Tournaments
create table tournaments (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  date date not null,
  format tournament_format not null default 'super8',
  modality tournament_modality not null,
  level student_level not null,
  status tournament_status not null default 'draft',
  created_by uuid not null references profiles(id)
);

create table tournament_matches (
  id uuid primary key default uuid_generate_v4(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  player1_id uuid not null references profiles(id),
  player2_id uuid not null references profiles(id),
  partner1_id uuid references profiles(id),
  partner2_id uuid references profiles(id),
  score text,
  winner_id uuid references profiles(id),
  round int not null,
  played_at timestamptz
);

-- Social
create table posts (
  id uuid primary key default uuid_generate_v4(),
  author_id uuid not null references profiles(id) on delete cascade,
  content text not null,
  image_urls text[] not null default '{}',
  likes_count int not null default 0,
  session_id uuid references class_sessions(id) on delete set null,
  tournament_id uuid references tournaments(id) on delete set null,
  created_at timestamptz not null default now()
);

create table post_likes (
  post_id uuid not null references posts(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table post_comments (
  id uuid primary key default uuid_generate_v4(),
  post_id uuid not null references posts(id) on delete cascade,
  author_id uuid not null references profiles(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);

-- Notifications
create table notifications (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references profiles(id) on delete cascade,
  type text not null,
  title text not null,
  body text not null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

-- Wellhub / TotalPass check-ins
create table wellhub_checkins (
  id uuid primary key default uuid_generate_v4(),
  wellhub_user_id text not null,
  wellhub_member_id text,
  student_id uuid references profiles(id) on delete set null,
  session_id uuid references class_sessions(id) on delete set null,
  status text not null default 'unmatched',
  raw_payload jsonb not null,
  checked_in_at timestamptz not null default now()
);

create table totalpass_checkins (
  id uuid primary key default uuid_generate_v4(),
  totalpass_user_id text not null,
  student_id uuid references profiles(id) on delete set null,
  session_id uuid references class_sessions(id) on delete set null,
  status text not null default 'unmatched',
  raw_payload jsonb not null,
  checked_in_at timestamptz not null default now()
);

-- Indexes
create index idx_class_sessions_date on class_sessions(session_date);
create index idx_class_sessions_class_id on class_sessions(class_id);
create index idx_session_bookings_student on session_bookings(student_id);
create index idx_session_bookings_session on session_bookings(session_id);
create index idx_attendance_session on attendance(session_id);
create index idx_credit_transactions_student on credit_transactions(student_id);
create index idx_notifications_user on notifications(user_id, read);
create index idx_posts_created on posts(created_at desc);
```

- [ ] **6.2 Commit**

```bash
git add supabase/
git commit -m "feat: add initial database schema migration"
```

- [ ] **6.3 Aplicar migração no Supabase**

```bash
# Instalar Supabase CLI se necessário
npm install -g supabase

# Login e link ao projeto
supabase login
supabase link --project-ref YOUR_PROJECT_REF

# Aplicar migration
supabase db push
```

---

## Task 7: RLS Policies

**Files:**
- Create: `supabase/migrations/002_rls_policies.sql`

- [ ] **7.1 Criar políticas RLS**

```sql
-- supabase/migrations/002_rls_policies.sql

-- Enable RLS on all tables
alter table profiles enable row level security;
alter table classes enable row level security;
alter table class_sessions enable row level security;
alter table enrollments enable row level security;
alter table session_bookings enable row level security;
alter table attendance enable row level security;
alter table credit_transactions enable row level security;
alter table trial_bookings enable row level security;
alter table subscription_plans enable row level security;
alter table student_subscriptions enable row level security;
alter table payments enable row level security;
alter table system_settings enable row level security;
alter table tournaments enable row level security;
alter table tournament_matches enable row level security;
alter table posts enable row level security;
alter table post_likes enable row level security;
alter table post_comments enable row level security;
alter table notifications enable row level security;
alter table wellhub_checkins enable row level security;
alter table totalpass_checkins enable row level security;

-- Helper function: is current user an admin?
create or replace function is_admin()
returns boolean language sql security definer as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$$;

-- profiles
create policy "Users can view own profile" on profiles for select using (id = auth.uid());
create policy "Admin can view all profiles" on profiles for select using (is_admin());
create policy "Users can update own profile" on profiles for update using (id = auth.uid());
create policy "Admin can update all profiles" on profiles for update using (is_admin());
create policy "Admin can insert profiles" on profiles for insert with check (is_admin());

-- classes (public read, admin write)
create policy "Anyone authenticated can view active classes" on classes
  for select using (auth.role() = 'authenticated' and is_active = true);
create policy "Admin can manage classes" on classes
  for all using (is_admin());

-- class_sessions (public read, admin write)
create policy "Authenticated can view sessions" on class_sessions
  for select using (auth.role() = 'authenticated');
create policy "Admin can manage sessions" on class_sessions
  for all using (is_admin());

-- enrollments
create policy "Students view own enrollments" on enrollments
  for select using (student_id = auth.uid());
create policy "Admin views all enrollments" on enrollments
  for select using (is_admin());
create policy "Admin manages enrollments" on enrollments
  for all using (is_admin());

-- session_bookings
create policy "Students view own bookings" on session_bookings
  for select using (student_id = auth.uid());
create policy "Admin views all bookings" on session_bookings
  for select using (is_admin());
create policy "Students can insert own bookings" on session_bookings
  for insert with check (student_id = auth.uid());
create policy "Students can cancel own bookings" on session_bookings
  for update using (student_id = auth.uid());
create policy "Admin manages all bookings" on session_bookings
  for all using (is_admin());

-- attendance
create policy "Students view own attendance" on attendance
  for select using (student_id = auth.uid());
create policy "Admin manages all attendance" on attendance
  for all using (is_admin());

-- credit_transactions
create policy "Students view own credits" on credit_transactions
  for select using (student_id = auth.uid());
create policy "Admin views all credits" on credit_transactions
  for select using (is_admin());
create policy "System inserts credits (service role only)" on credit_transactions
  for insert with check (is_admin());

-- subscription_plans (public read, admin write)
create policy "Authenticated can view active plans" on subscription_plans
  for select using (auth.role() = 'authenticated' and is_active = true);
create policy "Admin manages plans" on subscription_plans
  for all using (is_admin());

-- student_subscriptions
create policy "Students view own subscriptions" on student_subscriptions
  for select using (student_id = auth.uid() or payer_id = auth.uid());
create policy "Admin views all subscriptions" on student_subscriptions
  for select using (is_admin());
create policy "Admin manages subscriptions" on student_subscriptions
  for all using (is_admin());

-- payments
create policy "Students view own payments" on payments
  for select using (student_id = auth.uid());
create policy "Admin views all payments" on payments
  for select using (is_admin());

-- system_settings (admin only)
create policy "Admin manages system settings" on system_settings
  for all using (is_admin());

-- tournaments (public read, admin write)
create policy "Authenticated can view tournaments" on tournaments
  for select using (auth.role() = 'authenticated');
create policy "Admin manages tournaments" on tournaments
  for all using (is_admin());

create policy "Authenticated can view tournament matches" on tournament_matches
  for select using (auth.role() = 'authenticated');
create policy "Admin manages tournament matches" on tournament_matches
  for all using (is_admin());

-- posts
create policy "Authenticated can view posts" on posts
  for select using (auth.role() = 'authenticated');
create policy "Students can create posts" on posts
  for insert with check (author_id = auth.uid());
create policy "Students can update own posts" on posts
  for update using (author_id = auth.uid());
create policy "Students can delete own posts" on posts
  for delete using (author_id = auth.uid());
create policy "Admin manages all posts" on posts
  for all using (is_admin());

create policy "Authenticated can view likes" on post_likes
  for select using (auth.role() = 'authenticated');
create policy "Students can like posts" on post_likes
  for insert with check (user_id = auth.uid());
create policy "Students can unlike posts" on post_likes
  for delete using (user_id = auth.uid());

create policy "Authenticated can view comments" on post_comments
  for select using (auth.role() = 'authenticated');
create policy "Students can comment" on post_comments
  for insert with check (author_id = auth.uid());
create policy "Students can delete own comments" on post_comments
  for delete using (author_id = auth.uid());

-- notifications
create policy "Users view own notifications" on notifications
  for select using (user_id = auth.uid());
create policy "Users mark own notifications read" on notifications
  for update using (user_id = auth.uid());
create policy "Admin inserts notifications" on notifications
  for insert with check (is_admin());

-- trial_bookings (service role only write, public insert via API route)
create policy "Admin views trial bookings" on trial_bookings
  for select using (is_admin());
```

- [ ] **7.2 Aplicar**

```bash
supabase db push
```

- [ ] **7.3 Commit**

```bash
git add supabase/migrations/002_rls_policies.sql
git commit -m "feat: add RLS policies for all tables"
```

---

## Task 8: Trigger — Auto-criar Profile

**Files:**
- Create: `supabase/migrations/003_profile_trigger.sql`

- [ ] **8.1 Criar trigger**

```sql
-- supabase/migrations/003_profile_trigger.sql

-- Auto-create profile when user signs up
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();
```

- [ ] **8.2 Aplicar e commit**

```bash
supabase db push
git add supabase/migrations/003_profile_trigger.sql
git commit -m "feat: add trigger to auto-create profile on user signup"
```

---

## Task 9: PWA — Manifest e Ícones

**Files:**
- Create: `public/manifest.json`, `app/layout.tsx`

- [ ] **9.1 Criar manifest.json**

```json
{
  "name": "Beach Tennis App",
  "short_name": "BT App",
  "description": "Gestão de aulas e torneios de beach tennis",
  "start_url": "/home",
  "display": "standalone",
  "background_color": "#0f172a",
  "theme_color": "#ea580c",
  "orientation": "portrait",
  "icons": [
    {
      "src": "/icons/icon-192x192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any maskable"
    },
    {
      "src": "/icons/icon-512x512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any maskable"
    }
  ]
}
```

- [ ] **9.2 Criar ícones placeholder**

Criar dois PNGs laranjas simples (192x192 e 512x512) em `public/icons/`. Use qualquer editor de imagem ou gerador online. O ícone final será fornecido pelo professor Hudson.

- [ ] **9.3 Criar app/layout.tsx**

```tsx
// app/layout.tsx
import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Beach Tennis App',
  description: 'Gestão de aulas e torneios de beach tennis',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'BT App',
  },
}

export const viewport: Viewport = {
  themeColor: '#ea580c',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className={inter.className}>{children}</body>
    </html>
  )
}
```

- [ ] **9.4 Configurar tailwind.config.ts com cores do tema**

```ts
// tailwind.config.ts
import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './features/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#fff7ed',
          100: '#ffedd5',
          200: '#fed7aa',
          300: '#fdba74',
          400: '#fb923c',
          500: '#f97316',
          600: '#ea580c',  // primary
          700: '#c2410c',
          800: '#9a3412',
          900: '#7c2d12',
        },
        surface: {
          DEFAULT: '#0f172a',
          card:    '#1e293b',
          border:  '#334155',
        },
      },
    },
  },
  plugins: [],
}

export default config
```

- [ ] **9.5 Commit**

```bash
git add public/ app/layout.tsx tailwind.config.ts
git commit -m "feat: configure PWA manifest, icons, and Tailwind brand colors"
```

---

## Task 10: Componentes UI Base

**Files:**
- Create: `components/ui/Button.tsx`, `Card.tsx`, `Badge.tsx`, `Input.tsx`, `BottomNav.tsx`

- [ ] **10.1 Button.tsx**

```tsx
// components/ui/Button.tsx
import { ButtonHTMLAttributes, forwardRef } from 'react'
import { cn } from '@/lib/utils/cn'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', loading, className, children, disabled, ...props }, ref) => {
    const base = 'inline-flex items-center justify-center font-semibold rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 focus:ring-offset-surface disabled:opacity-50 disabled:cursor-not-allowed'
    const variants = {
      primary: 'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800',
      secondary: 'bg-surface-card text-white border border-surface-border hover:bg-surface-border',
      ghost: 'text-slate-300 hover:text-white hover:bg-surface-card',
      danger: 'bg-red-600 text-white hover:bg-red-700',
    }
    const sizes = {
      sm: 'px-3 py-1.5 text-sm',
      md: 'px-4 py-2 text-sm',
      lg: 'px-6 py-3 text-base',
    }
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(base, variants[variant], sizes[size], className)}
        {...props}
      >
        {loading ? <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> : null}
        {children}
      </button>
    )
  },
)
Button.displayName = 'Button'
```

- [ ] **10.2 Criar lib/utils/cn.ts**

```ts
// lib/utils/cn.ts
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

```bash
npm install clsx tailwind-merge
```

- [ ] **10.3 Badge.tsx**

```tsx
// components/ui/Badge.tsx
import { cn } from '@/lib/utils/cn'

interface BadgeProps {
  children: React.ReactNode
  variant?: 'default' | 'kids' | 'level' | 'success' | 'warning' | 'danger'
  className?: string
}

export function Badge({ children, variant = 'default', className }: BadgeProps) {
  const variants = {
    default: 'bg-surface-border text-slate-300',
    kids: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/50 animate-pulse',
    level: 'bg-brand-600/20 text-brand-400 border border-brand-600/50',
    success: 'bg-green-500/20 text-green-400',
    warning: 'bg-yellow-500/20 text-yellow-400',
    danger: 'bg-red-500/20 text-red-400',
  }
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold', variants[variant], className)}>
      {children}
    </span>
  )
}
```

- [ ] **10.4 Card.tsx**

```tsx
// components/ui/Card.tsx
import { cn } from '@/lib/utils/cn'

interface CardProps {
  children: React.ReactNode
  className?: string
  onClick?: () => void
}

export function Card({ children, className, onClick }: CardProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'bg-surface-card rounded-xl border border-surface-border p-4',
        onClick && 'cursor-pointer hover:border-brand-600/50 transition-colors',
        className,
      )}
    >
      {children}
    </div>
  )
}
```

- [ ] **10.5 Input.tsx**

```tsx
// components/ui/Input.tsx
import { InputHTMLAttributes, forwardRef } from 'react'
import { cn } from '@/lib/utils/cn'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className, ...props }, ref) => (
    <div className="flex flex-col gap-1">
      {label && <label className="text-sm font-medium text-slate-300">{label}</label>}
      <input
        ref={ref}
        className={cn(
          'w-full rounded-lg bg-surface-card border border-surface-border px-3 py-2 text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent',
          error && 'border-red-500',
          className,
        )}
        {...props}
      />
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  ),
)
Input.displayName = 'Input'
```

- [ ] **10.6 BottomNav.tsx**

```tsx
// components/ui/BottomNav.tsx
'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, Calendar, Plus, Users, User } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

const navItems = [
  { href: '/home', icon: Home, label: 'Home' },
  { href: '/aulas', icon: Calendar, label: 'Aulas' },
  { href: '/comunidade', icon: Users, label: 'Comunidade' },
  { href: '/perfil', icon: User, label: 'Perfil' },
]

export function BottomNav() {
  const pathname = usePathname()
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-surface-card border-t border-surface-border">
      <div className="flex items-center justify-around px-2 pb-safe">
        {navItems.slice(0, 2).map((item) => (
          <NavItem key={item.href} {...item} active={pathname.startsWith(item.href)} />
        ))}

        {/* FAB center button */}
        <Link href="/agendar" className="relative -top-5">
          <div className={cn(
            'flex h-14 w-14 items-center justify-center rounded-full bg-brand-600 shadow-lg shadow-brand-600/40 border-4 border-surface',
            pathname.startsWith('/agendar') && 'bg-brand-500',
          )}>
            <Plus className="h-6 w-6 text-white" />
          </div>
        </Link>

        {navItems.slice(2).map((item) => (
          <NavItem key={item.href} {...item} active={pathname.startsWith(item.href)} />
        ))}
      </div>
    </nav>
  )
}

function NavItem({ href, icon: Icon, label, active }: { href: string; icon: typeof Home; label: string; active: boolean }) {
  return (
    <Link href={href} className="flex flex-col items-center gap-0.5 py-2 px-3">
      <Icon className={cn('h-5 w-5', active ? 'text-brand-500' : 'text-slate-500')} />
      <span className={cn('text-[10px] font-medium', active ? 'text-brand-500' : 'text-slate-500')}>{label}</span>
    </Link>
  )
}
```

- [ ] **10.7 Commit**

```bash
git add components/ lib/utils/cn.ts
git commit -m "feat: add base UI components (Button, Card, Badge, Input, BottomNav)"
```

---

## Task 11: Layouts e Páginas de Auth

**Files:**
- Create: `app/(auth)/layout.tsx`, `app/(auth)/login/page.tsx`, `app/(auth)/cadastro/page.tsx`
- Create: `app/(dashboard)/layout.tsx`

- [ ] **11.1 Layout de auth**

```tsx
// app/(auth)/layout.tsx
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-white">🎾 Beach Tennis</h1>
          <p className="text-slate-400 text-sm mt-1">Academia Hudson Barros</p>
        </div>
        {children}
      </div>
    </div>
  )
}
```

- [ ] **11.2 Página de login**

```tsx
// app/(auth)/login/page.tsx
'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card } from '@/components/ui/Card'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setError('Email ou senha incorretos.')
      setLoading(false)
      return
    }
    router.push('/home')
    router.refresh()
  }

  return (
    <Card>
      <h2 className="text-lg font-semibold text-white mb-6">Entrar</h2>
      <form onSubmit={handleLogin} className="flex flex-col gap-4">
        <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <Input label="Senha" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <Button type="submit" loading={loading} size="lg" className="w-full">
          Entrar
        </Button>
      </form>
      <div className="mt-4 flex flex-col gap-2 text-center text-sm text-slate-400">
        <Link href="/cadastro" className="hover:text-brand-400">Criar conta</Link>
        <Link href="/recuperar-senha" className="hover:text-brand-400">Esqueci minha senha</Link>
      </div>
    </Card>
  )
}
```

- [ ] **11.3 Página de cadastro**

```tsx
// app/(auth)/cadastro/page.tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card } from '@/components/ui/Card'

export default function CadastroPage() {
  const router = useRouter()
  const [form, setForm] = useState({ full_name: '', email: '', password: '', phone: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleCadastro(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const supabase = createClient()
    const { error } = await supabase.auth.signUp({
      email: form.email,
      password: form.password,
      options: { data: { full_name: form.full_name } },
    })
    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }
    // Update phone in profile (trigger creates profile on signup)
    router.push('/home')
    router.refresh()
  }

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }))

  return (
    <Card>
      <h2 className="text-lg font-semibold text-white mb-6">Criar conta</h2>
      <form onSubmit={handleCadastro} className="flex flex-col gap-4">
        <Input label="Nome completo" value={form.full_name} onChange={set('full_name')} required />
        <Input label="Email" type="email" value={form.email} onChange={set('email')} required />
        <Input label="Telefone" type="tel" value={form.phone} onChange={set('phone')} placeholder="(11) 99999-9999" />
        <Input label="Senha" type="password" value={form.password} onChange={set('password')} required minLength={6} />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <Button type="submit" loading={loading} size="lg" className="w-full">
          Criar conta
        </Button>
      </form>
    </Card>
  )
}
```

- [ ] **11.4 Layout do dashboard (aluno)**

```tsx
// app/(dashboard)/layout.tsx
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { BottomNav } from '@/components/ui/BottomNav'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <div className="min-h-screen bg-surface text-white">
      <main className="pb-24">{children}</main>
      <BottomNav />
    </div>
  )
}
```

- [ ] **11.5 Commit**

```bash
git add app/
git commit -m "feat: add auth pages (login, cadastro) and dashboard layout"
```

---

## Task 12: Landing Page e Página Experimental

**Files:**
- Create: `app/page.tsx`, `app/experimental/page.tsx`

- [ ] **12.1 Landing page**

```tsx
// app/page.tsx
import Link from 'next/link'
import { Button } from '@/components/ui/Button'

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-surface text-white">
      <div className="max-w-lg mx-auto px-4 py-12 flex flex-col gap-8">
        <header className="text-center">
          <h1 className="text-4xl font-black text-brand-500">🎾 BT App</h1>
          <p className="text-slate-300 mt-2 text-lg">Academia Hudson Barros</p>
        </header>

        <div className="flex flex-col gap-3 text-center text-slate-400 text-sm">
          <p>📅 Segunda a sexta: 7h – 22h</p>
          <p>📅 Sábado: 7h – 12h</p>
          <p>🎾 Turmas por nível: A · B · C · D · Iniciante</p>
          <p>👶 Aulas kids disponíveis</p>
        </div>

        <div className="flex flex-col gap-3">
          <Link href="/experimental">
            <Button size="lg" className="w-full">Agendar aula experimental gratuita</Button>
          </Link>
          <Link href="/login">
            <Button size="lg" variant="secondary" className="w-full">Entrar / Criar conta</Button>
          </Link>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **12.2 Página experimental (esqueleto)**

```tsx
// app/experimental/page.tsx
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'

export default function ExperimentalPage() {
  return (
    <div className="min-h-screen bg-surface text-white flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <h1 className="text-xl font-bold text-white mb-2">Aula Experimental</h1>
        <p className="text-slate-400 text-sm mb-6">
          Gratuita na primeira vez. Sem precisar criar conta.
        </p>
        <Card>
          <p className="text-slate-400 text-sm text-center py-4">
            Formulário de agendamento — implementado no Plano 2
          </p>
        </Card>
      </div>
    </div>
  )
}
```

- [ ] **12.3 Verificar que o app roda sem erros**

```bash
npm run dev
```
Acessar: http://localhost:3000 (landing), http://localhost:3000/login

- [ ] **12.4 Rodar todos os testes**

```bash
npm run test:run
```
Esperado: todos os testes de utils passando

- [ ] **12.5 Commit final do Plano 1**

```bash
git add -A
git commit -m "feat: complete foundation - landing page, auth, PWA, all base components"
```

---

## Task 13: Deploy Inicial na Vercel

- [ ] **13.1 Instalar Vercel CLI**

```bash
npm install -g vercel
vercel login
```

- [ ] **13.2 Fazer deploy**

```bash
vercel --prod
```

- [ ] **13.3 Configurar variáveis de ambiente na Vercel**

No dashboard da Vercel → Settings → Environment Variables, adicionar:
```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
```

- [ ] **13.4 Verificar PWA**

Acessar a URL da Vercel no celular → verificar prompt "Adicionar à tela inicial" no Android.

---

**Plano 1 concluído.** O projeto está no ar com auth funcional, banco configurado, RLS ativo, PWA instalável e todos os tipos TypeScript definidos.

**Próximo:** [Plano 2 — Classes, Agendamento e Sistema de Créditos](./2026-05-31-plan-2-classes-agendamento.md)
