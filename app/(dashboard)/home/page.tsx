// app/(dashboard)/home/page.tsx
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { formatDate } from '@/lib/utils/dateHelpers'
import type { Tournament } from '@/types'

export default async function HomePage() {
  const supabase = createClient()

  // Fetch up to 3 open tournaments
  const { data } = await supabase
    .from('tournaments')
    .select('*')
    .eq('status', 'open')
    .order('date', { ascending: true })
    .limit(3)

  const tournaments = (data ?? []) as Tournament[]

  return (
    <div className="p-4 space-y-6">
      <h1 className="text-xl font-bold text-white">Home</h1>

      {/* Próximos Torneios card */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-white">Próximos Torneios</h2>
          <Link
            href="/torneios"
            className="text-xs text-brand-500 hover:text-brand-400 transition-colors"
          >
            ver todos →
          </Link>
        </div>

        {tournaments.length === 0 ? (
          <Card>
            <p className="text-slate-400 text-sm text-center py-2">
              Nenhum torneio com inscrições abertas no momento.
            </p>
          </Card>
        ) : (
          <div className="space-y-2">
            {tournaments.map((tournament) => (
              <Link key={tournament.id} href={`/torneios/${tournament.id}`}>
                <Card className="hover:border-brand-600/50 transition-colors cursor-pointer">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white truncate">{tournament.name}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {formatDate(tournament.date, "dd 'de' MMMM")}
                      </p>
                    </div>
                    <Badge variant="level">Nível {tournament.level.toUpperCase()}</Badge>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
