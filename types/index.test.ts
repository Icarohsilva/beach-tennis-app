import type { Class, DayUseSlot, DayUseBooking } from './index'
import { describe, it, expect } from 'vitest'

// Testes de FORMA: eles existem para quebrar quando um campo obrigatório nasce
// e alguma tela deixa de preenchê-lo. Por isso os literais são completos — um
// fixture incompleto não compila, e um teste que não compila não avisa nada.
describe('types', () => {
  it('Class has court field', () => {
    const c: Class = {
      id: '1', organization_id: 'org', name: 'Terça 18h', description: null,
      level: 'iniciante', sport: null, type: 'adult', day_of_week: 2,
      start_time: '18:00', end_time: '19:00',
      max_students: 8, is_active: true, court: 1,
      gender_restriction: null,
    }
    expect(c.court).toBe(1)
  })

  it('DayUseSlot has required shape', () => {
    const s: DayUseSlot = {
      id: 'abc', organization_id: 'org', court: 2, date: '2026-06-10',
      start_time: '09:00', end_time: '10:00',
      capacity: 8, sport: null, kind: 'scheduled', price_cents: null,
      cover_image_url: null, payment_timing: 'on_site',
      notes: null, is_active: true, recurrence_id: null,
      created_by: 'uid', created_at: '2026-06-01T00:00:00Z',
    }
    expect(s.court).toBe(2)
  })

  it('DayUseBooking status is union type', () => {
    const b: DayUseBooking = {
      id: 'x', organization_id: 'org', slot_id: 'y', student_id: 'z',
      status: 'confirmed',
      booked_at: '2026-06-01T00:00:00Z',
      cancelled_at: null,
      refund_pix_key: null, refund_pix_owner: null,
      payment_method: 'free', hold_until: null,
      receipt_url: null, receipt_uploaded_at: null,
    }
    expect(b.status).toBe('confirmed')
  })
})
