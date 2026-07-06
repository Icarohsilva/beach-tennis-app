// app/api/cron/mp-token-refresh/route.ts
// Tokens OAuth do MP valem ~6 meses. Semanalmente renovamos os que vencem em
// <30 dias via refresh_token. Falha de AUTORIZAÇÃO (401/403 — refresh token
// realmente revogado) → status 'expired' (UI mostra "Reconectar", checkouts
// novos ficam bloqueados). Falha TRANSITÓRIA (5xx/rede) → só loga e tenta de
// novo na próxima semana; marcar 'expired' por um blip seria um falso sinal
// de "precisa reconectar" para uma academia que na verdade está tudo bem.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { decryptSecret } from '@/lib/billing/tokenCrypto'
import { mpRefreshOAuthToken, MpApiError } from '@/lib/billing/mpClient'
import { saveMpAccount, setMpAccountStatus } from '@/lib/billing/gatewayAccounts'

export const maxDuration = 300

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const threshold = new Date(Date.now() + 30 * 86400000).toISOString()
  const { data: rows } = await admin
    .from('org_gateway_accounts')
    .select('organization_id, refresh_token_enc')
    .eq('gateway', 'mercadopago')
    .eq('status', 'connected')
    .lt('token_expires_at', threshold)

  let refreshed = 0
  let expired = 0
  let transientFailures = 0
  for (const row of (rows ?? []) as { organization_id: string; refresh_token_enc: string }[]) {
    try {
      const tokens = await mpRefreshOAuthToken(decryptSecret(row.refresh_token_enc))
      // MP costuma rotacionar o refresh_token a cada uso — se o upsert falhar
      // aqui, ficamos com o token velho salvo e SÓ descobriríamos isso na
      // próxima semana como um 401/403 genuíno (falso "precisa reconectar").
      // Trata como falha transitória, não como sucesso.
      const { error } = await saveMpAccount(row.organization_id, tokens, null)
      if (error) throw new Error(`saveMpAccount falhou: ${error}`)
      refreshed++
    } catch (e) {
      const isAuthRejection = e instanceof MpApiError && (e.status === 401 || e.status === 403)
      console.error('[mp-token-refresh] falhou', {
        org: row.organization_id,
        authRejection: isAuthRejection,
        error: e instanceof Error ? e.message : e,
      })
      if (isAuthRejection) {
        await setMpAccountStatus(row.organization_id, 'expired')
        expired++
      } else {
        transientFailures++
      }
    }
  }

  return NextResponse.json({ refreshed, expired, transientFailures })
}
