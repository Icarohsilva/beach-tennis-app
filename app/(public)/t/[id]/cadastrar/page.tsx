// app/(public)/t/[id]/cadastrar/page.tsx
import { TournamentSignupForm } from './TournamentSignupForm'

interface PageProps { params: { id: string } }

export default function TournamentCadastroPage({ params }: PageProps) {
  return <TournamentSignupForm tournamentId={params.id} />
}
