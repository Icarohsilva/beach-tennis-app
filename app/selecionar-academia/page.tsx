// app/selecionar-academia/page.tsx
import { redirect } from 'next/navigation'
import { getMemberships, getAuthUser } from '@/lib/supabase/server'
import { AcademyChooser } from './AcademyChooser'

export default async function SelecionarAcademiaPage() {
  const user = await getAuthUser()
  if (!user) redirect('/login')

  const memberships = await getMemberships()
  // 0 vínculos: estado raro — manda pra home (layout decide o que fazer).
  if (memberships.length === 0) redirect('/home')
  // 1 vínculo: não há o que escolher — segue direto.
  if (memberships.length === 1) {
    const only = memberships[0]
    redirect(only.role === 'admin' ? '/admin/dashboard' : '/home')
  }

  return (
    <div className="min-h-screen bg-surface text-white flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <AcademyChooser
          options={memberships.map((m) => ({
            organization_id: m.organization_id,
            org_name: m.org_name,
            role: m.role,
          }))}
        />
      </div>
    </div>
  )
}
