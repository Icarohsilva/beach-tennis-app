'use server'
// features/aulas/waitlistActions.ts

import { createClient, createAdminClient } from '@/lib/supabase/server'
import type { WaitlistStatus } from '@/types'

// ---------------------------------------------------------------------------
// offerWaitlistSpot — called when a spot opens (cancellation or cron)
// ---------------------------------------------------------------------------

export async function offerWaitlistSpot(sessionId: string): Promise<void> {
  const adminClient = createAdminClient()

  // Find next 'waiting' entry (lowest position, then earliest joined_at)
  const { data: next } = await adminClient
    .from('waitlists')
    .select('id, student_id, session_id')
    .eq('session_id', sessionId)
    .eq('status', 'waiting')
    .order('position', { ascending: true })
    .order('joined_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!next) return // No one waiting

  const now = new Date().toISOString()

  // Offer the spot
  await adminClient
    .from('waitlists')
    .update({ status: 'offered' as WaitlistStatus, notified_at: now })
    .eq('id', next.id)

  // Fetch session info for notification body
  const { data: session } = await adminClient
    .from('class_sessions')
    .select('session_date, class:classes(name)')
    .eq('id', sessionId)
    .single()

  const classRaw = Array.isArray(session?.class) ? session!.class[0] : session?.class
  const className = (classRaw as { name: string } | null)?.name ?? 'sua aula'

  const deadline = new Date(Date.now() + 60 * 60 * 1000)
  const deadlineStr = deadline.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

  // Insert in-app notification
  await adminClient.from('notifications').insert({
    user_id: next.student_id,
    type: 'waitlist_offer',
    title: 'Vaga disponível!',
    body: `Uma vaga abriu em ${className} (${session?.session_date}). Confirme sua presença até ${deadlineStr}.`,
    read: false,
  })
}

// ---------------------------------------------------------------------------
// joinWaitlist — student joins the waitlist for a full session
// ---------------------------------------------------------------------------

export async function joinWaitlist(sessionId: string): Promise<{ error?: string }> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const adminClient = createAdminClient()

  // Fetch session + class
  const { data: session } = await adminClient
    .from('class_sessions')
    .select('id, status, class:classes(max_students)')
    .eq('id', sessionId)
    .single()

  if (!session) return { error: 'Sessão não encontrada.' }
  if (session.status !== 'scheduled') return { error: 'Esta sessão não está disponível.' }

  const classRaw = Array.isArray(session.class) ? session.class[0] : session.class
  const maxStudents = (classRaw as { max_students: number } | null)?.max_students ?? 0

  // Confirm session is actually full
  const { count: bookedCount } = await adminClient
    .from('session_bookings')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId)
    .eq('status', 'confirmed')

  if ((bookedCount ?? 0) < maxStudents) {
    return { error: 'Esta sessão ainda tem vagas. Use o agendamento normal.' }
  }

  // Check no existing booking
  const { count: existingBooking } = await adminClient
    .from('session_bookings')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId)
    .eq('student_id', user.id)
    .eq('status', 'confirmed')

  if ((existingBooking ?? 0) > 0) {
    return { error: 'Você já tem um agendamento nesta sessão.' }
  }

  // Check no existing waitlist entry
  const { count: existingWaitlist } = await adminClient
    .from('waitlists')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId)
    .eq('student_id', user.id)
    .in('status', ['waiting', 'offered'])

  if ((existingWaitlist ?? 0) > 0) {
    return { error: 'Você já está na lista de espera desta sessão.' }
  }

  // Calculate position (count of active waitlist entries + 1)
  const { count: activeCount } = await adminClient
    .from('waitlists')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId)
    .in('status', ['waiting', 'offered'])

  const position = (activeCount ?? 0) + 1

  // Check waitlist capacity (max = max_students)
  if (position > maxStudents) {
    return { error: 'A lista de espera para esta sessão está cheia.' }
  }

  const { error: insertErr } = await adminClient.from('waitlists').insert({
    session_id: sessionId,
    student_id: user.id,
    position,
  })

  if (insertErr) return { error: 'Erro ao entrar na lista de espera. Tente novamente.' }

  return {}
}

// ---------------------------------------------------------------------------
// leaveWaitlist — student voluntarily leaves the queue
// ---------------------------------------------------------------------------

export async function leaveWaitlist(waitlistId: string): Promise<{ error?: string }> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const adminClient = createAdminClient()

  const { data: entry } = await adminClient
    .from('waitlists')
    .select('id, student_id, status, session_id')
    .eq('id', waitlistId)
    .single()

  if (!entry) return { error: 'Entrada não encontrada.' }
  if (entry.student_id !== user.id) return { error: 'Sem permissão.' }
  if (!['waiting', 'offered'].includes(entry.status)) {
    return { error: 'Você não está mais na lista de espera.' }
  }

  await adminClient
    .from('waitlists')
    .update({ status: 'cancelled' as WaitlistStatus })
    .eq('id', waitlistId)

  // If they had an offered spot, advance queue to next person
  if (entry.status === 'offered') {
    await offerWaitlistSpot(entry.session_id)
  }

  return {}
}

// ---------------------------------------------------------------------------
// acceptWaitlistSpot — student confirms the offered spot
// ---------------------------------------------------------------------------

export async function acceptWaitlistSpot(waitlistId: string): Promise<{ error?: string }> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const adminClient = createAdminClient()

  // Fetch waitlist entry
  const { data: entry } = await adminClient
    .from('waitlists')
    .select('id, session_id, student_id, status, notified_at')
    .eq('id', waitlistId)
    .single()

  if (!entry) return { error: 'Entrada não encontrada.' }
  if (entry.student_id !== user.id) return { error: 'Sem permissão.' }
  if (entry.status !== 'offered') return { error: 'Esta vaga não está mais disponível.' }

  // Check 1-hour acceptance window
  if (!entry.notified_at) return { error: 'Erro interno: notified_at ausente.' }
  const notifiedAt = new Date(entry.notified_at)
  const deadline = new Date(notifiedAt.getTime() + 60 * 60 * 1000)
  if (new Date() > deadline) {
    return { error: 'O prazo para confirmar a vaga expirou.' }
  }

  // Verify session still has capacity
  const { data: session } = await adminClient
    .from('class_sessions')
    .select('id, status, class:classes(max_students)')
    .eq('id', entry.session_id)
    .single()

  if (!session || session.status !== 'scheduled') {
    return { error: 'Esta sessão não está mais disponível.' }
  }

  const classRaw = Array.isArray(session.class) ? session.class[0] : session.class
  const maxStudents = (classRaw as { max_students: number } | null)?.max_students ?? 0

  const { count: bookedCount } = await adminClient
    .from('session_bookings')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', entry.session_id)
    .eq('status', 'confirmed')

  if ((bookedCount ?? 0) >= maxStudents) {
    // Another booking slipped in — expire and advance queue
    await adminClient
      .from('waitlists')
      .update({ status: 'expired' as WaitlistStatus })
      .eq('id', waitlistId)
    await offerWaitlistSpot(entry.session_id)
    return { error: 'A vaga foi preenchida. O próximo da fila será notificado.' }
  }

  // Create the booking directly (validations already passed at joinWaitlist time)
  const { error: bookingErr } = await adminClient.from('session_bookings').insert({
    student_id: user.id,
    session_id: entry.session_id,
    type: 'extra',
    status: 'confirmed',
    from_enrollment: false,
    credit_used: false,
    booked_at: new Date().toISOString(),
  })

  if (bookingErr) return { error: 'Erro ao criar agendamento. Tente novamente.' }

  // Mark waitlist entry as accepted
  await adminClient
    .from('waitlists')
    .update({ status: 'accepted' as WaitlistStatus })
    .eq('id', waitlistId)

  return {}
}
