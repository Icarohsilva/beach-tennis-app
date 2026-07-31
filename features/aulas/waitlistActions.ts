'use server'
// features/aulas/waitlistActions.ts

import { revalidatePath } from 'next/cache'
import { createClient, createAdminClient, getActiveOrgId, getActiveMembership } from '@/lib/supabase/server'
import type { WaitlistStatus, StudentLevel, ClassType } from '@/types'
import * as Sentry from '@sentry/nextjs'
import { notifyUsers } from '@/lib/notifications/dispatch'
import {
  countOpenMissedCheckins,
  getMissedCheckinSettings,
} from '@/features/checkin/missedCheckinSettings'
import { isMissedCheckinBlocked } from '@/lib/checkin/missedCheckins'

// ---------------------------------------------------------------------------
// offerWaitlistSpot — called when a spot opens (cancellation or cron)
// ---------------------------------------------------------------------------

export async function offerWaitlistSpot(sessionId: string): Promise<void> {
  const adminClient = createAdminClient()

  // Find next 'waiting' entry (earliest joined_at is source of truth for queue order)
  const { data: next } = await adminClient
    .from('waitlists')
    .select('id, student_id, session_id')
    .eq('session_id', sessionId)
    .eq('status', 'waiting')
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

  // Fetch session info for notification body (org vem da própria sessão)
  const { data: session } = await adminClient
    .from('class_sessions')
    .select('organization_id, session_date, class:classes(name)')
    .eq('id', sessionId)
    .single()

  const classRaw = Array.isArray(session?.class) ? session!.class[0] : session?.class
  const className = (classRaw as { name: string } | null)?.name ?? 'sua aula'

  const deadline = new Date(Date.now() + 60 * 60 * 1000)
  const deadlineStr = deadline.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

  const title = 'Vaga disponível!'
  const body = `Uma vaga abriu em ${className} (${session?.session_date}). Confirme sua presença até ${deadlineStr}.`

  // Best-effort: uma falha de notificacao nao pode derrubar o avanço da fila
  // (offerWaitlistSpot é chamado fire-and-forget por leaveWaitlist/acceptWaitlistSpot).
  try {
    const { data: profile } = await adminClient
      .from('profiles')
      .select('phone')
      .eq('id', next.student_id)
      .single()
    const { data: emailRow } = await adminClient
      .from('user_emails')
      .select('email')
      .eq('id', next.student_id)
      .maybeSingle()

    await notifyUsers(adminClient, {
      orgId: session?.organization_id as string,
      recipients: [{
        userId: next.student_id,
        email: (emailRow as { email: string } | null)?.email ?? null,
        phone: (profile as { phone: string | null } | null)?.phone ?? null,
      }],
      type: 'waitlist_offer',
      title,
      body,
      channels: ['inapp', 'email', 'whatsapp', 'push'],
    })
  } catch (err) {
    console.error('[offerWaitlistSpot] notifyUsers falhou', {
      sessionId, studentId: next.student_id,
      error: err instanceof Error ? err.message : String(err),
    })
    Sentry.captureException(err, {
      tags: { channel: 'dispatch', notificationType: 'waitlist_offer' },
      extra: { sessionId, studentId: next.student_id },
    })
  }
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
  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  // Fetch session + class (escopado pela academia ativa)
  const { data: session } = await adminClient
    .from('class_sessions')
    .select('id, status, class:classes(max_students, level, type)')
    .eq('id', sessionId)
    .eq('organization_id', orgId)
    .single()

  if (!session) return { error: 'Sessão não encontrada.' }
  if (session.status !== 'scheduled') return { error: 'Esta sessão não está disponível.' }

  const clsInfo = (Array.isArray(session.class) ? session.class[0] : session.class) as {
    max_students: number
    level: StudentLevel
    type: ClassType
  } | null
  if (!clsInfo) return { error: 'Turma não encontrada.' }

  // Nível/dependente/pagamento (por-academia) vêm da membership da academia ativa.
  const joinProfile = await getActiveMembership()
  if (!joinProfile) return { error: 'Perfil não encontrado.' }

  if (clsInfo.type === 'kids' && !joinProfile.is_dependent) {
    return { error: 'Esta turma é exclusiva para alunos kids (dependentes).' }
  }

  const maxStudents = clsInfo.max_students

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
    organization_id: orgId,
    session_id: sessionId,
    student_id: user.id,
    position,
  })

  if (insertErr) return { error: 'Erro ao entrar na lista de espera. Tente novamente.' }

  revalidatePath('/home')
  revalidatePath('/agendar')
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

  revalidatePath('/home')
  revalidatePath('/agendar')
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
  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  // Fetch waitlist entry
  const { data: entry } = await adminClient
    .from('waitlists')
    .select('id, session_id, student_id, status, notified_at')
    .eq('id', waitlistId)
    .eq('organization_id', orgId)
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
    .eq('organization_id', orgId)
    .single()

  if (!session || session.status !== 'scheduled') {
    return { error: 'Esta sessão não está mais disponível.' }
  }

  const classRaw = Array.isArray(session.class) ? session.class[0] : session.class
  const maxStudents = (classRaw as { max_students: number } | null)?.max_students ?? 0

  // Limite diário: máx 2 aulas confirmadas na data da sessão
  const { data: sessionDateRow } = await adminClient
    .from('class_sessions')
    .select('session_date')
    .eq('id', entry.session_id)
    .eq('organization_id', orgId)
    .single()

  if (sessionDateRow) {
    const { data: sameDaySessions } = await adminClient
      .from('class_sessions')
      .select('id')
      .eq('session_date', sessionDateRow.session_date)
      .eq('organization_id', orgId)

    const sameDayIds = (sameDaySessions ?? []).map((s: { id: string }) => s.id)
    const { count: dailyCount } = await adminClient
      .from('session_bookings')
      .select('id', { count: 'exact', head: true })
      .eq('student_id', user.id)
      .eq('status', 'confirmed')
      .in('session_id', sameDayIds)

    if ((dailyCount ?? 0) >= 2) {
      return { error: 'Você já atingiu o limite de 2 aulas nessa data.' }
    }
  }

  // Pendência de check-in. A fila de espera é a única porta de reserva que não passa
  // por resolveClassAccess, então a checagem é feita aqui na mão — sem isto, aceitar
  // uma vaga da fila seria o furo do bloqueio.
  const { data: mem } = await adminClient
    .from('memberships')
    .select('partner')
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .maybeSingle()

  if ((mem as { partner: string | null } | null)?.partner) {
    const { blockLimit } = await getMissedCheckinSettings(adminClient, orgId)
    if (blockLimit > 0) {
      const abertas = await countOpenMissedCheckins(adminClient, user.id, orgId)
      if (isMissedCheckinBlocked(abertas, blockLimit)) {
        return {
          error: `Você tem ${abertas} check-in(s) do parceiro em aberto. Regularize em Financeiro para voltar a agendar.`,
        }
      }
    }
  }

  // Insert atômico — se outro booking entrou antes, expira e avança a fila
  const { error: bookingErr } = await adminClient.rpc('book_session_atomic', {
    p_student_id: user.id,
    p_session_id: entry.session_id,
    p_max_students: maxStudents,
  })

  if (bookingErr) {
    if (bookingErr.message.includes('SESSION_FULL')) {
      await adminClient
        .from('waitlists')
        .update({ status: 'expired' as WaitlistStatus })
        .eq('id', waitlistId)
      await offerWaitlistSpot(entry.session_id)
      return { error: 'A vaga foi preenchida. O próximo da fila será notificado.' }
    }
    if (bookingErr.message.includes('ALREADY_BOOKED')) {
      return { error: 'Você já tem um agendamento nesta sessão.' }
    }
    return { error: 'Erro ao criar agendamento. Tente novamente.' }
  }

  // Mark waitlist entry as accepted
  await adminClient
    .from('waitlists')
    .update({ status: 'accepted' as WaitlistStatus })
    .eq('id', waitlistId)

  revalidatePath('/home')
  revalidatePath('/agendar')
  return {}
}
