// features/liga/awardPoints.ts
// Ponte entre as actions e as RPCs da Liga. Nunca escreve nas tabelas direto.
import * as Sentry from '@sentry/nextjs'
import { createAdminClient } from '@/lib/supabase/server'
import type { LigaPointReason } from '@/types'

type AdminClient = ReturnType<typeof createAdminClient>

export interface AwardPointsInput {
  orgId: string
  seasonId: string
  studentId: string
  sport: string
  points: number
  reason: LigaPointReason
  sourceId?: string | null
  note?: string | null
  awardedBy?: string | null
}

/**
 * Credita pontos via RPC atômica. Nunca lança.
 *
 * Best-effort de propósito: todos os callers são operações que o professor ou o aluno
 * está fazendo por outro motivo (marcar presença, se inscrever num torneio). A Liga
 * falhando não pode derrubar nenhuma delas — mesmo contrato do ensureClassDebt em
 * features/aulas/actions.ts. A passada diária do cron reconcilia o que escapar.
 */
export async function awardLigaPoints(
  admin: AdminClient,
  input: AwardPointsInput,
): Promise<void> {
  try {
    const { error } = await admin.rpc('liga_award_points', {
      p_org: input.orgId,
      p_season: input.seasonId,
      p_student: input.studentId,
      p_sport: input.sport,
      p_points: input.points,
      p_reason: input.reason,
      p_source_id: input.sourceId ?? null,
      p_note: input.note ?? null,
      p_awarded_by: input.awardedBy ?? null,
    })
    if (error) throw new Error(error.message)
  } catch (err) {
    console.error('[liga] awardLigaPoints falhou', {
      studentId: input.studentId,
      sport: input.sport,
      reason: input.reason,
      error: err instanceof Error ? err.message : String(err),
    })
    Sentry.captureException(err, {
      tags: { feature: 'liga' },
      extra: { ...input },
    })
  }
}

export interface RevokePointsInput {
  seasonId: string
  studentId: string
  sport: string
  reason: LigaPointReason
  sourceId?: string | null
}

/** Remove um crédito específico (professor desmarcou a presença). Nunca lança. */
export async function revokeLigaPoints(
  admin: AdminClient,
  input: RevokePointsInput,
): Promise<void> {
  try {
    const { error } = await admin.rpc('liga_revoke_points', {
      p_season: input.seasonId,
      p_student: input.studentId,
      p_sport: input.sport,
      p_reason: input.reason,
      p_source_id: input.sourceId ?? null,
    })
    if (error) throw new Error(error.message)
  } catch (err) {
    console.error('[liga] revokeLigaPoints falhou', {
      studentId: input.studentId,
      sport: input.sport,
      reason: input.reason,
      error: err instanceof Error ? err.message : String(err),
    })
    Sentry.captureException(err, { tags: { feature: 'liga' }, extra: { ...input } })
  }
}
