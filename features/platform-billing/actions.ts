'use server'
// features/platform-billing/actions.ts
import { requireOwner, createAdminClient } from '@/lib/supabase/server'
import { PLATFORM_PLAN } from '@/lib/billing/platformPlan'
import { getSiteUrl } from '@/lib/utils/siteUrl'

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

  // back_url aponta para a RAIZ do site (sem path). Motivo: o validador de URL do
  // MercadoPago tem um bug com o TLD ".website" — qualquer back_url com PATH nesse
  // domínio é recusado com "Invalid value for back_url" (confirmado contra a API real;
  // ".website" sem path passa, e outros TLDs com path passam). No retorno o MP anexa
  // ?preapproval_id=... e o middleware redireciona a raiz para /admin/assinatura.
  const backUrl = getSiteUrl()

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
      back_url: backUrl,
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
