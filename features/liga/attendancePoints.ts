// features/liga/attendancePoints.ts
// Reflete a marcação de presença na Liga (spec §Fase 1 / Onde os pontos entram).
import { createAdminClient } from '@/lib/supabase/server'
import { getOrgSports } from '@/lib/arenas/orgSports'
import { sportForAttendance } from '@/lib/liga/sportForPoints'
import { pointsForAttendance } from '@/lib/liga/points'
import { getLigaSettings } from './settings'
import { getOrCreateActiveSeason } from './season'
import { awardLigaPoints, revokeLigaPoints } from './awardPoints'

type AdminClient = ReturnType<typeof createAdminClient>

/** Modalidade da turma daquela sessão. null quando a turma não tem modalidade. */
async function sessionClassSport(
  admin: AdminClient,
  orgId: string,
  sessionId: string,
): Promise<string | null> {
  const { data } = await admin
    .from('class_sessions')
    .select('classes(sport)')
    .eq('id', sessionId)
    .eq('organization_id', orgId)
    .maybeSingle()

  // O join vem como objeto ou array de um, dependendo da inferência do supabase-js.
  const raw = (data as { classes: { sport: string | null } | { sport: string | null }[] } | null)?.classes
  const cls = Array.isArray(raw) ? raw[0] : raw
  return cls?.sport ?? null
}

/**
 * Presente → credita; ausente → revoga o crédito daquela aula.
 *
 * Nunca lança: a marcação de presença é a operação do professor e não pode falhar
 * porque a Liga falhou. Mesmo contrato de ensureClassDebt e syncMissedCheckin.
 */
export async function syncLigaAttendancePoints(
  admin: AdminClient,
  input: { orgId: string; studentId: string; sessionId: string; present: boolean },
): Promise<void> {
  const { orgId, studentId, sessionId, present } = input

  try {
    const settings = await getLigaSettings(orgId)
    if (!settings.enabled) return

    const [classSport, orgSports] = await Promise.all([
      sessionClassSport(admin, orgId, sessionId),
      getOrgSports(orgId),
    ])

    const sport = sportForAttendance(classSport, orgSports)
    if (!sport) return // turma sem modalidade em academia multi-modalidade

    const season = await getOrCreateActiveSeason(orgId)
    if (!season) return

    if (present) {
      await awardLigaPoints(admin, {
        orgId,
        seasonId: season.id,
        studentId,
        sport,
        points: pointsForAttendance(settings.weights),
        reason: 'attendance',
        sourceId: sessionId,
      })
    } else {
      await revokeLigaPoints(admin, {
        seasonId: season.id,
        studentId,
        sport,
        reason: 'attendance',
        sourceId: sessionId,
      })
    }
  } catch (err) {
    console.error('[liga] syncLigaAttendancePoints falhou', {
      sessionId,
      studentId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
