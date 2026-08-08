// features/liga/queries.ts
// Leituras da Liga para a tela do aluno. Tudo escopado por organization_id.
import { createAdminClient } from '@/lib/supabase/server'
import type { LigaDivision, LigaMedal, LigaPointEntry, LigaSeason } from '@/types'

export interface RankingEntry {
  studentId: string
  fullName: string
  avatarUrl: string | null
  points: number
  position: number
  isMe: boolean
}

export interface LigaView {
  season: LigaSeason
  sport: string
  division: LigaDivision
  points: number
  streakWeeks: number
  position: number
  divisionSize: number
  pointsToPromote: number | null
  ranking: RankingEntry[]
  ledger: LigaPointEntry[]
}

/** Esportes em que o aluno tem posição nesta temporada, mais os que ele declarou. */
export async function getStudentLigaSports(
  orgId: string,
  studentId: string,
  seasonId: string,
): Promise<string[]> {
  const admin = createAdminClient()

  const [{ data: membership }, { data: standings }] = await Promise.all([
    admin
      .from('memberships')
      .select('sports')
      .eq('user_id', studentId)
      .eq('organization_id', orgId)
      .maybeSingle(),
    admin
      .from('liga_standings')
      .select('sport')
      .eq('season_id', seasonId)
      .eq('student_id', studentId),
  ])

  const declared = (membership as { sports: string[] } | null)?.sports ?? []
  const scored = ((standings ?? []) as { sport: string }[]).map((r) => r.sport)
  return Array.from(new Set([...declared, ...scored]))
}

/**
 * Tudo o que a tela da Liga precisa para um (aluno, esporte).
 *
 * O ranking exclui quem optou por sair (`memberships.liga_opted_out`), exceto o
 * próprio aluno — quem saiu continua vendo a própria posição.
 */
export async function getLigaView(
  orgId: string,
  studentId: string,
  season: LigaSeason,
  sport: string,
  promoteCount: number,
): Promise<LigaView | null> {
  const admin = createAdminClient()

  const { data: mine } = await admin
    .from('liga_standings')
    .select('division, points, streak_weeks')
    .eq('season_id', season.id)
    .eq('student_id', studentId)
    .eq('sport', sport)
    .maybeSingle()

  const standing = (mine as {
    division: LigaDivision
    points: number
    streak_weeks: number
  } | null) ?? { division: 'bronze' as LigaDivision, points: 0, streak_weeks: 0 }

  const { data: divisionRows } = await admin
    .from('liga_standings')
    .select('student_id, points')
    .eq('season_id', season.id)
    .eq('sport', sport)
    .eq('division', standing.division)
    .order('points', { ascending: false })

  const rows = (divisionRows ?? []) as { student_id: string; points: number }[]

  // Nomes e opt-out de todos os envolvidos, numa consulta.
  const ids = rows.map((r) => r.student_id)
  const [{ data: profiles }, { data: memberships }] = await Promise.all([
    ids.length > 0
      ? admin.from('profiles').select('id, full_name, avatar_url').in('id', ids)
      : Promise.resolve({
          data: [] as { id: string; full_name: string; avatar_url: string | null }[],
        }),
    ids.length > 0
      ? admin
          .from('memberships')
          .select('user_id, liga_opted_out')
          .eq('organization_id', orgId)
          .in('user_id', ids)
      : Promise.resolve({ data: [] as { user_id: string; liga_opted_out: boolean }[] }),
  ])

  const profileById = new Map(
    (
      (profiles ?? []) as { id: string; full_name: string; avatar_url: string | null }[]
    ).map((p) => [p.id, p]),
  )
  const optedOut = new Set(
    ((memberships ?? []) as { user_id: string; liga_opted_out: boolean }[])
      .filter((m) => m.liga_opted_out)
      .map((m) => m.user_id),
  )

  const ranking: RankingEntry[] = rows
    .map((r, i) => ({
      studentId: r.student_id,
      fullName: profileById.get(r.student_id)?.full_name ?? 'Aluno',
      avatarUrl: profileById.get(r.student_id)?.avatar_url ?? null,
      points: r.points,
      position: i + 1,
      isMe: r.student_id === studentId,
    }))
    .filter((e) => e.isMe || !optedOut.has(e.studentId))

  const myPosition = rows.findIndex((r) => r.student_id === studentId) + 1

  // Quanto falta para entrar na zona de promoção — o corte é o último colocado que
  // ainda sobe, então depende do promoteCount configurado pela academia.
  const cutoffIndex = Math.max(0, Math.min(rows.length - 1, promoteCount - 1))
  const promoteCutoff = rows[cutoffIndex]?.points ?? 0
  const alreadyPromoting = myPosition > 0 && myPosition <= promoteCount
  const pointsToPromote =
    standing.division === 'diamante' || alreadyPromoting
      ? null
      : Math.max(1, promoteCutoff - standing.points + 1)

  const { data: ledgerRows } = await admin
    .from('liga_points')
    .select('*')
    .eq('season_id', season.id)
    .eq('student_id', studentId)
    .eq('sport', sport)
    .order('created_at', { ascending: false })
    .limit(30)

  return {
    season,
    sport,
    division: standing.division,
    points: standing.points,
    streakWeeks: standing.streak_weeks,
    position: myPosition > 0 ? myPosition : rows.length + 1,
    divisionSize: rows.length,
    pointsToPromote,
    ranking,
    ledger: (ledgerRows ?? []) as LigaPointEntry[],
  }
}

/**
 * Medalhas do aluno naquela academia, das mais recentes para as mais antigas.
 *
 * Não filtra por temporada: medalha é permanente, ao contrário do ponto, que zera todo
 * dia 1º. E não filtra por esporte porque a tela mostra as globais junto com as da
 * modalidade escolhida.
 */
export async function getStudentMedals(
  orgId: string,
  studentId: string,
): Promise<LigaMedal[]> {
  const { data } = await createAdminClient()
    .from('liga_medals')
    .select('*')
    .eq('organization_id', orgId)
    .eq('student_id', studentId)
    .order('earned_at', { ascending: false })

  return (data ?? []) as LigaMedal[]
}

export interface KudosView {
  id: string
  fromName: string
  toName: string
  category: string
  message: string
  createdAt: string
  fromMe: boolean
  toMe: boolean
}

/** Últimos elogios da academia, com os nomes já resolvidos. */
export async function getRecentKudos(
  orgId: string,
  viewerId: string,
  limit = 12,
): Promise<KudosView[]> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('liga_kudos')
    .select('id, from_student_id, to_student_id, category, message, created_at')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
    .limit(limit)

  const rows = (data ?? []) as {
    id: string
    from_student_id: string
    to_student_id: string
    category: string
    message: string
    created_at: string
  }[]
  if (rows.length === 0) return []

  const ids = Array.from(new Set(rows.flatMap((r) => [r.from_student_id, r.to_student_id])))
  const { data: profiles } = await admin.from('profiles').select('id, full_name').in('id', ids)
  const nameById = new Map(
    ((profiles ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name]),
  )

  return rows.map((r) => ({
    id: r.id,
    fromName: nameById.get(r.from_student_id) ?? 'Aluno',
    toName: nameById.get(r.to_student_id) ?? 'Aluno',
    category: r.category,
    message: r.message,
    createdAt: r.created_at,
    fromMe: r.from_student_id === viewerId,
    toMe: r.to_student_id === viewerId,
  }))
}

/**
 * Colegas que o aluno pode elogiar: quem pontuou na mesma modalidade nesta temporada.
 *
 * Sai de `liga_standings` e não da lista de alunos da academia porque elogio é entre
 * quem divide a quadra. Numa academia de 300 alunos, um seletor com todo mundo seria
 * inútil — e convidaria justamente ao elogio aleatório que as travas tentam conter.
 */
export async function getKudosPeers(
  seasonId: string,
  sport: string,
  viewerId: string,
): Promise<{ id: string; name: string }[]> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('liga_standings')
    .select('student_id')
    .eq('season_id', seasonId)
    .eq('sport', sport)

  const ids = ((data ?? []) as { student_id: string }[])
    .map((r) => r.student_id)
    .filter((id) => id !== viewerId)
  if (ids.length === 0) return []

  const { data: profiles } = await admin.from('profiles').select('id, full_name').in('id', ids)
  return ((profiles ?? []) as { id: string; full_name: string }[])
    .map((p) => ({ id: p.id, name: p.full_name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
}
