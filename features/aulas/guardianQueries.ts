// features/aulas/guardianQueries.ts
// Quem são os dependentes do responsável logado.
//
// Módulo separado de guardianActions.ts porque é leitura, não ação: a home precisa
// dela para montar a ficha da aula kids (uma linha por filho), e um arquivo
// `'use server'` só pode exportar função assíncrona — tipo exportado dali não
// compila. Mesma consulta que /perfil já fazia (app/(dashboard)/perfil/page.tsx),
// agora num lugar só.
import { createAdminClient, getActiveOrgId, getAuthUser } from '@/lib/supabase/server'
import { requestCache } from '@/lib/utils/requestCache'

/** Um dependente do responsável, como as telas do aluno precisam dele. */
export interface GuardianDependent {
  id: string
  name: string
}

/**
 * Dependentes ativos do usuário logado na academia ativa, em ordem de nome.
 *
 * Lista vazia quando o próprio usuário é dependente (dependente não tem
 * dependente) ou quando não há ninguém — os dois casos significam a mesma coisa
 * para a tela: nenhuma linha de filho na ficha da aula.
 *
 * Memoizada por request no padrão dos helpers de lib/supabase/server.ts: a home
 * pergunta isto uma vez para montar a agenda e a ficha da aula pergunta de novo.
 */
export const listGuardianDependents = requestCache(
  async function listGuardianDependents(): Promise<GuardianDependent[]> {
    const user = await getAuthUser()
    if (!user) return []
    const orgId = await getActiveOrgId()
    if (!orgId) return []

    const adminClient = createAdminClient()

    // Teto natural (os filhos de uma pessoa), então `.select()` direto — não é
    // leitura que cresce com o tamanho da academia.
    const { data: membersRaw } = await adminClient
      .from('memberships')
      .select('user_id')
      .eq('parent_id', user.id)
      .eq('organization_id', orgId)
      .eq('is_dependent', true)
      // Dependente inativado pela academia sai da lista: ele não agenda mais, e
      // mantê-lo com botão de "Entrar" prometeria o que a reserva vai negar.
      .is('archived_at', null)

    const ids = ((membersRaw ?? []) as { user_id: string }[]).map((m) => m.user_id)
    if (ids.length === 0) return []

    const { data: namesRaw } = await adminClient
      .from('profiles')
      .select('id, full_name')
      .in('id', ids)

    const nameById = new Map(
      ((namesRaw ?? []) as { id: string; full_name: string | null }[]).map((p) => [
        p.id,
        p.full_name ?? '',
      ]),
    )

    return ids
      .map((id) => ({ id, name: nameById.get(id) ?? '' }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  },
)
