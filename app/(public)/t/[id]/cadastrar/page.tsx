// app/(public)/t/[id]/cadastrar/page.tsx
import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'
import { TournamentSignupForm } from './TournamentSignupForm'
import { normalizeSportForOrg } from '@/lib/arenas/sports'
import { canonicalizePairGenders, requiresKnownGender } from '@/lib/torneios/pairRules'

interface PageProps { params: { id: string } }

export default async function TournamentCadastroPage({ params }: PageProps) {
  // Resolve o convite da academia DONA do torneio para que o novo usuário seja
  // vinculado a ela (e não à academia padrão) já na criação da conta.
  const admin = createAdminClient()
  const { data: tournament } = await admin
    .from('tournaments')
    .select('organization_id, sport, allowed_pair_genders')
    .eq('id', params.id)
    .single()
  if (!tournament) notFound()

  // Torneio com restrição de gênero: pede o gênero já no cadastro, senão a
  // pessoa cria a conta só para ser recusada na inscrição por perfil incompleto.
  const requiresGender = requiresKnownGender(
    canonicalizePairGenders((tournament.allowed_pair_genders as string[] | null) ?? []),
  )

  const { data: org } = await admin
    .from('organizations')
    .select('invite_code, sports')
    .eq('id', tournament.organization_id as string)
    .single()

  // Quem cria conta por um torneio de futevôlei pratica futevôlei: já entra com esse
  // esporte na membership (se a academia o oferece), pronto para o ranking da Liga.
  const sport = normalizeSportForOrg(
    (tournament.sport as string | null) ?? null,
    (org?.sports as string[] | null) ?? [],
  )

  return (
    <TournamentSignupForm
      tournamentId={params.id}
      orgInviteCode={(org?.invite_code as string | null) ?? null}
      sport={sport}
      requiresGender={requiresGender}
    />
  )
}
