// app/arenas/page.tsx
export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/server'
import { buildDirectoryFilter } from '@/lib/arenas/filters'
import { SPORT_BY_SLUG } from '@/lib/arenas/sports'
import { ArenaFilters } from './ArenaFilters'

interface DirectoryArena {
  id: string
  name: string
  slug: string
  city: string | null
  neighborhood: string | null
  state: string | null
  sports: string[]
}

interface PageProps {
  searchParams: { cidade?: string; esporte?: string }
}

export default async function ArenasPage({ searchParams }: PageProps) {
  const admin = createAdminClient()
  const filter = buildDirectoryFilter(searchParams)

  let query = admin
    .from('organizations')
    .select('id, name, slug, city, neighborhood, state, sports')
    .eq('status', 'active')
    .eq('is_listed', true)
    .not('city', 'is', null)
    .order('city', { ascending: true })
    .order('name', { ascending: true })

  if (filter.city) query = query.eq('city', filter.city)
  if (filter.sport) query = query.contains('sports', [filter.sport])

  const { data } = await query
  const arenas = (data ?? []) as DirectoryArena[]

  // Lista de cidades para o seletor (todas as orgs listadas, independente do filtro atual).
  const { data: cityRows } = await admin
    .from('organizations')
    .select('city')
    .eq('status', 'active')
    .eq('is_listed', true)
    .not('city', 'is', null)
    .order('city', { ascending: true })

  const cities = Array.from(
    new Set((cityRows ?? []).map((r: { city: string }) => r.city)),
  )

  return (
    <div className="min-h-screen bg-surface text-white">
      <div className="max-w-3xl mx-auto px-4 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">Encontre uma arena</h1>
          <p className="text-slate-400 text-sm">
            Descubra arenas perto de você e agende uma aula experimental gratuita.
          </p>
        </div>

        <ArenaFilters
          cities={cities}
          selectedCity={filter.city}
          selectedSport={filter.sport}
        />

        {arenas.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-slate-400">Nenhuma arena encontrada nessa região.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {arenas.map((a) => (
              <Link
                key={a.id}
                href={`/arenas/${a.slug}`}
                className="block rounded-xl border border-surface-border bg-surface-card p-5 hover:border-brand-500/60 transition-colors"
              >
                <h2 className="text-white font-bold text-lg">{a.name}</h2>
                <p className="text-slate-400 text-sm mt-0.5">
                  {[a.neighborhood, a.city, a.state].filter(Boolean).join(' · ')}
                </p>
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {a.sports.map((slug) => {
                    const sport = SPORT_BY_SLUG.get(slug)
                    if (!sport) return null
                    return (
                      <span
                        key={slug}
                        className="text-xs text-slate-300 bg-surface-border rounded-full px-2.5 py-1"
                      >
                        {sport.emoji} {sport.label}
                      </span>
                    )
                  })}
                </div>
                <span className="inline-block mt-4 text-brand-500 text-sm font-semibold">
                  Ver horários →
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
