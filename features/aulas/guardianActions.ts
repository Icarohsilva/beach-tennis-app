'use server'
// features/aulas/guardianActions.ts
// O responsável agindo pelo dependente: entrar na aula kids, sair, fila de espera.
//
// Por que existe: o dependente NÃO tem usuário de auth (a FK para auth.users caiu
// em 20260626000300), então ele nunca vai apertar um botão. Antes disso, só o
// admin conseguia colocar uma criança numa aula — o pai via a turma do filho e não
// tinha o que fazer com ela. Estas ações são a porta que faltava.
//
// Nenhuma regra de academia mora aqui. A autorização (você é o responsável dele?)
// é o único assunto deste arquivo; cota, crédito, capacidade e Liga continuam onde
// sempre estiveram, resolvidos NA MEMBERSHIP DO DEPENDENTE por bookSessionAs e
// companhia. Duplicá-las aqui era o caminho certo para as duas versões desandarem.

import { createAdminClient, getActiveOrgId, getAuthUser } from '@/lib/supabase/server'
import { bookSessionAs, cancelBookingAs } from './actions'
import { joinWaitlistAs, leaveWaitlistAs } from './waitlistActions'
import { listGuardianDependents } from './guardianQueries'
import type { PayWith } from '@/types'

/**
 * Confere que `dependentId` é dependente ativo de quem está logado, nesta academia.
 *
 * Mesmo formato de verificação de `subscribeToPlanCheckout`
 * (features/financeiro/checkoutActions.ts), que já era o único caminho
 * responsável→dependente do sistema. As três condições importam:
 * `is_dependent` (não é um adulto qualquer), `parent_id` (é SEU dependente) e
 * `archived_at is null` (não foi excluído da academia — reativar cadastro é
 * decisão da academia, não do responsável).
 */
async function assertGuardianOf(dependentId: string): Promise<string | null> {
  const user = await getAuthUser()
  if (!user) return 'Não autenticado.'

  const orgId = await getActiveOrgId()
  if (!orgId) return 'Academia ativa não encontrada.'

  const { data } = await createAdminClient()
    .from('memberships')
    .select('is_dependent, parent_id, archived_at')
    .eq('user_id', dependentId)
    .eq('organization_id', orgId)
    .maybeSingle()

  const membership = data as
    | { is_dependent: boolean; parent_id: string | null; archived_at: string | null }
    | null

  if (!membership || !membership.is_dependent || membership.parent_id !== user.id) {
    return 'Sem permissão.'
  }
  if (membership.archived_at) {
    return 'O cadastro deste dependente está inativo. Fale com a academia.'
  }
  return null
}

/**
 * Ids dos dependentes do responsável logado — a lista que autoriza sair de uma
 * aula ou de uma fila. Sair parte da reserva, não do aluno, então a checagem tem
 * de ser "esta reserva é de algum filho meu?" em vez de "este filho é meu?".
 */
async function myDependentIds(): Promise<string[]> {
  return (await listGuardianDependents()).map((d) => d.id)
}

/** Coloca um dependente na aula. */
export async function bookSessionForDependent(
  sessionId: string,
  dependentId: string,
  payWith?: PayWith,
): Promise<{ error?: string }> {
  const denial = await assertGuardianOf(dependentId)
  if (denial) return { error: denial }
  return bookSessionAs(dependentId, sessionId, { payWith })
}

/** Tira um dependente da aula. Estorno e falta seguem a regra normal do aluno. */
export async function cancelBookingForDependent(
  bookingId: string,
): Promise<{ error?: string }> {
  return cancelBookingAs(bookingId, await myDependentIds())
}

/** Coloca um dependente na fila de espera de uma turma kids lotada. */
export async function joinWaitlistForDependent(
  sessionId: string,
  dependentId: string,
): Promise<{ error?: string; position?: number }> {
  const denial = await assertGuardianOf(dependentId)
  if (denial) return { error: denial }
  return joinWaitlistAs(dependentId, sessionId)
}

/** Tira um dependente da fila de espera. */
export async function leaveWaitlistForDependent(
  waitlistId: string,
): Promise<{ error?: string }> {
  return leaveWaitlistAs(waitlistId, await myDependentIds())
}
