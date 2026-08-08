'use server'
// features/liga/actions.ts
// Ações do próprio aluno na Liga.
import { revalidatePath } from 'next/cache'
import { createClient, createAdminClient, getCurrentOrgId } from '@/lib/supabase/server'

/**
 * Marca as medalhas como vistas, encerrando a comemoração.
 *
 * O filtro por `student_id` do usuário da sessão não é redundante com o id da medalha:
 * o id vem do cliente, e sem esse filtro qualquer pessoa poderia apagar a comemoração
 * de outro aluno passando ids alheios. Mesma classe de IDOR que
 * `features/organizations/actions.ts` já documenta.
 */
export async function markLigaMedalsSeen(medalIds: string[]): Promise<{ error?: string }> {
  if (medalIds.length === 0) return {}

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'Academia não encontrada.' }

  const { error } = await createAdminClient()
    .from('liga_medals')
    .update({ seen_at: new Date().toISOString() })
    .in('id', medalIds.slice(0, 50))
    .eq('student_id', user.id)
    .eq('organization_id', orgId)

  if (error) return { error: 'Erro ao registrar as medalhas.' }

  revalidatePath('/liga')
  return {}
}
