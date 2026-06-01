// app/(dashboard)/torneios/[id]/page.tsx
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { BracketView } from '@/features/torneios/BracketView'
import { formatDate } from '@/lib/utils/dateHelpers'
import type { Tournament, TournamentStatus } from '@/types'
import type { TournamentMatch } from '@/features/torneios/BracketView'
import { RegisterButton } from './RegisterButton'

const STATUS_LABELS: Record<TournamentStatus, string> = {
  draft: 'Rascunho',
  open: 'Inscrições Abertas',
  in_progress: 'Em Andamento',
  finished: 'Encerrado',
}

const STATUS_VARIANTS: Record<TournamentStatus, 'default' | 'success' | 'warning' | 'danger'> = {
  draft: 'default',
  open: 'success',
  in_progress: 'warning',
  finished: 'danger',
}

interface PageProps {
  params: { id: string }
}

export default async function TorneioDetailPage({ params }: PageProps) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Fetch tournament
  const { data: tournament, error } = await supabase
    .from('tournaments')
    .select('*')
    .eq('id', params.id)
    .single()

  if (error || !tournament) notFound()

  // Draft tournaments are not visible to students
  if ((tournament as Tournament).status === 'draft') notFound()

  // Fetch matches with player names
  const { data: matchesData } = await supabase
    .from('tournament_matches')
    .select(`
      id, tournament_id, round, player1_id, player2_id, partner1_id, partner2_id, score, winner_id,
      player1:profiles!player1_id(id, full_name),
      player2:profiles!player2_id(id, full_name),
      partner1:profiles!partner1_id(id, full_name),
      partner2:profiles!partner2_id(id, full_name),
      winner:profiles!winner_id(id, full_name)
    `)
    .eq('tournament_id', params.id)
    .order('round', { ascending: true })

  const matches = (matchesData ?? []) as unknown as TournamentMatch[]

  // Check if current user is already registered
  const { count: regCount } = await supabase
    .from('tournament_registrations')
    .select('id', { count: 'exact', head: true })
    .eq('tournament_id', params.id)
    .eq('player_id', user.id)

  const isRegistered = (regCount ?? 0) > 0
  const t = tournament as Tournament

  return (
    <div className="p-4 space-y-5">
      {/* Header */}
      <div className="flex items-start gap-2">
        <Link href="/torneios" className="text-slate-400 hover:text-white transition-colors mt-0.5">
          ←
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-white">{t.name}</h1>
          <p className="text-sm text-slate-400 mt-0.5">
            {formatDate(t.date, "dd 'de' MMMM 'de' yyyy")}
          </p>
        </div>
      </div>

      {/* Info card */}
      <Card>
        <div className="flex flex-wrap gap-2">
          <Badge variant={STATUS_VARIANTS[t.status]}>{STATUS_LABELS[t.status]}</Badge>
          <Badge variant="level">Nível {t.level.toUpperCase()}</Badge>
          <Badge variant="default">
            {t.modality === 'dupla_fixa' ? 'Dupla Fixa' : 'Dupla Revezando'}
          </Badge>
          <Badge variant="default">Super 8</Badge>
        </div>
      </Card>

      {/* Registration section — only when open */}
      {t.status === 'open' && (
        <Card>
          {isRegistered ? (
            <div className="flex items-center gap-2">
              <Badge variant="success">Inscrito</Badge>
              <span className="text-sm text-slate-400">Você já está inscrito neste torneio.</span>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-slate-300">Inscrições abertas. Participe!</p>
              <RegisterButton tournamentId={t.id} modality={t.modality} />
            </div>
          )}
        </Card>
      )}

      {/* Bracket */}
      <div>
        <h2 className="text-base font-semibold text-white mb-3">Chave do Torneio</h2>
        <BracketView matches={matches} modality={t.modality} />
      </div>
    </div>
  )
}
