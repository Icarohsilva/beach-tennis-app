// app/(admin)/template.tsx
// Reexecuta os gates de acesso do painel admin em TODA navegação — diferente de
// layout.tsx, que o Next.js reaproveita entre rotas irmãs sem re-rodar o Server
// Component (partial rendering). Bug real encontrado em produção: uma academia
// bloqueada (assinatura vencida) caía corretamente em /admin/assinatura no 1º
// load, mas clicar num link da sidebar para OUTRA rota admin (ex.: /admin/
// dashboard) buscava só o payload RSC da página — o layout, já "aprovado" na
// renderização anterior, não recalculava o gate, e o clique furava o bloqueio
// com dados reais. Confirmado via rede: GET /admin/dashboard?_rsc=... voltava
// 200 com o dashboard, não o redirect. Navegação "dura" (URL direta) sempre
// funcionou — só a troca de PÁGINA via Link, dentro do mesmo layout, escapava.
// template.tsx é remontado a cada navegação (Next.js garante isso), então os
// mesmos checks aqui SEMPRE rodam de novo, fechando a lacuna. Mantém os checks
// em layout.tsx também (defesa em profundidade barata, cobre o 1º load).
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { createClient, createAdminClient, getStaffContext } from '@/lib/supabase/server'
import { getPlatformAccess } from '@/lib/billing/access'

export default async function AdminTemplate({ children }: { children: React.ReactNode }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (user.user_metadata?.must_change_password === true) redirect('/definir-senha')

  const ctx = await getStaffContext()
  if (!ctx) redirect('/home')

  const adminClient = createAdminClient()
  const { data: membership } = await adminClient
    .from('memberships')
    .select('role')
    .eq('user_id', ctx.userId)
    .eq('organization_id', ctx.organizationId)
    .single()
  if (membership?.role !== 'admin') redirect('/home')

  const { data: org } = await adminClient
    .from('organizations')
    .select('onboarding_completed')
    .eq('id', ctx.organizationId)
    .single()
  if (org && org.onboarding_completed === false && ctx.isOwner) redirect('/onboarding')

  const pathname = headers().get('x-pathname') ?? ''
  const isAssinaturaRoute = pathname.startsWith('/admin/assinatura')
  const access = await getPlatformAccess(ctx.organizationId)
  if (!access.allowed && !isAssinaturaRoute) redirect('/admin/assinatura')

  return children
}
