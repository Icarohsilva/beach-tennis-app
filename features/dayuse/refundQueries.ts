// features/dayuse/refundQueries.ts
// Leitura dos estornos de day use: a lista do aluno e a fila do admin.
import type { createAdminClient } from '@/lib/supabase/server'
import { IN_CHUNK_SIZE, chunk, fetchAllPages } from '@/lib/supabase/paginate'
import type { RefundCause, RefundMethod, RefundStatus } from '@/lib/dayuse/refundRules'

type AdminClient = ReturnType<typeof createAdminClient>
type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>

export interface RefundRow {
  id: string
  organization_id: string
  booking_id: string
  student_id: string
  amount_cents: number
  cause: RefundCause
  method: RefundMethod
  status: RefundStatus
  pix_key: string | null
  pix_owner: string | null
  proof_url: string | null
  paid_at: string | null
  confirmed_at: string | null
  created_at: string
}

export interface StudentRefund extends RefundRow {
  /** Dados do horário, para o aluno reconhecer de qual day use é o estorno. */
  slot: { id: string; date: string; start_time: string; end_time: string; court: number } | null
  orgName: string | null
}

/**
 * Estornos do aluno naquela academia, do mais recente primeiro.
 *
 * `slotId` recorta para a página pública de UM day use (/d/[id]), onde o avulso
 * acompanha o próprio dinheiro — ele não tem /financeiro.
 */
export async function getStudentRefunds(
  client: AdminClient,
  input: { studentId: string; orgId?: string; slotId?: string },
): Promise<StudentRefund[]> {
  let q = client
    .from('dayuse_refunds')
    .select(`
      id, organization_id, booking_id, student_id, amount_cents, cause, method, status,
      pix_key, pix_owner, proof_url, paid_at, confirmed_at, created_at,
      dayuse_bookings!inner(slot_id, dayuse_slots(id, date, start_time, end_time, court)),
      organizations(name)
    `)
    .eq('student_id', input.studentId)
    .order('created_at', { ascending: false })
  if (input.orgId) q = q.eq('organization_id', input.orgId)

  const { data } = await q
  type Raw = RefundRow & {
    dayuse_bookings: {
      slot_id: string
      dayuse_slots: StudentRefund['slot'] | StudentRefund['slot'][] | null
    } | { slot_id: string; dayuse_slots: StudentRefund['slot'] | null }[] | null
    organizations: { name: string } | { name: string }[] | null
  }

  const rows = ((data ?? []) as unknown as Raw[]).map((r) => {
    const booking = Array.isArray(r.dayuse_bookings) ? r.dayuse_bookings[0] : r.dayuse_bookings
    const slotRaw = booking?.dayuse_slots ?? null
    const slot = (Array.isArray(slotRaw) ? slotRaw[0] : slotRaw) ?? null
    const org = Array.isArray(r.organizations) ? r.organizations[0] : r.organizations
    return { ...r, slot, orgName: org?.name ?? null }
  })

  // Recorte por horário depois da leitura: o filtro vive dois níveis abaixo
  // (refund → booking → slot) e PostgREST não filtra por coluna de tabela
  // aninhada sem transformar o join em inner de novo.
  return input.slotId ? rows.filter((r) => r.slot?.id === input.slotId) : rows
}

export interface AdminRefund extends RefundRow {
  studentName: string
  slot: { id: string; date: string; start_time: string; end_time: string; court: number } | null
  /** URL assinada do comprovante (bucket privado), quando há. */
  proofSignedUrl: string | null
}

/**
 * Fila de estornos da academia. Pendentes primeiro — é a lista de "o que eu
 * devo hoje".
 *
 * Paginada: estorno acumula com o tempo e o corte silencioso de 1.000 linhas do
 * PostgREST esconderia justamente os mais antigos, que são os mais urgentes.
 */
export async function getOrgRefunds(
  client: AdminClient,
  orgId: string,
): Promise<AdminRefund[]> {
  // O nome do aluno vem numa leitura SEPARADA, de propósito. `dayuse_refunds`
  // tem duas FKs para `profiles` (student_id e paid_by), e um embed
  // `profiles(...)` fica ambíguo: o PostgREST recusa a consulta inteira com
  // "more than one relationship was found" — a tela quebrava com erro de
  // servidor, não com lista vazia.
  const rows = await fetchAllPages<RefundRow & { dayuse_bookings: unknown }>(
    (from, to) =>
      client
        .from('dayuse_refunds')
        .select(`
          id, organization_id, booking_id, student_id, amount_cents, cause, method, status,
          pix_key, pix_owner, proof_url, paid_at, confirmed_at, created_at,
          dayuse_bookings!inner(dayuse_slots(id, date, start_time, end_time, court))
        `)
        .eq('organization_id', orgId)
        .order('created_at', { ascending: true })
        .range(from, to) as unknown as Page<RefundRow & { dayuse_bookings: unknown }>,
    { label: 'dayuse/estornos-admin' },
  )

  const studentIds = Array.from(new Set(rows.map((r) => r.student_id)))
  const nameById = new Map<string, string>()
  for (const part of chunk(studentIds, IN_CHUNK_SIZE)) {
    const { data: profs } = await client.from('profiles').select('id, full_name').in('id', part)
    for (const p of (profs ?? []) as { id: string; full_name: string }[]) {
      nameById.set(p.id, p.full_name)
    }
  }

  const out: AdminRefund[] = []
  for (const r of rows) {
    const booking = Array.isArray(r.dayuse_bookings) ? r.dayuse_bookings[0] : r.dayuse_bookings
    const slotRaw = (booking as { dayuse_slots?: unknown } | null)?.dayuse_slots ?? null
    const slot = (Array.isArray(slotRaw) ? slotRaw[0] : slotRaw) as AdminRefund['slot']

    let proofSignedUrl: string | null = null
    if (r.proof_url) {
      const { data: signed } = await client.storage
        .from('payment-receipts')
        .createSignedUrl(r.proof_url, 60 * 10)
      proofSignedUrl = signed?.signedUrl ?? null
    }

    out.push({
      ...r,
      studentName: nameById.get(r.student_id) ?? 'Aluno',
      slot: slot ?? null,
      proofSignedUrl,
    })
  }

  // Pendente antes de pago, pago antes de encerrado: a fila é de trabalho.
  const rank: Record<RefundStatus, number> = {
    pendente: 0, pago: 1, confirmado: 2, creditado: 3,
  }
  return out.sort((a, b) => rank[a.status] - rank[b.status])
}

export interface PendingReceipt {
  bookingId: string
  studentName: string
  amountCents: number
  bookedAt: string
  holdUntil: string | null
  hasReceipt: boolean
  receiptSignedUrl: string | null
  slot: { id: string; date: string; start_time: string; end_time: string; court: number } | null
}

/**
 * Reservas de day use pagas por PIX manual esperando conferência.
 *
 * Quem ainda NÃO anexou comprovante entra na lista também: é informação
 * operacional ("reservou e não pagou"), e some sozinho quando `hold_until`
 * vence. Esconder essa metade daria à arena a impressão de fila vazia com vaga
 * presa.
 */
export async function getPendingDayUseReceipts(
  client: AdminClient,
  orgId: string,
): Promise<PendingReceipt[]> {
  const rows = await fetchAllPages<{
    id: string
    booked_at: string
    hold_until: string | null
    receipt_url: string | null
    profiles: { full_name: string } | { full_name: string }[] | null
    dayuse_slots: unknown
    payments: { amount: number; status: string }[] | null
  }>(
    (from, to) =>
      client
        .from('dayuse_bookings')
        .select(`
          id, booked_at, hold_until, receipt_url,
          profiles(full_name),
          dayuse_slots(id, date, start_time, end_time, court),
          payments(amount, status)
        `)
        .eq('organization_id', orgId)
        .eq('status', 'pending_payment')
        .eq('payment_method', 'pix_manual')
        .order('booked_at', { ascending: true })
        .range(from, to) as unknown as Page<{
          id: string
          booked_at: string
          hold_until: string | null
          receipt_url: string | null
          profiles: { full_name: string } | { full_name: string }[] | null
          dayuse_slots: unknown
          payments: { amount: number; status: string }[] | null
        }>,
    { label: 'dayuse/comprovantes-admin' },
  )

  const out: PendingReceipt[] = []
  for (const r of rows) {
    const prof = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles
    const slotRaw = r.dayuse_slots
    const slot = (Array.isArray(slotRaw) ? slotRaw[0] : slotRaw) as PendingReceipt['slot']
    const pending = (r.payments ?? []).find((p) => p.status === 'pending')

    let receiptSignedUrl: string | null = null
    if (r.receipt_url) {
      const { data: signed } = await client.storage
        .from('payment-receipts')
        .createSignedUrl(r.receipt_url, 60 * 10)
      receiptSignedUrl = signed?.signedUrl ?? null
    }

    out.push({
      bookingId: r.id,
      studentName: prof?.full_name ?? 'Aluno',
      amountCents: Math.round(Number(pending?.amount ?? 0) * 100),
      bookedAt: r.booked_at,
      holdUntil: r.hold_until,
      hasReceipt: Boolean(r.receipt_url),
      receiptSignedUrl,
      slot: slot ?? null,
    })
  }

  // Com comprovante primeiro: é a metade em que a arena tem trabalho a fazer.
  return out.sort((a, b) => Number(b.hasReceipt) - Number(a.hasReceipt))
}
