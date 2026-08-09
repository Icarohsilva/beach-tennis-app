// features/liga/orgOverview.ts
// A Liga vista pela academia: engajamento, movimentação e quem está escapando.
//
// O ranking sozinho responde "quem está ganhando". O que a academia precisa saber é
// outra coisa: quantos alunos a Liga está alcançando, quem parou de aparecer e quem
// está prestes a subir ou cair — informação que vira conversa na quadra.
import { createAdminClient } from '@/lib/supabase/server'
import { brtToday } from '@/lib/utils/gridSchedule'
import type { LigaDivision } from '@/types'

type AdminClient = ReturnType<typeof createAdminClient>

/** Sem presença há tantos dias, o aluno entra na lista de quem está escapando. */
const DIAS_SUMIDO = 14

/** Só entra na lista de sumidos quem já treinou nos últimos meses. */
const DIAS_HISTORICO = 90

export interface MissingStudent {
  studentId: string
  name: string
  /** Dias desde a última presença. */
  daysAway: number
  phone: string | null
}

export interface OrgLigaOverview {
  /** Alunos com vínculo ativo na academia. */
  totalStudents: number
  /** Quantos pontuaram nesta temporada. */
  scoring: number
  /** Presenças creditadas na temporada. */
  attendancePoints: number
  /** Elogios enviados nesta temporada. */
  kudos: number
  /** Medalhas concedidas nos últimos 30 dias. */
  recentMedals: number
  /** Alunos por divisão, somando todas as modalidades. */
  byDivision: Record<LigaDivision, number>
  /** Quem treinava e sumiu. */
  missing: MissingStudent[]
}

function daysBetween(fromIso: string, todayIso: string): number {
  const [fy, fm, fd] = fromIso.slice(0, 10).split('-').map(Number)
  const [ty, tm, td] = todayIso.split('-').map(Number)
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000)
}

/**
 * Retrato da Liga para o painel da academia.
 *
 * `missing` só inclui quem tem histórico recente: aluno que nunca treinou não é
 * alguém "escapando", é alguém que ainda não começou — e misturar os dois faria a
 * lista virar ruído grande demais para alguém agir sobre ela.
 */
export async function getOrgLigaOverview(
  admin: AdminClient,
  orgId: string,
  seasonId: string | null,
  now: Date = new Date(),
): Promise<OrgLigaOverview> {
  const today = brtToday(now)
  const desde = (dias: number) => {
    const [y, m, d] = today.split('-').map(Number)
    return new Date(Date.UTC(y, m - 1, d - dias)).toISOString().slice(0, 10)
  }

  const [{ data: members }, { data: standings }, { data: points }, { data: kudos }, { count: medals }] =
    await Promise.all([
      admin
        .from('memberships')
        .select('user_id, profiles:profiles!memberships_user_id_fkey!inner(full_name, phone)')
        .eq('organization_id', orgId)
        .eq('role', 'student'),
      seasonId
        ? admin
            .from('liga_standings')
            .select('student_id, division')
            .eq('season_id', seasonId)
        : Promise.resolve({ data: [] as { student_id: string; division: LigaDivision }[] }),
      seasonId
        ? admin
            .from('liga_points')
            .select('id')
            .eq('season_id', seasonId)
            .eq('reason', 'attendance')
        : Promise.resolve({ data: [] as { id: string }[] }),
      seasonId
        ? admin.from('liga_kudos').select('id').eq('season_id', seasonId)
        : Promise.resolve({ data: [] as { id: string }[] }),
      admin
        .from('liga_medals')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .gte('earned_at', `${desde(30)}T00:00:00.000Z`),
    ])

  type MemberRow = {
    user_id: string
    profiles: { full_name: string; phone: string | null } | { full_name: string; phone: string | null }[] | null
  }
  const memberRows = (members ?? []) as MemberRow[]

  const byDivision: Record<LigaDivision, number> = { bronze: 0, prata: 0, ouro: 0, diamante: 0 }
  const scoringIds = new Set<string>()
  for (const row of (standings ?? []) as { student_id: string; division: LigaDivision }[]) {
    scoringIds.add(row.student_id)
    byDivision[row.division] = (byDivision[row.division] ?? 0) + 1
  }

  // Última presença de cada aluno nos últimos 90 dias, para separar "sumiu" de
  // "nunca veio".
  const { data: recentAttendance } = await admin
    .from('attendance')
    .select('student_id, class_sessions!inner(session_date)')
    .eq('organization_id', orgId)
    .eq('status', 'present')
    .gte('class_sessions.session_date', desde(DIAS_HISTORICO))

  type AttRow = {
    student_id: string
    class_sessions: { session_date: string } | { session_date: string }[]
  }
  const lastByStudent = new Map<string, string>()
  for (const raw of (recentAttendance ?? []) as AttRow[]) {
    const session = Array.isArray(raw.class_sessions) ? raw.class_sessions[0] : raw.class_sessions
    const date = session?.session_date
    if (!date) continue
    const current = lastByStudent.get(raw.student_id)
    if (!current || date > current) lastByStudent.set(raw.student_id, date)
  }

  const missing: MissingStudent[] = []
  for (const member of memberRows) {
    const last = lastByStudent.get(member.user_id)
    if (!last) continue // nunca treinou na janela: não é fuga, é que ainda não começou
    const daysAway = daysBetween(last, today)
    if (daysAway < DIAS_SUMIDO) continue

    const profile = Array.isArray(member.profiles) ? member.profiles[0] : member.profiles
    missing.push({
      studentId: member.user_id,
      name: profile?.full_name ?? 'Aluno',
      daysAway,
      phone: profile?.phone ?? null,
    })
  }
  // Quem sumiu há mais tempo primeiro: é quem está mais perto de não voltar.
  missing.sort((a, b) => b.daysAway - a.daysAway)

  return {
    totalStudents: memberRows.length,
    scoring: scoringIds.size,
    attendancePoints: (points ?? []).length,
    kudos: (kudos ?? []).length,
    recentMedals: medals ?? 0,
    byDivision,
    missing: missing.slice(0, 12),
  }
}
