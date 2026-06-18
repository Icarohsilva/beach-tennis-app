// app/arenas/[slug]/page.tsx
export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'
import { getOpenTrialSessions } from '@/lib/arenas/sessions'
import { SPORT_BY_SLUG } from '@/lib/arenas/sports'
import { Card } from '@/components/ui/Card'
import { TrialBookingForm } from './TrialBookingForm'

interface ArenaRow {
  id: string
  name: string
  slug: string
  status: string
  is_listed: boolean
  city: string | null
  state: string | null
  neighborhood: string | null
  address_line: string | null
  sports: string[]
  whatsapp: string | null
}

interface PageProps {
  params: { slug: string }
}

export default async function ArenaPage({ params }: PageProps) {
  const admin = createAdminClient()

  const { data } = await admin
    .from('organizations')
    .select('id, name, slug, status, is_listed, city, state, neighborhood, address_line, sports, whatsapp')
    .eq('slug', params.slug)
    .single()

  const org = data as ArenaRow | null
  if (!org || org.status !== 'active' || !org.is_listed || !org.city) {
    notFound()
  }

  const sessions = await getOpenTrialSessions(org.id)
  const whatsappDigits = org.whatsapp?.replace(/\D/g, '') ?? ''

  return (
    <div className="min-h-screen bg-surface text-white">
      <div className="max-w-lg mx-auto px-4 py-10">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white">{org.name}</h1>
          <p className="text-slate-400 text-sm mt-1">
            {[org.address_line, org.neighborhood, org.city, org.state].filter(Boolean).join(' · ')}
          </p>
          <div className="flex flex-wrap gap-1.5 mt-3">
            {org.sports.map((slug) => {
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
          {whatsappDigits && (
            <a
              href={`https://wa.me/${whatsappDigits}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block mt-4 text-sm text-emerald-400 font-medium"
            >
              💬 Falar no WhatsApp
            </a>
          )}
        </div>

        <div className="text-center mb-6">
          <h2 className="text-xl font-bold text-white mb-1">Aula Experimental</h2>
          <p className="text-slate-400 text-sm">Gratuita na primeira vez. Sem precisar criar conta.</p>
        </div>

        <Card>
          {sessions.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-slate-400 text-sm mb-2">
                Nenhuma sessão disponível nos próximos 30 dias.
              </p>
              <p className="text-slate-500 text-xs">Entre em contato para mais informações.</p>
            </div>
          ) : (
            <TrialBookingForm organizationId={org.id} sessions={sessions} />
          )}
        </Card>
      </div>
    </div>
  )
}
