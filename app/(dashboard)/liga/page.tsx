// app/(dashboard)/liga/page.tsx
// Aba Liga do aluno: divisão, sequência, ranking, extrato e o bloco de vídeo.
export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createAdminClient, getCurrentOrgId, getAuthUser } from '@/lib/supabase/server'
import { Trophy } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { getLigaSettings } from '@/features/liga/settings'
import { firstDemotedPosition, promoteLimit } from '@/lib/liga/divisions'
import { getOrCreateActiveSeason } from '@/features/liga/season'
import {
  getLigaView,
  getSeasonHistory,
  getStudentLigaSports,
  getStudentMedals,
  getRecentKudos,
  getKudosPeers,
  getLigaPrizeView,
} from '@/features/liga/queries'
import { PrizeBanner } from '@/features/liga/PrizeBanner'
import { RulesCard } from '@/features/liga/RulesCard'
import { KudosCard } from '@/features/liga/KudosCard'
import { ComunidadeSection } from '@/features/comunidade/ComunidadeSection'
import { PhotoGallery } from '@/features/torneios/PhotoGallery'
import { getRecentOrgPhotos } from '@/features/torneios/photoQueries'
import { getFeedData } from '@/features/comunidade/feed'
import { MedalsCard } from '@/features/liga/MedalsCard'
import { MedalCelebration, type CelebratedMedal } from '@/features/liga/MedalCelebration'
import { MEDAL_BY_KEY } from '@/lib/liga/medals'
import { sportLabel } from '@/lib/arenas/sports'
import { LigaHero } from '@/features/liga/LigaHero'
import { Reveal } from '@/components/ui/Reveal'
import { StreakCard } from '@/features/liga/StreakCard'
import { DivisionRanking } from '@/features/liga/DivisionRanking'
import { SeasonHistory } from '@/features/liga/SeasonHistory'
import { PointsLedger } from '@/features/liga/PointsLedger'
import { SportTabs } from '@/features/liga/SportTabs'
import { VideoBlock } from './VideoBlock'

async function readVideoFeedUrl(orgId: string | null): Promise<string | null> {
  if (!orgId) return null
  const { data } = await createAdminClient()
    .from('system_settings')
    .select('value')
    .eq('organization_id', orgId)
    .eq('key', 'video_feed_url')
    .maybeSingle()
  return (data as { value: string } | null)?.value ?? null
}

export default async function LigaPage({
  searchParams,
}: {
  searchParams: { esporte?: string }
}) {
  const user = await getAuthUser()
  if (!user) redirect('/login')

  const orgId = await getCurrentOrgId()
  const [settings, videoFeedUrl] = await Promise.all([
    getLigaSettings(orgId),
    readVideoFeedUrl(orgId),
  ])

  const header = (
    <div className="sticky top-0 z-10 bg-surface border-b border-surface-border px-4 py-3">
      <SectionHeader title="Liga" />
    </div>
  )

  // Liga desligada: a aba continua servindo o vídeo, que é o que ela já fazia antes.
  if (!settings.enabled || !orgId) {
    return (
      <div className="relative min-h-full pb-24">
        {header}
        <div className="px-4 py-4 space-y-3">
          <VideoBlock videoFeedUrl={videoFeedUrl} />
          {!videoFeedUrl && (
            <EmptyState
              icon={Trophy}
              title="A Liga ainda não começou"
              description="Sua academia ainda não ativou o ranking. Quando ativar, suas presenças passam a valer pontos aqui."
            />
          )}
        </div>
      </div>
    )
  }

  const season = await getOrCreateActiveSeason(orgId)
  if (!season) {
    return (
      <div className="relative min-h-full pb-24">
        {header}
        <div className="px-4 py-4 space-y-3">
          <EmptyState
            icon={Trophy}
            title="A temporada ainda vai começar"
            description="Assim que a academia abrir a temporada, seus pontos aparecem aqui."
          />
          <VideoBlock videoFeedUrl={videoFeedUrl} />
        </div>
      </div>
    )
  }

  const sports = await getStudentLigaSports(orgId, user.id, season.id)

  if (sports.length === 0) {
    return (
      <div className="relative min-h-full pb-24">
        {header}
        <div className="px-4 py-4 space-y-3">
          <EmptyState
            icon={Trophy}
            title="Escolha suas modalidades"
            description="A Liga tem um ranking por modalidade. Diga quais você pratica e já entra na disputa desta temporada."
            ctaHref="/perfil"
            ctaLabel="Escolher no perfil"
          />
          <VideoBlock videoFeedUrl={videoFeedUrl} />
        </div>
      </div>
    )
  }

  const activeSport = sports.includes(searchParams.esporte ?? '')
    ? (searchParams.esporte as string)
    : sports[0]

  const [view, history, medals, kudos, peers, feed, photos, prizeView, membershipRow] =
    await Promise.all([
      getLigaView(orgId, user.id, season, activeSport, settings.cuts),
      getSeasonHistory(orgId, user.id, activeSport),
      getStudentMedals(orgId, user.id),
      getRecentKudos(orgId, user.id),
      getKudosPeers(season.id, activeSport, user.id),
      getFeedData(orgId, user.id),
      getRecentOrgPhotos(orgId),
      getLigaPrizeView(orgId, user.id, season.id),
      createAdminClient()
        .from('memberships')
        .select('role')
        .eq('user_id', user.id)
        .eq('organization_id', orgId)
        .maybeSingle(),
    ])

  // Só admin fixa post no mural. O papel é por-academia, então vem da membership.
  const isAdmin = (membershipRow.data as { role: string } | null)?.role === 'admin'

  // A comemoração é de TODAS as não vistas, não só as da modalidade aberta: a medalha
  // foi conquistada, e escondê-la porque o aluno abriu a outra aba seria perder o
  // único momento em que ela aparece.
  const unseen: CelebratedMedal[] = medals
    .filter((m) => !m.seen_at)
    .map((m) => {
      const def = MEDAL_BY_KEY.get(m.medal_key)
      return def
        ? {
            id: m.id,
            label: def.label,
            description: def.description,
            icon: def.icon,
            sportLabel: m.sport ? sportLabel(m.sport) : null,
          }
        : null
    })
    // Medalha cujo catálogo sumiu (chave renomeada num deploy) não tem o que comemorar.
    .filter((m): m is CelebratedMedal => m !== null)

  return (
    <div className="relative min-h-full pb-24">
      {header}
      <div className="space-y-3 px-4 py-4">
        <SportTabs sports={sports} active={activeSport} />
        {view && (
          <>
            <Reveal step={0}>
              <LigaHero
                division={view.division}
                points={view.points}
                position={view.position}
                divisionSize={view.divisionSize}
                pointsToPromote={view.pointsToPromote}
                streakWeeks={view.streakWeeks}
                sport={view.sport}
                endsOn={season.ends_on}
                promoteCount={promoteLimit(settings.cuts, view.division)}
              />
            </Reveal>
            <Reveal step={1}>
              <RulesCard settings={settings} />
            </Reveal>
            <Reveal step={2}>
              <PrizeBanner prizes={prizeView.prizes} myAwards={prizeView.myAwards} />
            </Reveal>
            <Reveal step={3}>
              <StreakCard streakWeeks={view.streakWeeks} />
            </Reveal>
            <Reveal step={4}>
              <DivisionRanking
                entries={view.ranking}
                division={view.division}
                divisionSize={view.divisionSize}
                promoteCount={promoteLimit(settings.cuts, view.division)}
                demoteFrom={firstDemotedPosition(settings.cuts, view.division, view.divisionSize)}
              />
            </Reveal>
            <Reveal step={5}>
              <SeasonHistory rows={history} />
            </Reveal>
            <Reveal step={6}>
              <MedalsCard medals={medals} sport={activeSport} />
            </Reveal>
            <Reveal step={7}>
              <KudosCard
                peers={peers}
                recent={kudos}
                sport={activeSport}
                weeklyCap={settings.kudosWeeklyCap}
              />
            </Reveal>
            <Reveal step={8}>
              <PhotoGallery photos={photos} title="FOTOS DOS TORNEIOS" />
            </Reveal>
            <Reveal step={9}>
              <ComunidadeSection
                currentUserId={user.id}
                activeOrgId={orgId}
                initialPosts={feed.posts}
                initialLikedPostIds={feed.likedPostIds}
                canPin={isAdmin}
              />
            </Reveal>
          </>
        )}
        <Reveal step={10}>
          <VideoBlock videoFeedUrl={videoFeedUrl} />
        </Reveal>
        {view && (
          <Reveal step={11}>
            <PointsLedger entries={view.ledger} />
          </Reveal>
        )}
      </div>
      <MedalCelebration medals={unseen} />
    </div>
  )
}
