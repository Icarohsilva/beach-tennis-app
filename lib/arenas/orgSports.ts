// lib/arenas/orgSports.ts
// Cardápio de modalidades de uma academia (organizations.sports), usado como
// domínio dos esportes do aluno (memberships.sports) e da turma (classes.sport).
import { createAdminClient } from '@/lib/supabase/server'
import { sportOptionsForOrg } from './sports'

// Slugs que a academia oferece; cai no cardápio completo quando não declarou nenhum.
export async function getOrgSports(orgId: string | null | undefined): Promise<string[]> {
  if (!orgId) return sportOptionsForOrg([])
  const admin = createAdminClient()
  const { data } = await admin
    .from('organizations')
    .select('sports')
    .eq('id', orgId)
    .maybeSingle()
  return sportOptionsForOrg((data?.sports as string[] | null) ?? [])
}
