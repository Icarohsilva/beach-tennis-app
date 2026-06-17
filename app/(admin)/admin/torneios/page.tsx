// app/(admin)/torneios/page.tsx
import Link from 'next/link'
import { createAdminClient, getCurrentOrgId } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { formatDate } from '@/lib/utils/dateHelpers'
import { CreateTournamentForm } from './CreateTournamentForm'
import { TournamentStatusActions } from './TournamentStatusActions'
import { Trophy } from 'lucide-react'
import type { Tournament, TournamentStatus } from '@/types'

const STATUS_LABELS: Record<TournamentStatus, string> = {
  draft: 'Rascunho',
  open: 'Aberto',
  in_progress: 'Em Andamento',
  finished: 'Encerrado',
}

const STATUS_VARIANTS: Record<TournamentStatus, 'default' | 'success' | 'warning' | 'danger'> = {
  draft: 'default',
  open: 'success',
  in_progress: 'warning',
  finished: 'danger',
}

export default async function AdminTorneiosPage() {
  const adminClient = createAdminClient()
  const orgId = await getCurrentOrgId()

  const { data, error } = await adminClient
    .from('tournaments')
    .select('*')
    .eq('organization_id', orgId)
    .order('date', { ascending: false })

  const tournaments = (data ?? []) as Tournament[]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-white">Torneios</h1>
      </div>

      {/* Create tournament form */}
      <Card>
        <h2 className="text-base font-semibold text-white mb-4">Novo Torneio</h2>
        <CreateTournamentForm />
      </Card>

      {error && (
        <p className="text-red-400 text-sm">Erro ao carregar torneios.</p>
      )}

      {/* Tournament list */}
      {tournaments.length === 0 ? (
        <EmptyState icon={Trophy} title="Nenhum torneio cadastrado ainda." description="Use o formulário acima para criar o primeiro torneio." />
      ) : (
        <div className="space-y-3">
          {tournaments.map((tournament) => (
            <Card key={tournament.id}>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <Link
                      href={`/admin/torneios/${tournament.id}`}
                      className="text-white font-semibold hover:text-brand-500 transition-colors"
                    >
                      {tournament.name}
                    </Link>
                    <Badge variant={STATUS_VARIANTS[tournament.status]}>
                      {STATUS_LABELS[tournament.status]}
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-400">
                    {formatDate(tournament.date, "dd 'de' MMMM 'de' yyyy")} · Nível{' '}
                    {tournament.level.toUpperCase()} ·{' '}
                    {tournament.modality === 'dupla_fixa' ? 'Dupla Fixa' : 'Dupla Revezando'}
                  </p>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <Link href={`/admin/torneios/${tournament.id}`}>
                    <Button variant="secondary" size="sm">
                      Gerenciar
                    </Button>
                  </Link>
                  <TournamentStatusActions
                    tournamentId={tournament.id}
                    currentStatus={tournament.status}
                  />
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
