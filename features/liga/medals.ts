// features/liga/medals.ts
// Apuração e concessão das medalhas da Liga (spec §Fase 2).
//
// A avaliação é sempre do estado inteiro do aluno, nunca incremental: cada passada
// recalcula os números e concede o que faltar. É o que torna a concessão idempotente
// e o que faz medalha nova do catálogo alcançar retroativamente quem já cumpria o
// critério, sem migration de backfill.
import { createAdminClient } from '@/lib/supabase/server'
import { getOrgSports } from '@/lib/arenas/orgSports'
import { sportForAttendance } from '@/lib/liga/sportForPoints'
import { evaluateMedals, type MedalStats } from '@/lib/liga/medals'
import { getLigaSettings } from './settings'
import { getOrCreateActiveSeason } from './season'
import type { LigaDivision } from '@/types'

type AdminClient = ReturnType<typeof createAdminClient>

/** Hora antes da qual a aula conta como "madrugador". */
const EARLY_CLASS_BEFORE = '07:00'

export interface MedalGrant {
  medalKey: string
  sport: string | null
}

interface AttendanceRow {
  session_date: string
  class_sport: string | null
  start_time: string | null
}

/** Presenças confirmadas do aluno naquela academia, com modalidade e horário da turma. */
async function loadStudentAttendance(
  admin: AdminClient,
  orgId: string,
  studentId: string,
): Promise<AttendanceRow[]> {
  const { data } = await admin
    .from('attendance')
    .select('class_sessions!inner(session_date, classes(sport, start_time))')
    .eq('organization_id', orgId)
    .eq('student_id', studentId)
    .eq('status', 'present')

  type Cls = { sport: string | null; start_time: string | null }
  type Session = { session_date: string; classes: Cls | Cls[] | null }
  type Raw = { class_sessions: Session | Session[] | null }

  return ((data ?? []) as Raw[])
    .map((r) => {
      const session = Array.isArray(r.class_sessions) ? r.class_sessions[0] : r.class_sessions
      const cls = Array.isArray(session?.classes) ? session?.classes[0] : session?.classes
      return {
        session_date: session?.session_date ?? '',
        class_sport: cls?.sport ?? null,
        start_time: cls?.start_time ?? null,
      }
    })
    .filter((r) => r.session_date !== '')
}

/** Meses cheios entre a entrada na academia e agora. */
function monthsBetween(from: string, now: Date): number {
  const start = new Date(from)
  if (isNaN(start.getTime())) return 0
  const months =
    (now.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (now.getUTCMonth() - start.getUTCMonth())
  // Ainda não chegou o dia do mês: o mês corrente não conta como completo.
  return Math.max(0, now.getUTCDate() < start.getUTCDate() ? months - 1 : months)
}

export interface StudentMedalStats {
  /** Números por modalidade em que o aluno tem alguma atividade. */
  bySport: Map<string, MedalStats>
  /** Números da academia inteira (medalhas de tempo de casa). */
  global: MedalStats
}

/**
 * Levanta tudo o que o catálogo pergunta, numa passada só por aluno.
 *
 * Lê o histórico inteiro de propósito, não só a temporada: "100 aulas" é sobre a
 * relação do aluno com a academia, não sobre o mês corrente. Já `division` e
 * `streakWeeks` vêm do cache da temporada atual, que é onde eles fazem sentido.
 */
export async function computeStudentMedalStats(
  admin: AdminClient,
  orgId: string,
  studentId: string,
  now: Date = new Date(),
): Promise<StudentMedalStats> {
  const [orgSports, attendance, membershipRes, entriesRes, winsRes, season] = await Promise.all([
    getOrgSports(orgId),
    loadStudentAttendance(admin, orgId, studentId),
    admin
      .from('memberships')
      .select('created_at')
      .eq('organization_id', orgId)
      .eq('user_id', studentId)
      .maybeSingle(),
    admin
      .from('tournament_entries')
      .select('tournament_id, tournaments!inner(sport)')
      .eq('organization_id', orgId)
      .eq('player_id', studentId)
      .eq('entry_status', 'confirmed'),
    admin
      .from('tournaments')
      .select('sport')
      .eq('organization_id', orgId)
      .eq('status', 'finished')
      .or(`winner1_id.eq.${studentId},winner1_partner_id.eq.${studentId}`),
    getOrCreateActiveSeason(orgId, now),
  ])

  const standings = season
    ? await admin
        .from('liga_standings')
        .select('sport, division, streak_weeks')
        .eq('season_id', season.id)
        .eq('student_id', studentId)
    : { data: [] as { sport: string; division: LigaDivision; streak_weeks: number }[] }

  const standingBySport = new Map(
    (
      (standings.data ?? []) as { sport: string; division: LigaDivision; streak_weeks: number }[]
    ).map((s) => [s.sport, s]),
  )

  const bySport = new Map<string, MedalStats>()
  const ensure = (sport: string): MedalStats => {
    let row = bySport.get(sport)
    if (!row) {
      const standing = standingBySport.get(sport)
      row = {
        attendanceCount: 0,
        streakWeeks: standing?.streak_weeks ?? 0,
        tournamentEntries: 0,
        tournamentWins: 0,
        division: (standing?.division ?? 'bronze') as LigaDivision,
        monthsSinceJoined: 0,
        earlyClassCount: 0,
      }
      bySport.set(sport, row)
    }
    return row
  }

  // Standings sozinhos já colocam a modalidade no mapa: quem chegou ao Ouro e parou de
  // treinar continua com a medalha de divisão avaliada.
  for (const sport of Array.from(standingBySport.keys())) ensure(sport)

  let totalAttendance = 0
  for (const row of attendance) {
    totalAttendance++
    const sport = sportForAttendance(row.class_sport, orgSports)
    if (!sport) continue
    const stats = ensure(sport)
    stats.attendanceCount++
    if (row.start_time && row.start_time < EARLY_CLASS_BEFORE) stats.earlyClassCount++
  }

  type EntryRaw = { tournaments: { sport: string | null } | { sport: string | null }[] | null }
  for (const raw of (entriesRes.data ?? []) as EntryRaw[]) {
    const t = Array.isArray(raw.tournaments) ? raw.tournaments[0] : raw.tournaments
    if (t?.sport) ensure(t.sport).tournamentEntries++
  }

  for (const raw of (winsRes.data ?? []) as { sport: string | null }[]) {
    if (raw.sport) ensure(raw.sport).tournamentWins++
  }

  const joinedAt = (membershipRes.data as { created_at: string } | null)?.created_at
  const monthsSinceJoined = joinedAt ? monthsBetween(joinedAt, now) : 0

  return {
    bySport,
    global: {
      attendanceCount: totalAttendance,
      streakWeeks: 0,
      tournamentEntries: 0,
      tournamentWins: 0,
      division: 'bronze',
      monthsSinceJoined,
      earlyClassCount: 0,
    },
  }
}

/**
 * Concede as medalhas que faltam a um aluno. Devolve só as novas.
 *
 * Nunca lança: é chamada de dentro da marcação de presença e do fechamento de torneio,
 * que não podem falhar porque a Liga falhou — mesmo contrato de awardLigaPoints.
 */
export async function syncLigaMedals(
  admin: AdminClient,
  orgId: string,
  studentId: string,
  now: Date = new Date(),
): Promise<MedalGrant[]> {
  try {
    const settings = await getLigaSettings(orgId)
    if (!settings.enabled) return []

    const stats = await computeStudentMedalStats(admin, orgId, studentId, now)

    const deserved: MedalGrant[] = []
    for (const [sport, sportStats] of Array.from(stats.bySport.entries())) {
      for (const medalKey of evaluateMedals(sportStats, 'sport')) {
        deserved.push({ medalKey, sport })
      }
    }
    for (const medalKey of evaluateMedals(stats.global, 'global')) {
      deserved.push({ medalKey, sport: null })
    }
    if (deserved.length === 0) return []

    const { data: existingRaw } = await admin
      .from('liga_medals')
      .select('medal_key, sport')
      .eq('organization_id', orgId)
      .eq('student_id', studentId)

    const existing = new Set(
      ((existingRaw ?? []) as { medal_key: string; sport: string | null }[]).map(
        (m) => `${m.medal_key}::${m.sport ?? ''}`,
      ),
    )

    const missing = deserved.filter((d) => !existing.has(`${d.medalKey}::${d.sport ?? ''}`))
    if (missing.length === 0) return []

    const { error } = await admin.from('liga_medals').insert(
      missing.map((m) => ({
        organization_id: orgId,
        student_id: studentId,
        medal_key: m.medalKey,
        sport: m.sport,
      })),
    )

    // 23505 = unique_violation: outra passada concedeu antes desta. É o resultado
    // esperado da corrida entre o cron e a chamada da chamada de presença, não erro.
    if (error && error.code !== '23505') {
      console.error('[liga] syncLigaMedals: insert falhou', {
        studentId,
        error: error.message,
      })
      return []
    }

    return error ? [] : missing
  } catch (err) {
    console.error('[liga] syncLigaMedals falhou', {
      studentId,
      error: err instanceof Error ? err.message : String(err),
    })
    return []
  }
}
