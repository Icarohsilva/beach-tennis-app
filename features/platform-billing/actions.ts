'use server'
// features/platform-billing/actions.ts
import { requireOwner, createAdminClient } from '@/lib/supabase/server'
import { PLATFORM_PLAN } from '@/lib/billing/platformPlan'
import { getSiteUrl } from '@/lib/utils/siteUrl'
import { mpCancelPreapproval } from '@/lib/billing/mpClient'
import { sendEmail } from '@/lib/notifications/email'

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

// Cancela a assinatura da plataforma (landing promete "cancela em 1 clique" — este é
// o botão que cumpre essa promessa). Owner-only. Cancela no MP primeiro (nunca deixar
// o MP cobrando uma assinatura que a academia já considera encerrada) e só then marca
// local — mesmo padrão de cancelSubscription (aluno) em features/financeiro/actions.ts.
export async function cancelPlatformSubscription(): Promise<{ error?: string }> {
  const ctx = await requireOwner()
  const admin = createAdminClient()

  const { data: sub } = await admin
    .from('platform_subscriptions')
    .select('mp_preapproval_id, status')
    .eq('organization_id', ctx.organizationId)
    .maybeSingle()

  if (!sub || sub.status === 'canceled') return { error: 'Nenhuma assinatura ativa encontrada.' }

  const token = process.env.MERCADOPAGO_ACCESS_TOKEN
  if (sub.mp_preapproval_id && token) {
    try {
      await mpCancelPreapproval(token, sub.mp_preapproval_id)
    } catch (e) {
      console.error('[platform-billing] cancelamento no MP falhou', e)
      return { error: 'Não foi possível cancelar no Mercado Pago. Tente novamente.' }
    }
  }

  const { error } = await admin
    .from('platform_subscriptions')
    .update({ status: 'canceled', updated_at: new Date().toISOString() })
    .eq('organization_id', ctx.organizationId)
  if (error) return { error: 'Erro ao cancelar assinatura.' }

  return {}
}

// Solicitação de reembolso/arrependimento (art. 49 CDC — 7 dias). Registra o PEDIDO;
// NÃO chama a API de refund do MP automaticamente (mover dinheiro é decisão humana).
// O time da plataforma processa manualmente e marca o status em /super-admin/reembolsos.
export async function requestPlatformRefund(reason: string): Promise<{ error?: string }> {
  const ctx = await requireOwner()
  const admin = createAdminClient()

  const { error } = await admin.from('platform_refund_requests').insert({
    organization_id: ctx.organizationId,
    requested_by: ctx.userId,
    reason: reason.trim() || null,
  })
  if (error) return { error: 'Não foi possível registrar a solicitação. Tente novamente.' }

  try {
    const to = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? 'suporte@arenahub.website'
    const { data: userRes } = await admin.auth.admin.getUserById(ctx.userId)
    await sendEmail({
      to,
      subject: 'Nova solicitação de reembolso: assinatura da plataforma',
      html: `<p>${userRes?.user?.email ?? ctx.userId} (org ${ctx.organizationId}) solicitou reembolso da assinatura.</p><p>Motivo: ${reason.trim() || '(não informado)'}</p>`,
    })
  } catch (e) {
    console.error('[platform-billing] falha ao notificar solicitação de reembolso', e)
  }

  return {}
}
