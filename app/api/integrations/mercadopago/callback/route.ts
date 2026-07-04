// app/api/integrations/mercadopago/callback/route.ts
// Callback do OAuth marketplace: valida o state assinado, confirma que quem
// está completando o fluxo é o MESMO usuário que o iniciou (sessão atual ==
// state.userId) e que esse usuário é o dono da org (state.orgId), troca o
// code por tokens e salva criptografado. Qualquer falha → redirect com
// código de erro, nada persiste pela metade.
//
// Por que checar a sessão atual E não só "state.userId é dono da org": sem
// isso, um atacante dono de uma org própria poderia forjar uma URL de
// autorização do MP com o PRÓPRIO state (válido, assinado, apontando pra
// própria org) e induzir outra pessoa a completá-la logada — a conta MP da
// vítima acabaria linkada à org do atacante. Exigir sessão atual == state.userId
// fecha essa CSRF de terceira parte.
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { verifyOAuthState } from '@/lib/billing/oauthState'
import { mpExchangeOAuthCode } from '@/lib/billing/mpClient'
import { saveMpAccount } from '@/lib/billing/gatewayAccounts'
import { getSiteUrl } from '@/lib/utils/siteUrl'

export async function GET(req: NextRequest) {
  const backTo = `${getSiteUrl()}/admin/financeiro/integracoes`
  const code = req.nextUrl.searchParams.get('code')
  const state = req.nextUrl.searchParams.get('state')

  const secret = process.env.MP_APP_SECRET
  if (!secret) {
    console.error('[mp-oauth] MP_APP_SECRET ausente')
    return NextResponse.redirect(`${backTo}?mp=error`)
  }

  const parsed = verifyOAuthState(state, secret)
  if (!parsed || !code) return NextResponse.redirect(`${backTo}?mp=invalid`)

  // Sessão atual precisa ser a mesma pessoa que iniciou o fluxo.
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.id !== parsed.userId) {
    return NextResponse.redirect(`${backTo}?mp=forbidden`)
  }

  // Defesa extra: o userId do state precisa ser o dono da org HOJE (pode ter
  // mudado entre o clique em "Conectar" e o retorno do MP).
  const admin = createAdminClient()
  const { data: org } = await admin
    .from('organizations')
    .select('owner_id')
    .eq('id', parsed.orgId)
    .single()
  if ((org as { owner_id: string | null } | null)?.owner_id !== parsed.userId) {
    return NextResponse.redirect(`${backTo}?mp=forbidden`)
  }

  try {
    const redirectUri = `${getSiteUrl()}/api/integrations/mercadopago/callback`
    const tokens = await mpExchangeOAuthCode(code, redirectUri)
    const { error } = await saveMpAccount(parsed.orgId, tokens, parsed.userId)
    if (error) return NextResponse.redirect(`${backTo}?mp=error`)
  } catch (e) {
    console.error('[mp-oauth] troca de code falhou', e)
    return NextResponse.redirect(`${backTo}?mp=error`)
  }

  return NextResponse.redirect(`${backTo}?mp=connected`)
}
