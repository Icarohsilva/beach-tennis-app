// features/aulas/vacationQueries.ts
// Leitura das férias. Separado de vacationActions.ts porque `'use server'` só
// exporta função assíncrona — tipo exportado dali não compila.
import type { createAdminClient } from '@/lib/supabase/server'
import type { VacationPeriod } from '@/lib/aulas/vacation'

type AdminClient = ReturnType<typeof createAdminClient>

export type VacationStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'

export interface VacationRow {
  id: string
  studentId: string
  studentName?: string
  startsOn: string
  endsOn: string
  status: VacationStatus
  reviewNote: string | null
  createdAt: string
}

interface RawRow {
  id: string
  student_id: string
  starts_on: string
  ends_on: string
  status: VacationStatus
  review_note: string | null
  created_at: string
}

function toRow(r: RawRow): VacationRow {
  return {
    id: r.id,
    studentId: r.student_id,
    startsOn: r.starts_on,
    endsOn: r.ends_on,
    status: r.status,
    reviewNote: r.review_note,
    createdAt: r.created_at,
  }
}

/**
 * Períodos APROVADOS de um aluno que ainda alcançam o futuro.
 *
 * Só os aprovados: pedido pendente não congela nada, e é aqui que essa decisão
 * fica visível para quem lê o caminho quente da reserva.
 *
 * O corte por `ends_on >= from` mantém a leitura barata sem perder o período em
 * curso — férias que terminaram já não interessam a nenhuma decisão.
 */
export async function getApprovedVacations(
  client: AdminClient,
  studentId: string,
  orgId: string,
  from: string,
): Promise<VacationPeriod[]> {
  const { data } = await client
    .from('vacations')
    .select('starts_on, ends_on')
    .eq('student_id', studentId)
    .eq('organization_id', orgId)
    .eq('status', 'approved')
    .gte('ends_on', from)

  return ((data ?? []) as { starts_on: string; ends_on: string }[]).map((v) => ({
    startsOn: v.starts_on,
    endsOn: v.ends_on,
  }))
}

/**
 * Férias aprovadas de TODOS os alunos da academia numa janela, indexadas por
 * aluno.
 *
 * É a forma que a geração da grade precisa: uma consulta para a org inteira, e
 * não uma por matrícula. Numa academia com 300 alunos a diferença é entre 1
 * query e 300.
 */
export async function getOrgVacationsInWindow(
  client: AdminClient,
  orgId: string | undefined,
  from: string,
  to: string,
): Promise<Map<string, VacationPeriod[]>> {
  let query = client
    .from('vacations')
    .select('student_id, starts_on, ends_on')
    .eq('status', 'approved')
    // Períodos que cruzam a janela: começam antes do fim E terminam depois do
    // início. Mesma condição de `overlaps`, aqui em SQL.
    .lte('starts_on', to)
    .gte('ends_on', from)
  if (orgId) query = query.eq('organization_id', orgId)

  const { data } = await query

  const byStudent = new Map<string, VacationPeriod[]>()
  for (const v of (data ?? []) as {
    student_id: string
    starts_on: string
    ends_on: string
  }[]) {
    const list = byStudent.get(v.student_id) ?? []
    list.push({ startsOn: v.starts_on, endsOn: v.ends_on })
    byStudent.set(v.student_id, list)
  }
  return byStudent
}

/** Histórico de férias de um aluno, mais recente primeiro (ficha do admin e /perfil). */
export async function listStudentVacations(
  client: AdminClient,
  studentId: string,
  orgId: string,
): Promise<VacationRow[]> {
  const { data } = await client
    .from('vacations')
    .select('id, student_id, starts_on, ends_on, status, review_note, created_at')
    .eq('student_id', studentId)
    .eq('organization_id', orgId)
    .order('starts_on', { ascending: false })
    .limit(20)

  return ((data ?? []) as RawRow[]).map(toRow)
}

/**
 * Pedidos esperando resposta na academia, com o nome do aluno.
 *
 * Sem esta lista o pedido do aluno fica invisível até alguém abrir a ficha dele
 * por acaso — que é o mesmo que não ter aprovação nenhuma.
 */
export async function listPendingVacations(
  client: AdminClient,
  orgId: string,
): Promise<VacationRow[]> {
  const { data } = await client
    .from('vacations')
    .select('id, student_id, starts_on, ends_on, status, review_note, created_at')
    .eq('organization_id', orgId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })

  const rows = ((data ?? []) as RawRow[]).map(toRow)
  if (rows.length === 0) return rows

  const { data: names } = await client
    .from('profiles')
    .select('id, full_name')
    .in('id', rows.map((r) => r.studentId))

  const nameById = new Map(
    ((names ?? []) as { id: string; full_name: string | null }[]).map((p) => [
      p.id,
      p.full_name ?? 'Aluno',
    ]),
  )
  return rows.map((r) => ({ ...r, studentName: nameById.get(r.studentId) ?? 'Aluno' }))
}
