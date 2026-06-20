'use server'
// features/platform-billing/actions.ts
import { requireOwner, createAdminClient } from '@/lib/supabase/server'
import { PLATFORM_PLAN } from '@/lib/billing/platformPlan'

// Base URL do site para o back_url do MercadoPago. Normaliza para garantir uma URL
// absoluta e válida: força o esquema https:// (se a env vier sem ele, ex.
// "www.arenahub.website") e remove barra(s) final(is). Sem o https://, o MP
// recusa com "Invalid value for back_url, must be a valid URL".
function getSiteUrl(): string {
  const raw = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://arenahub.website').trim()
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  return withScheme.replace(/\/+$/, '')
}

// Inicia a assinatura da plataforma (Preapproval no MercadoPago). Owner-only.
// Devolve init_point (URL hospedada do MP) para o client redirecionar. Não tocamos no cartão.
export async function subscribeToPlatform(): Promise<{ error?: string; initPoint?: string }> {
  const ctx = await requireOwner() // não-dono → redirect; aqui já é owner

  const token = process.env.MERCADOPAGO_ACCESS_TOKEN
  if (!token) return { error: 'Pagamento indisponível no momento. Tente mais tarde.' }

  const admin = createAdminClient()

  // E-mail do dono (payer_email do MP).
  const { data: userRes } = await admin.auth.admin.getUserById(ctx.userId)
  const payerEmail = userRes?.user?.email
  if (!payerEmail) return { error: 'Não foi possível obter o e-mail do dono.' }

  const res = await fetch('https://api.mercadopago.com/preapproval', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      reason: PLATFORM_PLAN.reason,
      auto_recurring: {
        frequency: 1,
        frequency_type: 'months',
        transaction_amount: PLATFORM_PLAN.priceMonthly,
        currency_id: PLATFORM_PLAN.currency,
      },
      payer_email: payerEmail,
      back_url: `${getSiteUrl()}/admin/assinatura?retorno=1`,
      external_reference: ctx.organizationId,
      status: 'pending',
    }),
  })

  if (!res.ok) {
    console.error('[platform-billing] MP preapproval failed:', res.status, await res.text())
    return { error: 'Não foi possível iniciar a assinatura. Tente novamente.' }
  }

  const data = (await res.json()) as { id?: string; init_point?: string }
  if (!data.id || !data.init_point) {
    return { error: 'Resposta inesperada do provedor de pagamento.' }
  }

  // Guarda o id da assinatura na linha da org (a fonte da verdade do status vem do webhook).
  await admin
    .from('platform_subscriptions')
    .update({ mp_preapproval_id: data.id, updated_at: new Date().toISOString() })
    .eq('organization_id', ctx.organizationId)

  return { initPoint: data.init_point }
}
