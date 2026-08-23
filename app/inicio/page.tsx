// app/inicio/page.tsx
// Entrada do app: manda cada um para a sua casa.
//
// É o `start_url` do manifest. Antes ele apontava direto para /home, então
// relançar o PWA sempre abria a área do ALUNO — inclusive para o dono da
// academia, que ficava com a impressão de ter "virado aluno" a cada
// atualização. O login já decidia isso pelo papel
// (app/(auth)/login/page.tsx: isAdmin ? '/admin/dashboard' : '/home'); esta
// rota é a mesma decisão, agora também para quem abre o app pelo ícone.
//
// Não renderiza nada — só redireciona. force-dynamic porque a decisão depende
// da sessão e da academia ativa (cookie), que não existem em tempo de build.
import { redirect } from 'next/navigation'
import { getAuthUser, getMemberships, getActiveOrgId } from '@/lib/supabase/server'
import { isStaffOfActiveOrg } from '@/lib/org/activeOrg'

export const dynamic = 'force-dynamic'

export default async function InicioPage() {
  const user = await getAuthUser()
  if (!user) redirect('/login')

  const [memberships, activeOrgId] = await Promise.all([getMemberships(), getActiveOrgId()])

  // Aluno com 2+ academias e sem academia ativa resolvida cai em /home, que tem
  // o desvio para /selecionar-academia — não duplicamos essa regra aqui.
  redirect(isStaffOfActiveOrg(memberships, activeOrgId) ? '/admin/dashboard' : '/home')
}
