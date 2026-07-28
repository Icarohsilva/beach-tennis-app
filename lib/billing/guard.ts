// lib/billing/guard.ts
// Gate de cobrança que roda POR PÁGINA — e precisa continuar assim.
//
// Por que não basta no layout: o Next.js NÃO re-executa layout.tsx quando a navegação
// é client-side entre rotas irmãs (partial rendering) — ele busca só o payload RSC do
// segmento que mudou. Medido neste projeto (Next 14.2.35, com log no servidor): clicar
// num link da sidebar renderizava a PÁGINA nova no servidor sem reavaliar o gate do
// layout, e a academia bloqueada navegava o painel inteiro com dados reais. Só a
// navegação "dura" (URL digitada, F5) reexecutava o layout.
//
// template.tsx NÃO resolve: foi medido no mesmo teste e também não re-executa no
// servidor nessa navegação. A garantia de "novo a cada navegação" do template vale
// para a instância no cliente (remonta, reseta estado), não para o Server Component.
//
// Página, essa sim, SEMPRE re-renderiza no servidor. Por isso o gate mora aqui e é
// chamado na primeira linha de cada página.
//
// => TODA página nova em app/(admin)/admin/ tem que chamar requirePlatformAccess().
//    A única isenta é /admin/assinatura (senão vira loop de redirect).
import { cache } from 'react'
import { redirect } from 'next/navigation'
import { getActiveOrgId } from '@/lib/supabase/server'
import { getPlatformAccess, type PlatformAccessResult } from './access'

// cache() do React deduplica dentro do MESMO request: no load "duro" o layout e a
// página chamam o gate, e o banco é consultado uma vez só.
export const requirePlatformAccess = cache(
  async function requirePlatformAccess(): Promise<PlatformAccessResult> {
    const orgId = await getActiveOrgId()
    if (!orgId) redirect('/home')

    const access = await getPlatformAccess(orgId)
    if (!access.allowed) redirect('/admin/assinatura')
    return access
  },
)
