'use server'
// features/torneios/participantActions.ts
// Ficha de contato de um inscrito, buscada no clique.
//
// Por que uma action e não um campo a mais na página: se o telefone viesse
// junto com a lista, o HTML da página do torneio carregaria o telefone de TODO
// mundo — e bastaria abrir o código-fonte para colher a lista inteira, mesmo
// com a interface escondendo. Buscando no clique, o número só sai do servidor
// para quem tem direito a ele, um de cada vez.
import { createAdminClient, createClient, getActiveOrgId } from '@/lib/supabase/server'
import { buildContactMessage } from '@/lib/torneios/contactMessage'
import { buildWhatsAppUrl } from '@/lib/utils/whatsappLink'
import {
  computeRecord,
  countTrophies,
  currentStreak,
  recentForm,
  type FormResult,
  type PlayerMatch,
} from '@/lib/torneios/playerStats'
import { getPlayerTournamentProfile } from './playerStatsQueries'

export interface ParticipantContact {
  playerId: string
  name: string
  /**
   * Link pronto do WhatsApp. null quando não há telefone cadastrado OU quando
   * quem pediu não tem direito de ver — a UI não distingue os dois casos de
   * propósito, para não confirmar a existência do número.
   */
  whatsappUrl: string | null
  /** Motivo de não haver link, para a UI dizer algo útil. */
  contactBlocked: 'no_phone' | 'not_allowed' | null
  /** Campanha do atleta NESTE torneio. */
  played: number
  wins: number
  losses: number
  /** Parceiro na inscrição (dupla fixa). */
  partnerName: string | null
  entryStatus: 'confirmed' | 'waitlist' | 'offered' | null
  /**
   * Carreira do atleta NESTA academia — o que dá peso ao nome antes do jogo.
   * Separado da campanha do torneio de propósito: "4 títulos" e "2 vitórias
   * neste torneio" respondem perguntas diferentes.
   */
  career: {
    titles: number
    podiums: number
    tournaments: number
    played: number
    wins: number
    winRate: number
    form: FormResult[]
    streak: { kind: 'win' | 'loss' | 'none'; count: number }
  }
}

/**
 * Quem pode ver o telefone de um inscrito.
 *
 * O organizador sempre — é ele que conduz o evento. Entre alunos, só quem
 * também está no torneio: a pessoa se inscreveu para jogar, não para ter o
 * número exposto a toda a academia. Aluno que só está passeando pela página vê
 * nome e campanha, sem contato.
 */
export async function getParticipantContact(
  tournamentId: string,
  playerId: string,
): Promise<{ error?: string; data?: ParticipantContact }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  const admin = createAdminClient()

  // O torneio precisa ser da academia ativa: sem isso, um id de outra academia
  // viraria consulta de telefone livre.
  const { data: tournament } = await admin
    .from('tournaments')
    .select('id, name, organization_id')
    .eq('id', tournamentId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!tournament) return { error: 'Torneio não encontrado.' }

  const [{ data: membership }, { data: org }, { data: entries }] = await Promise.all([
    admin
      .from('memberships')
      .select('role')
      .eq('user_id', user.id)
      .eq('organization_id', orgId)
      .maybeSingle(),
    admin.from('organizations').select('name').eq('id', orgId).maybeSingle(),
    admin
      .from('tournament_entries')
      .select('player_id, partner_id, entry_status')
      .eq('tournament_id', tournamentId)
      .eq('organization_id', orgId),
  ])

  type EntryRow = {
    player_id: string
    partner_id: string | null
    entry_status: 'confirmed' | 'waitlist' | 'offered'
  }
  const rows = (entries ?? []) as EntryRow[]

  const isAdmin = membership?.role === 'admin'
  const viewerIsEntrant = rows.some(
    (e) => e.player_id === user.id || e.partner_id === user.id,
  )
  const targetEntry =
    rows.find((e) => e.player_id === playerId || e.partner_id === playerId) ?? null
  if (!targetEntry) return { error: 'Esta pessoa não está inscrita neste torneio.' }

  const canSeeContact = isAdmin || viewerIsEntrant

  // Nomes: o alvo, o parceiro dele e quem está pedindo (para assinar a mensagem).
  const partnerId =
    targetEntry.player_id === playerId ? targetEntry.partner_id : targetEntry.player_id
  const wanted = Array.from(new Set([playerId, partnerId, user.id].filter((x): x is string => !!x)))
  const { data: profiles } = await admin
    .from('profiles')
    .select('id, full_name, phone')
    .in('id', wanted)

  type ProfileRow = { id: string; full_name: string | null; phone: string | null }
  const byId = new Map(((profiles ?? []) as ProfileRow[]).map((p) => [p.id, p]))
  const target = byId.get(playerId)
  if (!target) return { error: 'Pessoa não encontrada.' }

  const name = target.full_name ?? 'Atleta'
  const phone = (target.phone ?? '').trim()

  let whatsappUrl: string | null = null
  let contactBlocked: ParticipantContact['contactBlocked'] = null
  if (!canSeeContact) {
    contactBlocked = 'not_allowed'
  } else if (!phone) {
    contactBlocked = 'no_phone'
  } else {
    whatsappUrl = buildWhatsAppUrl(
      phone,
      buildContactMessage({
        toName: name,
        fromName: byId.get(user.id)?.full_name ?? null,
        tournamentName: tournament.name as string,
        orgName: (org?.name as string | undefined) ?? null,
        fromAdmin: isAdmin,
      }),
    )
  }

  // Campanha no torneio. Só placar confirmado conta — pendente ainda pode ser
  // contestado pela dupla adversária.
  const { data: matchRows } = await admin
    .from('tournament_matches')
    .select('id, player1_id, partner1_id, player2_id, partner2_id, games1, games2')
    .eq('tournament_id', tournamentId)
    .eq('organization_id', orgId)
    .eq('result_status', 'confirmed')

  const matches: PlayerMatch[] = ((matchRows ?? []) as Array<{
    id: string
    player1_id: string | null
    partner1_id: string | null
    player2_id: string | null
    partner2_id: string | null
    games1: number | null
    games2: number | null
  }>).map((m) => ({
    id: m.id,
    tournamentId,
    tournamentName: tournament.name as string,
    date: '',
    side1: [m.player1_id, m.partner1_id].filter((x): x is string => !!x),
    side2: [m.player2_id, m.partner2_id].filter((x): x is string => !!x),
    games1: m.games1 ?? 0,
    games2: m.games2 ?? 0,
  }))
  const record = computeRecord(playerId, matches)

  // Carreira: reusa a mesma leitura da página de retrospecto, então título e
  // aproveitamento aqui batem com o que ela mostra.
  const career = await getPlayerTournamentProfile({ orgId, playerId })
  const careerRecord = career ? computeRecord(playerId, career.matches) : null
  const trophies = countTrophies(career?.podiums ?? [])

  return {
    data: {
      playerId,
      name,
      whatsappUrl,
      contactBlocked,
      played: record.played,
      wins: record.wins,
      losses: record.losses,
      partnerName: partnerId ? byId.get(partnerId)?.full_name ?? null : null,
      entryStatus: targetEntry.entry_status,
      career: {
        titles: trophies.titles,
        podiums: trophies.podiums,
        tournaments: career?.tournamentCount ?? 0,
        played: careerRecord?.played ?? 0,
        wins: careerRecord?.wins ?? 0,
        winRate: careerRecord?.winRate ?? 0,
        form: career ? recentForm(playerId, career.matches) : [],
        streak: career ? currentStreak(playerId, career.matches) : { kind: 'none', count: 0 },
      },
    },
  }
}
