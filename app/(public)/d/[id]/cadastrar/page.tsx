// app/(public)/d/[id]/cadastrar/page.tsx
// Conta rápida para reservar um day use. Espelha /t/[id]/cadastrar com UMA
// diferença decisiva: NÃO manda `org_invite_code` no signUp.
//
// Sem convite, handle_new_user (20260810000200_signup_without_org.sql) cria
// perfil e ZERO memberships — que é exatamente a decisão tomada para o day use:
// quem paga um avulso passa a ter conta no aplicativo, não vínculo com a arena.
// O caminho oposto (virar `athlete` da arena, como o torneio faz) colocaria
// essa pessoa nas listas da academia e no motor da Liga sem ela ter se tornado
// aluna de ninguém.
import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'
import { DayUseSignupForm } from './DayUseSignupForm'
import { sportLabel } from '@/lib/arenas/sports'
import { formatDate, formatTime } from '@/lib/utils/dateHelpers'

interface PageProps { params: { id: string } }

export default async function DayUseCadastroPage({ params }: PageProps) {
  const admin = createAdminClient()
  const { data: slotRaw } = await admin
    .from('dayuse_slots')
    .select('date, start_time, end_time, sport, organization_id')
    .eq('id', params.id)
    .eq('is_active', true)
    .maybeSingle()
  if (!slotRaw) notFound()
  const slot = slotRaw as {
    date: string
    start_time: string
    end_time: string
    sport: string | null
    organization_id: string
  }

  const { data: org } = await admin
    .from('organizations')
    .select('name')
    .eq('id', slot.organization_id)
    .maybeSingle()

  const what = slot.sport ? `Day use de ${sportLabel(slot.sport)}` : 'Day use'
  const subtitle = `${what}${org?.name ? ` na ${org.name as string}` : ''} · `
    + `${formatDate(slot.date, "dd 'de' MMMM")}, ${formatTime(slot.start_time)}`
    + `–${formatTime(slot.end_time)}`

  return <DayUseSignupForm slotId={params.id} subtitle={subtitle} />
}
