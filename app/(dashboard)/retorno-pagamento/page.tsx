// app/(dashboard)/retorno-pagamento/page.tsx
// O MP devolve o usuário na RAIZ (bug do validador com o TLD .website — ver
// features/platform-billing/actions.ts). O middleware manda para cá; esta
// página descobre de QUEM é o retorno e redireciona. Nunca aplica efeitos —
// isso é papel do webhook.
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'

export default async function RetornoPagamentoPage({
  searchParams,
}: {
  searchParams: { preapproval_id?: string; external_reference?: string }
}) {
  const admin = createAdminClient()

  const preapprovalId = searchParams.preapproval_id
  if (preapprovalId) {
    // Assinatura de aluno?
    const { data: studentSub } = await admin
      .from('student_subscriptions')
      .select('id')
      .eq('gateway_subscription_id', preapprovalId)
      .maybeSingle()
    if (studentSub) redirect('/financeiro?retorno=assinatura')
    // Senão: assinatura SaaS da academia (fluxo existente).
    redirect('/admin/assinatura')
  }

  const externalRef = searchParams.external_reference
  if (externalRef) {
    const { data: payment } = await admin
      .from('payments')
      .select('id, type')
      .eq('id', externalRef)
      .maybeSingle()
    if (payment?.type === 'day_use') redirect('/agendar/dayuse?retorno=1')
    if (payment) redirect('/financeiro?retorno=avulso')
  }

  redirect('/home')
}
