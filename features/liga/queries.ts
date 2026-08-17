// features/liga/queries.ts
// Leituras da Liga para a tela do aluno. Tudo escopado por organization_id.
import { createAdminClient } from '@/lib/supabase/server'
import { DIVISION_ORDER, promoteLimit, type DivisionCuts } from '@/lib/liga/divisions'
import { missingProfileFields } from '@/lib/liga/profileComplete'
import { readProfileFields } from './extraPoints'
import { getLigaSettings } from './settings'
import type {
  LigaDivision,
  LigaMedal,
  LigaPointEntry,
  LigaPrize,
  LigaPrizeAward,
  LigaSeason,
} from '@/types'

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
  cuts: DivisionCuts,
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
          .select('user_id, liga_opted_out, archived_at')
          .eq('organization_id', orgId)
          .in('user_id', ids)
      : Promise.resolve({
          data: [] as { user_id: string; liga_opted_out: boolean; archived_at: string | null }[],
        }),
  ])

  const profileById = new Map(
    (
      (profiles ?? []) as { id: string; full_name: string; avatar_url: string | null }[]
    ).map((p) => [p.id, p]),
  )
  // Cadastro inativo sai do ranking pelo mesmo caminho de quem optou por não
  // aparecer: `liga_standings` é cache de posição e continua tendo a linha de quem
  // saiu (o extrato em `liga_points` é a verdade e não se apaga), então sem este
  // filtro alguém que deixou a academia seguiria ocupando lugar na tabela.
  const hidden = new Set(
    (
      (memberships ?? []) as {
        user_id: string
        liga_opted_out: boolean
        archived_at: string | null
      }[]
    )
      .filter((m) => m.liga_opted_out || m.archived_at)
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
    .filter((e) => e.isMe || !hidden.has(e.studentId))

  const myPosition = rows.findIndex((r) => r.student_id === studentId) + 1

  // Quanto falta para entrar na zona de promoção — o corte é o último colocado que
  // ainda sobe, então depende do corte que a academia configurou PARA ESTA divisão.
  const promoteCount = promoteLimit(cuts, standing.division)
  const cutoffIndex = Math.max(0, Math.min(rows.length - 1, promoteCount - 1))
  const promoteCutoff = rows[cutoffIndex]?.points ?? 0
  const alreadyPromoting = myPosition > 0 && myPosition <= promoteCount
  // promoteCount 0 é o topo da escada ou uma divisão que a academia fechou: não há
  // para onde subir, e prometer "faltam X pontos" seria mentira.
  const pointsToPromote =
    promoteCount === 0 || alreadyPromoting
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

/** O que está valendo na temporada e o que este aluno já ganhou (e ainda não recebeu). */
export async function getLigaPrizeView(
  orgId: string,
  studentId: string,
  seasonId: string,
): Promise<{ prizes: LigaPrize[]; myAwards: LigaPrizeAward[] }> {
  const admin = createAdminClient()

  const [{ data: prizes }, { data: awards }] = await Promise.all([
    admin
      .from('liga_prizes')
      .select('*')
      .eq('season_id', seasonId)
      .order('kind')
      .order('position', { nullsFirst: false }),
    // Prêmios de QUALQUER temporada ainda não entregues: o fechamento vira a
    // temporada, então o prêmio ganho é sempre da anterior — filtrar pela corrente
    // esconderia justamente o que o aluno acabou de ganhar.
    admin
      .from('liga_prize_awards')
      .select('*')
      .eq('organization_id', orgId)
      .eq('student_id', studentId)
      .eq('delivered', false)
      .order('created_at', { ascending: false })
      .limit(5),
  ])

  return {
    prizes: (prizes ?? []) as LigaPrize[],
    myAwards: (awards ?? []) as LigaPrizeAward[],
  }
}

export interface SeasonHistoryRow {
  seasonId: string
  startsOn: string
  endsOn: string
  /** Onde o aluno terminou. null = ele não pontuou naquela temporada. */
  me: { division: LigaDivision; position: number; points: number } | null
  /** Campeão da temporada naquele esporte. null = ninguém pontuou. */
  champion: { name: string; division: LigaDivision; points: number } | null
}

/**
 * Temporadas já fechadas, das mais recentes para as mais antigas.
 *
 * Não existe tabela de histórico: `liga_standings` é escopado por `season_id` e o
 * fechamento não apaga as linhas da temporada que fechou — cria linhas novas para a
 * temporada nova. O passado já está gravado; isto aqui só o lê.
 *
 * "Campeão da temporada" é o 1º da **divisão mais alta que teve alguém com ponto**, e não
 * o maior número de pontos da academia: o Bronze costuma ter mais gente e mais volume, e
 * premiar volume em vez de patamar inverteria o sentido da escada.
 */
export async function getSeasonHistory(
  orgId: string,
  studentId: string | null,
  sport: string,
  limit = 6,
): Promise<SeasonHistoryRow[]> {
  const admin = createAdminClient()

  const { data: seasonRows } = await admin
    .from('liga_seasons')
    .select('id, starts_on, ends_on')
    .eq('organization_id', orgId)
    .eq('status', 'closed')
    .order('starts_on', { ascending: false })
    .limit(limit)

  const seasons = (seasonRows ?? []) as { id: string; starts_on: string; ends_on: string }[]
  if (seasons.length === 0) return []

  // Uma query para todas as temporadas da janela, não uma por temporada. O teto é
  // natural (6 temporadas × alunos da academia), então não precisa de fetchAllPages.
  const { data: standingRows } = await admin
    .from('liga_standings')
    .select('season_id, student_id, division, points')
    .eq('sport', sport)
    .in(
      'season_id',
      seasons.map((s) => s.id),
    )

  const rows = (standingRows ?? []) as {
    season_id: string
    student_id: string
    division: LigaDivision
    points: number
  }[]

  const bySeason = new Map<string, typeof rows>()
  for (const r of rows) {
    const list = bySeason.get(r.season_id) ?? []
    list.push(r)
    bySeason.set(r.season_id, list)
  }

  // Nomes dos campeões: resolvidos de uma vez, depois de saber quem são.
  const championIds = new Set<string>()
  const championBySeason = new Map<string, { studentId: string; division: LigaDivision; points: number }>()
  for (const season of seasons) {
    const lista = (bySeason.get(season.id) ?? []).filter((r) => r.points > 0)
    if (lista.length === 0) continue
    const topDivision = lista
      .map((r) => r.division)
      .sort((a, b) => DIVISION_ORDER.indexOf(b) - DIVISION_ORDER.indexOf(a))[0]
    const champ = lista
      .filter((r) => r.division === topDivision)
      .sort((a, b) => b.points - a.points || a.student_id.localeCompare(b.student_id))[0]
    if (!champ) continue
    championIds.add(champ.student_id)
    championBySeason.set(season.id, {
      studentId: champ.student_id,
      division: champ.division,
      points: champ.points,
    })
  }

  const ids = Array.from(championIds)
  const { data: profiles } =
    ids.length > 0
      ? await admin.from('profiles').select('id, full_name').in('id', ids)
      : { data: [] as { id: string; full_name: string }[] }
  const nameById = new Map(
    ((profiles ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name]),
  )

  return seasons.map((season) => {
    const lista = bySeason.get(season.id) ?? []
    const mine = studentId ? lista.find((r) => r.student_id === studentId) : undefined

    // Posição dentro da divisão dele, que é a disputa que ele jogou — mesma ordenação
    // (e mesmo desempate) do ranking ao vivo.
    let me: SeasonHistoryRow['me'] = null
    if (mine) {
      const naDivisao = lista
        .filter((r) => r.division === mine.division)
        .sort((a, b) => b.points - a.points || a.student_id.localeCompare(b.student_id))
      me = {
        division: mine.division,
        position: naDivisao.findIndex((r) => r.student_id === mine.student_id) + 1,
        points: mine.points,
      }
    }

    const champ = championBySeason.get(season.id)
    return {
      seasonId: season.id,
      startsOn: season.starts_on,
      endsOn: season.ends_on,
      me,
      champion: champ
        ? {
            name: nameById.get(champ.studentId) ?? 'Aluno',
            division: champ.division,
            points: champ.points,
          }
        : null,
    }
  })
}

export interface ProfileBonusStatus {
  /** Quanto vale o bônus nesta academia. */
  points: number
  /** Campos que ainda faltam, já em rótulo de tela. Vazio = completo. */
  missing: string[]
}

/**
 * O que falta no cadastro do aluno para o bônus único da Liga.
 *
 * Devolve null quando não há nada a dizer: Liga desligada, fonte zerada pela academia,
 * bônus já recebido ou cadastro já completo. A tela não decide isso — se decidisse,
 * mostraria uma cobrança a quem já ganhou o ponto.
 *
 * A régua vem de `missingProfileFields`, a MESMA que `checkProfileComplete` usa para
 * conceder. É esse compartilhamento que impede a tela de pedir um campo que o motor não
 * exige (ou pior, calar sobre um que ele exige — o defeito que originou este bloco).
 */
export async function getProfileBonusStatus(
  orgId: string | null,
  studentId: string,
): Promise<ProfileBonusStatus | null> {
  if (!orgId) return null

  const settings = await getLigaSettings(orgId)
  if (!settings.enabled) return null

  const points = settings.weights.profileComplete
  if (!points || points <= 0) return null

  const admin = createAdminClient()

  const { count } = await admin
    .from('liga_points')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('student_id', studentId)
    .eq('reason', 'profile_complete')
  if ((count ?? 0) > 0) return null

  const missing = missingProfileFields(await readProfileFields(admin, orgId, studentId))
  if (missing.length === 0) return null

  return { points, missing }
}
