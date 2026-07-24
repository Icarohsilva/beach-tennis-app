'use server'
// features/account/actions.ts
// Solicitação de exclusão de conta (LGPD, art. 18). Registra o PEDIDO; a execução
// técnica (anonimizar/deletar dados) é manual e deliberada — este projeto já teve
// bugs sérios de FK em purges destrutivas automatizadas (ver memória do projeto),
// então deleção em cascata automática fica de fora de propósito.
import { createClient, createAdminClient, getActiveOrgId } from '@/lib/supabase/server'
import { sendEmail } from '@/lib/notifications/email'

export async function requestAccountDeletion(reason: string): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const admin = createAdminClient()
  const organizationId = await getActiveOrgId()

  const { error } = await admin.from('account_deletion_requests').insert({
    user_id: user.id,
    organization_id: organizationId,
    reason: reason.trim() || null,
  })
  if (error) return { error: 'Não foi possível registrar a solicitação. Tente novamente.' }

  try {
    const to = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? 'suporte@arenahub.website'
    await sendEmail({
      to,
      subject: 'Nova solicitação de exclusão de conta',
      html: `<p>${user.email ?? user.id} solicitou exclusão de conta.</p><p>Motivo: ${reason.trim() || '(não informado)'}</p>`,
    })
  } catch (e) {
    console.error('[account] falha ao notificar solicitação de exclusão por e-mail', e)
  }

  return {}
}
