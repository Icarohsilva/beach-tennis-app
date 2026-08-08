// app/(dashboard)/liga/page.tsx
// Aba Liga do aluno: divisão, sequência, ranking, extrato e o bloco de vídeo.
export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createClient, createAdminClient, getCurrentOrgId } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { getLigaSettings } from '@/features/liga/settings'
import { getOrCreateActiveSeason } from '@/features/liga/season'
import { getLigaView, getStudentLigaSports } from '@/features/liga/queries'
import { SeasonCard } from '@/features/liga/SeasonCard'
import { StreakCard } from '@/features/liga/StreakCard'
import { DivisionRanking } from '@/features/liga/DivisionRanking'
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
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
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
            <Card>
              <p className="text-sm text-slate-300">
                A Liga ainda não foi ativada pela sua academia.
              </p>
            </Card>
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
          <Card>
            <p className="text-sm text-slate-300">A temporada ainda vai começar.</p>
          </Card>
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
          <Card>
            <p className="text-sm text-slate-300">
              Escolha suas modalidades no perfil para entrar no ranking da academia.
            </p>
          </Card>
          <VideoBlock videoFeedUrl={videoFeedUrl} />
        </div>
      </div>
    )
  }

  const activeSport = sports.includes(searchParams.esporte ?? '')
    ? (searchParams.esporte as string)
    : sports[0]

  const view = await getLigaView(orgId, user.id, season, activeSport, settings.promoteCount)

  return (
    <div className="relative min-h-full pb-24">
      {header}
      <div className="px-4 py-4 space-y-3">
        <SportTabs sports={sports} active={activeSport} />
        {view && (
          <>
            <SeasonCard
              division={view.division}
              points={view.points}
              position={view.position}
              divisionSize={view.divisionSize}
              pointsToPromote={view.pointsToPromote}
              sport={view.sport}
              endsOn={season.ends_on}
            />
            <StreakCard streakWeeks={view.streakWeeks} />
            <DivisionRanking entries={view.ranking} />
            <PointsLedger entries={view.ledger} />
          </>
        )}
        <VideoBlock videoFeedUrl={videoFeedUrl} />
      </div>
    </div>
  )
}
