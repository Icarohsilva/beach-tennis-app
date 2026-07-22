# Relatório de Frequência — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar à academia um relatório de presenças/faltas por aluno (semana e mês) e ao aluno a própria frequência (mês e ano), sem depender de um hábito de chamada que hoje não existe.

**Architecture:** A presença é **calculada na leitura**, nunca materializada. Um módulo puro (`lib/utils/attendanceReport.ts`) recebe sessões, matrículas, reservas e linhas de `attendance` e devolve os totais por aluno; uma camada de consulta busca esses dados do Supabase; as telas só desenham. Nenhuma migration, nenhum cron novo — a correção do professor já funciona pela chamada existente, porque a linha de `attendance` vence a presunção.

**Tech Stack:** Next.js 14 App Router, TypeScript, Supabase (service role via `createAdminClient`), Tailwind, Vitest, date-fns.

**Spec:** `docs/superpowers/specs/2026-07-22-relatorio-frequencia-design.md`

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `lib/utils/attendanceReport.ts` (criar) | Regra pura de classificação e totalização. Sem I/O. |
| `lib/utils/attendanceReport.test.ts` (criar) | Testes da regra. |
| `lib/utils/monthWindow.ts` (modificar) | Ganha `getWeekWindow` e `shiftWindow`. |
| `lib/utils/monthWindow.test.ts` (criar) | Testes das novas janelas. |
| `features/relatorios/query.ts` (criar) | Busca no Supabase e chama o módulo puro. |
| `lib/org/permissions.ts` (modificar) | Nova área `relatorios`. |
| `app/(admin)/layout.tsx` (modificar) | Item de menu "Relatórios". |
| `app/(admin)/admin/relatorios/page.tsx` (criar) | Tela do painel. |
| `features/relatorios/FrequencyTable.tsx` (criar) | Tabela ordenável (client). |
| `app/(admin)/admin/grade/[sessionId]/page.tsx` (modificar) | Chamada passa a listar também o aluno fixo sem reserva. |
| `features/relatorios/StudentFrequencyCard.tsx` (criar) | Card do aluno (Home) e bloco do Perfil. |
| `app/(dashboard)/home/page.tsx` (modificar) | Card de frequência. |
| `app/(dashboard)/perfil/page.tsx` (modificar) | Seção "Minha frequência". |

---

### Task 1: Módulo puro — classificação e totais

**Files:**
- Create: `lib/utils/attendanceReport.ts`
- Test: `lib/utils/attendanceReport.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/utils/attendanceReport.test.ts`:

```ts
// lib/utils/attendanceReport.test.ts
import { describe, it, expect } from 'vitest'
import { buildAttendanceReport, type ReportInput } from './attendanceReport'

/** Base: 1 turma, 1 sessão passada, 1 aluno fixo matriculado há muito tempo. */
function base(): ReportInput {
  return {
    today: '2026-07-22',
    trackingStart: '2026-01-01',
    sessions: [{ id: 's1', date: '2026-07-20', status: 'scheduled', classId: 'c1' }],
    enrollments: [{ studentId: 'ana', classId: 'c1', enrolledAt: '2026-01-01', cancelledAt: null }],
    bookings: [],
    attendance: [],
  }
}

describe('buildAttendanceReport', () => {
  it('presume presença de quem era esperado e não tem registro', () => {
    const [ana] = buildAttendanceReport(base())
    expect(ana).toMatchObject({ studentId: 'ana', present: 1, absent: 0, notified: 0, expected: 1, rate: 100 })
  })

  it('falta marcada pelo professor vence a presunção', () => {
    const input = base()
    input.attendance = [{ studentId: 'ana', sessionId: 's1', status: 'absent' }]
    const [ana] = buildAttendanceReport(input)
    expect(ana).toMatchObject({ present: 0, absent: 1, rate: 0 })
  })

  it('conta late como presente', () => {
    const input = base()
    input.attendance = [{ studentId: 'ana', sessionId: 's1', status: 'late' }]
    expect(buildAttendanceReport(input)[0]).toMatchObject({ present: 1, absent: 0 })
  })

  it('quem avisou entra em notified e no denominador, mas não em present', () => {
    const input = base()
    input.bookings = [{ studentId: 'ana', sessionId: 's1', status: 'cancelled' }]
    const [ana] = buildAttendanceReport(input)
    expect(ana).toMatchObject({ present: 0, absent: 0, notified: 1, expected: 1, rate: 0 })
  })

  it('ignora sessão cancelada para todo mundo', () => {
    const input = base()
    input.sessions = [{ id: 's1', date: '2026-07-20', status: 'cancelled', classId: 'c1' }]
    expect(buildAttendanceReport(input)).toEqual([])
  })

  it('ignora aula de hoje (só conta a partir do dia seguinte)', () => {
    const input = base()
    input.sessions = [{ id: 's1', date: '2026-07-22', status: 'scheduled', classId: 'c1' }]
    expect(buildAttendanceReport(input)).toEqual([])
  })

  it('ignora sessão anterior ao corte de rastreio', () => {
    const input = base()
    input.trackingStart = '2026-07-21'
    expect(buildAttendanceReport(input)).toEqual([])
  })

  it('reserva confirmada torna esperado quem não é fixo', () => {
    const input = base()
    input.enrollments = []
    input.bookings = [{ studentId: 'bruno', sessionId: 's1', status: 'confirmed' }]
    expect(buildAttendanceReport(input)[0]).toMatchObject({ studentId: 'bruno', present: 1, expected: 1 })
  })

  it('não gera falta retroativa para quem se matriculou depois da aula', () => {
    const input = base()
    input.enrollments = [{ studentId: 'ana', classId: 'c1', enrolledAt: '2026-07-21', cancelledAt: null }]
    expect(buildAttendanceReport(input)).toEqual([])
  })

  it('não gera falta depois de o aluno sair da turma', () => {
    const input = base()
    input.enrollments = [{ studentId: 'ana', classId: 'c1', enrolledAt: '2026-01-01', cancelledAt: '2026-07-19' }]
    expect(buildAttendanceReport(input)).toEqual([])
  })

  it('mantém o aluno na conta no próprio dia em que saiu', () => {
    const input = base()
    input.enrollments = [{ studentId: 'ana', classId: 'c1', enrolledAt: '2026-01-01', cancelledAt: '2026-07-21' }]
    expect(buildAttendanceReport(input)[0]).toMatchObject({ present: 1 })
  })

  it('deixa de fora quem não tinha nenhuma aula prevista', () => {
    const input = base()
    input.enrollments = [{ studentId: 'ana', classId: 'OUTRA', enrolledAt: '2026-01-01', cancelledAt: null }]
    expect(buildAttendanceReport(input)).toEqual([])
  })

  it('calcula aproveitamento com as três categorias', () => {
    const input = base()
    input.sessions = [
      { id: 's1', date: '2026-07-13', status: 'scheduled', classId: 'c1' },
      { id: 's2', date: '2026-07-14', status: 'scheduled', classId: 'c1' },
      { id: 's3', date: '2026-07-15', status: 'scheduled', classId: 'c1' },
      { id: 's4', date: '2026-07-16', status: 'scheduled', classId: 'c1' },
    ]
    input.attendance = [{ studentId: 'ana', sessionId: 's4', status: 'absent' }]
    input.bookings = [{ studentId: 'ana', sessionId: 's3', status: 'cancelled' }]
    const [ana] = buildAttendanceReport(input)
    // s1 e s2 presumidas, s3 avisou, s4 falta -> 2/(2+1+1) = 50%
    expect(ana).toMatchObject({ present: 2, absent: 1, notified: 1, expected: 4, rate: 50 })
  })

  it('ordena por aproveitamento decrescente', () => {
    const input = base()
    input.sessions = [
      { id: 's1', date: '2026-07-13', status: 'scheduled', classId: 'c1' },
      { id: 's2', date: '2026-07-14', status: 'scheduled', classId: 'c1' },
    ]
    input.enrollments = [
      { studentId: 'ana', classId: 'c1', enrolledAt: '2026-01-01', cancelledAt: null },
      { studentId: 'bruno', classId: 'c1', enrolledAt: '2026-01-01', cancelledAt: null },
    ]
    input.attendance = [{ studentId: 'ana', sessionId: 's1', status: 'absent' }]
    const rows = buildAttendanceReport(input)
    expect(rows.map((r) => r.studentId)).toEqual(['bruno', 'ana'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- lib/utils/attendanceReport.test.ts`
Expected: FAIL — `Failed to resolve import "./attendanceReport"`.

- [ ] **Step 3: Write the implementation**

Create `lib/utils/attendanceReport.ts`:

```ts
// lib/utils/attendanceReport.ts
// Regra pura do relatório de frequência. Sem React e sem I/O.
//
// A presença é PRESUMIDA: quem era esperado numa aula que já passou conta como
// presente até alguém dizer o contrário. Uma linha de `attendance` (professor ou
// webhook de parceiro) sempre vence a presunção.

/** Data em que a academia passou a ter frequência rastreada. */
export const ATTENDANCE_TRACKING_START = '2026-07-23'

export interface ReportSession {
  id: string
  /** YYYY-MM-DD */
  date: string
  status: 'scheduled' | 'completed' | 'cancelled'
  classId: string
}

export interface ReportEnrollment {
  studentId: string
  classId: string
  /** YYYY-MM-DD */
  enrolledAt: string
  /** YYYY-MM-DD, ou null se a matrícula segue ativa. */
  cancelledAt: string | null
}

export interface ReportBooking {
  studentId: string
  sessionId: string
  status: 'confirmed' | 'cancelled'
}

export interface ReportAttendance {
  studentId: string
  sessionId: string
  status: 'present' | 'absent' | 'late'
}

export interface ReportInput {
  sessions: ReportSession[]
  enrollments: ReportEnrollment[]
  bookings: ReportBooking[]
  attendance: ReportAttendance[]
  /** Data do servidor, YYYY-MM-DD. Aula de hoje ainda não conta. */
  today: string
  /** Corte de rastreio, YYYY-MM-DD. */
  trackingStart: string
}

export interface StudentTotals {
  studentId: string
  present: number
  absent: number
  notified: number
  /** present + absent + notified — as aulas que estavam previstas para ele. */
  expected: number
  /** 0–100, arredondado. */
  rate: number
}

/**
 * A matrícula valia naquela data? A agenda olha `is_active` (presente); o
 * relatório olha o passado e precisa da janela, senão quem entrou hoje ganha
 * falta retroativa e quem saiu continua acumulando.
 */
function enrollmentCovers(enrollment: ReportEnrollment, date: string): boolean {
  if (enrollment.enrolledAt > date) return false
  if (enrollment.cancelledAt !== null && enrollment.cancelledAt < date) return false
  return true
}

export function buildAttendanceReport(input: ReportInput): StudentTotals[] {
  const { sessions, enrollments, bookings, attendance, today, trackingStart } = input

  // Só aulas que já passaram, não canceladas e dentro do rastreio.
  const eligible = sessions.filter(
    (s) => s.status !== 'cancelled' && s.date < today && s.date >= trackingStart,
  )

  const bookingsBySession = new Map<string, ReportBooking[]>()
  for (const b of bookings) {
    bookingsBySession.set(b.sessionId, [...(bookingsBySession.get(b.sessionId) ?? []), b])
  }

  const attendanceBySession = new Map<string, Map<string, ReportAttendance['status']>>()
  for (const a of attendance) {
    const perSession = attendanceBySession.get(a.sessionId) ?? new Map()
    perSession.set(a.studentId, a.status)
    attendanceBySession.set(a.sessionId, perSession)
  }

  const totals = new Map<string, StudentTotals>()
  const bump = (studentId: string, field: 'present' | 'absent' | 'notified') => {
    const row = totals.get(studentId) ?? {
      studentId, present: 0, absent: 0, notified: 0, expected: 0, rate: 0,
    }
    row[field] += 1
    row.expected += 1
    totals.set(studentId, row)
  }

  for (const session of eligible) {
    const sessionBookings = bookingsBySession.get(session.id) ?? []
    const marks = attendanceBySession.get(session.id) ?? new Map()

    const confirmed = new Set(
      sessionBookings.filter((b) => b.status === 'confirmed').map((b) => b.studentId),
    )
    const cancelled = new Set(
      sessionBookings.filter((b) => b.status === 'cancelled').map((b) => b.studentId),
    )
    const fixed = new Set(
      enrollments
        .filter((e) => e.classId === session.classId && enrollmentCovers(e, session.date))
        .map((e) => e.studentId),
    )

    // Todo mundo que a aula tocava: fixo na janela, reserva confirmada ou aviso.
    const involved = new Set<string>([...fixed, ...confirmed, ...cancelled])

    for (const studentId of involved) {
      const mark = marks.get(studentId)
      if (mark) {
        // Afirmação de alguém (professor ou parceiro) vence a presunção.
        bump(studentId, mark === 'absent' ? 'absent' : 'present')
        continue
      }
      if (cancelled.has(studentId)) {
        bump(studentId, 'notified')
        continue
      }
      // Esperado e sem registro: presença presumida.
      bump(studentId, 'present')
    }
  }

  return Array.from(totals.values())
    .map((row) => ({
      ...row,
      rate: row.expected === 0 ? 0 : Math.round((row.present / row.expected) * 100),
    }))
    .sort((a, b) => b.rate - a.rate || b.present - a.present || a.studentId.localeCompare(b.studentId))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- lib/utils/attendanceReport.test.ts`
Expected: PASS — 13 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/utils/attendanceReport.ts lib/utils/attendanceReport.test.ts
git commit -m "feat(frequencia): regra pura de presenca presumida com correcao"
```

---

### Task 2: Janelas de semana e navegação entre períodos

**Files:**
- Modify: `lib/utils/monthWindow.ts`
- Test: `lib/utils/monthWindow.test.ts` (criar)

- [ ] **Step 1: Write the failing test**

Create `lib/utils/monthWindow.test.ts`:

```ts
// lib/utils/monthWindow.test.ts
import { describe, it, expect } from 'vitest'
import { getWeekWindow, shiftWindow, getMonthWindow } from './monthWindow'

describe('getWeekWindow', () => {
  it('vai de domingo a sábado da semana da data', () => {
    // 2026-07-22 é uma quarta-feira
    expect(getWeekWindow(new Date(2026, 6, 22))).toEqual({ from: '2026-07-19', to: '2026-07-25' })
  })

  it('trata o próprio domingo como início da semana', () => {
    expect(getWeekWindow(new Date(2026, 6, 19))).toEqual({ from: '2026-07-19', to: '2026-07-25' })
  })
})

describe('shiftWindow', () => {
  it('anda semanas para trás', () => {
    const w = { from: '2026-07-19', to: '2026-07-25' }
    expect(shiftWindow(w, 'week', -1)).toEqual({ from: '2026-07-12', to: '2026-07-18' })
  })

  it('anda meses para trás atravessando o ano', () => {
    const w = getMonthWindow(new Date(2026, 0, 15))
    expect(shiftWindow(w, 'month', -1)).toEqual({ from: '2025-12-01', to: '2025-12-31' })
  })

  it('anda para a frente', () => {
    const w = { from: '2026-07-19', to: '2026-07-25' }
    expect(shiftWindow(w, 'week', 1)).toEqual({ from: '2026-07-26', to: '2026-08-01' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- lib/utils/monthWindow.test.ts`
Expected: FAIL — `getWeekWindow is not a function`.

- [ ] **Step 3: Write the implementation**

Replace `lib/utils/monthWindow.ts` with:

```ts
// lib/utils/monthWindow.ts
// Janelas de data (yyyy-MM-dd) usadas por check-in e pelo relatório de frequência.
import {
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addWeeks, addMonths, parseISO,
} from 'date-fns'

export interface DateWindow {
  from: string // yyyy-MM-dd
  to: string // yyyy-MM-dd
}

export type WindowKind = 'week' | 'month'

/** Primeiro e último dia do mês de `now` (yyyy-MM-dd). */
export function getMonthWindow(now: Date): DateWindow {
  return {
    from: format(startOfMonth(now), 'yyyy-MM-dd'),
    to: format(endOfMonth(now), 'yyyy-MM-dd'),
  }
}

/** Data de `now` até o último dia do mês (yyyy-MM-dd). */
export function getRemainingMonthWindow(now: Date): DateWindow {
  return {
    from: format(now, 'yyyy-MM-dd'),
    to: format(endOfMonth(now), 'yyyy-MM-dd'),
  }
}

/** Domingo a sábado da semana de `now` (yyyy-MM-dd). */
export function getWeekWindow(now: Date): DateWindow {
  return {
    from: format(startOfWeek(now), 'yyyy-MM-dd'),
    to: format(endOfWeek(now), 'yyyy-MM-dd'),
  }
}

/** Move a janela `offset` semanas/meses (negativo = passado). */
export function shiftWindow(window: DateWindow, kind: WindowKind, offset: number): DateWindow {
  const anchor = parseISO(window.from)
  if (kind === 'week') return getWeekWindow(addWeeks(anchor, offset))
  return getMonthWindow(addMonths(anchor, offset))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- lib/utils/monthWindow.test.ts`
Expected: PASS — 5 tests.

Run a segunda vez a suíte de check-in, que já usava este arquivo:
`npm run test:run -- lib/checkin`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/utils/monthWindow.ts lib/utils/monthWindow.test.ts
git commit -m "feat(frequencia): janelas de semana e navegacao entre periodos"
```

---

### Task 3: Camada de consulta

**Files:**
- Create: `features/relatorios/query.ts`

- [ ] **Step 1: Write the implementation**

Esta camada só busca e adapta — a regra está na Task 1 e já tem teste. Não há teste unitário aqui (dependeria de mock do Supabase, que este repo não usa); a verificação é a tela funcionando na Task 5.

Create `features/relatorios/query.ts`:

```ts
// features/relatorios/query.ts
import { createAdminClient } from '@/lib/supabase/server'
import {
  buildAttendanceReport,
  ATTENDANCE_TRACKING_START,
  type ReportSession,
  type ReportEnrollment,
  type ReportBooking,
  type ReportAttendance,
  type StudentTotals,
} from '@/lib/utils/attendanceReport'
import type { DateWindow } from '@/lib/utils/monthWindow'

export interface FrequencyRow extends StudentTotals {
  name: string
}

export interface UnrecordedSession {
  id: string
  date: string
  className: string
}

export interface FrequencyReport {
  rows: FrequencyRow[]
  /** Aulas que contaram no período. */
  sessionsCount: number
  /** Aulas do período em que ninguém foi marcado — onde o professor deve olhar. */
  unrecorded: UnrecordedSession[]
  totals: { present: number; absent: number; notified: number; rate: number }
}

/** Só conta a partir de quando a academia existe — e do corte global. */
function effectiveStart(orgCreatedAt: string | null): string {
  const orgDay = (orgCreatedAt ?? '').slice(0, 10)
  return orgDay > ATTENDANCE_TRACKING_START ? orgDay : ATTENDANCE_TRACKING_START
}

export async function getFrequencyReport(
  orgId: string,
  window: DateWindow,
  today: string,
): Promise<FrequencyReport> {
  const admin = createAdminClient()

  const [{ data: orgRow }, { data: sessionsRaw }, { data: enrollRaw }] = await Promise.all([
    admin.from('organizations').select('created_at').eq('id', orgId).single(),
    admin
      .from('class_sessions')
      .select('id, session_date, status, class_id, classes(name)')
      .eq('organization_id', orgId)
      .gte('session_date', window.from)
      .lte('session_date', window.to),
    // Sem filtro de is_active: uma matrícula encerrada ainda valia nas aulas
    // anteriores ao cancelamento.
    admin
      .from('enrollments')
      .select('student_id, class_id, enrolled_at, cancelled_at')
      .eq('organization_id', orgId),
  ])

  type SessionRow = {
    id: string
    session_date: string
    status: ReportSession['status']
    class_id: string
    classes: { name: string } | { name: string }[] | null
  }
  const sessionRows = (sessionsRaw ?? []) as unknown as SessionRow[]
  const classNameOf = (row: SessionRow) => {
    const cls = Array.isArray(row.classes) ? row.classes[0] : row.classes
    return cls?.name ?? 'Turma'
  }

  const sessions: ReportSession[] = sessionRows.map((row) => ({
    id: row.id,
    date: row.session_date,
    status: row.status,
    classId: row.class_id,
  }))
  const sessionIds = sessions.map((s) => s.id)

  const [{ data: bookingsRaw }, { data: attendanceRaw }] = sessionIds.length > 0
    ? await Promise.all([
        admin.from('session_bookings').select('student_id, session_id, status').in('session_id', sessionIds),
        admin.from('attendance').select('student_id, session_id, status').in('session_id', sessionIds),
      ])
    : [{ data: [] }, { data: [] }]

  const enrollments: ReportEnrollment[] = (
    (enrollRaw ?? []) as { student_id: string; class_id: string; enrolled_at: string; cancelled_at: string | null }[]
  ).map((e) => ({
    studentId: e.student_id,
    classId: e.class_id,
    enrolledAt: (e.enrolled_at ?? '').slice(0, 10),
    cancelledAt: e.cancelled_at ? e.cancelled_at.slice(0, 10) : null,
  }))

  const bookings = ((bookingsRaw ?? []) as { student_id: string; session_id: string; status: string }[])
    .filter((b) => b.status === 'confirmed' || b.status === 'cancelled')
    .map((b) => ({ studentId: b.student_id, sessionId: b.session_id, status: b.status as ReportBooking['status'] }))

  const attendance = ((attendanceRaw ?? []) as { student_id: string; session_id: string; status: string }[])
    .map((a) => ({ studentId: a.student_id, sessionId: a.session_id, status: a.status as ReportAttendance['status'] }))

  const trackingStart = effectiveStart(orgRow?.created_at ?? null)
  const totals = buildAttendanceReport({
    sessions, enrollments, bookings, attendance, today, trackingStart,
  })

  // Nomes só de quem apareceu na conta.
  const ids = totals.map((t) => t.studentId)
  const { data: profiles } = ids.length > 0
    ? await admin.from('profiles').select('id, full_name').in('id', ids)
    : { data: [] }
  const nameById = new Map(
    ((profiles ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name]),
  )

  const rows: FrequencyRow[] = totals.map((t) => ({ ...t, name: nameById.get(t.studentId) ?? 'Aluno' }))

  const counted = sessions.filter(
    (s) => s.status !== 'cancelled' && s.date < today && s.date >= trackingStart,
  )
  const markedSessionIds = new Set(attendance.map((a) => a.sessionId))
  const unrecorded: UnrecordedSession[] = counted
    .filter((s) => !markedSessionIds.has(s.id))
    .map((s) => {
      const row = sessionRows.find((r) => r.id === s.id)!
      return { id: s.id, date: s.date, className: classNameOf(row) }
    })
    .sort((a, b) => a.date.localeCompare(b.date))

  const present = rows.reduce((sum, r) => sum + r.present, 0)
  const absent = rows.reduce((sum, r) => sum + r.absent, 0)
  const notified = rows.reduce((sum, r) => sum + r.notified, 0)
  const denominator = present + absent + notified

  return {
    rows,
    sessionsCount: counted.length,
    unrecorded,
    totals: {
      present, absent, notified,
      rate: denominator === 0 ? 0 : Math.round((present / denominator) * 100),
    },
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: nenhum erro em `features/relatorios/query.ts`. (Os erros pré-existentes em `*.test.ts` de `lib/branding`, `lib/torneios/schedule` e `types/index.test.ts` continuam e não são deste trabalho.)

- [ ] **Step 3: Commit**

```bash
git add features/relatorios/query.ts
git commit -m "feat(frequencia): camada de consulta do relatorio"
```

---

### Task 4: Área de permissão e item de menu

**Files:**
- Modify: `lib/org/permissions.ts`
- Modify: `lib/org/permissions.test.ts`
- Modify: `app/(admin)/layout.tsx:79-89`

- [ ] **Step 1: Write the failing test**

Em `lib/org/permissions.test.ts`, adicione dentro do `describe` existente:

```ts
  it('professor vê relatórios', () => {
    expect(canAccessArea('relatorios', false)).toBe(true)
  })

  it('dono vê relatórios', () => {
    expect(canAccessArea('relatorios', true)).toBe(true)
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- lib/org/permissions.test.ts`
Expected: FAIL — erro de tipo: `'relatorios'` não é atribuível a `AdminArea`.

- [ ] **Step 3: Add the area**

Em `lib/org/permissions.ts`, troque o tipo:

```ts
export type AdminArea =
  | 'dashboard' | 'aulas' | 'alunos' | 'notificacoes' | 'torneios'
  | 'financeiro' | 'configuracoes' | 'equipe' | 'integracoes' | 'relatorios'
```

`OWNER_ONLY` fica inalterado — o professor precisa ver a frequência das turmas dele.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- lib/org/permissions.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the menu item**

Em `app/(admin)/layout.tsx`, no array `allNav`, insira logo depois de `/admin/grade`:

```ts
    { href: '/admin/relatorios', label: 'Relatórios', area: 'relatorios' },
```

O menu mobile (`AdminMobileNav`) recebe o mesmo array via prop `links`, então não precisa de outra alteração.

- [ ] **Step 6: Commit**

```bash
git add lib/org/permissions.ts lib/org/permissions.test.ts "app/(admin)/layout.tsx"
git commit -m "feat(frequencia): area relatorios no painel"
```

---

### Task 5: Tabela ordenável (client)

**Files:**
- Create: `features/relatorios/FrequencyTable.tsx`

- [ ] **Step 1: Write the implementation**

Create `features/relatorios/FrequencyTable.tsx`:

```tsx
// features/relatorios/FrequencyTable.tsx
'use client'
import { useState } from 'react'
import { cn } from '@/lib/utils/cn'
import type { FrequencyRow } from './query'

type SortKey = 'rate' | 'present' | 'absent' | 'notified' | 'name'

const COLUMNS: { key: SortKey; label: string; numeric: boolean }[] = [
  { key: 'name', label: 'Aluno', numeric: false },
  { key: 'present', label: 'Presenças', numeric: true },
  { key: 'absent', label: 'Faltas', numeric: true },
  { key: 'notified', label: 'Avisou', numeric: true },
  { key: 'rate', label: 'Aproveit.', numeric: true },
]

export function FrequencyTable({ rows }: { rows: FrequencyRow[] }) {
  const [sort, setSort] = useState<SortKey>('rate')

  const sorted = [...rows].sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name, 'pt-BR')
    return b[sort] - a[sort] || a.name.localeCompare(b.name, 'pt-BR')
  })

  if (rows.length === 0) {
    return (
      <p className="glass rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-slate-400">
        Nenhuma aula com aluno previsto neste período.
      </p>
    )
  }

  return (
    <div className="glass overflow-x-auto rounded-2xl border border-white/[0.07]">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/[0.07]">
            {COLUMNS.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={cn('px-3 py-2.5', col.numeric ? 'text-right' : 'text-left')}
              >
                <button
                  type="button"
                  onClick={() => setSort(col.key)}
                  className={cn(
                    'text-[10px] font-bold uppercase tracking-wider transition-colors',
                    sort === col.key ? 'text-brand-400' : 'text-slate-400 hover:text-white',
                  )}
                >
                  {col.label}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            // Falta sem aviso é o sinal que interessa: rótulo textual, não só cor.
            const alerta = row.absent > 0 && row.absent >= row.present
            return (
              <tr key={row.studentId} className="border-b border-white/[0.04] last:border-0">
                <td className="px-3 py-2.5">
                  <span className="font-medium text-white">{row.name}</span>
                  {alerta && (
                    <span className="ml-2 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                      faltando muito
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-right text-emerald-300">{row.present}</td>
                <td className="px-3 py-2.5 text-right text-slate-200">{row.absent}</td>
                <td className="px-3 py-2.5 text-right text-slate-400">{row.notified}</td>
                <td className="px-3 py-2.5 text-right font-bold text-white">{row.rate}%</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: nenhum erro novo.

- [ ] **Step 3: Commit**

```bash
git add features/relatorios/FrequencyTable.tsx
git commit -m "feat(frequencia): tabela ordenavel por aluno"
```

---

### Task 6: Tela do painel `/admin/relatorios`

**Files:**
- Create: `app/(admin)/admin/relatorios/page.tsx`

- [ ] **Step 1: Write the implementation**

Create `app/(admin)/admin/relatorios/page.tsx`:

```tsx
// app/(admin)/admin/relatorios/page.tsx
export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { CalendarCheck, UserCheck, UserX, BellRing } from 'lucide-react'
import { getCurrentOrgId } from '@/lib/supabase/server'
import { getFrequencyReport } from '@/features/relatorios/query'
import { FrequencyTable } from '@/features/relatorios/FrequencyTable'
import { StatCard } from '@/components/ui/StatCard'
import { Reveal } from '@/components/ui/Reveal'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { getWeekWindow, getMonthWindow, shiftWindow, type WindowKind } from '@/lib/utils/monthWindow'
import { formatDate } from '@/lib/utils/dateHelpers'

interface PageProps {
  searchParams: { periodo?: string; offset?: string }
}

export default async function RelatoriosPage({ searchParams }: PageProps) {
  const orgId = await getCurrentOrgId()
  const kind: WindowKind = searchParams.periodo === 'mes' ? 'month' : 'week'
  const offset = Number.parseInt(searchParams.offset ?? '0', 10) || 0

  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  const current = kind === 'week' ? getWeekWindow(now) : getMonthWindow(now)
  const window = offset === 0 ? current : shiftWindow(current, kind, offset)

  const report = await getFrequencyReport(orgId, window, today)

  const label = kind === 'week'
    ? `${formatDate(window.from, "dd 'de' MMM")} – ${formatDate(window.to, "dd 'de' MMM")}`
    : formatDate(window.from, "MMMM 'de' yyyy")

  const linkFor = (nextKind: WindowKind, nextOffset: number) =>
    `/admin/relatorios?periodo=${nextKind === 'week' ? 'semana' : 'mes'}&offset=${nextOffset}`

  return (
    <div className="space-y-6">
      <Reveal step={0}>
        <div>
          <h1 className="text-2xl font-bold text-white">Relatório de frequência</h1>
          <p className="mt-1 text-sm text-slate-400">
            Quem está vindo às aulas. A presença é assumida para quem estava previsto — marque a
            falta na chamada para corrigir.
          </p>
        </div>
      </Reveal>

      {/* Período */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-2">
          {(['week', 'month'] as WindowKind[]).map((k) => (
            <Link
              key={k}
              href={linkFor(k, 0)}
              className={
                'rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ' +
                (kind === k
                  ? 'bg-brand-600 text-white'
                  : 'border border-white/[0.08] bg-white/[0.04] text-slate-400 hover:text-white')
              }
            >
              {k === 'week' ? 'Semana' : 'Mês'}
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={linkFor(kind, offset - 1)}
            className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-xs text-slate-300 hover:text-white"
          >
            ← anterior
          </Link>
          <span className="text-sm font-semibold capitalize text-white">{label}</span>
          {offset < 0 && (
            <Link
              href={linkFor(kind, offset + 1)}
              className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-xs text-slate-300 hover:text-white"
            >
              seguinte →
            </Link>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Aulas no período" value={report.sessionsCount} icon={CalendarCheck} step={1} />
        <StatCard label="Presenças" value={report.totals.present} icon={UserCheck} step={2} />
        <StatCard label="Faltas" value={report.totals.absent} icon={UserX} step={3} />
        <StatCard label="Comparecimento" value={report.totals.rate} suffix="%" icon={BellRing} step={4} />
      </div>

      <Reveal step={5} as="section">
        <SectionHeader title="Por aluno" />
        <FrequencyTable rows={report.rows} />
      </Reveal>

      {report.unrecorded.length > 0 && (
        <Reveal step={6} as="section">
          <SectionHeader title="Aulas sem chamada" />
          <p className="mb-3 text-xs text-slate-400">
            Nestas aulas todo mundo entrou como presente. Se alguém faltou — ou a aula não
            aconteceu — ajuste na chamada.
          </p>
          <div className="space-y-2">
            {report.unrecorded.map((session) => (
              <Link key={session.id} href={`/admin/grade/${session.id}`} className="group block">
                <div className="glass flex items-center justify-between gap-3 rounded-2xl border border-white/[0.07] p-3.5 transition-all group-hover:-translate-y-0.5 group-hover:border-brand-600/40">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">{session.className}</p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {formatDate(session.date, "EEE, dd 'de' MMM")}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs font-semibold text-brand-400">Fazer chamada →</span>
                </div>
              </Link>
            ))}
          </div>
        </Reveal>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify in the browser**

Run: `npm run dev` e acesse `/admin/relatorios` com uma conta de academia.
Expected: a tela carrega; com o corte em `2026-07-23` e nenhuma aula posterior, os números vêm zerados e a tabela mostra "Nenhuma aula com aluno previsto neste período" — comportamento correto, não é bug.

Para conferir com dado real, troque temporariamente `ATTENDANCE_TRACKING_START` para `'2026-01-01'`, recarregue, confirme que a tabela preenche, e **desfaça a alteração antes de commitar**.

- [ ] **Step 3: Commit**

```bash
git add "app/(admin)/admin/relatorios/page.tsx"
git commit -m "feat(frequencia): tela de relatorio no painel"
```

---

### Task 7: Fechar o furo da chamada

A chamada monta a lista só com reservas confirmadas. Aluno fixo sem reserva gerada nunca aparece, então a falta dele nunca é registrada e o relatório herda o furo.

**Files:**
- Modify: `app/(admin)/admin/grade/[sessionId]/page.tsx:40-48`

- [ ] **Step 1: Substituir a origem da lista**

Em `app/(admin)/admin/grade/[sessionId]/page.tsx`, troque o bloco que busca as reservas (linhas ~40-48) por:

```ts
  // Quem a aula toca: reservas confirmadas + alunos fixos da turma, menos quem
  // avisou que não vem. Mesma regra da agenda do aluno — sem isso o fixo sem
  // reserva gerada não aparece na chamada e a falta dele nunca é registrada.
  const { data: bookings } = await adminClient
    .from('session_bookings')
    .select('student_id, status')
    .eq('session_id', params.sessionId)
    .eq('organization_id', orgId)
    .in('status', ['confirmed', 'cancelled'])

  const bookingRows = (bookings ?? []) as { student_id: string; status: string }[]
  const confirmedIds = bookingRows.filter((b) => b.status === 'confirmed').map((b) => b.student_id)
  const optedOut = new Set(bookingRows.filter((b) => b.status === 'cancelled').map((b) => b.student_id))

  const { data: fixedRaw } = await adminClient
    .from('enrollments')
    .select('student_id')
    .eq('class_id', typedSession.class_id)
    .eq('organization_id', orgId)
    .eq('is_active', true)

  const fixedIds = ((fixedRaw ?? []) as { student_id: string }[]).map((e) => e.student_id)

  const studentIds = Array.from(
    new Set([...confirmedIds, ...fixedIds.filter((id) => !optedOut.has(id))]),
  )
```

O restante da página já usa `studentIds` e continua funcionando sem alteração.

- [ ] **Step 2: Verify in the browser**

Run: `npm run dev`, abra uma sessão de turma que tenha aluno fixo sem reserva em `/admin/grade/<sessionId>`.
Expected: o aluno fixo aparece na lista da chamada. Confirmar a chamada grava `attendance` para ele.

- [ ] **Step 3: Run the suite**

Run: `npm run test:run`
Expected: PASS (nenhum teste cobre esta página; a suíte não pode regredir).

- [ ] **Step 4: Commit**

```bash
git add "app/(admin)/admin/grade/[sessionId]/page.tsx"
git commit -m "fix(chamada): lista inclui aluno fixo sem reserva gerada"
```

---

### Task 8: Frequência do aluno

**Files:**
- Create: `features/relatorios/StudentFrequencyCard.tsx`
- Modify: `app/(dashboard)/home/page.tsx`
- Modify: `app/(dashboard)/perfil/page.tsx`

- [ ] **Step 1: Write the card**

Create `features/relatorios/StudentFrequencyCard.tsx`:

```tsx
// features/relatorios/StudentFrequencyCard.tsx
import { ProgressRing } from '@/components/ui/ProgressRing'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import type { StudentTotals } from '@/lib/utils/attendanceReport'

/**
 * Frequência do próprio aluno. Presença presumida não é rotulada como tal para
 * ele — a distinção existe para o professor decidir se corrige.
 */
export function StudentFrequencyCard({
  totals,
  periodLabel,
}: {
  totals: StudentTotals | null
  periodLabel: string
}) {
  if (!totals || totals.expected === 0) {
    return (
      <div className="glass rounded-2xl border border-white/[0.07] p-4">
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
          Sua frequência · {periodLabel}
        </p>
        <p className="mt-2 text-sm text-slate-400">Nenhuma aula registrada neste período ainda.</p>
      </div>
    )
  }

  return (
    <div className="glass rounded-2xl border border-white/[0.07] p-4">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
        Sua frequência · {periodLabel}
      </p>
      <div className="mt-3 flex items-center gap-4">
        <ProgressRing percent={totals.rate} size={64} strokeWidth={6}>
          <span className="text-sm font-extrabold text-white">
            <AnimatedNumber value={totals.rate} suffix="%" />
          </span>
        </ProgressRing>
        <dl className="grid flex-1 grid-cols-3 gap-2 text-center">
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-slate-400">Presenças</dt>
            <dd className="text-lg font-extrabold text-emerald-300">
              <AnimatedNumber value={totals.present} />
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-slate-400">Faltas</dt>
            <dd className="text-lg font-extrabold text-white">
              <AnimatedNumber value={totals.absent} />
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-slate-400">Avisou</dt>
            <dd className="text-lg font-extrabold text-slate-300">
              <AnimatedNumber value={totals.notified} />
            </dd>
          </div>
        </dl>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add the student query helper**

Em `features/relatorios/query.ts`, acrescente ao final:

```ts
/** Totais de um aluno só, no período. Reusa a mesma regra do painel. */
export async function getStudentFrequency(
  orgId: string,
  studentId: string,
  window: DateWindow,
  today: string,
): Promise<StudentTotals | null> {
  const report = await getFrequencyReport(orgId, window, today)
  return report.rows.find((r) => r.studentId === studentId) ?? null
}
```

- [ ] **Step 3: Show it on the Home**

Em `app/(dashboard)/home/page.tsx`, adicione os imports:

```ts
import { getStudentFrequency } from '@/features/relatorios/query'
import { StudentFrequencyCard } from '@/features/relatorios/StudentFrequencyCard'
```

Depois do bloco que calcula `checkinProgress`, acrescente:

```ts
  const monthWindow = getMonthWindow(new Date())
  const frequency = orgId ? await getStudentFrequency(orgId, user.id, monthWindow, today) : null
```

`getMonthWindow` já está importado no arquivo (usado pelo check-in de parceiro).

No JSX, logo depois do bloco `{isPartner && checkinProgress && (...)}`, insira:

```tsx
      <Reveal step={2}>
        <StudentFrequencyCard totals={frequency} periodLabel={formatDate(today, 'MMMM')} />
      </Reveal>
```

- [ ] **Step 4: Show it on the Perfil**

Em `app/(dashboard)/perfil/page.tsx`, adicione os imports:

```ts
import { getStudentFrequency } from '@/features/relatorios/query'
import { StudentFrequencyCard } from '@/features/relatorios/StudentFrequencyCard'
import { getMonthWindow } from '@/lib/utils/monthWindow'
import { formatDate } from '@/lib/utils/dateHelpers'
```

Antes do `return`, calcule mês e ano:

```ts
  const hoje = new Date().toISOString().slice(0, 10)
  const anoWindow = { from: `${hoje.slice(0, 4)}-01-01`, to: `${hoje.slice(0, 4)}-12-31` }
  const [freqMes, freqAno] = orgId
    ? await Promise.all([
        getStudentFrequency(orgId, user.id, getMonthWindow(new Date()), hoje),
        getStudentFrequency(orgId, user.id, anoWindow, hoje),
      ])
    : [null, null]
```

`orgId` já existe nesta página (`app/(dashboard)/perfil/page.tsx:25`, vindo de
`getActiveOrgId()`) — reaproveite, não crie outro.

No JSX, antes da seção "Plano Ativo", insira:

```tsx
      <section className="space-y-3">
        <SectionHeader title="Minha frequência" />
        <StudentFrequencyCard totals={freqMes} periodLabel={formatDate(hoje, 'MMMM')} />
        <StudentFrequencyCard totals={freqAno} periodLabel={hoje.slice(0, 4)} />
      </section>
```

- [ ] **Step 5: Typecheck and run the suite**

Run: `npx tsc --noEmit`
Expected: nenhum erro novo fora dos `*.test.ts` pré-existentes.

Run: `npm run test:run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add features/relatorios/StudentFrequencyCard.tsx features/relatorios/query.ts "app/(dashboard)/home/page.tsx" "app/(dashboard)/perfil/page.tsx"
git commit -m "feat(frequencia): visao do aluno na home e no perfil"
```

---

### Task 9: Verificação final e FAQ

**Files:**
- Modify: `docs/faq/academia.md`
- Modify: `docs/faq/aluno.md`
- Modify: `docs/faq/capture.mjs`

- [ ] **Step 1: Run the full verification**

```bash
npm run lint
npm run test:run
npm run build
```
Expected: lint só com os 4 avisos pré-existentes de `<img>`; testes todos passando; build compilando.

- [ ] **Step 2: Add the capture step**

Em `docs/faq/capture.mjs`, na seção do admin (depois da linha que captura `/admin/grade`), acrescente:

```js
await capture(admin, '/admin/relatorios', 'admin-relatorios')
```

- [ ] **Step 3: Document it for the academy**

Em `docs/faq/academia.md`, acrescente uma seção nova depois da seção da Grade:

```markdown
## Relatório de frequência

Em **Relatórios** você vê quem está vindo às aulas, por semana ou por mês.

![Relatório de frequência](images/admin-relatorios.png)

- **Presenças, faltas e avisos** por aluno, com o aproveitamento (presenças ÷ aulas previstas).
- **Aulas sem chamada** — nessas, todo mundo entrou como presente. É onde você corrige.

> **🔧 Nos bastidores**
> - A presença é **presumida**: quem estava previsto numa aula que já passou conta como presente até você marcar a falta na chamada. Isso faz o relatório existir mesmo sem chamada diária.
> - Quem avisou que não vem (saiu da aula pelo app antes dela começar) conta como **aviso**, separado de falta.
> - A contagem começa na data em que a frequência passou a ser rastreada — aulas anteriores aparecem como sem registro.
```

- [ ] **Step 4: Document it for the student**

Em `docs/faq/aluno.md`, na seção **2. Home**, acrescente ao final da lista de bullets:

```markdown
- **Sua frequência** — presenças, faltas e aproveitamento do mês. O detalhe por mês e por ano fica no **Perfil**.
```

- [ ] **Step 5: Regenerate the FAQ prints**

```bash
npm run dev   # em outro terminal
node docs/faq/capture.mjs
cp docs/faq/images/*.png public/faq/images/
```
Expected: todas as etapas OK e `admin-relatorios.png` gerado.

> As imagens do manual são servidas de `public/faq/images/`, não de `docs/`. Regerar só `docs/` deixa o manual publicado mostrando as telas antigas.

- [ ] **Step 6: Commit**

```bash
git add docs/faq public/faq/images
git commit -m "docs(faq): relatorio de frequencia nos manuais e prints"
```

---

## Auto-revisão do plano

**Cobertura do spec:**

| Requisito do spec | Task |
|---|---|
| Regra de classificação (3 estados, presunção, attendance vence) | 1 |
| Janela da matrícula (`enrolled_at` / `cancelled_at`) | 1 |
| Aproveitamento com aviso no denominador | 1 |
| Aula de hoje fora, corte temporal | 1 |
| `ATTENDANCE_TRACKING_START` + `organizations.created_at` | 1, 3 |
| Camada de consulta | 3 |
| Área `relatorios` (professor vê) e menu | 4 |
| Semana/mês com navegação | 2, 6 |
| Faixa de números | 6 |
| Tabela ordenável, padrão por aproveitamento, rótulo textual | 5 |
| Aulas sem registro com atalho para a chamada | 3, 6 |
| Furo da chamada (fixo sem reserva) | 7 |
| Card na Home + seção no Perfil (mês e ano) | 8 |
| Aluno sem aula prevista fora da tabela | 1 (`expected === 0` não entra) |
| Testes da regra pura | 1 |
| Verificação + FAQ | 9 |

**Sem placeholders:** todo passo que muda código traz o código.

**Consistência de tipos:** `StudentTotals` (Task 1) é estendido por `FrequencyRow` (Task 3), consumido por `FrequencyTable` (5) e `StudentFrequencyCard` (8). `DateWindow`/`WindowKind` (Task 2) são usados em 3 e 6. `buildAttendanceReport` tem a mesma assinatura em 1 e 3.
