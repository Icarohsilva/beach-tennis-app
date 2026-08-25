// app/(admin)/admin/torneios/[id]/editar/page.tsx
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createAdminClient, getCurrentOrgId } from '@/lib/supabase/server'
import { requirePlatformAccess } from '@/lib/billing/guard'
import { resolveTournamentContent } from '@/lib/torneios/content'
import { sortPrizes, type PrizeRow } from '@/lib/torneios/prizes'
import { TournamentContentForm } from './TournamentContentForm'
import { TournamentPrizesCard } from './TournamentPrizesCard'

interface PageProps { params: { id: string } }

export default async function EditarTorneioPage({ params }: PageProps) {
  await requirePlatformAccess() // gate de cobranca; ver lib/billing/guard.ts
  const adminClient = createAdminClient()
  const orgId = await getCurrentOrgId()
  if (!orgId) notFound()

  const { data: tournament } = await adminClient
    .from('tournaments')
    .select('id, name, date, description, rules, venue, start_time, registration_deadline, event_id')
    .eq('id', params.id)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!tournament) notFound()

  const { data: event } = tournament.event_id
    ? await adminClient
        .from('tournament_events')
        .select('name, slug, description, rules, venue')
        .eq('id', tournament.event_id as string)
        .maybeSingle()
    : { data: null }

  const resolved = resolveTournamentContent({
    tournament: {
      description: tournament.description as string | null,
      rules: tournament.rules as string | null,
      venue: tournament.venue as string | null,
    },
    event: event
      ? {
          name: event.name as string,
          slug: event.slug as string,
          description: event.description as string | null,
          rules: event.rules as string | null,
          venue: event.venue as string | null,
        }
      : null,
  })

  const { data: prizesRaw } = await adminClient
    .from('tournament_prizes')
    .select('id, kind, position, description, value_cents, delivered_at')
    .eq('tournament_id', params.id)
    .order('position', { ascending: true })
  const prizes = sortPrizes((prizesRaw ?? []) as PrizeRow[])

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <Link
        href={`/admin/torneios/${params.id}`}
        className="flex items-center gap-1 text-sm text-slate-400 hover:text-white"
      >
        <ArrowLeft size={16} />
        Voltar ao torneio
      </Link>

      <div>
        <h1 className="text-2xl font-bold text-white">Configurar torneio</h1>
        <p className="text-slate-400 mt-1 text-sm">{tournament.name as string}</p>
      </div>

      <TournamentContentForm
        tournamentId={params.id}
        tournamentDate={tournament.date as string}
        own={{
          description: tournament.description as string | null,
          rules: tournament.rules as string | null,
          venue: tournament.venue as string | null,
          start_time: tournament.start_time as string | null,
          registration_deadline: tournament.registration_deadline as string | null,
        }}
        resolved={resolved}
      />

      <TournamentPrizesCard tournamentId={params.id} initialPrizes={prizes} />
    </div>
  )
}
