'use client'
// app/(admin)/torneios/[id]/AdminMatchCard.tsx
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/Card'
import { MatchResult } from '@/features/torneios/MatchResult'
import type { TournamentMatch } from '@/features/torneios/BracketView'
import type { TournamentModality } from '@/types'

interface AdminMatchCardProps {
  match: TournamentMatch
  modality: TournamentModality
}

export function AdminMatchCard({ match, modality }: AdminMatchCardProps) {
  const router = useRouter()

  return (
    <Card>
      <MatchResult
        match={match}
        modality={modality}
        isAdmin
        onResultSaved={() => router.refresh()}
      />
    </Card>
  )
}
