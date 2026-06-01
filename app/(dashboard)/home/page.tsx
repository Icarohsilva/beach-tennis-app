// app/(dashboard)/home/page.tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { formatDate, formatTime } from '@/lib/utils/dateHelpers'
import type { Tournament, Profile } from '@/types'

export default async function HomePage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const today = new Date().toISOString().slice(0, 10)

  const [
    { data: profileData },
    { data: tournamentsData },
    { data: nextSessionsData },
  ] = await Promise.all([
    supabase
      .from('profiles')
      .select('full_name, credits_balance, payment_type')
      .eq('id', user.id)
      .single(),
    supabase
      .from('tournaments')
      .select('*')
      .eq('status', 'open')
      .order('date', { ascending: true })
      .limit(3),
    supabase
      .from('session_bookings')
      .select('id, session:class_sessions(id, session_date, class:classes(name, start_time, end_time, level, type))')
      .eq('student_id', user.id)
      .eq('status', 'confirmed')
      .gte('session_date', today)
      .order('session_date', { referencedTable: 'class_sessions', ascending: true })
      .limit(5),
  ])

  const profile = profileData as Pick<Profile, 'full_name' | 'credits_balance' | 'payment_type'> | null
  const tournaments = (tournamentsData ?? []) as Tournament[]

  type SessionRow = {
    id: string
    session: {
      id: string
      session_date: string
      class: { name: string; start_time: string; end_time: string; level: string; type: string }
    } | {
      id: string
      session_date: string
      class: { name: string; start_time: string; end_time: string; level: string; type: string }
    }[]
  }
  const nextSessions = (nextSessionsData ?? []) as unknown as SessionRow[]
  const showCredits = profile?.payment_type !== 'wellhub' && profile?.payment_type !== 'totalpass'

  return (
    <div className="p-4 space-y-6 pb-24">
      <div>
        <h1 className="text-xl font-bold text-white">
          Olá{profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}!
        </h1>
        <p className="text-slate-400 text-sm mt-0.5">Bom treino hoje 🎾</p>
      </div>

      {showCredits && (
        <Card className="flex items-center justify-between">
          <div>
            <p className="text-slate-400 text-xs">Créditos disponíveis</p>
            <p className="text-3xl font-bold text-brand-500">{profile?.credits_balance ?? 0}</p>
          </div>
          <Link href="/perfil" className="text-xs text-slate-400 hover:text-white transition-colors">
            Ver plano →
          </Link>
        </Card>
      )}

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-white">Minhas Próximas Aulas</h2>
          <Link href="/aulas" className="text-xs text-brand-500 hover:text-brand-400 transition-colors">
            ver todas →
          </Link>
        </div>
        {nextSessions.length === 0 ? (
          <Card>
            <p className="text-slate-400 text-sm text-center py-2">
              Nenhuma aula agendada.{' '}
              <Link href="/agendar" className="text-brand-500 hover:underline">
                Agendar agora →
              </Link>
            </p>
          </Card>
        ) : (
          <div className="space-y-2">
            {nextSessions.map((item) => {
              const session = Array.isArray(item.session) ? item.session[0] : item.session
              const cls = session ? (Array.isArray(session.class) ? session.class[0] : session.class) : null
              if (!session || !cls) return null
              return (
                <Card key={item.id}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">{cls.name}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {formatDate(session.session_date, "EEE, dd 'de' MMM")} · {formatTime(cls.start_time)}
                      </p>
                    </div>
                    {cls.type === 'kids'
                      ? <Badge variant="kids">KIDS</Badge>
                      : <Badge variant="level">{cls.level.toUpperCase()}</Badge>
                    }
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </section>

      {tournaments.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-white">Próximos Torneios</h2>
            <Link href="/torneios" className="text-xs text-brand-500 hover:text-brand-400 transition-colors">
              ver todos →
            </Link>
          </div>
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
        </section>
      )}
    </div>
  )
}
