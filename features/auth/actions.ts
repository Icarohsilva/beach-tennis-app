'use server'
// features/auth/actions.ts
import { createClient, createAdminClient } from '@/lib/supabase/server'

// Limpa a flag must_change_password no Auth após o usuário definir a nova senha.
export async function clearMustChangePassword(): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const admin = createAdminClient()
  const { error } = await admin.auth.admin.updateUserById(user.id, {
    user_metadata: { ...user.user_metadata, must_change_password: false },
  })
  if (error) return { error: 'Não foi possível concluir.' }
  return {}
}
