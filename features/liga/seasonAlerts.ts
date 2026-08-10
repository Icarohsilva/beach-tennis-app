// features/liga/seasonAlerts.ts
// Dispara o aviso da reta final da temporada.
import { createAdminClient } from '@/lib/supabase/server'
import { notifyUsers } from '@/lib/notifications/dispatch'
import { sportLabel } from '@/lib/arenas/sports'
import { DIVISION_LABEL } from '@/lib/liga/labels'
import { seasonAlertKind, seasonAlertText } from '@/lib/liga/seasonAlert'
import { brtToday } from '@/lib/utils/gridSchedule'
import { getLigaSettings } from './settings'
import type { LigaDivision, LigaSeason } from '@/types'
import { BRT_OFFSET } from '@/lib/utils/sessionTime'

type AdminClient = ReturnType<typeof createAdminClient>

const NOTIFICATION_TYPE = 'liga_season_ending'

interface StandingRow {
  student_id: string
  sport: string
  division: LigaDivision
  points: number
}

/** Dias inteiros entre hoje (BRT) e o último dia da temporada. */
function daysUntil(endsOn: string, now: Date): number {
  const [ey, em, ed] = endsOn.split('-').map(Number)
  const [ty, tm, td] = brtToday(now).split('-').map(Number)
  const end = Date.UTC(ey, em - 1, ed)
  const today = Date.UTC(ty, tm - 1, td)
  return Math.round((end - today) / 86400000)
}

export interface SeasonAlertResult {
  notified: number
}

/**
 * Avisa quem está a poucos pontos de subir ou dentro da zona de rebaixamento.
 *
 * Roda diariamente, mas só dispara no dia certo (ALERT_DAYS_LEFT) — a regra de quando
 * mora em `lib/liga/seasonAlert.ts`, testada. Aqui é só leitura, dedupe e envio.
 */
export async function sendSeasonEndAlerts(
  admin: AdminClient,
  orgId: string,
  now: Date = new Date(),
): Promise<SeasonAlertResult> {
  const settings = await getLigaSettings(orgId)
  if (!settings.enabled) return { notified: 0 }

  const { data: seasonRaw } = await admin
    .from('liga_seasons')
    .select('*')
    .eq('organization_id', orgId)
    .eq('status', 'active')
    .order('starts_on', { ascending: false })
    .limit(1)
    .maybeSingle()

  const season = seasonRaw as LigaSeason | null
  if (!season) return { notified: 0 }

  const daysLeft = daysUntil(season.ends_on, now)

  const { data: standingsRaw } = await admin
    .from('liga_standings')
    .select('student_id, sport, division, points')
    .eq('season_id', season.id)

  const standings = (standingsRaw ?? []) as StandingRow[]
  if (standings.length === 0) return { notified: 0 }

  // Agrupa por (esporte, divisão): as zonas de promoção e rebaixamento são desse
  // recorte, não da academia inteira.
  const groups = new Map<string, StandingRow[]>()
  for (const row of standings) {
    const key = `${row.sport}::${row.division}`
    const list = groups.get(key) ?? []
    list.push(row)
    groups.set(key, list)
  }

  interface Pending {
    studentId: string
    title: string
    body: string
  }
  const pending: Pending[] = []

  for (const [key, rows] of Array.from(groups.entries())) {
    const [sport, division] = key.split('::') as [string, LigaDivision]
    rows.sort((a, b) => b.points - a.points || a.student_id.localeCompare(b.student_id))

    const promotes = division !== 'diamante' && settings.promoteCount > 0
    const demotes = division !== 'bronze' && settings.demoteCount > 0
    const cutoffPoints = rows[Math.max(0, Math.min(rows.length - 1, settings.promoteCount - 1))]
      ?.points ?? 0
    const relegationFrom = rows.length - settings.demoteCount

    rows.forEach((row, index) => {
      const position = index + 1
      const jaSobe = promotes && position <= settings.promoteCount
      const pointsToPromote =
        !promotes || jaSobe ? null : Math.max(1, cutoffPoints - row.points + 1)
      const inRelegationZone = demotes && index >= relegationFrom

      const kind = seasonAlertKind({
        daysLeft,
        pointsToPromote,
        inRelegationZone,
        points: row.points,
      })
      if (!kind) return

      const text = seasonAlertText(kind, {
        pointsToPromote,
        sportLabel: sportLabel(sport),
        divisionLabel: DIVISION_LABEL[division],
      })
      pending.push({ studentId: row.student_id, title: text.title, body: text.body })
    })
  }

  if (pending.length === 0) return { notified: 0 }

  // Dedupe: o cron roda todo dia e pode ser reexecutado no mesmo dia. Sem isto, uma
  // segunda passada mandaria o mesmo push de novo.
  const { data: jaAvisados } = await admin
    .from('notifications')
    .select('user_id')
    .eq('organization_id', orgId)
    .eq('type', NOTIFICATION_TYPE)
    // −03:00, não Z: `brtToday` já é data BRT; ancorá-la em UTC fazia a janela
    // "hoje" começar às 21h de ontem.
    .gte('created_at', `${brtToday(now)}T00:00:00.000${BRT_OFFSET}`)

  const avisados = new Set(((jaAvisados ?? []) as { user_id: string }[]).map((n) => n.user_id))
  const novos = pending.filter((p) => !avisados.has(p.studentId))
  if (novos.length === 0) return { notified: 0 }

  // Um aluno pode aparecer em duas modalidades; manda só o primeiro aviso dele.
  const vistos = new Set<string>()
  let notified = 0

  for (const p of novos) {
    if (vistos.has(p.studentId)) continue
    vistos.add(p.studentId)

    // Texto por aluno, então uma chamada por aluno. In-app + push: e-mail para isto
    // seria invasivo demais para o tamanho da informação.
    await notifyUsers(admin, {
      orgId,
      recipients: [{ userId: p.studentId }],
      type: NOTIFICATION_TYPE,
      title: p.title,
      body: p.body,
      channels: ['inapp', 'push'],
    })
    notified++
  }

  return { notified }
}
