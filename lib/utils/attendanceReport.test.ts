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

  it('inclui a sessão exatamente na data do corte', () => {
    const input = base()
    input.trackingStart = '2026-07-20'
    expect(buildAttendanceReport(input)[0]).toMatchObject({ present: 1 })
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

  it('conta a sessão anterior ao cancelamento da matrícula', () => {
    const input = base()
    input.enrollments = [{ studentId: 'ana', classId: 'c1', enrolledAt: '2026-01-01', cancelledAt: '2026-07-21' }]
    expect(buildAttendanceReport(input)[0]).toMatchObject({ present: 1 })
  })

  it('não conta a aula do próprio dia em que a matrícula foi cancelada', () => {
    const input = base()
    input.enrollments = [{ studentId: 'ana', classId: 'c1', enrolledAt: '2026-01-01', cancelledAt: '2026-07-20' }]
    expect(buildAttendanceReport(input)).toEqual([])
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
