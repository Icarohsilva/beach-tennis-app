// app/(dashboard)/torneios/atleta/[id]/page.tsx
// Retrospecto de um atleta nos torneios da academia.
//
// É a página que os apps de torneio chamam de perfil do jogador: campanha,
// troféus, com quem rende mais e o confronto direto. Quando você abre o perfil
// de OUTRA pessoa, o H2H entre vocês vem primeiro — é a informação que faz
// alguém abrir esta página antes de um jogo.
//
// Aqui só busca e cálculo; o desenho é PlayerProfileView.
import { notFound, redirect } from 'next/navigation'
import { getActiveOrgId, getAuthUser } from '@/lib/supabase/server'
import { getPlayerTournamentProfile } from '@/features/torneios/playerStatsQueries'
import {
  computeRecord,
  countTrophies,
  currentStreak,
  headToHead,
  headToHeadWith,
  partnerRecords,
  recentForm,
  sideOf,
  wonBy,
} from '@/lib/torneios/playerStats'
import {
  PlayerProfileView,
  type RecentMatchView,
} from '@/features/torneios/PlayerProfileView'

/** Quantos confrontos e parcerias listar antes de virar ruído. */
const LIST_LIMIT = 5
const RECENT_MATCHES = 8

interface PageProps {
  params: { id: string }
}

export default async function AtletaPage({ params }: PageProps) {
  const user = await getAuthUser()
  if (!user) redirect('/login')

  const orgId = await getActiveOrgId()
  // A busca é escopada na academia ativa, então id de outra org cai aqui.
  const profile = await getPlayerTournamentProfile({ orgId, playerId: params.id })
  if (!profile) notFound()

  const { matches, nameById, podiums, name, tournamentCount } = profile
  const isMe = params.id === user.id

  const recent: RecentMatchView[] = matches
    .slice(-RECENT_MATCHES)
    .reverse()
    .map((m) => {
      const side = sideOf(params.id, m)
      const mine = side === 1 ? m.games1 : m.games2
      const theirs = side === 1 ? m.games2 : m.games1
      return {
        id: m.id,
        tournamentId: m.tournamentId,
        tournamentName: m.tournamentName,
        date: m.date,
        opponents: (side === 1 ? m.side2 : m.side1)
          .map((id) => nameById[id] ?? 'Jogador')
          .join(' / '),
        score: `${mine} × ${theirs}`,
        won: wonBy(params.id, m),
      }
    })

  return (
    <PlayerProfileView
      name={name}
      tournamentCount={tournamentCount}
      record={computeRecord(params.id, matches)}
      trophies={countTrophies(podiums)}
      streak={currentStreak(params.id, matches)}
      form={recentForm(params.id, matches)}
      rivals={headToHead(params.id, matches).slice(0, LIST_LIMIT)}
      partners={partnerRecords(params.id, matches).slice(0, LIST_LIMIT)}
      recent={recent}
      nameById={nameById}
      isMe={isMe}
      // O confronto entre quem olha e quem é olhado só existe no perfil alheio.
      versusMe={isMe ? null : headToHeadWith(user.id, params.id, matches)}
    />
  )
}
