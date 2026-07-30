// features/aulas/gridGeneration.ts
// Núcleo ÚNICO de geração semanal da grade. Chamado por: criar turma, botão
// "gerar dia", botão "gerar semana", e o cron de auto-geração. Gera as sessões
// (idempotente) e reserva os alunos fixos elegíveis.
import { createAdminClient } from '@/lib/supabase/server'
import { buildSessionRows } from './sessionUtils'
import { reconcileAllActiveEnrollments } from './creditReconciliation'

type AdminClient = ReturnType<typeof createAdminClient>

export interface GenerateGridResult {
  /** Sessões efetivamente inseridas nesta chamada — não conta as que já existiam e foram puladas pelo upsert idempotente. */
  sessionsCreated: number
  studentsBooked: number
  /** Alunos fixos que ficaram sem vínculo nesta rodada por falta de cota. */
  quotaSkipped: number
  /** Alunos fixos que ficaram sem vínculo por pendência de check-in em aberto. */
  missedCheckinSkipped: number
  /** Presente quando o upsert de class_sessions falhou — chamador não deve tratar como sucesso. */
  error?: string
}

/**
 * Gera as sessões das turmas ativas da org no intervalo [from, to] e reserva os
 * fixos. `opts.dayOfWeek` restringe às turmas daquele dia; `opts.classId` a uma
 * turma. Idempotente: o upsert com ignoreDuplicates não recria sessões existentes.
 */
export async function generateGrid(
  orgId: string,
  from: string, // yyyy-MM-dd
  to: string, // yyyy-MM-dd
  opts: { dayOfWeek?: number; classId?: string } = {},
  injectedClient?: AdminClient,
): Promise<GenerateGridResult> {
  const client = injectedClient ?? createAdminClient()

  let q = client
    .from('classes')
    .select('id, day_of_week')
    .eq('organization_id', orgId)
    .eq('is_active', true)
  if (opts.dayOfWeek !== undefined) q = q.eq('day_of_week', opts.dayOfWeek)
  if (opts.classId !== undefined) q = q.eq('id', opts.classId)

  const { data: classesRaw } = await q
  const classes = (classesRaw ?? []) as { id: string; day_of_week: number }[]
  if (classes.length === 0) return { sessionsCreated: 0, studentsBooked: 0, quotaSkipped: 0, missedCheckinSkipped: 0 }

  const rows = classes.flatMap((c) => buildSessionRows(c.id, c.day_of_week, from, to))
  let sessionsCreated = 0
  if (rows.length > 0) {
    // organization_id é preenchido pelo trigger trg_set_org (deriva de class_id).
    // .select() com ignoreDuplicates devolve SÓ as linhas inseridas (conflitos
    // são pulados e não voltam) → contagem real de sessões novas, não tentadas.
    const { data: inserted, error: upsertErr } = await client
      .from('class_sessions')
      .upsert(rows, { onConflict: 'class_id,session_date', ignoreDuplicates: true })
      .select('id')

    if (upsertErr) {
      console.error('[generateGrid] upsert de class_sessions falhou', {
        orgId, from, to, error: upsertErr.message,
      })
      return { sessionsCreated: 0, studentsBooked: 0, quotaSkipped: 0, missedCheckinSkipped: 0, error: upsertErr.message }
    }
    sessionsCreated = inserted?.length ?? 0
  }

  const rec = await reconcileAllActiveEnrollments(from, to, orgId)

  return {
    sessionsCreated,
    studentsBooked: rec.booked,
    quotaSkipped: rec.quotaSkipped,
    missedCheckinSkipped: rec.missedCheckinSkipped,
  }
}
