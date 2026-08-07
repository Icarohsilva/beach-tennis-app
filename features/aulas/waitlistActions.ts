'use server'
// features/aulas/waitlistActions.ts

import { revalidatePath } from 'next/cache'
import { createClient, createAdminClient, getActiveOrgId, getActiveMembership } from '@/lib/supabase/server'
import type { WaitlistStatus, StudentLevel, ClassType } from '@/types'
import * as Sentry from '@sentry/nextjs'
import { notifyUsers } from '@/lib/notifications/dispatch'

// ---------------------------------------------------------------------------
// notifyWaitlistSpotOpen — avisa a fila inteira quando uma vaga abre
// ---------------------------------------------------------------------------

/**
 * Avisa TODA a fila de espera de que uma vaga abriu. A vaga fica com quem
 * entrar primeiro — não há oferta individual nem reserva temporária.
 *
 * O modelo anterior oferecia a vaga a uma pessoa por vez, com 1h para aceitar,
 * e dependia de um cron para expirar a oferta e passar para a próxima. Como o
 * plano Hobby da Vercel só permite cron 1x/dia, uma oferta não aceita segurava
 * a fila por até ~24h e a vaga morria sem ninguém usar. Notificando todo mundo
 * de uma vez a fila não trava: a corrida é resolvida no próprio agendamento,
 * que é atômico (book_session_atomic + advisory lock), então quem chega depois
 * do último lugar recebe SESSION_FULL e continua na fila para a próxima vaga.
 */
export async function notifyWaitlistSpotOpen(sessionId: string): Promise<void> {
  const adminClient = createAdminClient()

  const { data: waiting } = await adminClient
    .from('waitlists')
    .select('id, student_id')
    .eq('session_id', sessionId)
    .eq('status', 'waiting')
    .order('joined_at', { ascending: true })

  const entries = (waiting ?? []) as { id: string; student_id: string }[]
  if (entries.length === 0) return

  const { data: session } = await adminClient
    .from('class_sessions')
    .select('organization_id, session_date, class:classes(name)')
    .eq('id', sessionId)
    .single()

  const classRaw = Array.isArray(session?.class) ? session!.class[0] : session?.class
  const className = (classRaw as { name: string } | null)?.name ?? 'sua aula'

  const title = 'Vaga disponível!'
  const body =
    `Abriu uma vaga em ${className} (${session?.session_date}). ` +
    'A vaga é de quem entrar primeiro — abra o app e garanta a sua.'

  const studentIds = entries.map((e) => e.student_id)

  // Best-effort: falha de notificação não pode derrubar o cancelamento que a
  // originou (chamada fire-and-forget por cancelBooking/skipEnrollmentSession).
  try {
    const { data: profiles } = await adminClient
      .from('profiles')
      .select('id, phone')
      .in('id', studentIds)
    const { data: emailRows } = await adminClient
      .from('user_emails')
      .select('id, email')
      .in('id', studentIds)

    const phoneById = new Map(
      ((profiles ?? []) as { id: string; phone: string | null }[]).map((p) => [p.id, p.phone]),
    )
    const emailById = new Map(
      ((emailRows ?? []) as { id: string; email: string }[]).map((e) => [e.id, e.email]),
    )

    await notifyUsers(adminClient, {
      orgId: session?.organization_id as string,
      recipients: studentIds.map((id) => ({
        userId: id,
        email: emailById.get(id) ?? null,
        phone: phoneById.get(id) ?? null,
      })),
      type: 'waitlist_offer',
      title,
      body,
      channels: ['inapp', 'email', 'whatsapp', 'push'],
    })

    // Marca d'água de quando a fila foi avisada — o painel do professor usa
    // para mostrar que todo mundo já foi chamado para esta vaga.
    await adminClient
      .from('waitlists')
      .update({ notified_at: new Date().toISOString() })
      .in('id', entries.map((e) => e.id))
  } catch (err) {
    console.error('[notifyWaitlistSpotOpen] notifyUsers falhou', {
      sessionId,
      recipients: studentIds.length,
      error: err instanceof Error ? err.message : String(err),
    })
    Sentry.captureException(err, {
      tags: { channel: 'dispatch', notificationType: 'waitlist_offer' },
      extra: { sessionId, recipients: studentIds.length },
    })
  }
}

// ---------------------------------------------------------------------------
// clearWaitlistEntry — tira o aluno da fila quando ele consegue entrar na aula
// ---------------------------------------------------------------------------

/**
 * Encerra a entrada ativa do aluno na fila daquela sessão. Chamado depois de um
 * agendamento bem-sucedido: entrar na aula sai da fila, por qualquer porta
 * (botão da fila ou agendamento normal). Nunca lança — a reserva já está feita
 * e não pode ser desfeita por causa da limpeza da fila.
 */
export async function clearWaitlistEntry(sessionId: string, studentId: string): Promise<void> {
  try {
    const adminClient = createAdminClient()
    await adminClient
      .from('waitlists')
      .update({ status: 'accepted' as WaitlistStatus })
      .eq('session_id', sessionId)
      .eq('student_id', studentId)
      .in('status', ['waiting', 'offered'])
  } catch (err) {
    console.error('[clearWaitlistEntry] falhou', {
      sessionId, studentId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

// ---------------------------------------------------------------------------
// joinWaitlist — student joins the waitlist for a full session
// ---------------------------------------------------------------------------

export async function joinWaitlist(
  sessionId: string,
): Promise<{ error?: string; position?: number }> {
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

  // Entradas mortas (saiu da fila / perdeu o prazo) de tentativas anteriores.
  // A unicidade hoje é parcial (só status ativos), mas limpar mantém o histórico
  // da sessão enxuto e evita depender da versão do índice em cada ambiente.
  await adminClient
    .from('waitlists')
    .delete()
    .eq('session_id', sessionId)
    .eq('student_id', user.id)
    .in('status', ['cancelled', 'expired'])

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

  // Confirmação de entrada na fila: sem isto o aluno só recebe notificação se e
  // quando uma vaga abrir, e fica sem saber se a entrada valeu nem que lugar pegou.
  // Best-effort — a fila já está gravada, notificação não pode derrubar a ação.
  try {
    const { data: sessionInfo } = await adminClient
      .from('class_sessions')
      .select('session_date, class:classes(name)')
      .eq('id', sessionId)
      .single()
    const clsRaw = Array.isArray(sessionInfo?.class) ? sessionInfo!.class[0] : sessionInfo?.class
    const className = (clsRaw as { name: string } | null)?.name ?? 'sua aula'

    await notifyUsers(adminClient, {
      orgId,
      recipients: [{ userId: user.id }],
      type: 'waitlist_joined',
      title: 'Você entrou na lista de espera',
      body:
        `Você é o ${position}º da fila em ${className} (${sessionInfo?.session_date}). ` +
        'Se abrir uma vaga, avisamos todo mundo da fila — a vaga fica com quem entrar primeiro.',
      channels: ['inapp', 'push'],
    })
  } catch (err) {
    console.error('[joinWaitlist] notifyUsers falhou', {
      sessionId, studentId: user.id,
      error: err instanceof Error ? err.message : String(err),
    })
    Sentry.captureException(err, {
      tags: { channel: 'dispatch', notificationType: 'waitlist_joined' },
      extra: { sessionId, studentId: user.id },
    })
  }

  revalidatePath('/home')
  revalidatePath('/agendar')
  return { position }
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

  // Sem avanço de fila aqui: a vaga não fica reservada para ninguém, então sair
  // da fila não libera nada para o próximo — quem continua na fila já foi (ou
  // será) avisado quando houver vaga de verdade.

  revalidatePath('/home')
  revalidatePath('/agendar')
  return {}
}

