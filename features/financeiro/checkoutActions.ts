'use server'
// features/financeiro/checkoutActions.ts
// Checkouts do aluno com o token MP da ACADEMIA (OAuth marketplace).
// Nenhum efeito de crédito/ativação acontece aqui — só o webhook confirma.
import { createClient, createAdminClient, getActiveOrgId } from '@/lib/supabase/server'
import { getConnectedMpToken } from '@/lib/billing/gatewayAccounts'
import { mpCancelPreapproval, mpCreatePreapproval, mpCreatePreference } from '@/lib/billing/mpClient'
import { computeMarketplaceFee } from '@/lib/billing/fees'
import { addPeriod, PERIODICITY_MONTHS, PERIODICITY_LABELS } from '@/lib/billing/periodicity'
import { getSiteUrl } from '@/lib/utils/siteUrl'
import type { Periodicity } from '@/types'

interface CheckoutResult {
  initPoint?: string
  error?: string
}

// Assina um plano com recorrência automática (MP Assinaturas).
// forStudentId: responsável assinando para um dependente (pagador = logado).
export async function subscribeToPlanCheckout(
  planId: string,
  billingOptionId: string,
  forStudentId?: string,
): Promise<CheckoutResult> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  const admin = createAdminClient()
  const studentId = forStudentId ?? user.id

  // Assinar para outro aluno: só responsável → dependente.
  if (forStudentId && forStudentId !== user.id) {
    const { data: dep } = await admin
      .from('memberships')
      .select('is_dependent, parent_id')
      .eq('user_id', forStudentId)
      .eq('organization_id', orgId)
      .single()
    if (!dep?.is_dependent || dep.parent_id !== user.id) return { error: 'Sem permissão.' }
  }

  const token = await getConnectedMpToken(orgId)
  if (!token) return { error: 'Pagamento online indisponível. Fale com a academia.' }

  // Opção de cobrança: precisa ser do plano informado, habilitada e da academia.
  const { data: option } = await admin
    .from('plan_billing_options')
    .select('id, plan_id, periodicity, price, is_enabled')
    .eq('id', billingOptionId)
    .eq('organization_id', orgId)
    .single()
  if (!option || !option.is_enabled || option.plan_id !== planId || option.price <= 0) {
    return { error: 'Opção de plano indisponível.' }
  }
  const periodicity = option.periodicity as Periodicity

  const { data: plan } = await admin
    .from('subscription_plans')
    .select('id, name, is_active')
    .eq('id', planId)
    .eq('organization_id', orgId)
    .single()
  if (!plan?.is_active) return { error: 'Este plano não está disponível.' }

  // Plano vigente bloqueia; pendências antigas são limpas (lazy, spec §3.1).
  const { data: existing } = await admin
    .from('student_subscriptions')
    .select('id, status')
    .eq('student_id', studentId)
    .eq('organization_id', orgId)
    .in('status', ['active', 'past_due'])
    .maybeSingle()
  if (existing) return { error: 'Já existe um plano ativo. Cancele antes de trocar.' }

  await admin
    .from('student_subscriptions')
    .update({ status: 'cancelled' })
    .eq('student_id', studentId)
    .eq('organization_id', orgId)
    .eq('status', 'pending_payment')

  // E-mail do PAGADOR (payer do MP é quem cadastra o cartão).
  const { data: payerUser } = await admin.auth.admin.getUserById(user.id)
  const payerEmail = payerUser?.user?.email
  if (!payerEmail) return { error: 'Não foi possível obter seu e-mail.' }

  const now = new Date()
  const { data: sub, error: insErr } = await admin
    .from('student_subscriptions')
    .insert({
      organization_id: orgId,
      student_id: studentId,
      payer_id: user.id,
      plan_id: planId,
      billing_option_id: option.id,
      periodicity,
      price: option.price,
      status: 'pending_payment',
      gateway: 'mercadopago',
      starts_at: now.toISOString(),
      ends_at: null,
      next_billing_at: addPeriod(now, periodicity).toISOString(),
      discount_pct: 0,
      gateway_subscription_id: null,
    })
    .select('id')
    .single()
  if (insErr) {
    // 23505 = violação do índice único parcial (student_subscriptions_one_live_per_student)
    // — corrida entre duas chamadas concorrentes (ex.: duplo clique, duas
    // abas). A outra já está cuidando da assinatura; não criar duplicata.
    if (insErr.code === '23505') {
      return { error: 'Já existe uma assinatura em andamento. Aguarde ou tente novamente em instantes.' }
    }
    return { error: 'Erro ao iniciar assinatura. Tente novamente.' }
  }
  if (!sub) return { error: 'Erro ao iniciar assinatura. Tente novamente.' }

  try {
    const pre = await mpCreatePreapproval(token, {
      reason: `${plan.name} — ${PERIODICITY_LABELS[periodicity]}`,
      auto_recurring: {
        frequency: PERIODICITY_MONTHS[periodicity],
        frequency_type: 'months',
        transaction_amount: option.price,
        currency_id: 'BRL',
      },
      payer_email: payerEmail,
      // Bug do validador do MP com TLD .website: back_url NÃO pode ter path.
      // O retorno cai na raiz com ?preapproval_id=... e o middleware manda
      // para /retorno-pagamento, que roteia para a tela certa.
      back_url: getSiteUrl(),
      external_reference: sub.id,
      notification_url: `${getSiteUrl()}/api/webhooks/mercadopago?org=${orgId}`,
      status: 'pending',
    })
    const { error: linkErr } = await admin
      .from('student_subscriptions')
      .update({ gateway_subscription_id: pre.id })
      .eq('id', sub.id)
    if (linkErr) {
      // Preapproval foi criado no MP mas não conseguimos salvar o id local —
      // o webhook resolve assinaturas por gateway_subscription_id, então sem
      // isso o pagamento futuro ficaria "órfão" (aluno paga, ninguém ativa).
      // Cancela o preapproval no MP e força o aluno a tentar de novo, em vez
      // de devolver um initPoint que levaria a um pagamento sem dono.
      console.error('[checkout] falhou ao salvar gateway_subscription_id — cancelando preapproval órfão', {
        subId: sub.id, preapprovalId: pre.id, error: linkErr.message,
      })
      try {
        await mpCancelPreapproval(token, pre.id)
      } catch (cancelErr) {
        console.error('[checkout] falha ao cancelar preapproval órfão — requer intervenção manual', {
          subId: sub.id, preapprovalId: pre.id, error: cancelErr,
        })
      }
      await admin.from('student_subscriptions').update({ status: 'cancelled' }).eq('id', sub.id)
      return { error: 'Não foi possível concluir a preparação do pagamento. Tente novamente.' }
    }
    return { initPoint: pre.init_point }
  } catch (e) {
    console.error('[checkout] preapproval falhou', e)
    await admin.from('student_subscriptions').update({ status: 'cancelled' }).eq('id', sub.id)
    return { error: 'Não foi possível iniciar o pagamento. Tente novamente.' }
  }
}

// Compra N créditos de aula avulsa (Checkout Pro: PIX/cartão). O crédito só
// entra no saldo quando o webhook confirmar o pagamento aprovado.
export async function buySingleClassCredits(qty: number): Promise<CheckoutResult> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  if (!Number.isInteger(qty) || qty < 1 || qty > 20) {
    return { error: 'Quantidade inválida (1 a 20).' }
  }

  const admin = createAdminClient()

  // Venda habilitada + preço (system_settings key/value por academia).
  const { data: settingsRaw } = await admin
    .from('system_settings')
    .select('key, value')
    .eq('organization_id', orgId)
    .in('key', ['single_class_price', 'single_class_sale_enabled'])
  const settings = Object.fromEntries(
    ((settingsRaw ?? []) as { key: string; value: string }[]).map((s) => [s.key, s.value]),
  )
  const price = parseFloat(settings.single_class_price ?? '0') || 0
  if (settings.single_class_sale_enabled !== 'true' || price <= 0) {
    return { error: 'Venda de aula avulsa indisponível. Fale com a academia.' }
  }

  const token = await getConnectedMpToken(orgId)
  if (!token) return { error: 'Pagamento online indisponível. Fale com a academia.' }

  const amount = Math.round(qty * price * 100) / 100

  const { data: payment, error: payErr } = await admin
    .from('payments')
    .insert({
      organization_id: orgId,
      student_id: user.id,
      subscription_id: null,
      session_id: null,
      amount,
      currency: 'BRL',
      status: 'pending',
      type: 'per_class',
      gateway: 'mercadopago',
      gateway_payment_id: null,
      credits_qty: qty,
    })
    .select('id')
    .single()
  if (payErr || !payment) return { error: 'Erro ao iniciar a compra. Tente novamente.' }

  const { data: org } = await admin
    .from('organizations')
    .select('platform_fee_pct')
    .eq('id', orgId)
    .single()
  const feePct = Number((org as { platform_fee_pct?: number } | null)?.platform_fee_pct ?? 0)

  try {
    const pref = await mpCreatePreference(token, {
      items: [
        { title: `Aula avulsa (${qty}x)`, quantity: qty, unit_price: price, currency_id: 'BRL' },
      ],
      external_reference: payment.id as string,
      notification_url: `${getSiteUrl()}/api/webhooks/mercadopago?org=${orgId}`,
      // Mesmo bug de back_url do TLD .website: sempre a raiz (o MP anexa
      // ?external_reference=... e /retorno-pagamento roteia).
      back_urls: { success: getSiteUrl(), pending: getSiteUrl(), failure: getSiteUrl() },
      marketplace_fee: computeMarketplaceFee(amount, feePct),
    })
    return { initPoint: pref.init_point }
  } catch (e) {
    console.error('[checkout] preference avulsa falhou', e)
    await admin.from('payments').update({ status: 'failed' }).eq('id', payment.id)
    return { error: 'Não foi possível iniciar o pagamento. Tente novamente.' }
  }
}
