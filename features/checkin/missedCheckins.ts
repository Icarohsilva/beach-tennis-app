// features/checkin/missedCheckins.ts
// Ponto ÚNICO de criação e resolução da pendência de check-in de parceiro — mesmo
// papel que features/financeiro/classDebt.ts tem para a dívida de aula avulsa.
//
// A pendência nasce na FALTA marcada pelo professor, não na reserva: quem cancelou
// com antecedência não deve nada, e não é preciso nenhuma regra para apagar depois.
import * as Sentry from '@sentry/nextjs'
import type { createAdminClient } from '@/lib/supabase/server'
import { notifyUsers } from '@/lib/notifications/dispatch'
import { cancelFutureBookings } from '@/features/aulas/cancelBookings'
import { isMissedCheckinBlocked } from '@/lib/checkin/missedCheckins'
import {
  countOpenMissedCheckins,
  getMissedCheckinSettings,
  resolveMissedCheckinAmount,
} from './missedCheckinSettings'
import type { CheckinPartner } from '@/types'

type AdminClient = ReturnType<typeof createAdminClient>

export interface EnsureMissedCheckinInput {
  orgId: string
  studentId: string
  sessionId: string
  sessionDate: string // YYYY-MM-DD
  createdBy: string | null
}

export interface EnsureMissedCheckinResult {
  created: boolean
  openCount: number
}

/**
 * Cria a pendência de check-in da falta, se ela couber.
 *
 * Não cria quando:
 *  - o aluno não tem parceiro na academia — a falta dele não custou repasse nenhum
 *    (quem não é parceiro nunca gera pendência de check-in);
 *  - já existe check-in do aluno naquela data — ele bipou, o repasse veio; a falta
 *    marcada na chamada é uma divergência de presença, não de check-in;
 *  - já existe pendência para o par (aluno, sessão) — garantido pelo índice único
 *    missed_checkins_student_session_idx.
 *
 * Chame SOMENTE para ausência. Marcar presente é o caminho de clearMissedCheckin.
 */
export async function ensureMissedCheckin(
  client: AdminClient,
  input: EnsureMissedCheckinInput,
): Promise<EnsureMissedCheckinResult> {
  const { orgId, studentId, sessionId, sessionDate, createdBy } = input

  // 1. Só parceiro gera pendência de check-in. Sem membership, o aluno não é desta
  //    academia.
  const { data: membership } = await client
    .from('memberships')
    .select('partner')
    .eq('user_id', studentId)
    .eq('organization_id', orgId)
    .maybeSingle()

  const partner = (membership as { partner: CheckinPartner | null } | null)?.partner
  if (!partner) return { created: false, openCount: 0 }

  // 2. Fez check-in nesse dia → o repasse aconteceu, não há o que cobrar.
  const { count: checkinCount } = await client
    .from('checkins')
    .select('id', { count: 'exact', head: true })
    .eq('student_id', studentId)
    .eq('organization_id', orgId)
    .eq('checkin_date', sessionDate)

  if ((checkinCount ?? 0) > 0) {
    return { created: false, openCount: await countOpenMissedCheckins(client, studentId, orgId) }
  }

  // 3. Valor congelado agora: mudar o preço depois não reescreve o histórico.
  const amount = await resolveMissedCheckinAmount(client, orgId, partner)

  // 4. Com valor, cria também o payments para o aluno poder quitar pelas trilhas que
  //    já existem (PIX + comprovante, Mercado Pago). Sem valor, a pendência é só
  //    controle — mesma filosofia do ensureClassDebt sem single_class_price.
  let paymentId: string | null = null
  if (amount > 0) {
    paymentId = await ensureMissedCheckinPayment(client, {
      orgId, studentId, sessionId, amount,
    })
  }

  const { error } = await client.from('missed_checkins').insert({
    organization_id: orgId,
    student_id: studentId,
    session_id: sessionId,
    partner,
    session_date: sessionDate,
    amount,
    status: 'open',
    payment_id: paymentId,
    created_by: createdBy,
  })

  // 23505 = índice único: já havia pendência para este par. Idempotência, não erro.
  if (error && error.code !== '23505') {
    throw new Error(`Falha ao registrar pendência de check-in: ${error.message}`)
  }

  return {
    created: !error,
    openCount: await countOpenMissedCheckins(client, studentId, orgId),
  }
}

/**
 * Garante o payments da pendência e devolve o id.
 *
 * `payments_session_student_unique` permite UM payments por (aluno, sessão). Se já
 * existe — pré-declaração do admin, ou dívida de avulsa — reusa em vez de criar: o
 * aluno não pode ser cobrado duas vezes pela mesma aula.
 */
async function ensureMissedCheckinPayment(
  client: AdminClient,
  input: { orgId: string; studentId: string; sessionId: string; amount: number },
): Promise<string | null> {
  const { orgId, studentId, sessionId, amount } = input

  const { data: inserted, error } = await client
    .from('payments')
    .insert({
      organization_id: orgId,
      student_id: studentId,
      session_id: sessionId,
      amount,
      currency: 'BRL',
      status: 'pending',
      type: 'per_class',
      gateway: 'manual',
      credits_qty: null,
      missed_checkin: true,
    })
    .select('id')
    .maybeSingle()

  if (!error) return (inserted as { id: string } | null)?.id ?? null
  if (error.code !== '23505') {
    throw new Error(`Falha ao registrar cobrança da pendência: ${error.message}`)
  }

  const { data: existing } = await client
    .from('payments')
    .select('id')
    .eq('student_id', studentId)
    .eq('session_id', sessionId)
    .maybeSingle()

  return (existing as { id: string } | null)?.id ?? null
}

/**
 * Desfaz a pendência quando o professor corrige a marcação para presente.
 *
 * Só apaga a que está `open`: `paid` (o aluno já pagou) e `waived` (o admin já
 * perdoou) são fatos consumados. O payments vinculado também é apagado, se ainda
 * estiver pendente — cobrar por uma falta que não houve seria pior que não cobrar.
 */
export async function clearMissedCheckin(
  client: AdminClient,
  input: { orgId: string; studentId: string; sessionId: string },
): Promise<void> {
  const { orgId, studentId, sessionId } = input

  const { data: rows } = await client
    .from('missed_checkins')
    .select('id, payment_id')
    .eq('organization_id', orgId)
    .eq('student_id', studentId)
    .eq('session_id', sessionId)
    .eq('status', 'open')

  const pendencias = (rows ?? []) as { id: string; payment_id: string | null }[]
  if (pendencias.length === 0) return

  await client
    .from('missed_checkins')
    .delete()
    .in('id', pendencias.map((p) => p.id))

  const paymentIds = pendencias.map((p) => p.payment_id).filter((id): id is string => !!id)
  if (paymentIds.length === 0) return

  await client
    .from('payments')
    .delete()
    .in('id', paymentIds)
    .eq('status', 'pending')
    .eq('missed_checkin', true)
}

/**
 * Aplica o bloqueio: cancela as reservas futuras do aluno, oferece as vagas para a
 * fila de espera e avisa aluno e admins.
 *
 * Idempotente: rodar de novo não encontra reserva confirmada, então não cancela nem
 * notifica nada. Nunca lança — o bloqueio é consequência da chamada, e falhar aqui
 * não pode derrubar a marcação de presença que o professor está fazendo.
 */
export async function enforceMissedCheckinBlock(
  client: AdminClient,
  input: { orgId: string; studentId: string },
): Promise<{ blocked: boolean; cancelledBookings: number }> {
  const { orgId, studentId } = input

  try {
    const { blockLimit } = await getMissedCheckinSettings(client, orgId)
    if (blockLimit <= 0) return { blocked: false, cancelledBookings: 0 }

    const openCount = await countOpenMissedCheckins(client, studentId, orgId)
    if (!isMissedCheckinBlocked(openCount, blockLimit)) {
      return { blocked: false, cancelledBookings: 0 }
    }

    // onlyFromEnrollment: false — cancela fixa E avulsa. O objetivo declarado é
    // liberar a vaga para quem vai aparecer, não poupar a avulsa.
    const { cancelled, freedSessionIds } = await cancelFutureBookings(client, {
      studentId,
      orgId,
      onlyFromEnrollment: false,
      refundReason: 'Estorno — bloqueio por pendência de check-in',
    })

    if (cancelled === 0) return { blocked: true, cancelledBookings: 0 }

    await offerFreedSpots(freedSessionIds)
    await notifyBlocked(client, { orgId, studentId, openCount, cancelled })

    return { blocked: true, cancelledBookings: cancelled }
  } catch (err) {
    console.error('[enforceMissedCheckinBlock] falhou', {
      studentId, orgId, error: err instanceof Error ? err.message : String(err),
    })
    Sentry.captureException(err, {
      tags: { feature: 'missedCheckins' },
      extra: { studentId, orgId },
    })
    return { blocked: false, cancelledBookings: 0 }
  }
}

/** Import dinâmico: waitlistActions é 'use server' e importa daqui indiretamente. */
async function offerFreedSpots(sessionIds: string[]): Promise<void> {
  if (sessionIds.length === 0) return
  const { offerWaitlistSpot } = await import('@/features/aulas/waitlistActions')
  for (const sessionId of Array.from(new Set(sessionIds))) {
    try {
      await offerWaitlistSpot(sessionId)
    } catch (err) {
      console.error('[enforceMissedCheckinBlock] offerWaitlistSpot falhou', {
        sessionId, error: err instanceof Error ? err.message : String(err),
      })
    }
  }
}

async function notifyBlocked(
  client: AdminClient,
  input: { orgId: string; studentId: string; openCount: number; cancelled: number },
): Promise<void> {
  const { orgId, studentId, openCount, cancelled } = input

  await notifyUsers(client, {
    orgId,
    recipients: [{ userId: studentId }],
    type: 'checkin_pendencia_bloqueio',
    title: 'Agendamentos bloqueados',
    body:
      `Você tem ${openCount} check-in(s) do parceiro em aberto, e por isso ` +
      `${cancelled} aula(s) que você tinha marcada(s) foram canceladas. ` +
      'Regularize em Financeiro para voltar a agendar.',
    channels: ['push', 'inapp'],
  })

  const { data: admins } = await client
    .from('memberships')
    .select('user_id')
    .eq('organization_id', orgId)
    .eq('role', 'admin')

  const recipients = ((admins ?? []) as { user_id: string }[]).map((m) => ({ userId: m.user_id }))
  if (recipients.length === 0) return

  const { data: profile } = await client
    .from('profiles')
    .select('full_name')
    .eq('id', studentId)
    .maybeSingle()
  const name = (profile as { full_name: string } | null)?.full_name ?? 'Aluno'

  await notifyUsers(client, {
    orgId,
    recipients,
    type: 'checkin_pendencia_bloqueio_admin',
    title: 'Aluno bloqueado por pendência de check-in',
    body:
      `${name} atingiu ${openCount} pendência(s) de check-in. ` +
      `${cancelled} reserva(s) futura(s) foram canceladas e as vagas liberadas.`,
    channels: ['inapp'],
  })
}
