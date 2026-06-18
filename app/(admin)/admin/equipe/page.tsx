// app/(admin)/admin/equipe/page.tsx
import { createAdminClient, requireOwner } from '@/lib/supabase/server'
import { InviteCard } from './InviteCard'
import { EquipeManager, type ProfessorRow } from './EquipeManager'

export const dynamic = 'force-dynamic'

export default async function EquipePage() {
  const ctx = await requireOwner() // redireciona professor → dashboard

  const admin = createAdminClient()
  const { data: org } = await admin
    .from('organizations')
    .select('invite_code, owner_id')
    .eq('id', ctx.organizationId)
    .single()

  // Professores = admins da org que NÃO são o dono.
  const { data: staff } = await admin
    .from('profiles')
    .select('id, full_name')
    .eq('organization_id', ctx.organizationId)
    .eq('role', 'admin')
    .order('full_name', { ascending: true })

  const professors = ((staff ?? []) as ProfessorRow[]).filter((p) => p.id !== org?.owner_id)

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://arenahub.pro'
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
