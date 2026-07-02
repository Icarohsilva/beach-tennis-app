// app/(public)/t/[id]/cadastrar/page.tsx
import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'
import { TournamentSignupForm } from './TournamentSignupForm'

interface PageProps { params: { id: string } }

export default async function TournamentCadastroPage({ params }: PageProps) {
  // Resolve o convite da academia DONA do torneio para que o novo usuário seja
  // vinculado a ela (e não à academia padrão) já na criação da conta.
  const admin = createAdminClient()
  const { data: tournament } = await admin
    .from('tournaments')
    .select('organization_id')
    .eq('id', params.id)
    .single()
  if (!tournament) notFound()

  const { data: org } = await admin
    .from('organizations')
    .select('invite_code')
    .eq('id', tournament.organization_id as string)
    .single()

  return (
    <TournamentSignupForm
      tournamentId={params.id}
      orgInviteCode={(org?.invite_code as string | null) ?? null}
    />
  )
}
