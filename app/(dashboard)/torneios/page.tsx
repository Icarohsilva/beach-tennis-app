// app/(dashboard)/torneios/page.tsx
import { createClient } from '@/lib/supabase/server'
import { TournamentCard } from '@/features/torneios/TournamentCard'
import type { Tournament } from '@/types'

const LEVEL_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Todos os níveis' },
  { value: 'iniciante', label: 'Iniciante' },
  { value: 'D', label: 'Nível D' },
  { value: 'C', label: 'Nível C' },
  { value: 'B', label: 'Nível B' },
  { value: 'A', label: 'Nível A' },
]

interface PageProps {
  searchParams: { nivel?: string }
}

export default async function TorneiosPage({ searchParams }: PageProps) {
  const supabase = createClient()
  const nivel = searchParams.nivel ?? ''

  let query = supabase
    .from('tournaments')
    .select('*')
    .neq('status', 'draft')
    .order('date', { ascending: true })

  if (nivel) {
    query = query.eq('level', nivel)
  }

  const { data, error } = await query
  const tournaments = (data ?? []) as Tournament[]

  return (
    <div className="p-4 space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-white">Torneios</h1>
      </div>

      {/* Level filter */}
      <div className="flex gap-2 flex-wrap">
        {LEVEL_OPTIONS.map((opt) => {
          const isActive = nivel === opt.value
          const href = opt.value ? `/torneios?nivel=${opt.value}` : '/torneios'
          return (
            <a
              key={opt.value}
              href={href}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                isActive
                  ? 'bg-brand-600 text-white'
                  : 'bg-surface-card border border-surface-border text-slate-400 hover:text-white hover:border-brand-600/50'
              }`}
            >
              {opt.label}
            </a>
          )
        })}
      </div>

      {error && (
        <p className="text-red-400 text-sm">Erro ao carregar torneios.</p>
      )}

      {tournaments.length === 0 ? (
        <p className="text-slate-400 text-sm mt-8 text-center">
          Nenhum torneio disponível no momento.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {tournaments.map((tournament) => (
            <TournamentCard
              key={tournament.id}
              tournament={tournament}
              href={`/torneios/${tournament.id}`}
            />
          ))}
        </div>
      )}
    </div>
  )
}
