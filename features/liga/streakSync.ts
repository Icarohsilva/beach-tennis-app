// features/liga/streakSync.ts
// Recalcula a sequência de semanas e credita o bônus semanal, uma vez por semana
// por aluno/esporte (spec §Fase 1).
import { startOfISOWeek, format } from 'date-fns'
import { createAdminClient } from '@/lib/supabase/server'
import { computeStreakWeeks } from '@/lib/liga/streak'
import { pointsForStreakWeek } from '@/lib/liga/points'
import { sportForAttendance } from '@/lib/liga/sportForPoints'
import { getOrgSports } from '@/lib/arenas/orgSports'
import { getLigaSettings } from './settings'
import { getOrCreateActiveSeason } from './season'
import { awardLigaPoints } from './awardPoints'

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * UUID determinístico da semana, usado como `source_id` do bônus de sequência.
 *
 * Precisa ser estável para que o índice único do extrato impeça o cron de creditar o
 * mesmo bônus duas vezes na mesma semana (ele roda todo dia). Os 12 primeiros dígitos
 * carregam a data da segunda-feira daquela semana.
 */
export function weekSourceId(weekStart: Date): string {
  const ymd = format(weekStart, 'yyyyMMdd')
  return `00000000-0000-4000-8000-${ymd}0000`
}

interface AttendanceRow {
  student_id: string
  session_date: string
  class_sport: string | null
}

/** Presenças confirmadas da academia nas últimas ~30 semanas, com a modalidade da turma. */
async function loadRecentAttendance(
  admin: AdminClient,
  orgId: string,
  sinceIso: string,
): Promise<AttendanceRow[]> {
  const { data } = await admin
    .from('attendance')
    .select('student_id, class_sessions!inner(session_date, classes(sport))')
    .eq('organization_id', orgId)
    .eq('status', 'present')
    .gte('class_sessions.session_date', sinceIso)

  type Raw = {
    student_id: string
    class_sessions:
      | { session_date: string; classes: { sport: string | null } | { sport: string | null }[] }
      | { session_date: string; classes: { sport: string | null } | { sport: string | null }[] }[]
  }

  return ((data ?? []) as Raw[]).map((r) => {
    const session = Array.isArray(r.class_sessions) ? r.class_sessions[0] : r.class_sessions
    const cls = Array.isArray(session?.classes) ? session?.classes[0] : session?.classes
    return {
      student_id: r.student_id,
      session_date: session?.session_date ?? '',
      class_sport: cls?.sport ?? null,
    }
  }).filter((r) => r.session_date !== '')
}

export interface StreakSyncResult {
  studentsTouched: number
  bonusesAwarded: number
}

/**
 * Recalcula `streak_weeks` e credita o bônus da semana corrente para uma academia.
 *
 * Roda todo dia. O bônus é creditado no máximo uma vez por semana por (aluno, esporte)
 * graças ao `weekSourceId` determinístico — rodar cinco vezes na mesma semana credita
 * uma vez só.
 */
export async function syncLigaStreaks(
  admin: AdminClient,
  orgId: string,
  now: Date = new Date(),
): Promise<StreakSyncResult> {
  const settings = await getLigaSettings(orgId)
  if (!settings.enabled) return { studentsTouched: 0, bonusesAwarded: 0 }

  const season = await getOrCreateActiveSeason(orgId, now)
  if (!season) return { studentsTouched: 0, bonusesAwarded: 0 }

  const orgSports = await getOrgSports(orgId)
  // 30 semanas cobre qualquer sequência que o bônus consiga distinguir (teto de 4x).
  const since = new Date(now.getTime() - 30 * 7 * 24 * 3600 * 1000)
  const rows = await loadRecentAttendance(admin, orgId, format(since, 'yyyy-MM-dd'))

  // (aluno, esporte) → datas de presença
  const byStudentSport = new Map<string, string[]>()
  for (const row of rows) {
    const sport = sportForAttendance(row.class_sport, orgSports)
    if (!sport) continue
    const key = `${row.student_id}::${sport}`
    const list = byStudentSport.get(key) ?? []
    list.push(row.session_date)
    byStudentSport.set(key, list)
  }

  const sourceId = weekSourceId(startOfISOWeek(now))
  let studentsTouched = 0
  let bonusesAwarded = 0

  for (const [key, dates] of Array.from(byStudentSport.entries())) {
    const [studentId, sport] = key.split('::')
    const streakWeeks = computeStreakWeeks(dates, now)

    await admin
      .from('liga_standings')
      .update({ streak_weeks: streakWeeks })
      .eq('season_id', season.id)
      .eq('student_id', studentId)
      .eq('sport', sport)
    studentsTouched++

    const points = pointsForStreakWeek(streakWeeks, settings.weights)
    if (points <= 0) continue

    await awardLigaPoints(admin, {
      orgId,
      seasonId: season.id,
      studentId,
      sport,
      points,
      reason: 'streak',
      sourceId,
      note: `${streakWeeks} semana(s) seguidas`,
    })
    bonusesAwarded++
  }

  return { studentsTouched, bonusesAwarded }
}
