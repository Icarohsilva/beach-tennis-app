// app/(admin)/admin/equipe/page.tsx
import { createAdminClient, requireOwner } from '@/lib/supabase/server'
import { InviteCard } from './InviteCard'
import { EquipeManager, type ProfessorRow } from './EquipeManager'
import { requirePlatformAccess } from '@/lib/billing/guard'

export const dynamic = 'force-dynamic'

export default async function EquipePage() {
  await requirePlatformAccess() // gate de cobranca; ver lib/billing/guard.ts
  const ctx = await requireOwner() // redireciona professor → dashboard

  const admin = createAdminClient()
  const { data: org } = await admin
    .from('organizations')
    .select('invite_code, owner_id')
    .eq('id', ctx.organizationId)
    .single()

  // Professores = admins da org que NÃO são o dono. Papel é por-academia: vem
  // das memberships desta org (não de profiles.role, que é o papel padrão).
  const { data: staff } = await admin
    .from('memberships')
    .select('user_id, profiles:profiles!memberships_user_id_fkey!inner(full_name)')
    .eq('organization_id', ctx.organizationId)
    .eq('role', 'admin')

  type StaffRow = {
    user_id: string
    profiles: { full_name: string } | { full_name: string }[] | null
  }
  const professors: ProfessorRow[] = ((staff ?? []) as unknown as StaffRow[])
    .map((m) => {
      const prof = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles
      return { id: m.user_id, full_name: prof?.full_name ?? '' }
    })
    .filter((p) => p.id !== org?.owner_id)
    .sort((a, b) => a.full_name.localeCompare(b.full_name, 'pt-BR'))

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://arenahub.website'
  const inviteUrl = `${baseUrl}/cadastro?convite=${org?.invite_code ?? ''}`

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Equipe</h1>
        <p className="text-slate-400 text-sm mt-1">Convide alunos e gerencie seus professores.</p>
      </div>
      <InviteCard inviteUrl={inviteUrl} />
      <EquipeManager professors={professors} />
    </div>
  )
}
