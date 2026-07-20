// features/aulas/authGuards.ts
// Guarda de auth compartilhada entre as server actions de aulas. NÃO é
// 'use server' — é um helper importável.
import { createClient, createAdminClient, getActiveOrgId } from '@/lib/supabase/server'

/** Exige admin da academia ativa. Retorna { userId, orgId } ou { error }. */
export async function requireAdmin(): Promise<{ userId: string; orgId: string; error?: string }> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { userId: '', orgId: '', error: 'Não autenticado.' }

  const orgId = await getActiveOrgId()
  if (!orgId) return { userId: user.id, orgId: '', error: 'Academia ativa não encontrada.' }

  // Papel é por-academia: vem da membership da academia ativa.
  const adminClient = createAdminClient()
  const { data: membership } = await adminClient
    .from('memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .single()

  if (membership?.role !== 'admin') {
    return { userId: user.id, orgId, error: 'Sem permissão de administrador.' }
  }
  return { userId: user.id, orgId }
}
