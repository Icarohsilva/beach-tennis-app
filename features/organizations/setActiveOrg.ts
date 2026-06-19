'use server'
// features/organizations/setActiveOrg.ts
// Grava a academia ativa num cookie httpOnly. Valida que a org é uma membership do
// usuário (defesa: ninguém ativa uma academia da qual não participa).
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { ACTIVE_ORG_COOKIE } from '@/lib/org/activeOrg'

export async function setActiveOrg(orgId: string): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  // memberships do usuário são legíveis por ele (RLS memberships_select_own).
  const { data: membership } = await supabase
    .from('memberships')
    .select('organization_id')
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!membership) return { error: 'Você não participa desta academia.' }

  cookies().set(ACTIVE_ORG_COOKIE, orgId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  })
  return {}
}
