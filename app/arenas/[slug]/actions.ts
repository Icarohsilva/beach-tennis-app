'use server'
// app/arenas/[slug]/actions.ts
// Agendamento de aula experimental, escopado por organization_id para isolar
// academias. Movido de app/experimental/actions.ts.

import { createAdminClient } from '@/lib/supabase/server'

export async function createTrialBooking(
  organizationId: string,
  sessionId: string,
  name: string,
  email: string,
  phone: string,
): Promise<{ error?: string; success?: boolean }> {
  if (!name.trim() || !email.trim() || !phone.trim()) {
    return { error: 'Preencha todos os campos.' }
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(email)) {
    return { error: 'E-mail inválido.' }
  }

  const adminClient = createAdminClient()

  // Sessão precisa existir E pertencer a esta academia.
  const { data: session } = await adminClient
    .from('class_sessions')
    .select('id, session_date, status, class:classes(id, name, max_students, type, is_active)')
    .eq('id', sessionId)
    .eq('organization_id', organizationId)
    .single()

  if (!session) return { error: 'Sessão não encontrada.' }
  if (session.status !== 'scheduled') return { error: 'Esta sessão não está disponível.' }

  const cls = Array.isArray(session.class) ? session.class[0] : session.class
  if (!cls?.is_active) return { error: 'Turma inativa.' }
  if (cls?.type === 'kids') return { error: 'Aula experimental disponível apenas para adultos.' }

  // Duplicidade por e-mail na sessão (dentro da org).
  const { count: dupCount } = await adminClient
    .from('trial_bookings')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
    .eq('session_id', sessionId)
    .eq('email', email.trim().toLowerCase())
    .in('status', ['pending', 'attended'])

  if ((dupCount ?? 0) > 0) {
    return { error: 'Já existe um agendamento experimental com este e-mail para esta sessão.' }
  }

  // Capacidade (reservas confirmadas + trials) dentro da org.
  const { count: bookingsCount } = await adminClient
    .from('session_bookings')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
    .eq('session_id', sessionId)
    .eq('status', 'confirmed')

  const { count: trialsCount } = await adminClient
    .from('trial_bookings')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
    .eq('session_id', sessionId)
    .in('status', ['pending', 'attended'])

  const occupied = (bookingsCount ?? 0) + (trialsCount ?? 0)
  if (occupied >= cls.max_students) {
    return { error: 'Esta sessão está lotada.' }
  }

  const { error: insertErr } = await adminClient.from('trial_bookings').insert({
    organization_id: organizationId,
    name: name.trim(),
    email: email.trim().toLowerCase(),
    phone: phone.trim(),
    session_id: sessionId,
    status: 'pending',
    must_pay_next: false,
  })

  if (insertErr) {
    return { error: 'Erro ao criar agendamento. Tente novamente.' }
  }

  return { success: true }
}
